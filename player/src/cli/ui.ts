/**
 * Il player interattivo su terminale, e l'esecutore di script di playthrough
 * che ne riusa il rendering.
 *
 * Non contiene logica narrativa: mostra quello che l'engine gli passa e
 * raccoglie input. I campi destinati alla generazione asset (image_prompt,
 * ambient_sound_prompt, sound_effect_prompt, style_prompt) non vengono ne'
 * generati ne' riprodotti, ma si vedono sempre come testo, con il nome che
 * hanno nell'IR: sono il segnaposto di quello che un giorno sara' immagine,
 * suono e voce. Il debug aggiunge la diagnostica intorno — id, condizioni,
 * effetti, azioni filtrate e il perche'.
 */

import * as readline from 'node:readline/promises';
import {
  type ActionPrompt,
  type ChoicePrompt,
  type Command,
  type DialogueNode,
  type NarrationBeat,
  type Outcome,
  type PlayerUI,
  type Resolver,
  type Scene,
  type ScriptDriver,
  type Story,
  type VoiceSpec,
  GameState,
  InputLibero,
  QuitError,
  describeCondition,
  describeEffect,
  findCharacter,
  findPlace,
  isRepeatable,
  findAction,
  SCENE_CUTSCENE,
  sceneLabel,
  sceneType,
  segnoTurno,
  isDidascalia,
  speakerName,
  toneOf,
} from '../core/index.js';
import { Theme, rule, wrap } from './term.js';

/** Il tipo di risorsa che un prompt descrive. Stessa tassonomia del player
 * web: cambia solo come la si dipinge. */
type Media = 'image' | 'sound' | 'voice' | 'music' | 'none';

/** Il riferimento a un luogo, con il suo nome quando ne ha uno: l'id serve a
 * ritrovarlo nel JSON, il nome a sapere di cosa si parla. */
function etichettaLuogo(id: string, nome?: string): string {
  return nome ? `${id} — ${nome}` : id;
}

export interface TermOptions {
  story: Story;
  resolver: Resolver;
  debug: boolean;
  color: boolean;
  width: number;
  /** Se presente, la partita e' guidata da uno script: niente input umano,
   * niente pause di tap-to-continue. */
  script?: ScriptDriver;
}

export class TermUI implements PlayerUI {
  readonly story: Story;
  readonly resolver: Resolver;
  readonly width: number;
  readonly t: Theme;
  debug: boolean;
  trace: () => string[] = () => [];

  private script?: ScriptDriver;
  /** Il turno a input libero: risolver, verbi del player, fallback d'autore.
   * La logica sta nel core, qui c'e' solo il rendering. */
  private libero: InputLibero;
  /** Esito dell'`Effect` in corso, in attesa di essere disposto. */
  private pending?: { rows: Array<[string, string, Media]>; texts: string[]; changes: string[] };
  private rl?: readline.Interface;
  private lastState?: GameState;
  private lastScene?: Scene;

  constructor(o: TermOptions) {
    this.story = o.story;
    this.resolver = o.resolver;
    this.debug = o.debug;
    this.width = o.width;
    this.t = new Theme(o.color);
    this.script = o.script;
    this.libero = new InputLibero(o.story, o.resolver);
  }

  // ------------------------------------------------------------- stampa

  private out(s = ''): void {
    process.stdout.write(s + '\n');
  }
  private para(s: string, indent = ''): void {
    this.out(wrap(s, this.width, indent));
  }
  private dbg(s: string): void {
    if (this.debug) this.out(this.t.mag(wrap(s, this.width, '  · ')));
  }

  /**
   * Un parametro dell'IR, con il nome che ha nell'IR: quello che si legge
   * giocando e quello che si cerca nel JSON devono chiamarsi allo stesso modo.
   *
   * Si vede sempre, anche fuori dal debug — in debug cambia solo il colore
   * dell'etichetta, per allinearsi al resto della diagnostica. Il valore
   * prende il colore del tipo di risorsa che descrive: e' la stessa
   * tassonomia del player web, cosi' un transcript di terminale e uno di
   * browser si leggono allo stesso modo.
   */
  private param(k: string, v: string | undefined, media: Media = 'none', indent = '  '): void {
    if (!v) return;
    const label = this.debug ? this.t.mag(`${k}: `) : this.t.dim(`${k}: `);
    this.out(wrap(label + this.paint(media)(v), this.width, indent));
  }

  /**
   * Un gruppo di prompt che parlano della stessa entita' — `background`,
   * `characters.<id>`, `global_style`.
   *
   * Il prefisso comune sale nell'intestazione e sparisce dalle righe: a colpo
   * d'occhio si vede quali risorse ha *quella* entita' e quali le mancano,
   * invece di rileggere lo stesso prefisso tre volte.
   */
  private group(name: string, rows: Array<[string, string | undefined, Media]>, who?: string): void {
    if (!rows.some(([, v]) => v)) return;
    this.out('  ' + this.t.bold(name) + (who ? this.t.dim(` — ${who}`) : ''));
    for (const [k, v, media] of rows) this.param(k, v, media, '    ');
  }

  private paint(media: Media): (s: string) => string {
    switch (media) {
      case 'image':
        return this.t.blue;
      case 'sound':
        return this.t.green;
      case 'voice':
        return this.t.yellow;
      case 'music':
        return this.t.mag;
      default:
        return this.t.gray;
    }
  }

  /**
   * La copertina: quello che vale per tutta la storia, prima che cominci.
   *
   * Risponde in un colpo d'occhio alle domande che ci si fa aprendo un IR che
   * non si e' compilato adesso — che versione, che lingua, quante scene, da
   * dove parte, chi c'e' dentro, che stile hanno immagini e voci.
   *
   * A differenza del player web non chiede nessun tocco per proseguire: qui lo
   * scrollback del terminale resta, quindi la prima scena puo' partire subito
   * sotto senza che la copertina vada persa.
   */
  intro(): void {
    const st = this.story;
    this.out();
    this.out(this.t.bold(st.title));
    if (st.description) this.para(this.t.dim(st.description));
    this.out(this.t.dim(`resolver: ${this.resolver.name} · :aiuto per i comandi`));
    this.out();

    this.param('ir_version', st.ir_version);
    if (st.generated_by) {
      const g = st.generated_by;
      this.param('generated_by', `${g.compiler} ${g.compiler_version}${g.model ? ` · ${g.model}` : ''}`);
    }
    this.param('id', st.id);
    this.param('language', st.language);
    this.param('scenes', `${st.scenes.length}`);
    this.param('start_scene', st.start_scene);

    // La locandina: un'inquadratura come le altre, solo che inquadra la storia
    // invece di una scena. In terminale non si vede — come nessuna immagine —
    // ma si vede *se c'e'*, che e' l'informazione utile quando si sta per
    // pagare la generazione.
    if (st.cover) {
      this.out();
      this.group('cover', [
        ['image_prompt', st.cover.image_prompt, 'image'],
        ['image', st.cover.image, 'image'],
        ['place', st.cover.place, 'none'],
        ['characters_in_frame', st.cover.characters_in_frame?.join(', '), 'none'],
      ]);
    }

    // `image_style_suffix` finisce in coda a ogni image_prompt e
    // `narrator_voice` vale per tutta la narrazione: sono prompt come gli
    // altri, solo che valgono una volta per storia invece che una per scena.
    const g = st.global_style;
    this.out();
    this.group('global_style', [
      ['default_tone', g?.default_tone, 'none'],
      ['image_style_suffix', g?.image_style_suffix, 'image'],
      ['narrator_voice.style_prompt', g?.narrator_voice?.style_prompt, 'voice'],
      ['ambient_music_tags', g?.ambient_music_tags?.join(', '), 'music'],
    ]);

    // La roster globale: qui stanno i prompt dei personaggi *come sono
    // definiti*. Nelle scene si vedra' quello che vale li', override compresi.
    if (st.characters?.length) {
      this.out();
      this.out(this.t.dim(`  personaggi (${st.characters.length}):`));
      for (const c of st.characters) {
        this.group(
          `characters.${c.id}`,
          [
            ['visual_prompt', c.visual_prompt, 'image'],
            ['image', c.image, 'image'],
            ['voice.style_prompt', c.voice?.style_prompt, 'voice'],
          ],
          c.name,
        );
      }
    }

    // I luoghi: come i personaggi, hanno un prompt che vale da riferimento
    // stabile per ogni inquadratura ambientata li'.
    if (st.places?.length) {
      this.out();
      this.out(this.t.dim(`  luoghi (${st.places.length}):`));
      for (const pl of st.places) {
        this.group(
          `places.${pl.id}`,
          [
            ['visual_prompt', pl.visual_prompt, 'image'],
            ['image', pl.image, 'image'],
          ],
          pl.name,
        );
      }
    }

    // Gli elenchi documentali: non fanno niente in gioco, ma dicono cosa
    // l'autore si aspettava che la storia usasse — e il linter li confronta.
    this.out();
    this.param('state_flags_schema', st.state_flags_schema?.join(', '));
    this.param(
      'items',
      st.items?.map((i) => (i.aliases?.length ? `${i.id} "${i.name}" (${i.aliases.join(', ')})` : `${i.id} "${i.name}"`)).join(' · '),
    );
    this.param('initial_inventory', st.initial_inventory?.join(', '));

    if (this.debug) this.out(this.t.mag("modalita' debug attiva"));
    this.out();
  }

  // ------------------------------------------------------------ PlayerUI

  sceneEnter(state: GameState, scene: Scene): void {
    this.lastState = state;
    this.lastScene = scene;
    this.out();
    this.out(this.t.cyan(rule(sceneLabel(scene), this.width)));
    this.dumpScene(state, scene);
    this.out();
  }

  async beat(scene: Scene, b: NarrationBeat, index: number, total: number): Promise<void> {
    this.lastScene = scene;
    this.dbg(`beat ${index + 1}/${total}`);
    // Stesso ordine della scheda di scena: prima i riferimenti che questa
    // inquadratura eredita (dove, chi), poi cio' che vale solo per lei.
    this.param('place', b.place ? etichettaLuogo(b.place, findPlace(this.story, b.place)?.name) : undefined);
    // Il prompt del luogo si mostra una volta per scena: qui torna solo se il
    // beat si sposta altrove rispetto all'inquadratura di base.
    if (b.place && b.place !== scene.background?.place) {
      this.param(`places.${b.place}.visual_prompt`, findPlace(this.story, b.place)?.visual_prompt, 'image');
    }
    this.param('characters_in_frame', b.characters_in_frame?.join(', '));
    this.param('image_prompt', b.image_prompt, 'image');
    // In terminale un'immagine non si vede: quello che si puo' dire e' che
    // esiste e come si chiama. Serve a collaudare la pubblicazione senza
    // aprire un browser — un beat con il prompt e senza `image` e' un beat
    // che nel player web resterebbe senza inquadratura.
    this.param('image', b.image, 'image');
    this.param('sound_effect_prompt', b.sound_effect_prompt, 'sound');
    this.param('voice.style_prompt', b.voice?.style_prompt, 'voice');
    this.para(this.t.italic(b.text), '  ');
    this.out();
    // Come nel player web: ci si ferma fra un beat e l'altro, non dopo
    // l'ultimo. Quell'invio non portava niente di nuovo — quello che viene dopo,
    // azioni della scena o unica azione di prosecuzione di una cutscene, e' gia'
    // pronto da stampare.
    if (index + 1 < total) await this.pause();
  }

  async line(scene: Scene, nodeId: string, n: DialogueNode): Promise<void> {
    this.lastScene = scene;
    this.dbg(`nodo ${nodeId}`);
    this.param('voice_override.style_prompt', n.voice_override?.style_prompt, 'voice');
    // Le didascalie non hanno un nome davanti: non le dice nessuno.
    if (!isDidascalia(n)) this.out(this.t.bold(speakerName(this.story, n.speaker) + ':'));
    this.para(n.text, '  ');
    this.out();
    if (!n.choices || n.choices.length === 0) await this.pause();
  }

  /**
   * Raccoglie l'esito di un `Effect` invece di stamparlo man mano.
   *
   * `State.apply` consegna narrazione, cambi di stato e suono nell'ordine in
   * cui li *applica*, fissato dallo schema. Qui interessa un altro ordine:
   * prima i prompt delle risorse — l'inquadratura, il suono, la voce, cioe'
   * cio' che nella scena si percepirebbe per primo — e poi il testo. Nessuno
   * dei due ordini deve piegarsi all'altro, quindi si raccoglie e si dispone.
   */
  beginEffect(): void {
    this.pending = { rows: [], texts: [], changes: [] };
  }

  endEffect(): void {
    const buf = this.pending;
    this.pending = undefined;
    if (!buf) return;
    for (const [k, v, media] of buf.rows) this.param(k, v, media);
    for (const t of buf.texts) this.para(this.t.italic(t), '  ');
    for (const c of buf.changes) this.dbg(`stato: ${c}`);
    if (buf.rows.length || buf.texts.length) this.out();
  }

  narration(text: string, voice?: VoiceSpec): void {
    if (this.pending) {
      if (voice?.style_prompt) this.pending.rows.push(['narration_voice.style_prompt', voice.style_prompt, 'voice']);
      this.pending.texts.push(text);
      return;
    }
    this.param('narration_voice.style_prompt', voice?.style_prompt, 'voice');
    this.para(this.t.italic(text), '  ');
    this.out();
  }

  /** Il player non riproduce niente: del suono resta il prompt, che e'
   * esattamente cio' che il modulo assets dovra' generare. */
  sound(prompt: string): void {
    if (this.pending) {
      this.pending.rows.push(['play_sound_prompt', prompt, 'sound']);
      return;
    }
    this.param('play_sound_prompt', prompt, 'sound');
  }

  stateChange(desc: string): void {
    if (this.pending) {
      this.pending.changes.push(desc);
      return;
    }
    this.dbg(`stato: ${desc}`);
  }

  notice(text: string): void {
    this.out(this.t.dim(wrap(text, this.width, '  ')));
  }

  /** Un bug di giocabilita' dell'IR si vede sempre, anche fuori dal debug:
   * e' l'informazione per cui questo player esiste. */
  problem(text: string): void {
    this.out(this.t.red(wrap('[! IR] ' + text, this.width)));
  }

  async chooseAction(p: ActionPrompt): Promise<Command> {
    this.lastState = p.state;
    this.lastScene = p.scene;

    if (this.script) {
      const cmd = this.script.chooseAction(p);
      this.echo(cmd.actionId ?? '');
      return cmd;
    }

    // L'elenco delle azioni e' impalcatura di collaudo, non l'interfaccia: si
    // gioca scrivendo, e l'elenco si vede solo in debug. Un menu che elenca le
    // azioni utili risolve gli enigmi al posto del giocatore, e finche' resta
    // acceso non si puo' giudicare quanto una storia sia davvero difficile.
    //
    // Nelle cutscene no: li' l'unica azione e' proseguire, non c'e' nessun
    // enigma da proteggere, e far scrivere "continua" dopo ogni sequenza
    // narrata sarebbe attrito e basta. Basta l'invio.
    const cutscene = sceneType(p.scene) === SCENE_CUTSCENE;
    const elenco = this.debug || cutscene;

    for (;;) {
      this.out(this.t.dim(rule('', this.width)));
      if (elenco) {
        p.available.forEach((a, i) => {
          this.out(`  ${this.t.green(`${i + 1})`)} ${a.label}`);
          this.dbg(
            `id: ${a.id} · condizione: ${describeCondition(a.condition)} · effetto: ${describeEffect(a.effect)} · repeatable: ${isRepeatable(a)}`,
          );
        });
      }
      if (this.debug && p.hidden.length > 0) {
        this.out(this.t.mag('  azioni nascoste:'));
        for (const h of p.hidden) {
          this.out(this.t.mag(`    × ${h.action.label} [${h.action.id}]`));
          this.dbg(`  nascosta perche': ${h.reason}`);
          this.dbg(`  effetto: ${describeEffect(h.action.effect)}`);
        }
      }
      // La scena non ha piu' niente da dare: le uscite si mostrano, con la
      // label che l'autore ha scritto. Non e' l'elenco delle azioni che
      // rientra dalla finestra — e' l'unica cosa rimasta, e nasconderla non
      // protegge nessun enigma perche' non ce n'e' piu' nessuno.
      if (!elenco && p.uscite.length > 0) {
        for (const u of p.uscite) this.out(`  ${this.t.green('▸')} ${u.label}`);
      }
      if (p.terminal) {
        this.out(this.t.dim('  (scena finale: da qui non esce nessuna transizione — :esci per chiudere)'));
      }

      const input = await this.read(cutscene ? this.t.dim('[invio] ') : '· ');
      const meta = this.meta(input, p.state, p.scene);
      if (meta.handled) {
        if (meta.quit) return { quit: true };
        continue;
      }

      // Invio a vuoto in una cutscene: prosegui. E' il tap-to-continue dei
      // beat, applicato all'unica azione che una cutscene ha.
      if (cutscene && input.trim() === '' && p.available.length === 1) {
        return { actionId: p.available[0].id };
      }

      // Scorciatoia dell'elenco appena stampato: vale dove l'elenco c'e'
      // davvero. Non e' un backend — e' il numero della riga che si ha sotto
      // gli occhi, e sta nell'interfaccia perche' e' l'interfaccia a sapere
      // cosa ha appena scritto.
      if (elenco && /^\d+$/.test(input.trim())) {
        const a = p.available[Number(input.trim()) - 1];
        if (a) {
          this.out(this.t.green('> ' + a.label));
          return { actionId: a.id };
        }
      }

      const e = await this.libero.risolvi(p, input);
      this.dbg(`resolver: ${e.via ?? '-'}${e.why ? ` · ${e.why}` : ''}`);

      if (e.kind === 'azione' && e.actionId) {
        const a = findAction(p.scene, e.actionId);
        this.out(this.t.green('> ' + (a?.label ?? e.actionId)) + this.marchio(e));
        return { actionId: e.actionId };
      }

      // Azione esistente ma non ora, verbo del player, o niente: in tutti e tre
      // i casi si mostra testo d'autore (o una nota diagnostica) e si torna a
      // chiedere. Nessun Effect e' stato applicato, e l'engine non ha nemmeno
      // saputo che e' successo qualcosa.
      if (e.testo) this.out(wrap(this.t.italic(e.testo), this.width, '  ') + this.marchio(e));
      // Diagnostica, non narrazione: sta sotto il debug (vedi webui.ts).
      if (e.nota) this.dbg(e.nota);
      this.out();
    }
  }

  /** Chi ha deciso il turno, in coda alla riga. Si vede sempre: e' il solo modo
   * di accorgersi giocando di quando il backend a vettori serva davvero. */
  private marchio(e: Parameters<typeof segnoTurno>[0]): string {
    const s = segnoTurno(e);
    return s ? this.t.dim(`  ⟨${s}⟩`) : '';
  }

  async chooseChoice(p: ChoicePrompt): Promise<Command> {
    this.lastState = p.state;
    this.lastScene = p.scene;

    if (this.script) {
      const cmd = this.script.chooseChoice(p);
      this.echo(p.available[cmd.choiceIndex ?? 0]?.text ?? '');
      return cmd;
    }

    for (;;) {
      p.available.forEach((c, i) => {
        this.out(`  ${this.t.green(`${i + 1})`)} ${c.text}`);
        this.dbg(`→ nodo ${c.goto} · condizione: ${describeCondition(c.condition)} · effetto: ${describeEffect(c.effect)}`);
      });
      if (this.debug && p.hidden.length > 0) {
        this.out(this.t.mag('  scelte nascoste:'));
        for (const h of p.hidden) {
          this.out(this.t.mag(`    × ${h.choice.text}`));
          this.dbg(`  nascosta perche': ${h.reason}`);
        }
      }

      const input = await this.read('> ');
      const meta = this.meta(input, p.state, p.scene);
      if (meta.handled) {
        if (meta.quit) return { quit: true };
        continue;
      }
      const n = Number(input.trim());
      if (Number.isInteger(n) && n >= 1 && n <= p.available.length) return { choiceIndex: n - 1 };
      this.notice('Scegli il numero di una delle battute elencate.');
    }
  }

  finish(o: Outcome): void {
    this.out();
    this.out(this.t.cyan(rule('fine', this.width)));
    this.out('  ' + o.reason);
    this.out(this.t.dim(`  scena finale: ${o.scene} · passi: ${o.steps}`));
    if (o.problems.length > 0) {
      this.out(this.t.red(`  problemi di giocabilita' incontrati: ${o.problems.length}`));
      for (const p of o.problems) this.out(this.t.red('   - ' + p));
    }
    if (this.script && this.script.remaining > 0) {
      this.out(
        this.t.yellow(`  attenzione: ${this.script.remaining} passi dello script non sono stati usati (la storia e' finita prima)`),
      );
    }
    this.out();
  }

  close(): void {
    this.rl?.close();
  }

  // -------------------------------------------------------------- interni

  private echo(what: string): void {
    if (what) this.out(this.t.green('> ' + what));
  }

  private async read(prompt: string): Promise<string> {
    if (!this.rl) {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
    try {
      return await this.rl.question(this.t.bold(prompt));
    } catch {
      // stdin chiuso (Ctrl-D, pipe finita): equivale a uscire.
      this.out();
      throw new QuitError();
    }
  }

  /** Tap-to-continue. Anche qui i comandi meta funzionano: capita sempre di
   * volere il debug proprio mentre scorre la narrazione. */
  private async pause(): Promise<void> {
    if (this.script) return;
    for (;;) {
      const input = await this.read(this.t.dim('[invio] '));
      if (input.trim() === '') return;
      const meta = this.meta(input, this.lastState, this.lastScene);
      if (meta.handled) {
        if (meta.quit) throw new QuitError();
        continue;
      }
      return;
    }
  }

  /** Gestisce i comandi che iniziano con ':'. */
  private meta(input: string, st?: GameState, sc?: Scene): { handled: boolean; quit?: boolean } {
    const s = input.trim();
    if (!s.startsWith(':')) return { handled: false };
    const state = st ?? this.lastState;
    const scene = sc ?? this.lastScene;

    switch (s.split(/\s+/)[0].toLowerCase()) {
      case ':aiuto':
      case ':help':
      case ':?':
        this.help();
        break;
      case ':debug':
        this.debug = !this.debug;
        this.out(this.t.mag(this.debug ? 'debug ON' : 'debug OFF'));
        if (this.debug && scene) this.dumpScene(state, scene);
        break;
      case ':stato':
        this.dumpState(state);
        break;
      case ':flag':
      case ':flags':
        this.dumpFlags(state);
        break;
      case ':inv':
      case ':inventario':
        this.dumpInventory(state);
        break;
      case ':scena':
        if (scene) this.dumpScene(state, scene);
        break;
      case ':storico':
        this.dumpHistory(state);
        break;
      case ':azioni':
        if (scene) this.dumpActions(state, scene);
        break;
      case ':traccia':
        this.dumpTrace();
        break;
      case ':esci':
      case ':quit':
      case ':q':
        return { handled: true, quit: true };
      default:
        this.notice(`comando sconosciuto: ${s} (:aiuto per l'elenco)`);
    }
    return { handled: true };
  }

  private help(): void {
    this.out(
      this.t.dim(`  comandi:
    :debug      mostra/nasconde i parametri di scena e le azioni nascoste
    :stato      flag, inventario, scena corrente, storico
    :flag       solo i flag attivi
    :inv        solo l'inventario
    :scena      i parametri della scena corrente
    :storico    le scene visitate in ordine
    :azioni     TUTTE le azioni della scena, comprese quelle filtrate
    :traccia    la sequenza di id giocata finora (rigiocabile con --script)
    :esci       abbandona la partita`),
    );
  }

  private dumpState(st?: GameState): void {
    if (!st) return;
    this.out(this.t.yellow('  stato:'));
    this.out(`    scena corrente: ${st.scene}`);
    this.dumpFlags(st);
    this.dumpInventory(st);
    this.dumpHistory(st);
  }

  private dumpFlags(st?: GameState): void {
    if (!st) return;
    const f = st.sortedFlags();
    this.out(f.length ? this.t.yellow('    flag: ') + f.join(', ') : this.t.yellow('    flag: nessuno'));
  }

  private dumpInventory(st?: GameState): void {
    if (!st) return;
    this.out(
      st.inventory.length
        ? this.t.yellow('    inventario: ') +
          st.inventory.map((id) => this.story.items?.find((i) => i.id === id)?.name ?? `${id} [senza scheda]`).join(', ')
        : this.t.yellow('    inventario: vuoto'),
    );
  }

  private dumpHistory(st?: GameState): void {
    if (!st || st.history.length === 0) return;
    this.out(this.t.yellow('    scene visitate: ') + st.history.join(' → '));
  }

  private dumpTrace(): void {
    const tr = this.trace();
    if (tr.length === 0) {
      this.out(this.t.yellow('    traccia: vuota'));
      return;
    }
    this.out(this.t.yellow('    traccia (una riga per passo):'));
    for (const tok of tr) this.out('      ' + tok);
  }

  /** I parametri della scena. Fuori dal debug ne mostra solo l'essenziale. */
  private dumpScene(st: GameState | undefined, sc: Scene): void {
    const dbgLine = (k: string, v?: string) => {
      if (!this.debug || !v) return;
      this.out(this.t.mag(wrap(`${k}: ${v}`, this.width, '  ')));
    };
    // I parametri descrittivi della scena si vedono sempre; struttura, id e
    // conteggi restano invece riservati al debug.
    dbgLine('id', sc.id);
    this.param('scene_type', sceneType(sc));
    // `look` non e' un'azione e non compare fra le voci: nel player a parole e'
    // una domanda che si fa scrivendo. Qui si legge perche' senza non si
    // potrebbe collaudare, ne' accorgersi che manca.
    this.param('look', sc.look || '— mancante');
    for (const v of sc.look_variants ?? []) {
      this.param(`look_variants [${describeCondition(v.condition)}]`, v.text);
    }
    for (const n of sc.no_match_narration ?? []) {
      this.param(`no_match_narration [${n.intent}]`, n.text);
    }
    const globale = toneOf(this.story, sc);
    this.param('scene_tone', sc.scene_tone || (globale ? `${globale} (default globale)` : undefined));
    // L'ordine e' quello con cui si costruisce l'immagine mentale scendendo:
    // il tono, poi l'inquadratura — dove siamo, chi ci sta dentro, cosa si
    // vede — e infine chi c'e', con aspetto e voce.
    const luogo = sc.background?.place ? findPlace(this.story, sc.background.place) : undefined;
    this.group('background', [
      ['place', sc.background?.place ? etichettaLuogo(sc.background.place, luogo?.name) : undefined, 'none'],
      [`places.${sc.background?.place}.visual_prompt`, luogo?.visual_prompt, 'image'],
      ['characters_in_frame', sc.background?.characters_in_frame?.join(', '), 'none'],
      ['image_prompt', sc.background?.image_prompt, 'image'],
      ['image', sc.background?.image, 'image'],
      ['ambient_sound_prompt', sc.background?.ambient_sound_prompt, 'sound'],
    ]);

    // Aspetto e voce di chi e' in scena: l'override locale se c'e', altrimenti
    // quello della roster globale. Marcare quale dei due si sta guardando conta
    // — una scena che sovrascrive la voce di un personaggio e' una scelta, e
    // una svista si vede solo se si distingue dall'ereditata.
    for (const c of sc.characters ?? []) {
      const g = findCharacter(this.story, c.id);
      this.group(
        `characters.${c.id}`,
        [
          [`visual_prompt${c.visual_prompt ? ' (override)' : ''}`, c.visual_prompt ?? g?.visual_prompt, 'image'],
          ['image', c.image ?? g?.image, 'image'],
          [
            `voice.style_prompt${c.voice?.style_prompt ? ' (override)' : ''}`,
            c.voice?.style_prompt ?? g?.voice?.style_prompt,
            'voice',
          ],
        ],
        g?.name,
      );
    }

    if (!this.debug) return;

    if (sc.characters?.length) {
      const names = sc.characters.map((c) => {
        const g = findCharacter(this.story, c.id);
        return g?.name ? `${g.name} (${c.id})` : `${c.id} [non nella roster globale]`;
      });
      dbgLine('personaggi in scena', names.join(', '));
    }
    if (sc.on_enter_flags_set?.length) dbgLine('on_enter_flags_set', sc.on_enter_flags_set.join(', '));
    if (sc.dialogue_tree) {
      dbgLine('dialogue_tree', `start=${sc.dialogue_tree.start}, ${Object.keys(sc.dialogue_tree.nodes).length} nodi`);
    }
    dbgLine('narrazione', `${(sc.narration ?? []).length} beat`);
    this.dumpActions(st, sc);
  }

  /** Elenca TUTTE le azioni della scena, comprese quelle attualmente filtrate,
   * con id, condizione, effetto e motivo dell'esclusione. */
  private dumpActions(st: GameState | undefined, sc: Scene): void {
    this.out(this.t.mag(`  azioni della scena (${sc.actions.length}):`));
    for (const a of sc.actions) {
      let mark = this.t.green('✓');
      let why = '';
      if (st) {
        if (!isRepeatable(a) && st.consumed(sc.id, a.id)) {
          mark = this.t.red('×');
          why = " — gia' usata (repeatable: false)";
        } else {
          const m = st.meets(a.condition);
          if (!m.ok) {
            mark = this.t.red('×');
            why = ' — ' + m.why;
          }
        }
      }
      this.out(`   ${mark} [${a.id}] ${a.label}${this.t.dim(why)}`);
      this.out(this.t.mag(`       condizione: ${describeCondition(a.condition)} · effetto: ${describeEffect(a.effect)}`));
    }
  }
}
