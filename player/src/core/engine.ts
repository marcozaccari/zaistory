/**
 * Il loop che fa avanzare una partita.
 *
 * L'engine non sa chi lo sta guidando: parla solo con una `PlayerUI`. Le
 * implementazioni sono tre — il terminale, l'esecutore di script di
 * playthrough e il player web — e nessuna di loro cambia una virgola di questa
 * logica. E' il motivo per cui il core sta in un modulo separato: la stessa
 * partita, giocata a mano su un telefono o rigiocata da uno script in CI, deve
 * dare lo stesso risultato.
 *
 * I metodi della UI sono asincroni perche' un browser non puo' bloccarsi in
 * attesa di un tap: e' l'unica differenza rispetto al loop sincrono da cui
 * questo codice deriva.
 */

import type { Action, DialogueChoice, DialogueNode, Scene, Story } from './types.js';
import { findAction, findScene, isRepeatable, sceneHasExit } from './types.js';
import { GameState, type EffectSink, type Transition } from './state.js';

/** Uscita volontaria dal player. */
export class QuitError extends Error {
  constructor() {
    super('uscita richiesta');
  }
}

/** Uno script di playthrough e' finito mentre il gioco chiedeva ancora input. */
export class ScriptEndedError extends Error {
  constructor() {
    super('script di playthrough esaurito');
  }
}

/** Un'azione filtrata da una condizione, con il motivo. */
export interface HiddenAction {
  action: Action;
  reason: string;
}

/** Una scelta di dialogo filtrata da una condizione. */
export interface HiddenChoice {
  choice: DialogueChoice;
  reason: string;
}

export interface ActionPrompt {
  story: Story;
  scene: Scene;
  state: GameState;
  available: Action[];
  hidden: HiddenAction[];
  /** Vero se dalla scena non esce nessun goto_scene: e' un finale della
   * storia, non un vicolo cieco. */
  terminal: boolean;
}

export interface ChoicePrompt {
  story: Story;
  scene: Scene;
  state: GameState;
  nodeId: string;
  node: DialogueNode;
  available: DialogueChoice[];
  hidden: HiddenChoice[];
}

/** La risposta della UI a un prompt. */
export interface Command {
  quit?: boolean;
  actionId?: string;
  choiceIndex?: number;
}

/** L'esito della partita. */
export interface Outcome {
  reason: string;
  /** Scena in cui ci si e' fermati. */
  scene: string;
  /** Scelte effettuate. */
  steps: number;
  /** La storia e' finita in modo previsto. */
  ended: boolean;
  /** Il giocatore ha abbandonato. */
  quit: boolean;
  /** Bug di giocabilita' incontrati durante la partita. */
  problems: string[];
  /** Sequenza di token rigiocabile. */
  trace: string[];
}

/** Tutto cio' che l'engine sa del mondo esterno. */
export interface PlayerUI extends EffectSink {
  /**
   * Delimitano l'applicazione di un singolo `Effect`.
   *
   * Servono solo alla presentazione: `State.apply` chiama `narration`,
   * `stateChange` e `sound` nell'ordine fissato dallo schema, che e' l'ordine
   * *di applicazione* e non necessariamente quello in cui conviene mostrarli.
   * Sapere dove un effetto comincia e finisce permette a una UI di raccoglierne
   * l'esito e disporlo come vuole — per esempio i prompt delle risorse prima
   * del testo — senza che l'ordine con cui lo stato cambia venga toccato.
   * Sono opzionali: una UI che non ha esigenze di impaginazione le ignora.
   */
  beginEffect?(): void;
  endEffect?(): void;

  sceneEnter(state: GameState, scene: Scene): void | Promise<void>;
  beat(scene: Scene, beat: NonNullable<Scene['narration']>[number], index: number, total: number): void | Promise<void>;
  line(scene: Scene, nodeId: string, node: DialogueNode): void | Promise<void>;
  notice(text: string): void;
  problem(text: string): void;
  chooseAction(p: ActionPrompt): Promise<Command>;
  chooseChoice(p: ChoicePrompt): Promise<Command>;
  finish(o: Outcome): void;
}

export class Engine {
  readonly story: Story;
  readonly state = new GameState();
  readonly ui: PlayerUI;
  maxSteps = 10000;

  private outcome: Outcome = {
    reason: '',
    scene: '',
    steps: 0,
    ended: false,
    quit: false,
    problems: [],
    trace: [],
  };

  constructor(story: Story, ui: PlayerUI) {
    this.story = story;
    this.ui = ui;
  }

  /** La sequenza di token giocata finora. */
  trace(): string[] {
    return this.outcome.trace;
  }

  /** Applica un Effect segnalando alla UI dove comincia e dove finisce. */
  private applyEffect(e: Parameters<GameState['apply']>[0]): Transition {
    this.ui.beginEffect?.();
    try {
      return this.state.apply(e, this.ui);
    } finally {
      this.ui.endEffect?.();
    }
  }

  private problem(msg: string): void {
    this.outcome.problems.push(msg);
    this.ui.problem(msg);
  }

  private record(tok: string): void {
    this.outcome.trace.push(tok);
    this.outcome.steps++;
  }

  /** Gioca la storia dall'inizio fino a un finale, a un vicolo cieco o
   * all'uscita del giocatore. */
  async run(): Promise<Outcome> {
    let sceneId = this.story.start_scene;

    for (;;) {
      const sc = findScene(this.story, sceneId);
      if (!sc) {
        this.problem(`goto verso la scena inesistente "${sceneId}"`);
        this.outcome.reason = 'transizione verso una scena inesistente';
        break;
      }

      await this.enterScene(sc);

      try {
        await this.playNarration(sc);
        const next = await this.playScene(sc);
        if (!next) break;
        sceneId = next;
      } catch (err) {
        this.finishErr(err, sc);
        break;
      }
    }

    this.outcome.scene = this.state.scene;
    this.ui.finish(this.outcome);
    return this.outcome;
  }

  private finishErr(err: unknown, sc: Scene): void {
    this.outcome.scene = sc.id;
    if (err instanceof QuitError) {
      this.outcome.quit = true;
      this.outcome.reason = 'partita abbandonata dal giocatore';
    } else if (err instanceof ScriptEndedError) {
      this.outcome.reason = 'script di playthrough esaurito prima della fine della storia';
    } else {
      this.outcome.reason = err instanceof Error ? err.message : String(err);
    }
  }

  private async enterScene(sc: Scene): Promise<void> {
    this.state.scene = sc.id;
    this.state.history.push(sc.id);
    for (const f of sc.on_enter_flags_set ?? []) this.state.flags.add(f);
    await this.ui.sceneEnter(this.state, sc);
  }

  private async playNarration(sc: Scene): Promise<void> {
    const beats = sc.narration ?? [];
    for (let i = 0; i < beats.length; i++) {
      await this.ui.beat(sc, beats[i], i, beats.length);
    }
  }

  /** Gestisce azioni e dialoghi di una scena. Ritorna l'id della scena
   * successiva, oppure "" se la partita si ferma qui. */
  private async playScene(sc: Scene): Promise<string> {
    for (;;) {
      if (this.outcome.steps > this.maxSteps) {
        throw new Error(`superati ${this.maxSteps} passi: la storia sembra in loop`);
      }

      const { available, hidden } = this.actions(sc);
      if (available.length === 0) {
        // Nessuna azione disponibile. Se dalla scena non esce comunque nessuna
        // transizione e' un finale della storia; altrimenti e' il bug che
        // questo player esiste per trovare.
        if (!sceneHasExit(sc)) {
          this.outcome.ended = true;
          this.outcome.reason = 'fine della storia';
          return '';
        }
        this.problem(
          `scena "${sc.id}": nessuna azione disponibile ma la scena avrebbe un'uscita (condizioni mai soddisfatte?)`,
        );
        this.outcome.reason = 'vicolo cieco: nessuna azione disponibile';
        return '';
      }

      let cmd: Command;
      try {
        cmd = await this.ui.chooseAction({
          story: this.story,
          scene: sc,
          state: this.state,
          available,
          hidden,
          terminal: !sceneHasExit(sc),
        });
      } catch (err) {
        // Uno script che finisce in una scena terminale non e' un test
        // fallito: e' una storia arrivata al suo finale.
        if (err instanceof ScriptEndedError && !sceneHasExit(sc)) {
          this.outcome.ended = true;
          this.outcome.reason = 'fine della storia (scena terminale)';
          return '';
        }
        throw err;
      }
      if (cmd.quit) throw new QuitError();

      const act = findAction(sc, cmd.actionId ?? '');
      if (!act) {
        this.problem(`azione "${cmd.actionId}" inesistente nella scena "${sc.id}"`);
        continue;
      }
      this.record(`a:${act.id}`);
      if (!isRepeatable(act)) this.state.consume(sc.id, act.id);

      const tr = this.applyEffect(act.effect);
      const followed = await this.follow(sc, tr);
      if (followed.done) return followed.next;
    }
  }

  /** Esegue una transizione. */
  private async follow(sc: Scene, tr: Transition): Promise<{ next: string; done: boolean }> {
    if (tr.kind === 'scene') return { next: tr.target, done: true };
    if (tr.kind === 'dialogue') {
      const next = await this.playDialogue(sc, tr.target);
      if (next) return { next, done: true };
      return { next: '', done: false };
    }
    return { next: '', done: false };
  }

  /** Percorre il dialogue tree della scena a partire da un nodo. Ritorna l'id
   * di una scena se il dialogo porta fuori, "" se si torna alle azioni. */
  private async playDialogue(sc: Scene, nodeId: string): Promise<string> {
    for (;;) {
      if (this.outcome.steps > this.maxSteps) {
        throw new Error(`superati ${this.maxSteps} passi: il dialogo sembra in loop`);
      }
      if (!sc.dialogue_tree) {
        this.problem(`scena "${sc.id}": goto_dialogue "${nodeId}" ma la scena non ha dialogue_tree`);
        return '';
      }
      const node = sc.dialogue_tree.nodes[nodeId];
      if (!node) {
        this.problem(`scena "${sc.id}": nodo di dialogo inesistente "${nodeId}"`);
        return '';
      }

      await this.ui.line(sc, nodeId, node);

      const tr = this.applyEffect(node.effect);
      if (tr.kind === 'scene') return tr.target;
      if (tr.kind === 'dialogue') {
        nodeId = tr.target;
        continue;
      }

      const { available, hidden } = this.choices(node);
      if (available.length > 0) {
        const cmd = await this.ui.chooseChoice({
          story: this.story,
          scene: sc,
          state: this.state,
          nodeId,
          node,
          available,
          hidden,
        });
        if (cmd.quit) throw new QuitError();
        const idx = cmd.choiceIndex ?? -1;
        if (idx < 0 || idx >= available.length) {
          this.problem(`scelta fuori range nel nodo "${nodeId}"`);
          continue;
        }
        const ch = available[idx];
        this.record(`c:${ch.goto}`);

        const chTr = this.applyEffect(ch.effect);
        if (chTr.kind === 'scene') return chTr.target;
        nodeId = chTr.kind === 'dialogue' ? chTr.target : ch.goto;
        continue;
      }

      if (node.end) return '';
      if (node.next) {
        nodeId = node.next;
        continue;
      }

      // Nodo senza scelte disponibili, senza next e senza end: o le condizioni
      // hanno filtrato tutto, o il compilatore ha lasciato un ramo monco. In
      // entrambi i casi e' un bug da segnalare, non da nascondere tornando in
      // silenzio alle azioni.
      if (node.choices && node.choices.length > 0) {
        this.problem(
          `scena "${sc.id}", nodo "${nodeId}": tutte le scelte sono filtrate da una condizione e non c'e' next/end`,
        );
      } else {
        this.problem(`scena "${sc.id}", nodo "${nodeId}": nessuna scelta, nessun next, nessun end`);
      }
      this.ui.notice('(il dialogo si interrompe: si torna alle azioni della scena)');
      return '';
    }
  }

  /** Divide le azioni della scena tra disponibili e nascoste. */
  actions(sc: Scene): { available: Action[]; hidden: HiddenAction[] } {
    const available: Action[] = [];
    const hidden: HiddenAction[] = [];
    for (const a of sc.actions) {
      if (!isRepeatable(a) && this.state.consumed(sc.id, a.id)) {
        hidden.push({ action: a, reason: "gia' usata (repeatable: false)" });
        continue;
      }
      const { ok, why } = this.state.meets(a.condition);
      if (!ok) {
        hidden.push({ action: a, reason: why });
        continue;
      }
      available.push(a);
    }
    return { available, hidden };
  }

  private choices(n: DialogueNode): { available: DialogueChoice[]; hidden: HiddenChoice[] } {
    const available: DialogueChoice[] = [];
    const hidden: HiddenChoice[] = [];
    for (const c of n.choices ?? []) {
      const { ok, why } = this.state.meets(c.condition);
      if (!ok) hidden.push({ choice: c, reason: why });
      else available.push(c);
    }
    return { available, hidden };
  }
}
