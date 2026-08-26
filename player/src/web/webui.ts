/**
 * La faccia web dell'engine: transcript scorrevole + chip da toccare.
 *
 * Come il terminale, non contiene logica narrativa: mostra quello che l'engine
 * gli passa e raccoglie tocchi. I campi destinati alla generazione asset non
 * vengono ne' generati ne' riprodotti, ma si vedono sempre come testo: sono il
 * segnaposto dell'immagine, del suono e della voce che un giorno ci saranno.
 * Il debug aggiunge la diagnostica intorno.
 */

import {
  type ActionPrompt,
  type ChoicePrompt,
  type Command,
  type DialogueNode,
  type NarrationBeat,
  type Outcome,
  type PlayerUI,
  type Scene,
  type ScriptDriver,
  type Story,
  type VoiceSpec,
  GameState,
  QuitError,
  describeCondition,
  describeEffect,
  findCharacter,
  findPlace,
  sceneType,
  speakerName,
  toneOf,
} from '../core/index.js';
import { clear, el } from './dom.js';

/** Il tipo di risorsa che un prompt descrive: da' il colore all'etichetta, e
 * basta scorrere il transcript per vedere dove mancano le immagini o i suoni.
 * `none` e' per i parametri che non sono prompt di generazione (il tono). */
export type Media = 'image' | 'sound' | 'voice' | 'music' | 'none';

/** Il riferimento a un luogo, con il suo nome quando ne ha uno: l'id serve a
 * ritrovarlo nel JSON, il nome a sapere di cosa si parla. */
function etichettaLuogo(id: string, nome?: string): string {
  return nome ? `${id} — ${nome}` : id;
}

/**
 * [nome del campo nell'IR, valore, tipo di media, ereditato?]
 *
 * `ereditato` marca un valore che l'inquadratura non definisce ma riceve dalla
 * scena: si mostra su una riga sola, troncata, e si apre toccandola.
 */
type PromptRow = [string, string | undefined, Media, boolean?];

function promptRow([label, value, media, ereditato]: [string, string, Media, boolean?]): HTMLElement {
  if (!ereditato) {
    const row = el('span', `prompt m-${media}`);
    row.append(el('span', 'label', label), document.createTextNode(value));
    return row;
  }

  // Ereditato: il testo per intero e' gia' nella scheda di scena, ma un blocco
  // che non contiene tutti i suoi ingredienti costringe a risalire per sapere
  // cosa verra' generato. Una riga sola lo ricorda senza allagare la pagina —
  // il paragrafo di un luogo tornerebbe fino a cinque volte nella stessa scena.
  const row = el('button', `prompt m-${media} ereditato`);
  row.type = 'button';
  row.setAttribute('aria-expanded', 'false');
  // Il triangolino sta prima del testo: in coda se lo mangerebbe il
  // troncamento, cioe' sparirebbe esattamente quando serve a dire "c'e'
  // dell'altro, toccami".
  const caret = el('span', 'caret', '▸');
  row.append(el('span', 'label', label), caret, document.createTextNode(value));
  row.onclick = () => {
    const aperto = row.classList.toggle('aperto');
    row.setAttribute('aria-expanded', String(aperto));
    caret.textContent = aperto ? '▾' : '▸';
  };
  return row;
}

/**
 * Un gruppo di prompt che parlano della stessa entita' — `background`,
 * `characters.<id>`, `global_style`.
 *
 * Il prefisso comune sale nell'intestazione e sparisce dalle righe: si legge
 * "background: immagine, ambiente" invece di ripetere `background.` due volte,
 * e a colpo d'occhio si vede quali risorse ha *quella* entita' e quali le
 * mancano. `who` e' il nome umano, quando l'entita' ne ha uno.
 */
function promptGroup(name: string, rows: PromptRow[], who?: string): HTMLElement | undefined {
  const present = rows.filter((r): r is [string, string, Media, boolean?] => !!r[1]);
  if (present.length === 0) return undefined;
  const box = el('div', 'group');
  const head = el('span', 'gname', name);
  if (who) head.append(el('span', 'who', who));
  box.append(head);
  for (const row of present) box.append(promptRow(row));
  return box;
}

export interface WebUIOptions {
  story: Story;
  transcript: HTMLElement;
  dock: HTMLElement;
  /** Chiamata quando stato o scena cambiano, per aggiornare il pannello. */
  onUpdate: () => void;
  /** Se presente, la partita e' guidata da uno script di playthrough. */
  script?: ScriptDriver;
}

export class WebUI implements PlayerUI {
  readonly story: Story;
  state?: GameState;
  scene?: Scene;
  lastPrompt?: ActionPrompt;

  private transcript: HTMLElement;
  private dock: HTMLElement;
  private onUpdate: () => void;
  private script?: ScriptDriver;
  /** Promessa in attesa di un tocco: va rifiutata se la partita viene
   * ricominciata, altrimenti resta appesa per sempre. */
  private abort?: (err: unknown) => void;
  /** Una partita abbandonata continua a chiudersi per un microtask dopo il
   * rifiuto: senza questa bandiera scriverebbe il suo epilogo nel transcript
   * della partita nuova. */
  private dead = false;
  /** Dove riportare la vista quando arriva testo nuovo. */
  private anchor: 'end' | 'top' = 'end';
  /** Esito dell'`Effect` in corso, in attesa di essere disposto. */
  private pending?: { rows: PromptRow[]; texts: string[]; changes: string[] };
  /** Un tocco e' in corso: il dock e' fermo finche' non finisce. */
  private pressing = false;

  constructor(o: WebUIOptions) {
    this.story = o.story;
    this.transcript = o.transcript;
    this.dock = o.dock;
    this.onUpdate = o.onUpdate;
    this.script = o.script;
  }

  /** Interrompe l'attesa in corso (usata quando si ricomincia o si cambia IR). */
  cancel(): void {
    this.dead = true;
    this.abort?.(new QuitError());
    this.abort = undefined;
    this.pressing = false;
    this.dock.classList.remove('bloccato');
    clear(this.dock);
  }

  /**
   * Trattiene il bottone premuto quanto basta a vederlo.
   *
   * Senza questa pausa il tocco non si percepisce affatto: il dock viene
   * svuotato nello stesso istante del click, quindi lo stato premuto vive
   * qualche millisecondo e sparisce insieme al bottone. Non e' quindi una
   * questione di durata dell'animazione — e' che non c'era niente da animare.
   *
   * Il ritardo si paga a ogni interazione, per questo resta corto: giusto il
   * tempo che la campitura arrivi a fondo. Durante l'attesa il dock e' inerte,
   * cosi' un secondo tocco non fa partire due azioni.
   *
   * Ritorna false se un tocco era gia' in corso: chi chiama deve fermarsi.
   */
  private async press(b: HTMLButtonElement): Promise<boolean> {
    if (this.pressing || this.dead) return false;
    this.pressing = true;
    this.dock.classList.add('bloccato');
    b.classList.add('premuto');
    await new Promise((r) => setTimeout(r, 140));
    this.pressing = false;
    this.dock.classList.remove('bloccato');
    return !this.dead;
  }

  // -------------------------------------------------------------- stampa

  private push(node: Node): void {
    if (this.dead) return;
    this.transcript.append(node);
    this.scrollEnd();
  }

  /**
   * Riporta in vista il punto che conta: normalmente il fondo, perche' e' li'
   * che arriva il testo nuovo; la copertina invece si legge dall'inizio.
   *
   * Il secondo giro dentro `requestAnimationFrame` serve perche' il dock
   * cresce dopo il transcript (le chip si costruiscono per ultime): senza,
   * l'ultima riga resta nascosta sotto i bottoni.
   */
  private scrollEnd(): void {
    const go = () => {
      this.transcript.scrollTop = this.anchor === 'top' ? 0 : this.transcript.scrollHeight;
    };
    go();
    requestAnimationFrame(go);
  }

  private entry(cls: string, text: string): void {
    this.push(el('p', `entry ${cls}`, text));
  }

  /** Riga di debug: sta sempre nel DOM, si vede solo a debug acceso. Cosi'
   * accendendolo si legge anche quello che e' gia' scorso via. */
  private dbg(text: string): void {
    this.push(el('div', 'dbg', text));
  }

  /**
   * I prompt di generazione asset, con il nome che hanno nell'IR.
   *
   * Non vengono ne' generati ne' riprodotti — il player e' testuale — ma si
   * vedono sempre: sono il segnaposto di quello che un giorno sara' immagine,
   * suono e voce, ed e' guardandoli mentre si gioca che ci si accorge che un
   * beat ha cambiato inquadratura senza dirlo, o che un suono manca.
   *
   * Il tipo di media si dichiara qui invece di dedurlo dal nome del campo:
   * `style_prompt` sta sia sotto una voce sia sotto altro, e indovinare dal
   * nome vorrebbe dire sbagliare il giorno che lo schema cambia.
   */
  private assets(rows: PromptRow[]): void {
    const present = rows.filter((r): r is [string, string, Media, boolean?] => !!r[1]);
    if (present.length === 0) return;
    const box = el('div', 'assets');
    for (const row of present) box.append(promptRow(row));
    this.push(box);
  }

  /**
   * La copertina: quello che vale per tutta la storia, prima che cominci.
   *
   * Serve a rispondere in un colpo d'occhio alle domande che ci si fa
   * aprendo un IR che non si e' compilato adesso — che versione e', che
   * lingua, quante scene, da dove parte, chi c'e' dentro, che stile hanno le
   * immagini e le voci. Lo stile globale sta qui e non per scena perche' e'
   * li' che agisce: `image_style_suffix` finisce in coda a *ogni*
   * image_prompt e `narrator_voice` vale per tutta la narrazione.
   *
   * Chiude con un tocco e la prima scena parte subito dopo. Il tocco non e'
   * cerimonia: il transcript insegue il fondo, quindi senza qualcosa che
   * trattenga la lettura qui la copertina scorrerebbe via prima ancora di
   * essere vista. In terminale il problema non esiste — lo scrollback resta —
   * e infatti li' la copertina non chiede niente.
   */
  async intro(): Promise<void> {
    const st = this.story;
    const cover = el('section', 'cover');

    cover.append(el('h1', undefined, st.title));
    if (st.description) cover.append(el('p', 'desc', st.description));

    const dl = el('dl', 'kv');
    const meta = (k: string, v?: string) => {
      if (v) dl.append(el('dt', undefined, k), el('dd', undefined, v));
    };
    meta('ir_version', st.ir_version);
    meta('id', st.id);
    meta('language', st.language);
    meta('scenes', `${st.scenes.length}`);
    meta('start_scene', st.start_scene);
    cover.append(dl);

    const g = st.global_style;
    const style = promptGroup('global_style', [
      ['default_tone', g?.default_tone, 'none'],
      ['image_style_suffix', g?.image_style_suffix, 'image'],
      ['narrator_voice.style_prompt', g?.narrator_voice?.style_prompt, 'voice'],
      ['ambient_music_tags', g?.ambient_music_tags?.join(', '), 'music'],
    ]);
    if (style) cover.append(style);

    // La roster globale: qui stanno i prompt dei personaggi *come sono
    // definiti*. Nelle scene si vedra' quello che vale li', override compresi.
    // Anagrafiche ed elenchi documentali sono materiale da ispezione, non da
    // copertina: chi apre una storia vuole sapere che storia e', non l'elenco
    // dei suoi flag. Restano nel documento e compaiono col debug, come tutto
    // il resto della diagnostica.
    const dettagli = el('div', 'only-debug');

    if (st.characters?.length) {
      dettagli.append(el('h3', undefined, `personaggi (${st.characters.length})`));
      for (const c of st.characters) {
        const box = promptGroup(
          `characters.${c.id}`,
          [
            ['visual_prompt', c.visual_prompt, 'image'],
            ['voice.style_prompt', c.voice?.style_prompt, 'voice'],
          ],
          c.name,
        );
        if (box) dettagli.append(box);
        else dettagli.append(el('span', 'gname', `characters.${c.id}`));
      }
    }

    // I luoghi: come i personaggi, hanno un prompt che vale da riferimento
    // stabile per ogni inquadratura ambientata li'.
    if (st.places?.length) {
      dettagli.append(el('h3', undefined, `luoghi (${st.places.length})`));
      for (const pl of st.places) {
        const box = promptGroup(`places.${pl.id}`, [['visual_prompt', pl.visual_prompt, 'image']], pl.name);
        if (box) dettagli.append(box);
      }
    }

    // Gli elenchi documentali: non fanno niente in gioco, ma dicono cosa
    // l'autore si aspettava che la storia usasse — e il linter li confronta.
    const list = (title: string, values?: string[]) => {
      if (!values?.length) return;
      dettagli.append(el('h3', undefined, `${title} (${values.length})`));
      const box = el('div', 'chips');
      for (const v of values) box.append(el('span', 'chip', v));
      dettagli.append(box);
    };
    list('state_flags_schema', st.state_flags_schema);
    list('inventory_schema', st.inventory_schema);

    if (dettagli.childElementCount) cover.append(dettagli);

    // La copertina si legge dall'inizio, non dal fondo: e' l'unico punto del
    // transcript dove inseguire l'ultima riga sarebbe sbagliato.
    this.anchor = 'top';
    this.push(cover);
    try {
      await this.waitContinue('inizia', 'start');
    } finally {
      this.anchor = 'end';
    }
  }

  // ------------------------------------------------------------ PlayerUI

  sceneEnter(state: GameState, scene: Scene): void {
    this.state = state;
    this.scene = scene;

    // La scheda porta i parametri descrittivi della scena con il nome che
    // hanno nell'IR: sono quelli che si guardano leggendo, senza dover aprire
    // il pannello. Struttura, id e conteggi restano invece nel blocco di debug.
    // Titolo e id sono due cose diverse e devono sembrarlo: il titolo e' per
    // chi legge, l'id e' per chi cerca nel JSON. Tenerli in due elementi
    // separati e' anche l'unico modo perche' l'id non erediti il maiuscoletto
    // del titolo.
    const card = el('section', 'scene');
    const head = el('h2');
    const name = el('span', 'name');
    if (scene.title) name.append(document.createTextNode(scene.title + ' '));
    name.append(el('span', 'sid', scene.id));
    head.append(name, el('span', 'stype', sceneType(scene)));
    card.append(head);

    const param = (label: string, value: string | undefined, media: Media) => {
      if (!value) return;
      card.append(promptRow([label, value, media, false]));
    };
    // L'ordine e' quello con cui si costruisce l'immagine mentale scendendo:
    // il tono della scena, poi l'inquadratura — dove siamo, chi ci sta dentro,
    // cosa si vede — e infine chi c'e', con il suo aspetto e la sua voce.
    // Dentro l'inquadratura vale la stessa regola: il luogo e il cast sono
    // riferimenti ereditati, l'image_prompt e' l'unica cosa che vale solo qui.
    // E' anche l'impaginazione dei beat, che sono inquadrature come questa.
    param('scene_tone', scene.scene_tone || toneOf(this.story, scene), 'none');

    const luogo = scene.background?.place ? findPlace(this.story, scene.background.place) : undefined;
    const bg = promptGroup('background', [
      ['place', scene.background?.place && etichettaLuogo(scene.background.place, luogo?.name), 'none'],
      [`places.${scene.background?.place}.visual_prompt`, luogo?.visual_prompt, 'image'],
      ['characters_in_frame', scene.background?.characters_in_frame?.join(', '), 'none'],
      ['image_prompt', scene.background?.image_prompt, 'image'],
      ['ambient_sound_prompt', scene.background?.ambient_sound_prompt, 'sound'],
    ]);
    if (bg) card.append(bg);

    // Aspetto e voce di chi e' in scena: l'override locale se c'e', altrimenti
    // quello della roster globale. Marcare quale dei due si sta guardando conta
    // — una scena che sovrascrive la voce di un personaggio e' una scelta, e
    // una svista si vede solo se si distingue dall'ereditata.
    for (const c of scene.characters ?? []) {
      const g = findCharacter(this.story, c.id);
      const box = promptGroup(
        `characters.${c.id}`,
        [
          [`visual_prompt${c.visual_prompt ? ' (override)' : ''}`, c.visual_prompt ?? g?.visual_prompt, 'image'],
          [`voice.style_prompt${c.voice?.style_prompt ? ' (override)' : ''}`, c.voice?.style_prompt ?? g?.voice?.style_prompt, 'voice'],
        ],
        g?.name,
      );
      if (box) card.append(box);
    }

    this.push(card);

    const meta = [
      `narrazione: ${(scene.narration ?? []).length} beat`,
      `azioni: ${scene.actions.length}`,
    ];
    if (scene.on_enter_flags_set?.length) meta.push(`on_enter_flags_set: ${scene.on_enter_flags_set.join(', ')}`);
    if (scene.dialogue_tree) {
      meta.push(`dialogue_tree: start=${scene.dialogue_tree.start}, ${Object.keys(scene.dialogue_tree.nodes).length} nodi`);
    }
    if (scene.characters?.length) meta.push(`personaggi: ${scene.characters.map((c) => c.id).join(', ')}`);
    this.dbg(meta.join('\n'));

    this.onUpdate();
  }

  async beat(scene: Scene, b: NarrationBeat, index: number, total: number): Promise<void> {
    this.scene = scene;
    // Il luogo si mostra sempre: per intero quando il beat si sposta altrove
    // rispetto all'inquadratura di base, in una riga sola apribile quando lo
    // eredita dalla scena.
    const luogo = b.place ? findPlace(this.story, b.place) : undefined;
    const ereditato = !!b.place && b.place === scene.background?.place;
    // Stesso ordine della scheda di scena: prima i riferimenti che questa
    // inquadratura eredita (dove, chi), poi cio' che vale solo per lei.
    this.assets([
      ['place', b.place && etichettaLuogo(b.place, findPlace(this.story, b.place)?.name), 'none'],
      [`places.${b.place}.visual_prompt`, luogo?.visual_prompt, 'image', ereditato],
      ['characters_in_frame', b.characters_in_frame?.join(', '), 'none'],
      ['image_prompt', b.image_prompt, 'image'],
      ['sound_effect_prompt', b.sound_effect_prompt, 'sound'],
      ['voice.style_prompt', b.voice?.style_prompt, 'voice'],
    ]);
    this.entry('beat', b.text);
    this.dbg(`beat ${index + 1}/${total}`);
    // Un beat e' un blocco a se': senza un segno, due paragrafi in corsivo di
    // seguito sembrano lo stesso testo e non si capisce cosa abbia aggiunto il
    // tocco su "continua". Il numero del beat lo direbbe, ma vive nel debug.
    this.push(el('hr', 'beat-sep'));
    await this.waitContinue(index + 1 < total ? 'continua' : 'avanti');
  }

  async line(scene: Scene, nodeId: string, n: DialogueNode): Promise<void> {
    this.scene = scene;
    this.assets([['voice_override.style_prompt', n.voice_override?.style_prompt, 'voice']]);

    const p = el('p', 'entry line');
    p.append(el('span', 'speaker', speakerName(this.story, n.speaker)), document.createTextNode(n.text));
    this.push(p);

    const meta = [`nodo ${nodeId}`];
    if (n.effect) meta.push(`effetto: ${describeEffect(n.effect)}`);
    this.dbg(meta.join('\n'));

    if (!n.choices || n.choices.length === 0) await this.waitContinue('continua');
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
    this.assets(buf.rows);
    for (const t of buf.texts) this.entry('narration', t);
    for (const c of buf.changes) this.dbg(`stato: ${c}`);
    if (buf.changes.length && !this.dead) this.onUpdate();
  }

  narration(text: string, voice?: VoiceSpec): void {
    if (this.pending) {
      if (voice?.style_prompt) this.pending.rows.push(['narration_voice.style_prompt', voice.style_prompt, 'voice']);
      this.pending.texts.push(text);
      return;
    }
    this.assets([['narration_voice.style_prompt', voice?.style_prompt, 'voice']]);
    this.entry('narration', text);
  }

  /** Il player non riproduce niente: del suono resta il prompt, che e'
   * esattamente cio' che il modulo assets dovra' generare. */
  sound(prompt: string): void {
    if (this.pending) {
      this.pending.rows.push(['play_sound_prompt', prompt, 'sound']);
      return;
    }
    this.assets([['play_sound_prompt', prompt, 'sound']]);
  }

  stateChange(desc: string): void {
    if (this.pending) {
      this.pending.changes.push(desc);
      return;
    }
    this.dbg(`stato: ${desc}`);
    if (!this.dead) this.onUpdate();
  }

  notice(text: string): void {
    this.entry('notice', text);
  }

  /** Un bug di giocabilita' dell'IR si vede sempre, anche fuori dal debug:
   * e' l'informazione per cui questo player esiste. */
  problem(text: string): void {
    this.entry('problem', '[! IR] ' + text);
  }

  chooseAction(p: ActionPrompt): Promise<Command> {
    this.state = p.state;
    this.scene = p.scene;
    this.lastPrompt = p;
    this.onUpdate();

    if (this.script) {
      const cmd = this.script.chooseAction(p);
      const a = p.available.find((x) => x.id === cmd.actionId);
      this.entry('picked', `▸ ${a?.label ?? cmd.actionId} [${cmd.actionId}]`);
      return Promise.resolve(cmd);
    }

    return this.waitChoice((resolve) => {
      p.available.forEach((a, i) => {
        const b = el('button', 'choice');
        b.append(el('span', 'idx', `${i + 1}`), document.createTextNode(a.label));
        b.append(
          el(
            'span',
            'why dbg-inline',
            `id: ${a.id} · condizione: ${describeCondition(a.condition)} · effetto: ${describeEffect(a.effect)}`,
          ),
        );
        b.onclick = async () => {
          if (!(await this.press(b))) return;
          this.entry('picked', `▸ ${a.label}`);
          resolve({ actionId: a.id });
        };
        this.dock.append(b);
      });

      // Le azioni filtrate restano nel DOM ma invisibili: accendendo il debug
      // si vede subito *perche'* non compaiono, che e' la domanda che ci si
      // pone il 90% delle volte quando si testa una storia.
      for (const h of p.hidden) {
        const b = el('button', 'choice hidden-act');
        b.disabled = true;
        b.append(document.createTextNode(`× ${h.action.label}`));
        b.append(el('span', 'why', `[${h.action.id}] ${h.reason} · effetto: ${describeEffect(h.action.effect)}`));
        this.dock.append(b);
      }

      if (p.terminal) {
        this.dock.append(el('p', 'terminal-note', 'scena finale: da qui non esce nessuna transizione'));
      }
    });
  }

  chooseChoice(p: ChoicePrompt): Promise<Command> {
    this.state = p.state;
    this.scene = p.scene;
    this.onUpdate();

    if (this.script) {
      const cmd = this.script.chooseChoice(p);
      this.entry('picked', `▸ ${p.available[cmd.choiceIndex ?? 0]?.text ?? ''}`);
      return Promise.resolve(cmd);
    }

    return this.waitChoice((resolve) => {
      p.available.forEach((c, i) => {
        const b = el('button', 'choice');
        b.append(el('span', 'idx', `${i + 1}`), document.createTextNode(c.text));
        b.append(
          el('span', 'why dbg-inline', `→ nodo ${c.goto} · condizione: ${describeCondition(c.condition)} · effetto: ${describeEffect(c.effect)}`),
        );
        b.onclick = async () => {
          if (!(await this.press(b))) return;
          this.entry('picked', `▸ ${c.text}`);
          resolve({ choiceIndex: i });
        };
        this.dock.append(b);
      });
      for (const h of p.hidden) {
        const b = el('button', 'choice hidden-act');
        b.disabled = true;
        b.append(document.createTextNode(`× ${h.choice.text}`));
        b.append(el('span', 'why', `→ ${h.choice.goto} · ${h.reason}`));
        this.dock.append(b);
      }
    });
  }

  finish(o: Outcome): void {
    if (this.dead) return;
    clear(this.dock);
    const card = el('div', 'entry finish');
    card.append(el('h3', undefined, o.reason));
    card.append(el('div', undefined, `scena finale: ${o.scene} · passi: ${o.steps}`));
    if (o.problems.length > 0) {
      const list = el('div', undefined, `problemi di giocabilita' incontrati: ${o.problems.length}`);
      list.style.color = 'var(--red)';
      card.append(list);
      for (const p of o.problems) card.append(el('div', undefined, '– ' + p));
    }
    if (this.script && this.script.remaining > 0) {
      card.append(
        el('div', undefined, `attenzione: ${this.script.remaining} passi dello script non sono stati usati (la storia e' finita prima)`),
      );
    }
    this.push(card);
    this.onUpdate();
  }

  // -------------------------------------------------------------- interni

  private waitChoice(render: (resolve: (c: Command) => void) => void): Promise<Command> {
    if (this.dead) return Promise.reject(new QuitError());
    return new Promise<Command>((resolve, reject) => {
      this.abort = reject;
      clear(this.dock);
      render((cmd) => {
        this.abort = undefined;
        clear(this.dock);
        resolve(cmd);
      });
      this.scrollEnd();
    });
  }

  /**
   * Tap-to-continue. In modalita' script non c'e' nessuno da aspettare.
   *
   * `start` e' il bottone che apre la partita: pieno invece che delineato,
   * perche' e' l'unico della sua specie e non deve somigliare ai "continua"
   * che poi si toccano decine di volte.
   */
  private waitContinue(label: string, variant?: 'start'): Promise<void> {
    if (this.script) return Promise.resolve();
    if (this.dead) return Promise.reject(new QuitError());
    return new Promise<void>((resolve, reject) => {
      this.abort = reject;
      clear(this.dock);
      const b = el('button', `choice continue${variant === 'start' ? ' start' : ''}`, `▸ ${label}`);
      const go = async () => {
        if (!(await this.press(b))) return;
        this.abort = undefined;
        clear(this.dock);
        document.removeEventListener('keydown', onKey);
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void go();
        }
      };
      b.onclick = go;
      document.addEventListener('keydown', onKey);
      this.dock.append(b);
      b.focus({ preventScroll: true });
      this.scrollEnd();
    });
  }
}
