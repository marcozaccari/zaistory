/**
 * Il turno: cosa succede quando il giocatore scrive una riga.
 *
 * Qui vive l'ordine di precedenza, che non è un dettaglio di implementazione ma
 * una decisione di gioco:
 *
 * 1. **le domande sull'interfaccia** («cosa posso fare», «guardati intorno»),
 *    prima di tutto. Non sono tentativi di agire sul mondo, e lasciarle
 *    somigliare agli alias di un'entità significava farle *partire*: una
 *    domanda non può applicare un effetto;
 * 2. **il parser**: un'azione della fase, oppure un'uscita;
 * 3. **i verbi di sistema** (inventario, chi c'è, dove si può andare), dopo il
 *    parser, perché un'azione d'autore vince sempre su un verbo di sistema;
 * 4. **una cosa che è qui**, se la frase ne nomina una — in mano, nella stanza o
 *    in piedi accanto: si legge la sua descrizione invece del fallback generico,
 *    perché il fallback è scritto per l'intenzione e di quella cosa non sa
 *    niente;
 * 5. **il fallback per intenzione**, scritto dall'autore.
 *
 * E il vincolo che vale su tutto: qui non si inventa una parola. Ogni riga che
 * il giocatore legge sta nella storia. Dove non c'è, il player tace e lo segnala
 * come diagnostica — un buco deve vedersi come un buco.
 */

import type {
  Character,
  DialogueChoice,
  DialogueNode,
  Item,
  NarrationBeat,
  NoMatch,
  Prop,
  StoryIndex,
  VoiceSpec,
} from './types.js';

/** Quello che le tre specie di bersaglio hanno in comune: un id, dei nomi con
 * cui il giocatore le chiama, e una descrizione. È tutto ciò che serve per
 * rispondere a «guarda quella cosa». */
type Describable = Item | Prop | Character;

/** Una cosa che è qui, e di che specie: la specie non si ricava dall'oggetto —
 * le tre interfacce si somigliano troppo — e serve a chi la mostra. */
interface Found {
  kind: Named['kind'];
  entity: Describable;
}
import { displayName, pick, surfaces, textNow } from './types.js';
import { GameState } from './state.js';
import type { EffectSink, Jump } from './state.js';
import {
  availableActions,
  candidateActions,
  currentPhase,
  currentPlace,
  enterPlace,
  exitLabel,
  knownExits,
  lookNow,
  nothingLeftToDo,
  openExits,
  start,
  transitionFor,
  visibleProps,
} from './engine.js';
import { bestAffinity, roots } from './lexical.js';
import { classifyIntent, isEarlyQuestion, systemQuestion } from './verbs.js';
import { parse, type Resolution } from './parser.js';

/** Quanto deve somigliare la frase al nome di una cosa che è qui perché la
 * risposta parli di *quella* cosa. Più alta della soglia del parser, perché
 * qui manca il filtro del verbo: senza margine qualunque frase somiglierebbe
 * vagamente a qualcosa nella stanza. */
const NAMED_ENTITY_FLOOR = 0.6;

export type EventKind =
  | 'narration'
  | 'say'
  | 'system'
  | 'sound'
  | 'state'
  | 'choice'
  | 'problem'
  | 'note';

export interface TurnEvent {
  kind: EventKind;
  text: string;
  speaker?: string;
  voice?: VoiceSpec;
  /** Per i beat con un'inquadratura: quello che il palco deve mostrare. */
  beat?: NarrationBeat;
  /** Per i suoni: da quale campo della storia arriva questo prompt. Sono tre —
   * il suono di un beat, quello di un `Effect`, l'ambiente di un'inquadratura —
   * e chiamarli tutti allo stesso modo li farebbe sembrare la stessa cosa. */
  field?: string;
  /** Chi ha deciso questa risposta. Si mostra sempre, non solo in debug: un
   * rapporto di copertura non dice cosa si prova a giocarci. */
  by?: string;
  /** Per la descrizione di una cosa nominata: **quale** cosa.
   *
   * Sta qui perché a sceglierla è il parser, e un'interfaccia che volesse
   * mostrarne la figura dovrebbe altrimenti rifare da capo quella scelta —
   * cioè duplicare fuori dal core la regola che dice cosa il giocatore ha
   * nominato. Il core non decide che se ne faccia: dice solo di chi sta
   * parlando. */
  about?: Named;
}

/** Una delle tre specie di bersaglio, con l'id che la ritrova nell'indice. */
export interface Named {
  kind: 'item' | 'prop' | 'character';
  id: string;
}

export interface TurnResult {
  events: TurnEvent[];
  /** Le scelte di dialogo aperte adesso, se ce n'è. Nel dialogo l'elenco si
   * vede sempre: si agisce a parole, si parla a scelte. */
  choices?: { index: number; text: string }[];
  /** L'unica uscita rimasta, quando nel luogo non resta niente da fare. */
  suggestedExit?: { label: string; to: string };
  ended?: { kind: 'natural' | 'premature'; label?: string };
  /**
   * Il turno non ha risolto niente.
   *
   * Né un'azione, né un'uscita, né una domanda sull'interfaccia, né una cosa
   * che è qui: quello che si è letto è il ripiego per intenzione. Il core non
   * decide che farne — lo dice e basta — ma chi tiene una traccia rigiocabile
   * ha bisogno di saperlo: una frase che non ha mosso la storia non la muoverà
   * nemmeno rigiocandola, e nel salvataggio è solo un tentativo andato a vuoto.
   */
  noMatch?: boolean;
}

/**
 * Una partita. Tiene lo stato, il luogo e — quando è aperto — il nodo di
 * dialogo corrente, ed è l'unica interfaccia di cui web e CLI hanno bisogno.
 */
export class Session {
  readonly state: GameState;
  private dialogue?: { node: string };
  private events: TurnEvent[] = [];
  /** L'ultima fase che il giocatore ha visto entrare in scena.
   *
   * Serve perché **una fase può cambiare senza cambiare luogo**: un'azione alza
   * un flag, la condizione della fase seguente diventa vera, e il posto è
   * un'altra cosa pur essendo lo stesso posto. Se il player non se ne accorge,
   * la narrazione di quella fase non si legge mai — e se quella fase è un
   * finale, la storia non finisce. */
  private lastPhase = '';
  /** Vale per il turno corrente: la mette `input()`, la legge `fallback()`. */
  private chooseFallback?: (pool: NoMatch[]) => string | undefined;

  constructor(readonly idx: StoryIndex) {
    const carry = new Set((idx.story.carry_flags ?? []).map((c) => c.id));
    this.state = new GameState(carry);
  }

  private sink: EffectSink = {
    narration: (text, voice) => this.push({ kind: 'narration', text, voice }),
    sound: (prompt) => this.push({ kind: 'sound', text: prompt }),
    stateChange: (desc) => this.push({ kind: 'state', text: desc }),
  };

  private push(e: TurnEvent): void {
    this.events.push(e);
  }

  private flush(): TurnResult {
    if (!this.state.ended && !this.dialogue) this.settlePhase();
    const events = this.events;
    this.events = [];
    const res: TurnResult = { events };

    if (this.state.ended) {
      res.ended = this.state.ended;
      return res;
    }
    if (this.dialogue) {
      const open = this.openChoices();
      if (open.length) res.choices = open.map((c, i) => ({ index: i, text: c.text }));
      return res;
    }
    const pl = currentPlace(this.idx, this.state);
    const ph = currentPhase(pl, this.state);
    // Quando gli enigmi sono finiti non c'è più niente da proteggere, e
    // continuare a chiedere di indovinare la frase giusta è solo un muro. Una
    // sola uscita, però: dove sono due, mostrarle è stampare il menu delle
    // scelte, che è esattamente ciò che non si fa.
    if (ph && nothingLeftToDo(this.idx, pl, ph, this.state)) {
      const open = openExits(pl, this.state);
      if (open.length === 1) {
        res.suggestedExit = { label: exitLabel(this.idx, open[0]), to: open[0].to };
      }
    }
    return res;
  }

  // ------------------------------------------------------------- avvio

  begin(): TurnResult {
    const r = start(this.idx, this.state, this.sink);
    this.emitEnter(r);
    return this.flush();
  }

  private emitEnter(r: ReturnType<typeof enterPlace>): void {
    if (r.problem) this.push({ kind: 'problem', text: r.problem });
    for (const b of r.beats) {
      this.push({ kind: 'narration', text: b.text, voice: b.voice, beat: b });
      if (b.sound_effect_prompt) {
        this.push({ kind: 'sound', text: b.sound_effect_prompt, field: 'sound_effect_prompt' });
      }
    }
    if (r.phase) this.lastPhase = r.phase.id;
    if (r.ending) this.state.ended = r.ending;
  }

  /**
   * Se la fase corrente non è più quella che il giocatore ha visto, la fa
   * entrare: flag d'ingresso, narrazione, ed eventuale finale. È l'equivalente
   * di entrare in una stanza che nel frattempo è diventata un'altra stanza.
   */
  private settlePhase(): void {
    const pl = currentPlace(this.idx, this.state);
    // Due giri al massimo: i flag d'ingresso di una fase possono farne valere
    // un'altra, ma una catena più lunga è un errore di scrittura, non un caso
    // da inseguire.
    for (let i = 0; i < 2; i++) {
      const ph = currentPhase(pl, this.state);
      if (!ph || ph.id === this.lastPhase) return;
      this.lastPhase = ph.id;
      if (ph.on_enter_flags_set?.length) {
        for (const f of ph.on_enter_flags_set) this.state.flags.add(f);
      }
      for (const b of ph.narration ?? []) {
        this.push({ kind: 'narration', text: b.text, voice: b.voice, beat: b });
        if (b.sound_effect_prompt) {
        this.push({ kind: 'sound', text: b.sound_effect_prompt, field: 'sound_effect_prompt' });
      }
      }
      if (ph.ending) {
        this.state.ended = ph.ending;
        return;
      }
    }
  }

  // -------------------------------------------------------------- turno

  /**
   * Una riga scritta dal giocatore.
   *
   * `chooseFallback` è la porta del secondo interprete: dove il player tacerebbe
   * con un fallback per intenzione, chi chiama può scegliere quale delle frasi
   * d'autore usare. Non ne scrive una — riceve la stessa pila che userebbe il
   * player e ne indica una — perché la regola «il player non inventa prosa» non
   * ha eccezioni, nemmeno per i vettori.
   */
  input(text: string, opts?: { chooseFallback?: (pool: NoMatch[]) => string | undefined }): TurnResult {
    if (this.state.ended) return this.flush();
    this.state.turn++;
    this.chooseFallback = opts?.chooseFallback;

    const phrase = text.trim();
    if (!phrase) return this.flush();

    if (this.dialogue) {
      // Dentro un dialogo non si scrive: si sceglie. Rispondere qui con un
      // fallback sarebbe fingere di aver capito male una cosa che il giocatore
      // non doveva scrivere.
      this.push({ kind: 'note', text: 'Nel dialogo si sceglie una battuta dall’elenco.' });
      return this.flush();
    }

    const q = systemQuestion(phrase);
    if (q && isEarlyQuestion(q)) {
      this.answerSystem(q);
      return this.flush();
    }

    const pl = currentPlace(this.idx, this.state);
    const ph = currentPhase(pl, this.state);
    const res = parse({
      idx: this.idx,
      phrase,
      actions: candidateActions(this.idx, pl, ph, this.state),
      exits: knownExits(pl, this.state),
      ok: this.state.ok,
    });

    if (res.kind === 'action') {
      this.runAction(res.action);
      return this.flush();
    }
    if (res.kind === 'exit') {
      this.takeExit(res.exit);
      return this.flush();
    }

    if (q) {
      this.answerSystem(q);
      return this.flush();
    }

    if (this.answerNamedEntity(phrase)) return this.flush();

    this.fallback(res.kind === 'ambiguous' ? res.intent : res.intent);
    const muto = this.flush();
    muto.noMatch = true;
    return muto;
  }

  // --------------------------------------------- il secondo interprete
  //
  // Tre metodi e nient'altro: qui il core non sa che esistano i vettori, sa
  // soltanto che qualcuno può volerci provare dopo di lui. Chi ci prova lo fa
  // **dopo**, e solo dove il lessicale è muto: vedi `vectors.ts`.

  /**
   * Quello che il player farebbe di questa frase, senza farlo.
   *
   * `muto` è l'unico esito in cui ha senso che qualcun altro dica la sua: gli
   * altri tre sono già una risposta — un'azione da eseguire, una domanda
   * sull'interfaccia, la descrizione di una cosa che è qui.
   */
  preview(phrase: string): 'risolta' | 'sistema' | 'nominata' | 'muto' {
    const text = phrase.trim();
    if (!text || this.state.ended || this.dialogue) return 'risolta';

    const q = systemQuestion(text);
    if (q && isEarlyQuestion(q)) return 'sistema';

    const { actions, exits } = this.candidates();
    const res = parse({ idx: this.idx, phrase: text, actions, exits, ok: this.state.ok });
    if (res.kind === 'action' || res.kind === 'exit') return 'risolta';
    if (q) return 'sistema';
    return this.findNamedEntity(text) ? 'nominata' : 'muto';
  }

  /** Le candidate di adesso: le stesse che vede il parser. */
  candidates(): { actions: import('./types.js').Action[]; exits: import('./types.js').Exit[] } {
    const pl = currentPlace(this.idx, this.state);
    const ph = currentPhase(pl, this.state);
    return {
      actions: candidateActions(this.idx, pl, ph, this.state),
      exits: knownExits(pl, this.state),
    };
  }

  /** I fallback d'autore in vigore adesso: prima quelli della fase, poi quelli
   * globali. È la pila fra cui si sceglie, mai una da cui scrivere. */
  fallbackPool(): NoMatch[] {
    const ph = currentPhase(currentPlace(this.idx, this.state), this.state);
    return [...(ph?.no_match_narration ?? []), ...(this.idx.story.player_voice?.no_match_narration ?? [])];
  }

  /** Esegue una risoluzione decisa da un secondo interprete. Vale un turno come
   * gli altri: da qui in poi la strada è la stessa del lessicale. */
  takeResolution(res: Resolution): TurnResult {
    if (this.state.ended) return this.flush();
    this.state.turn++;
    if (res.kind === 'action') this.runAction(res.action);
    else if (res.kind === 'exit') this.takeExit(res.exit);
    return this.flush();
  }

  // ------------------------------------------------------------- azioni

  private runAction(a: import('./types.js').Action): void {
    const check = this.state.meets(a.condition);
    if (!check.ok) {
      // Un'azione bloccata non applica niente: nessun flag, nessuna
      // transizione, nessun oggetto. L'engine non sa nemmeno che è successo.
      if (a.blocked_narration) {
        this.push({ kind: 'narration', text: a.blocked_narration, by: 'lessicale' });
      } else {
        this.push({ kind: 'note', text: `manca blocked_narration su "${a.id}" (${check.why})` });
        this.fallback(classifyIntentOfAction(a));
      }
      return;
    }

    this.state.markExecuted(a.id);
    if (a.repeatable === false) this.state.consume(a.id);

    const jump = this.state.apply(a.effect, this.sink);
    this.follow(jump);
  }

  private follow(jump: Jump): void {
    if (jump.kind === 'dialogue') {
      this.openDialogue(jump.target);
      return;
    }
    if (jump.kind === 'place') {
      const r = enterPlace(this.idx, this.state, jump.target, this.sink);
      this.emitEnter(r);
    }
  }

  private takeExit(e: import('./types.js').Exit): void {
    const check = this.state.meets(e.condition);
    if (!check.ok) {
      if (e.blocked_narration) {
        this.push({ kind: 'narration', text: e.blocked_narration, by: 'lessicale' });
      } else {
        this.push({ kind: 'note', text: `manca blocked_narration sull'uscita verso "${e.to}" (${check.why})` });
        this.fallback('movement');
      }
      return;
    }

    const before: NarrationBeat[] = [];
    const t = transitionFor(this.state.place, e, this.state);
    if (t) {
      this.state.markTransition(t.key);
      before.push(...t.transition.narration);
    }
    const r = enterPlace(this.idx, this.state, e.to, this.sink, before);
    this.emitEnter(r);
  }

  // ------------------------------------------------------------ dialogo

  private openDialogue(nodeId: string): void {
    const ph = currentPhase(currentPlace(this.idx, this.state), this.state);
    const tree = ph?.dialogue;
    if (!tree) {
      this.push({ kind: 'problem', text: 'questa fase non ha nessun dialogo da aprire' });
      return;
    }
    const startId = tree.nodes[nodeId] ? nodeId : tree.start;
    this.dialogue = { node: startId };
    this.playDialogueFrom(startId);
  }

  /** Una scelta di dialogo, per indice nell'elenco mostrato. */
  choose(index: number): TurnResult {
    if (this.state.ended || !this.dialogue) return this.flush();
    const open = this.openChoices();
    const c = open[index];
    if (!c) {
      this.push({ kind: 'note', text: 'scelta non disponibile' });
      return this.flush();
    }
    this.state.turn++;
    // L'effetto di una scelta si applica dopo il tocco e prima del nodo di
    // destinazione: è il posto della didascalia su un ramo.
    const jump = this.state.apply(c.effect, this.sink);
    if (jump.kind !== 'none') {
      this.dialogue = undefined;
      this.follow(jump);
      return this.flush();
    }
    this.playDialogueFrom(c.goto);
    return this.flush();
  }

  private openChoices(): DialogueChoice[] {
    const node = this.dialogueNode();
    return (node?.choices ?? []).filter((c) => this.state.ok(c.condition));
  }

  private dialogueNode(): DialogueNode | undefined {
    if (!this.dialogue) return undefined;
    const ph = currentPhase(currentPlace(this.idx, this.state), this.state);
    return ph?.dialogue?.nodes[this.dialogue.node];
  }

  /** Percorre i nodi finché non trova delle scelte o la fine. */
  private playDialogueFrom(nodeId: string): void {
    const ph = currentPhase(currentPlace(this.idx, this.state), this.state);
    const tree = ph?.dialogue;
    if (!tree) return;

    let id: string | undefined = nodeId;
    const guard = new Set<string>();
    while (id) {
      if (guard.has(id)) {
        this.push({ kind: 'problem', text: `ciclo nel dialogo su "${id}"` });
        break;
      }
      guard.add(id);

      const node: DialogueNode | undefined = tree.nodes[id];
      if (!node) {
        this.push({ kind: 'problem', text: `nodo di dialogo inesistente: "${id}"` });
        break;
      }
      this.dialogue = { node: id };

      const text = pick([node.text, ...(node.text_variants ?? [])], this.state.turn) ?? node.text;
      if (node.speaker === 'narrator') {
        // Una didascalia è prosa, non una voce fuori campo: nessun nome davanti,
        // o si inventerebbe un narratore che nella scena non c'è.
        this.push({ kind: 'narration', text, voice: node.voice_override });
      } else {
        const who = displayName(this.idx.characters.get(node.speaker) ?? { id: node.speaker });
        this.push({ kind: 'say', text, speaker: who, voice: node.voice_override });
      }

      const jump = this.state.apply(node.effect, this.sink);
      if (jump.kind !== 'none') {
        this.dialogue = undefined;
        this.follow(jump);
        return;
      }

      if (node.end) {
        this.dialogue = undefined;
        return;
      }
      if (node.choices?.length) {
        if (this.openChoices().length === 0) {
          // Tutte le scelte filtrate da una condizione: il ramo esiste ma qui
          // non porta da nessuna parte.
          this.push({ kind: 'problem', text: `nessuna scelta disponibile in "${id}"` });
          this.dialogue = undefined;
        }
        return;
      }
      id = node.next;
      if (!id) {
        this.push({ kind: 'problem', text: `nodo monco: "${node.speaker}" non ha né scelte, né next, né end` });
        this.dialogue = undefined;
        return;
      }
    }
  }

  get inDialogue(): boolean {
    return this.dialogue !== undefined;
  }

  // ----------------------------------------------------- verbi di sistema

  private answerSystem(q: import('./verbs.js').SystemQuestion): void {
    const st = this.state;
    const pl = currentPlace(this.idx, st);
    const ph = currentPhase(pl, st);
    const pv = this.idx.story.player_voice;
    const by = 'verbo di sistema';

    switch (q) {
      case 'look_around': {
        const look = lookNow(ph, st);
        if (look) this.push({ kind: 'narration', text: look, by });
        else this.push({ kind: 'note', text: 'manca look in questa fase' });
        return;
      }
      case 'inventory': {
        if (st.inventory.length === 0) {
          const t = pick(pv?.inventory_empty, st.turn);
          if (t) this.push({ kind: 'system', text: t, by });
          else this.push({ kind: 'note', text: 'manca player_voice.inventory_empty' });
          return;
        }
        const names = st.inventory.map((id) => displayName(this.idx.items.get(id) ?? { id }));
        const intro = pick(pv?.inventory_intro, st.turn);
        if (!intro) {
          this.push({ kind: 'note', text: 'manca player_voice.inventory_intro' });
          return;
        }
        this.push({ kind: 'system', text: `${intro} ${list(names)}.`, by });
        return;
      }
      case 'presence': {
        const others = (ph?.characters ?? [])
          .map((c) => c.id)
          .filter((id) => id !== this.idx.story.protagonist);
        if (others.length === 0) {
          const t = pick(pv?.presence_alone, st.turn);
          if (t) this.push({ kind: 'system', text: t, by });
          else this.push({ kind: 'note', text: 'manca player_voice.presence_alone' });
          return;
        }
        const names = others.map((id) => displayName(this.idx.characters.get(id) ?? { id }));
        const intro = pick(pv?.presence_intro, st.turn);
        if (!intro) {
          this.push({ kind: 'note', text: 'manca player_voice.presence_intro' });
          return;
        }
        this.push({ kind: 'system', text: `${intro} ${list(names)}.`, by });
        return;
      }
      case 'exits': {
        const known = knownExits(pl, st);
        if (known.length === 0) {
          const t = pick(pv?.exits_none, st.turn);
          if (t) this.push({ kind: 'system', text: t, by });
          else this.push({ kind: 'note', text: 'manca player_voice.exits_none' });
          return;
        }
        // Il verbo singolo agisce se la scelta è unica, altrimenti mostra
        // l'elenco: una regola sola, la stessa che vale per «parla».
        const open = openExits(pl, st);
        if (open.length === 1 && known.length === 1) {
          this.takeExit(open[0]);
          return;
        }
        const intro = pick(pv?.exits_intro, st.turn);
        const names = known.map((e) => exitLabel(this.idx, e));
        if (!intro) {
          this.push({ kind: 'note', text: 'manca player_voice.exits_intro' });
          return;
        }
        this.push({ kind: 'system', text: `${intro} ${list(names)}.`, by });
        return;
      }
      case 'help': {
        // Risponde con i BERSAGLI, non con le azioni: dice dove guardare, non
        // cosa fare. L'enigma resta intero, l'attrito di indovinare su cosa no.
        const parts: string[] = [];
        const look = lookNow(ph, st);
        if (look) parts.push(look);
        const targets = new Set<string>();
        for (const a of availableActions(this.idx, pl, ph, st)) {
          for (const t of [a.target, a.second_target]) {
            if (!t || t === this.idx.story.protagonist) continue;
            const e = this.idx.props.get(t) ?? this.idx.characters.get(t) ?? this.idx.items.get(t);
            if (e) targets.add(displayName(e));
          }
        }
        if (targets.size) parts.push(`In gioco: ${list([...targets])}.`);
        if (!parts.length) {
          this.push({ kind: 'note', text: 'niente da suggerire: la fase non ha look né bersagli disponibili' });
          return;
        }
        this.push({ kind: 'system', text: parts.join(' '), by });
        return;
      }
    }
  }

  /**
   * Se la frase nomina una cosa che è QUI, si legge la sua descrizione invece
   * del fallback per intenzione.
   *
   * Sono entrambi testi d'autore, ma il fallback è scritto per l'*intenzione* e
   * della cosa appena nominata non sa niente: «usa il walkie» che si sente
   * rispondere «le mani non trovano niente» è peggio della descrizione del
   * walkie, che dice che è scarico — cioè esattamente quello che il giocatore
   * stava chiedendo.
   *
   * «Qui» sono tutte e tre le specie di bersaglio, non solo l'inventario: gli
   * oggetti d'ambiente presenti e i personaggi in scena. È la contropartita
   * della regola che lo schema impone all'autore — *tutto ciò con cui si
   * interagisce deve essere osservabile* —, e senza di essa quella regola
   * riempirebbe la storia di descrizioni che nessuno legge mai: un prop si
   * guarda solo se l'autore gli ha scritto anche un'azione `look` che ripete la
   * sua descrizione, cioè scrivendo due volte la stessa cosa. Resta al quarto
   * posto nella precedenza: un'azione d'autore sullo stesso bersaglio vince
   * sempre, perché quella fa succedere qualcosa e questa no.
   */
  private answerNamedEntity(phrase: string): boolean {
    const found = this.findNamedEntity(phrase);
    if (!found) return false;

    const text = textNow(found.entity.description, found.entity.description_variants, this.state.ok);
    if (!text) {
      this.push({ kind: 'note', text: `manca description su "${found.entity.id}"` });
      return false;
    }
    this.push({
      kind: 'narration',
      text,
      by: 'cosa nominata',
      about: { kind: found.kind, id: found.entity.id },
    });
    return true;
  }

  /** La cosa che è qui e che la frase nomina, se ce n'è una. Separata da
   * `answerNamedEntity` perché `preview` deve poterla cercare senza scrivere
   * niente nel trascritto. */
  private findNamedEntity(phrase: string): Found | undefined {
    const rs = roots(phrase);
    const pl = currentPlace(this.idx, this.state);
    const ph = currentPhase(pl, this.state);

    // Le tre specie, filtrate esattamente come le filtra il parser: una cosa
    // che non c'è non è un bersaglio nemmeno per essere guardata.
    const here: Found[] = [];
    for (const id of this.state.inventory) {
      const it = this.idx.items.get(id);
      if (it) here.push({ kind: 'item', entity: it });
    }
    for (const pr of visibleProps(pl, this.state)) here.push({ kind: 'prop', entity: pr });
    for (const c of ph?.characters ?? []) {
      if (c.id === this.idx.story.protagonist) continue;
      const ch = this.idx.characters.get(c.id);
      if (ch) here.push({ kind: 'character', entity: ch });
    }

    let best: { found: Found; score: number } | undefined;
    for (const f of here) {
      const s = bestAffinity(rs, surfaces(f.entity));
      if (s >= NAMED_ENTITY_FLOOR && (!best || s > best.score)) best = { found: f, score: s };
    }
    return best?.found;
  }

  /**
   * Il fallback d'autore per l'intenzione. Il player non ne genera mai il testo:
   * lo sceglie fra quelli scritti. Se per un'intenzione non c'è niente e non
   * c'è nemmeno un `generic`, **tace e lo segnala** invece di riempire il buco
   * con una frase.
   */
  private fallback(intent: import('./types.js').Intent): void {
    const ph = currentPhase(currentPlace(this.idx, this.state), this.state);
    const local = ph?.no_match_narration ?? [];
    const global = this.idx.story.player_voice?.no_match_narration ?? [];

    // Il secondo interprete, quando c'è, sceglie qui: è l'unico posto del
    // sistema in cui sbagliare non cambia niente — nessun effetto, nessuna
    // transizione, al peggio una battuta un po' fuori bersaglio.
    const scelto = this.chooseFallback?.([...local, ...global]);
    if (scelto) {
      this.push({ kind: 'narration', text: scelto, by: 'vettori' });
      return;
    }

    for (const source of [local, global]) {
      for (const want of [intent, 'generic' as const]) {
        const texts = source.filter((n) => n.intent === want).map((n) => n.text);
        const t = pick(texts, this.state.turn);
        if (t) {
          this.push({ kind: 'narration', text: t, by: 'lessicale' });
          return;
        }
      }
    }
    this.push({ kind: 'note', text: `nessun fallback per "${intent}", nemmeno generic` });
  }

  // --------------------------------------------------------- ispezione

  /** Quello che il palco deve mostrare adesso. */
  snapshot() {
    const pl = currentPlace(this.idx, this.state);
    const ph = currentPhase(pl, this.state);
    return {
      act: this.state.act,
      place: pl,
      phase: ph,
      look: lookNow(ph, this.state),
      props: visibleProps(pl, this.state),
      exits: knownExits(pl, this.state),
      inventory: this.state.inventory.map((id) => this.idx.items.get(id)).filter(Boolean),
      flags: this.state.sortedFlags(),
      inDialogue: this.inDialogue,
    };
  }
}

function classifyIntentOfAction(a: import('./types.js').Action): import('./types.js').Intent {
  switch (a.verb) {
    case 'look':
      return 'perception';
    case 'use':
      return 'manipulation';
    case 'talk':
      return 'communication';
  }
}

/** «a, b e c» — l'elenco come lo scriverebbe una persona. */
function list(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

export { classifyIntent };
