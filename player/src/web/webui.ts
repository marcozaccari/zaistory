/**
 * La faccia web dell'engine: transcript scorrevole + chip da toccare.
 *
 * Come il terminale, non contiene logica narrativa: mostra quello che l'engine
 * gli passa e raccoglie tocchi. Il debug aggiunge la diagnostica intorno.
 *
 * ## Cosa sta in alto e cosa sta in basso
 *
 * Lo schermo e' diviso per **senso**, non per tipo di dato. In cima sta il
 * palco (`palco.ts`) con tutto cio' che si guarda: l'inquadratura, il tono
 * della scena, dove siamo, chi e' in campo, le facce del cast. I prompt visivi
 * non lo accompagnano su una riga a parte — si aprono allargando la cosa che
 * descrivono, l'immagine o la faccia.
 *
 * Qui sotto, nel transcript, resta cio' che si ascolta e si legge: la
 * narrazione, il parlato, l'ambiente sonoro, gli effetti, i timbri di
 * narrazione. Un'immagine non li mostra, e quelli sono l'unico modo di sapere
 * che esistono.
 *
 * I campi visivi non spariscono dal resoconto: restano nel documento dentro un
 * blocco `only-debug`, perche' il transcript e' anche il registro di cio' che
 * l'IR dichiara e chi ispeziona deve poter tornare sul beat di sei tocchi fa.
 * Chi gioca invece li ha gia' davanti, in cima, e leggerli due volte sarebbe
 * mezzo schermo di rumore.
 */

import {
  type ActionPrompt,
  type ChoicePrompt,
  type Command,
  type DialogueNode,
  type EsitoTurno,
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
  ScriptEndedError,
  describeCondition,
  describeEffect,
  findCharacter,
  findPlace,
  isDidascalia,
  SCENE_CUTSCENE,
  sceneType,
  segnoTurno,
  speakerName,
  testoOggetto,
  toneOf,
} from '../core/index.js';
import { clear, el, piega, premi, staScrivendo } from './dom.js';
import { doppio, nomeCampo, nomeTipoScena, type Doppio } from './nomi.js';
import { promptGroup, promptNudi, promptRow, valore, type Media, type PromptRow } from './prompt.js';
import type { Immagini } from './immagini.js';
import type { Inquadratura, Palco, Volto } from './palco.js';
import type { Ascolto } from './ascolto.js';

export type { Media };

/** Il riferimento a un luogo, con il suo nome quando ne ha uno: l'id serve a
 * ritrovarlo nel JSON, il nome a sapere di cosa si parla. */
function etichettaLuogo(id: string, nome?: string): string {
  return nome ? `${id} — ${nome}` : id;
}

/** Un luogo come valore di riga: il nome a chi legge, `id — nome` a chi
 * ispeziona. */
function luogoDoppio(id: string | undefined, nome?: string): Doppio | undefined {
  return id ? doppio(nome ?? id, etichettaLuogo(id, nome)) : undefined;
}

/** Chi c'e' nell'inquadratura: i nomi a chi legge, gli id a chi ispeziona. */
function inFrameDoppio(story: Story, ids?: string[]): Doppio | undefined {
  if (!ids?.length) return undefined;
  return doppio(ids.map((id) => findCharacter(story, id)?.name ?? id).join(', '), ids.join(', '));
}

export interface WebUIOptions {
  story: Story;
  resolver: Resolver;
  transcript: HTMLElement;
  dock: HTMLElement;
  /** Chiamata quando stato o scena cambiano, per aggiornare il pannello. */
  onUpdate: () => void;
  /** Se presente, la partita e' guidata da uno script di playthrough. */
  script?: ScriptDriver;
  /** Lo script non arriva da una traccia incollata ma dalla partita che questa
   * pagina stava giocando prima di essere ricaricata. Cambia solo cosa si
   * legge quando non combacia: «la traccia» e' una cosa che si e' incollata,
   * una ripresa e' una cosa che si credeva di avere ancora. */
  ripresa?: boolean;
  /** La seconda uscita del player: la stessa storia, recitata. Arriva da
   * fuori perche' le sue impostazioni sopravvivono alla partita — si
   * ricomincia senza dover riscegliere la voce. */
  ascolto: Ascolto;
  /** La terza: la stessa storia, guardata. Come l'ascolto arriva da fuori,
   * per la stessa ragione — dove stanno le immagini non cambia perche' si
   * ricomincia. */
  immagini: Immagini;
  /** Dove finisce l'inquadratura corrente. Arriva da fuori come gli altri due:
   * e' un pezzo di pagina, e sopravvive alla partita che ci scorre dentro. */
  palco: Palco;
}

export class WebUI implements PlayerUI {
  readonly story: Story;
  resolver: Resolver;
  /** Il turno a input libero. La logica sta nel core: qui c'e' il rendering e
   * basta. */
  private libero: InputLibero;
  /** L'ultima cosa scritta, per non farla riscrivere da capo quando non ha
   * fatto match. */
  private ultimoInput = '';
  state?: GameState;
  scene?: Scene;
  lastPrompt?: ActionPrompt;

  private transcript: HTMLElement;
  private dock: HTMLElement;
  private onUpdate: () => void;
  private script?: ScriptDriver;
  private ripresa: boolean;
  private ascolto: Ascolto;
  private immagini: Immagini;
  private palco: Palco;
  /** Promessa in attesa di un tocco: va rifiutata se la partita viene
   * ricominciata, altrimenti resta appesa per sempre. */
  private abort?: (err: unknown) => void;
  /** Una partita abbandonata continua a chiudersi per un microtask dopo il
   * rifiuto: senza questa bandiera scriverebbe il suo epilogo nel transcript
   * della partita nuova. */
  private dead = false;
  /** Dove riportare la vista quando arriva testo nuovo. */
  private anchor: 'end' | 'top' = 'end';
  /**
   * Il primo blocco uscito dall'ultima cosa che ha fatto il giocatore.
   *
   * Un tocco puo' produrre molto piu' di uno schermo in una volta — la riga
   * dell'azione scelta, la narrazione del suo effetto, la scheda della scena
   * nuova, il primo beat — e inseguire il fondo scavalca proprio la parte che
   * risponde alla domanda "cos'e' successo?". Si atterra quindi in cima al
   * blocco nuovo e si legge in giu'. Quando il blocco e' corto la posizione
   * viene comunque limitata dal fondo del transcript, cioe' si torna a
   * comportarsi come prima senza doverlo scrivere da nessuna parte.
   */
  private landing?: HTMLElement;
  /**
   * Come staccare l'ascoltatore di tastiera del tap-to-continue in corso.
   *
   * Esiste perche' quel listener vive su `document` e non sul bottone, e
   * finora si staccava **solo** quando il bottone veniva premuto davvero. Una
   * partita abbandonata mentre aspettava un «continua» — cioe' ogni volta che
   * si ricomincia o si rigioca una traccia — se lo lasciava dietro, appeso a
   * un documento che nessuno ripulisce. Da quel momento ogni spazio e ogni
   * invio passavano prima da li', che chiamava `preventDefault()`: nella riga
   * di input non si riusciva piu' ne' a mettere uno spazio ne' a mandare la
   * frase, e restava solo il bottone col mouse.
   */
  private staccaTasti?: () => void;
  /** Il prossimo blocco stampato apre un turno nuovo: e' lui l'atterraggio. */
  private wantLanding = false;
  /** Esito dell'`Effect` in corso, in attesa di essere disposto. */
  private pending?: { rows: PromptRow[]; texts: string[]; changes: string[] };
  /** Un tocco e' in corso: il dock e' fermo finche' non finisce. */
  private pressing = false;
  /** Il beat di narrazione mostrato per ultimo e quanti ne ha la scena, per la
   * barra in testa. `beatCorrente` resta `undefined` finche' il primo beat non
   * e' comparso — un contatore che parte da 0/N direbbe una cosa falsa — e poi
   * si ferma sull'ultimo: a narrazione finita `10/10` significa "li hai visti
   * tutti", che e' esattamente quello che si vuole sapere restando fermi. */
  beatCorrente?: number;
  beatTotali?: number;
  /** Le due caselle della copertina: la figura sopra il titolo e i prompt che
   * la sostituiscono sotto la descrizione. Restano in mano alla `WebUI` perche'
   * la copertina non e' resoconto ma **schermata** — ci si sta sopra — e
   * l'interruttore delle immagini deve poterla ridisegnare mentre la si
   * guarda, esattamente come fa col palco. */
  private slotFigura?: HTMLElement;
  private slotPrompt?: HTMLElement;

  constructor(o: WebUIOptions) {
    this.story = o.story;
    this.resolver = o.resolver;
    this.libero = new InputLibero(o.story, o.resolver);
    this.transcript = o.transcript;
    this.dock = o.dock;
    this.onUpdate = o.onUpdate;
    this.script = o.script;
    this.ripresa = o.ripresa ?? false;
    this.ascolto = o.ascolto;
    this.immagini = o.immagini;
    this.palco = o.palco;
  }

  /**
   * Cambia backend a partita in corso.
   *
   * E' il motivo per cui il resolver e' un'interfaccia: si accende l'embedder
   * nella stessa scena in cui il lessicale ha appena detto di no, si riscrive
   * la stessa frase e si vede se cambia qualcosa. Un confronto fatto cosi'
   * dice cose che un rapporto di copertura non dice.
   */
  usaResolver(r: Resolver): void {
    this.resolver = r;
    this.libero = new InputLibero(this.story, r);
  }

  /**
   * Vero dove si scrive con una tastiera vera e non con quella di sistema.
   *
   * E' la differenza fra «il fuoco nel campo non costa niente» e «il fuoco nel
   * campo si mangia meta' schermo». Si chiede al puntatore e non alla
   * larghezza: un tablet con la tastiera attaccata e' un telefono per
   * larghezza e un computer per come ci si scrive.
   */
  private get tastieraFisica(): boolean {
    return window.matchMedia('(pointer: fine)').matches;
  }

  /**
   * Chiude la tastiera di sistema.
   *
   * Togliere dal DOM un campo che ha il fuoco non basta: il browser resta con
   * i tasti aperti su un elemento che non esiste piu', e da li' non si chiude
   * piu' con niente. Va tolto il fuoco **prima**, esplicitamente.
   */
  private chiudiTastiera(): void {
    const a = document.activeElement;
    if (a instanceof HTMLElement && this.dock.contains(a)) a.blur();
    // `blur` da solo basterebbe — c'e' un gestore che la toglie — ma non
    // quando il campo viene rimosso dal DOM senza aver mai perso il fuoco: li'
    // il palco resterebbe ritirato per il resto della partita.
    document.body.classList.remove('tastiera');
  }

  /** Interrompe l'attesa in corso (usata quando si ricomincia o si cambia IR). */
  cancel(): void {
    this.dead = true;
    this.chiudiTastiera();
    this.ascolto.taci();
    this.abort?.(new QuitError());
    this.abort = undefined;
    this.staccaTasti?.();
    this.staccaTasti = undefined;
    this.pressing = false;
    this.dock.classList.remove('bloccato');
    clear(this.dock);
  }

  /**
   * Il tocco su una chip del dock: la trattenuta condivisa (`premi`) piu' cio'
   * che riguarda solo il gioco.
   *
   * Quello che aggiunge rispetto a `premi`: durante l'attesa il dock e'
   * inerte, cosi' un secondo tocco non fa partire due azioni — che qui
   * sarebbero due passi di storia, non due click a vuoto.
   *
   * Ritorna false se un tocco era gia' in corso: chi chiama deve fermarsi.
   */
  private async press(b: HTMLButtonElement): Promise<boolean> {
    if (this.pressing || this.dead) return false;
    // Il tocco e' stato accolto: da qui comincia un turno, e il primo blocco
    // che ne esce e' dove riportare la lettura. Sta qui e non nei singoli
    // gestori perche' questa e' l'unica strada per cui passano tutti i tocchi.
    this.nuovoTurno();
    this.pressing = true;
    this.dock.classList.add('bloccato');
    await premi(b);
    this.pressing = false;
    this.dock.classList.remove('bloccato');
    return !this.dead;
  }

  // -------------------------------------------------------------- stampa

  private push(node: Node): void {
    if (this.dead) return;
    this.transcript.append(node);
    // L'atterraggio dev'essere un blocco che si *vede*. Le righe di debug
    // stanno nel DOM anche a debug spento, e `offsetTop` di un elemento
    // display:none e' 0: ancorarsi a una di loro riporta la vista in cima al
    // transcript. Succede sul serio all'ultimo tocco di un dialogo, dove il
    // turno stampa solo la riga nascosta del flag appena impostato. Finche'
    // arriva roba invisibile si continua ad aspettare; se il turno non stampa
    // altro, `landing` resta vuoto e si torna al fondo, che li' e' il punto
    // giusto.
    if (this.wantLanding && node instanceof HTMLElement && node.offsetParent !== null) {
      this.landing = node;
      this.wantLanding = false;
    }
    // Sotto script non si insegue niente: nessuno sta leggendo mentre la
    // traccia scorre, e ognuno di questi inseguimenti costa una misura del
    // documento. Su una ripresa di centotrentacinque passi sono piu' di mille
    // rimisurazioni per arrivare esattamente dove si arriva comunque alla
    // fine, con il primo turno vero. Riprendere una partita lunga passa da due
    // secondi a poco piu' di uno.
    if (!this.script) this.scrollEnd();
  }

  /**
   * Riporta in vista il punto che conta: l'inizio di cio' che e' appena
   * arrivato, o il fondo finche' non c'e' un blocco nuovo da leggere; la
   * copertina invece si legge dall'inizio.
   *
   * `scrollTop` viene limitato dal browser al massimo consentito, ed e' quello
   * che rende la regola una sola: se il blocco nuovo entra tutto nello schermo,
   * la posizione richiesta ricade sul fondo da se'.
   *
   * Il secondo giro dentro `requestAnimationFrame` serve perche' il dock
   * cresce dopo il transcript (le chip si costruiscono per ultime): senza,
   * l'ultima riga resta nascosta sotto i bottoni.
   */
  /**
   * Comincia un turno: l'atterraggio vecchio non vale piu' e il prossimo blocco
   * stampato prende il suo posto.
   *
   * Azzerarlo conta quanto assegnarlo. Un tocco puo' non produrre nessun blocco
   * — l'ultima battuta di un dialogo lineare porta solo al nodo dopo — e
   * senza azzeramento la vista resterebbe ancorata al turno precedente, con il
   * testo appena letto sopra lo schermo. Senza atterraggio si torna al fondo,
   * che in quel caso e' proprio il punto giusto.
   */
  private nuovoTurno(): void {
    // Zittire qui e non altrove: questa e' l'unica strada per cui passano
    // tutti i turni, e un turno nuovo che parte mentre la scena precedente sta
    // ancora parlando e' due voci sovrapposte — cioe' nessuna delle due.
    this.ascolto.taci();
    this.landing = undefined;
    this.wantLanding = true;
  }

  /**
   * `inFondo` scavalca l'atterraggio e va all'ultima riga.
   *
   * Serve in un caso solo, ed e' il momento in cui si prende la penna in mano:
   * col fuoco nel campo la domanda non e' piu' «cos'e' successo?» — a cui
   * risponde l'inizio del blocco nuovo — ma «cosa scrivo adesso?», a cui
   * risponde l'ultima cosa letta. Atterrare in cima a un turno lungo lascia
   * proprio quella fuori dallo schermo.
   */
  private scrollEnd(inFondo = false): void {
    const go = () => {
      if (this.anchor === 'top') {
        this.transcript.scrollTop = 0;
        return;
      }
      this.transcript.scrollTop =
        this.landing && !inFondo
          ? this.landing.offsetTop - this.transcript.offsetTop
          : this.transcript.scrollHeight;
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
    const box = promptNudi(rows);
    if (!box) return;
    box.className = 'assets';
    this.push(box);
  }

  /**
   * Gli stessi prompt, ma solo per chi ispeziona.
   *
   * E' dove finiscono i campi visivi di un'inquadratura — dove siamo, chi e'
   * in campo, l'`image_prompt`, l'aspetto del luogo. Chi gioca li ha gia'
   * davanti sul palco, in cima allo schermo, e ripeterli qui sotto sarebbe
   * mezzo schermo di rumore fra una riga di narrazione e l'altra; ma il
   * transcript resta il registro di cio' che l'IR dichiara, ed e' l'unico
   * posto dove si torna a vedere con che prompt e' stato costruito il beat di
   * sei tocchi fa. Nel documento ci sono sempre, si vedono col debug.
   */
  private assetsIspezione(rows: PromptRow[]): void {
    const box = promptNudi(rows);
    if (!box) return;
    box.className = 'assets only-debug';
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

    // La locandina, prima di tutto: e' la risposta all'unica domanda che ci si
    // fa aprendo una storia che non si conosce — «di cosa parla?» — e nessun
    // paragrafo la da' altrettanto in fretta. Con le immagini spente, o prima
    // che sia stata generata, al suo posto restano i prompt: e' la stessa
    // regola del palco, e per la stessa ragione.
    //
    // Due caselle vuote invece di un blocco solo: la figura sta sopra il
    // titolo, dove una locandina sta; i prompt che la sostituiscono stanno
    // sotto la descrizione, perche' un muro di testo sopra il titolo lo
    // seppellirebbe. `rileggiCopertina` riempie l'una o l'altra, ed e' la
    // stessa funzione che gira quando si accendono o si spengono le immagini
    // mentre la copertina e' ancora a schermo.
    this.slotFigura = el('div', 'locandina-slot');
    this.slotPrompt = el('div');
    cover.append(this.slotFigura);
    cover.append(el('h1', undefined, st.title));
    if (st.description) cover.append(el('p', 'desc', st.description));
    cover.append(this.slotPrompt);
    this.rileggiCopertina();

    const dl = el('dl', 'kv');
    const meta = (k: string, v?: string | Doppio, soloDebug = false) => {
      if (!v) return;
      const dt = el('dt', soloDebug ? 'only-debug' : undefined);
      dt.append(el('span', 'umano', nomeCampo(k)), el('span', 'ir', k));
      const dd = el('dd', soloDebug ? 'only-debug' : undefined);
      dd.append(valore(v));
      dl.append(dt, dd);
    };
    meta('ir_version', st.ir_version);
    // La provenienza sta con gli altri dati d'identita' del file, non sotto il
    // debug: e' la prima cosa da guardare quando due IR della stessa storia non
    // coincidono.
    if (st.generated_by) {
      const g = st.generated_by;
      meta('generated_by', `${g.compiler} ${g.compiler_version}${g.model ? ` · ${g.model}` : ''}`);
    }
    meta('id', st.id);
    meta('language', st.language);
    // Quante scene ha la storia e' una misura del file, non della storia: a chi
    // gioca dice solo quanto manca alla fine, che e' un anticipo che nessuno ha
    // chiesto — la stessa ragione per cui non sta piu' nemmeno in barra.
    meta('scenes', `${st.scenes.length}`, true);
    // La prima scena si chiama col suo titolo: l'id dice dove trovarla nel
    // JSON, e quello e' un servizio per chi ispeziona.
    const prima = st.scenes.find((s) => s.id === st.start_scene);
    meta('start_scene', doppio(prima?.title || st.start_scene, st.start_scene));
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

    // Tutti chiusi, e il conto nel titolo. Sono cinque elenchi che aperti
    // insieme fanno diverse schermate di roster prima ancora che la storia
    // cominci: chi apre una copertina vuole sapere *che storia e'*, non
    // leggere l'anagrafica. Il numero accanto al nome risponde gia' alla meta'
    // della domanda che ci si fa davvero — quanti personaggi, quanti luoghi,
    // quanti flag — e l'altra meta' e' a un tocco.
    if (st.characters?.length) {
      const { root, corpo } = piega('personaggi', st.characters.length);
      for (const c of st.characters) {
        const box = promptGroup(
          `characters.${c.id}`,
          [
            ['visual_prompt', c.visual_prompt, 'image'],
            ['voice.style_prompt', c.voice?.style_prompt, 'voice'],
          ],
          c.name,
        );
        if (box) corpo.append(box);
        else corpo.append(el('span', 'gname', `characters.${c.id}`));
      }
      dettagli.append(root);
    }

    // I luoghi: come i personaggi, hanno un prompt che vale da riferimento
    // stabile per ogni inquadratura ambientata li'.
    if (st.places?.length) {
      const { root, corpo } = piega('luoghi', st.places.length);
      for (const pl of st.places) {
        const box = promptGroup(`places.${pl.id}`, [['visual_prompt', pl.visual_prompt, 'image']], pl.name);
        if (box) corpo.append(box);
      }
      dettagli.append(root);
    }

    // Gli elenchi documentali: non fanno niente in gioco, ma dicono cosa
    // l'autore si aspettava che la storia usasse — e il linter li confronta.
    const list = (title: string, values?: string[]) => {
      if (!values?.length) return;
      const { root, corpo } = piega(title, values.length);
      const box = el('div', 'chips');
      for (const v of values) box.append(el('span', 'chip', v));
      corpo.append(box);
      dettagli.append(root);
    };
    list('state_flags_schema', st.state_flags_schema);
    list(
      'items',
      st.items?.map((i) => (i.aliases?.length ? `${i.name} (${i.aliases.join(', ')})` : i.name)),
    );
    list('initial_inventory', st.initial_inventory);

    if (dettagli.childElementCount) cover.append(dettagli);

    // La copertina si legge dall'inizio, non dal fondo: e' l'unico punto del
    // transcript dove inseguire l'ultima riga sarebbe sbagliato.
    this.anchor = 'top';
    this.push(cover);
    this.ascolto.copertina();
    try {
      await this.waitContinue('inizia', 'start');
    } finally {
      this.anchor = 'end';
    }
  }

  /**
   * Ridisegna la locandina con il modo immagini che vale adesso.
   *
   * La regola del transcript — «cio' che e' stampato resta, l'interruttore
   * vale da qui in avanti» — qui non si applica, ed e' la differenza fra un
   * resoconto e una schermata: la copertina non e' una cosa successa un
   * momento fa, e' dove si sta. Spegnere le immagini mentre la si guarda e
   * vederla restare com'era sarebbe l'interruttore che non fa niente.
   */
  rileggiCopertina(): void {
    const fig = this.slotFigura;
    const box = this.slotPrompt;
    if (!fig || !box) return;
    const st = this.story;
    const righe: PromptRow[] = [
      ['image_prompt', st.cover?.image_prompt, 'image'],
      ['place', luogoDoppio(st.cover?.place, findPlace(this.story, st.cover?.place ?? '')?.name), 'none'],
      ['characters_in_frame', inFrameDoppio(this.story, st.cover?.characters_in_frame), 'none'],
    ];
    const locandina = this.immagini.figura(st.cover?.image, st.cover?.image_prompt, {
      classe: 'locandina',
      titolo: st.title,
      righe,
    });
    fig.replaceChildren(...(locandina ? [locandina] : []));

    const prompt = locandina ? undefined : promptNudi(righe);
    if (prompt) prompt.className = 'assets';
    box.replaceChildren(...(prompt ? [prompt] : []));
  }

  // ------------------------------------------------------------ PlayerUI

  sceneEnter(state: GameState, scene: Scene): void {
    this.state = state;
    this.scene = scene;
    // Il contatore dei beat riparte da capo: quanti ne ha questa scena si sa
    // subito, a quale si sia arrivati solo quando il primo compare.
    this.beatTotali = scene.narration?.length || undefined;
    this.beatCorrente = undefined;

    // Tutto cio' che si guarda sale in cima: l'inquadratura, il tono, dove
    // siamo, chi e' in campo, e le facce del cast di lato. Restano li' fermi
    // mentre il racconto scorre sotto, che e' l'unico modo perche' rispondano
    // ancora a «dove sono e chi ho davanti» al sesto beat di una cutscene.
    this.palco.scena(this.inquadratura(scene), this.cast(scene));

    // Qui sotto resta la scheda della scena: il titolo, e cio' che si ascolta.
    // Titolo e id sono due cose diverse e devono sembrarlo: il titolo e' per
    // chi legge, l'id e' per chi cerca nel JSON. Tenerli in due elementi
    // separati e' anche l'unico modo perche' l'id non erediti il maiuscoletto
    // del titolo.
    const card = el('section', 'scene');
    const head = el('h2');
    const name = el('span', 'name');
    if (scene.title) name.append(document.createTextNode(scene.title + ' '));
    // L'id della scena non ha un equivalente umano: non e' un campo da
    // tradurre, e' una chiave per ritrovarla nel JSON. Sparisce e basta, tanto
    // il titolo che serve a chi gioca gli sta accanto.
    name.append(el('span', 'sid ir', scene.id));
    const tipo = el('span', 'stype');
    tipo.append(el('span', 'umano', nomeTipoScena(sceneType(scene))), el('span', 'ir', sceneType(scene)));
    head.append(name, tipo);
    card.append(head);

    // L'ambiente sonoro sta con la scena e non sul palco: un'immagine non lo
    // mostra, e questa riga e' l'unico modo di sapere che quella stanza ha un
    // suono di fondo.
    // Riga nuda e non gruppo: `background` conteneva anche i campi visivi, che
    // adesso stanno in cima — un'intestazione «ambientazione» sopra un campo
    // solo nomina un gruppo che non c'e' piu'.
    if (scene.background?.ambient_sound_prompt) {
      card.append(promptRow(['ambient_sound_prompt', scene.background.ambient_sound_prompt, 'sound']));
    }

    this.push(card);
    this.ascolto.scena(scene);

    // I campi visivi restano nel registro, per chi ispeziona: chi gioca li ha
    // gia' davanti in cima allo schermo.
    const luogo = scene.background?.place ? findPlace(this.story, scene.background.place) : undefined;
    this.assetsIspezione([
      ['scene_tone', scene.scene_tone || toneOf(this.story, scene), 'none'],
      ['place', luogoDoppio(scene.background?.place, luogo?.name), 'none'],
      [`places.${scene.background?.place}.visual_prompt`, luogo?.visual_prompt, 'image'],
      ['characters_in_frame', inFrameDoppio(this.story, scene.background?.characters_in_frame), 'none'],
      ['image_prompt', scene.background?.image_prompt, 'image'],
      ...this.cast(scene).flatMap((v): PromptRow[] => [
        [`characters.${v.id}.visual_prompt${v.aspettoOverride ? ' (override)' : ''}`, v.aspetto, 'image'],
        [`characters.${v.id}.voice.style_prompt${v.voceOverride ? ' (override)' : ''}`, v.voce, 'voice'],
      ]),
    ]);

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

  /**
   * L'inquadratura di base di una scena, come la vede il palco.
   *
   * Il tono e' quello della scena o, se non ne dichiara uno, quello globale:
   * e' l'unico campo del palco che non descrive un'immagine ma il modo di
   * leggere tutto il resto, e per questo non sparisce mai dietro un tocco.
   */
  private inquadratura(scene: Scene): Inquadratura {
    const luogo = scene.background?.place ? findPlace(this.story, scene.background.place) : undefined;
    return {
      image: scene.background?.image,
      image_prompt: scene.background?.image_prompt,
      tono: scene.scene_tone || toneOf(this.story, scene),
      luogo: scene.background?.place
        ? {
            id: scene.background.place,
            nome: luogo?.name ?? scene.background.place,
            aspetto: luogo?.visual_prompt,
          }
        : undefined,
      inCampo: scene.background?.characters_in_frame,
      titolo: scene.title,
    };
  }

  /**
   * Il cast di una scena: aspetto e voce di chi c'e', con l'override locale
   * quando la scena ne dichiara uno.
   *
   * Marcare quale dei due si sta guardando conta: una scena che sovrascrive la
   * voce di un personaggio e' una scelta, e una svista si vede solo se si
   * distingue dall'ereditata.
   */
  private cast(scene: Scene): Volto[] {
    return (scene.characters ?? []).map((c) => {
      const g = findCharacter(this.story, c.id);
      return {
        id: c.id,
        nome: g?.name ?? c.id,
        image: c.image ?? g?.image,
        aspetto: c.visual_prompt ?? g?.visual_prompt,
        aspettoOverride: !!c.visual_prompt,
        voce: c.voice?.style_prompt ?? g?.voice?.style_prompt,
        voceOverride: !!c.voice?.style_prompt,
      };
    });
  }

  async beat(scene: Scene, b: NarrationBeat, index: number, total: number): Promise<void> {
    this.scene = scene;

    // Il beat cambia inquadratura: la nuova prende il posto della precedente
    // sul palco, e il testo che arriva sotto la commenta. Un beat senza
    // `image` non lo svuota — resta quella di prima, che e' esattamente cio'
    // che succede quando la macchina non si e' spostata. Quello che invece
    // cambia sempre e' chi e' in campo: le facce del cast restano tutte, e si
    // marca chi di loro l'inquadratura dichiara.
    const luogo = b.place ? findPlace(this.story, b.place) : undefined;
    const base = this.inquadratura(scene);
    this.palco.inquadratura({
      ...base,
      image: b.image,
      image_prompt: b.image_prompt ?? base.image_prompt,
      luogo: b.place
        ? { id: b.place, nome: luogo?.name ?? b.place, aspetto: luogo?.visual_prompt }
        : base.luogo,
      inCampo: b.characters_in_frame ?? base.inCampo,
    });

    // Qui sotto solo cio' che si ascolta: l'effetto sonoro di questo passaggio
    // e il timbro con cui va narrato. Sono i due campi che un'immagine non puo'
    // mostrare, e per questo non salgono sul palco.
    this.assets([
      ['sound_effect_prompt', b.sound_effect_prompt, 'sound'],
      ['voice.style_prompt', b.voice?.style_prompt, 'voice'],
    ]);
    // I campi visivi restano nel registro, per chi ispeziona. Il luogo
    // ereditato dalla scena sta su una riga sola che si apre: c'e', ma non e'
    // la notizia.
    const ereditato = !!b.place && b.place === scene.background?.place;
    this.assetsIspezione([
      ['place', luogoDoppio(b.place, luogo?.name), 'none'],
      [`places.${b.place}.visual_prompt`, luogo?.visual_prompt, 'image', ereditato],
      ['characters_in_frame', inFrameDoppio(this.story, b.characters_in_frame), 'none'],
      ['image_prompt', b.image_prompt, 'image'],
    ]);

    this.entry('beat', b.text);
    this.ascolto.beat(scene, b, index);
    this.dbg(`beat ${index + 1}/${total}`);
    // Un beat e' un blocco a se': senza un segno, due paragrafi in corsivo di
    // seguito sembrano lo stesso testo e non si capisce cosa abbia aggiunto il
    // tocco su "continua". Il numero del beat lo dice, ma sta in testa alla
    // pagina: qui serve un confine visibile dentro al testo.
    this.push(el('hr', 'beat-sep'));
    // Prima dell'attesa: dopo, la barra si aggiornerebbe solo al tocco, cioe'
    // mostrerebbe sempre il beat precedente a quello che si sta leggendo.
    this.beatCorrente = index + 1;
    this.beatTotali = total;
    this.onUpdate();
    // Si aspetta solo se c'e' un altro beat. Dopo l'ultimo, quello che viene
    // dopo — le azioni della scena, o l'unica azione di prosecuzione di una
    // cutscene — e' gia' pronto da mostrare: un tocco che non porta niente di
    // nuovo sullo schermo e' solo un tocco in piu', e in fondo a una cutscene
    // di nove beat diventa "avanti" seguito da "Continua", due bottoni di fila
    // che dicono la stessa cosa.
    //
    // Non e' logica di flusso che il player si inventa: le azioni disponibili e
    // le transizioni restano quelle dell'IR, cambia solo il momento in cui le
    // chip compaiono, che e' impaginazione.
    if (index + 1 < total) await this.waitContinue('continua');
  }

  async line(scene: Scene, nodeId: string, n: DialogueNode): Promise<void> {
    this.scene = scene;
    this.assets([['voice_override.style_prompt', n.voice_override?.style_prompt, 'voice']]);

    // Una didascalia e' prosa: quello che nella sceneggiatura sta fra due
    // battute. Mettergli davanti «Narratore» inventa una voce fuori campo che
    // non c'e' — e in ascolto la fa pure recitare a ogni riga.
    const p = el('p', isDidascalia(n) ? 'entry line didascalia' : 'entry line');
    if (!isDidascalia(n)) p.append(el('span', 'speaker', speakerName(this.story, n.speaker)));
    p.append(document.createTextNode(n.text));
    this.push(p);
    this.ascolto.battuta(n);

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
    for (const [, v, media] of buf.rows) {
      // I valori doppi sono riferimenti — un luogo, chi c'e' in campo — non
      // prompt: non si recitano, e non c'e' niente da leggere dentro di loro.
      if (typeof v !== 'string') continue;
      if (media === 'sound') this.ascolto.suono(v);
      if (media === 'voice') this.ascolto.vocePrompt({ style_prompt: v });
    }
    for (const t of buf.texts) {
      this.entry('narration', t);
      this.ascolto.dilo(t);
    }
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
    this.ascolto.vocePrompt(voice);
    this.entry('narration', text);
    this.ascolto.dilo(text);
  }

  /** Il player non riproduce niente: del suono resta il prompt, che e'
   * esattamente cio' che il modulo assets dovra' generare. */
  sound(prompt: string): void {
    if (this.pending) {
      this.pending.rows.push(['play_sound_prompt', prompt, 'sound']);
      return;
    }
    this.assets([['play_sound_prompt', prompt, 'sound']]);
    this.ascolto.suono(prompt);
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
    this.ascolto.dilo(text);
  }

  /** Un bug di giocabilita' dell'IR si vede sempre, anche fuori dal debug:
   * e' l'informazione per cui questo player esiste. */
  problem(text: string): void {
    this.entry('problem', '[! IR] ' + text);
    this.ascolto.dilo(text);
  }

  chooseAction(p: ActionPrompt): Promise<Command> {
    this.state = p.state;
    this.scene = p.scene;
    this.lastPrompt = p;
    this.onUpdate();

    if (this.script) {
      const cmd = this.consumaScript(() => this.script!.chooseAction(p));
      if (cmd) {
        const a = p.available.find((x) => x.id === cmd.actionId);
        this.nuovoTurno();
        this.entry('picked', `▸ ${a?.label ?? cmd.actionId} [${cmd.actionId}]`);
        return Promise.resolve(cmd);
      }
      // La traccia e' finita: si prosegue a mano, da qui sotto.
    }

    // L'interfaccia e' la riga di testo; le chip sono strumento di ispezione e
    // si vedono solo in debug. Non e' un cambio di stile: un elenco che mostra
    // le azioni utili risolve gli enigmi al posto del giocatore, e finche'
    // resta acceso non si puo' giudicare quanto una storia compilata sia
    // davvero difficile.
    //
    // Nelle cutscene no, e per la stessa ragione al contrario: li' l'unica
    // azione e' proseguire, non c'e' nessun enigma da proteggere, e obbligare
    // a *scrivere* "continua" dopo ogni sequenza narrata sarebbe attrito e
    // basta. Una cutscene si guarda e si tocca, come dice l'architettura.
    const cutscene = sceneType(p.scene) === SCENE_CUTSCENE;

    return this.waitChoice((resolve) => {
      if (!cutscene) this.dock.append(this.rigaInput(p, resolve));

      /**
       * L'unica chip di una cutscene, quando l'avanzamento automatico e'
       * acceso.
       *
       * In fondo a una sequenza narrata la prosecuzione non e' un tap-to-
       * continue ma un'azione dell'IR, e senza questo l'avanzamento
       * automatico attraverserebbe nove beat da solo per poi fermarsi
       * sull'ultimo bottone — quello che, a schermo spento, e' proprio il
       * tocco impossibile da trovare.
       *
       * Solo con una candidata sola, e solo in cutscene. Dove le azioni sono
       * due il player non sceglie al posto del giocatore: e' il vincolo che
       * regge tutto il resto, e vale anche quando la scelta sembra ovvia.
       */
      const soloUscita = cutscene && p.available.length === 1;

      // L'elenco delle azioni sotto il debug sta dentro un blocco chiuso.
      // Acceso il debug, quello che si guarda e' quasi sempre il transcript —
      // cosa ha capito il resolver, quale fallback e' uscito — e una scena con
      // otto azioni piu' le filtrate copriva mezzo schermo di bottoni sopra la
      // riga in cui si scrive. Chiuso, il conto nel titolo dice gia' quello
      // che si controlla al volo («quante ne ha questa scena?») e l'elenco e'
      // a un tocco. Nasce solo se c'e' qualcosa da metterci dentro.
      let debug: ReturnType<typeof piega> | undefined;
      const inDebug = (b: HTMLElement) => {
        if (!debug) {
          debug = piega('azioni', 0);
          debug.root.classList.add('solo-debug');
        }
        debug.corpo.append(b);
      };

      p.available.forEach((a, i) => {
        // Un'uscita mostrata (`p.uscite`) non e' una chip di debug: la scena
        // non ha piu' niente da dare, e continuare a chiedere di indovinare la
        // frase giusta non protegge piu' nessun enigma. Si vede con la label
        // che le ha dato l'autore — «Lasciare che la strada finisca» dice dove
        // si sta andando, cosa che «continua» non dice.
        const uscita = !cutscene && p.uscite.includes(a);
        const b = el('button', cutscene || uscita ? 'choice continue' : 'choice solo-debug');
        if (!cutscene && !uscita) b.append(el('span', 'idx', `${i + 1}`));
        // Il segno sta in un elemento suo: e' l'unica cosa del bottone che
        // deve poter crescere senza portarsi dietro il testo e l'altezza.
        if (cutscene || uscita) b.append(el('span', 'segno', '▸'));
        b.append(document.createTextNode(a.label));
        b.append(
          el(
            'span',
            'why dbg-inline',
            `id: ${a.id} · condizione: ${describeCondition(a.condition)} · effetto: ${describeEffect(a.effect)}`,
          ),
        );
        const vai = async () => {
          this.ascolto.voce.dimenticaFine();
          if (!(await this.press(b))) return;
          this.entry('picked', `▸ ${a.label}`);
          resolve({ actionId: a.id });
        };
        b.onclick = vai;
        if (cutscene || uscita) this.dock.append(b);
        else inDebug(b);

        if (soloUscita && this.ascolto.attiva && this.ascolto.impostazioni.avanzamento) {
          this.ascolto.voce.quandoFinisce(() => {
            if (!this.dead) void vai();
          });
        }
      });

      // Le azioni filtrate restano nel DOM ma invisibili: accendendo il debug
      // si vede subito *perche'* non compaiono, che e' la domanda che ci si
      // pone il 90% delle volte quando si testa una storia.
      for (const h of p.hidden) {
        const b = el('button', 'choice hidden-act');
        b.disabled = true;
        b.append(document.createTextNode(`× ${h.action.label}`));
        b.append(el('span', 'why', `[${h.action.id}] ${h.reason} · effetto: ${describeEffect(h.action.effect)}`));
        inDebug(b);
      }

      if (debug) {
        // Il conto si scrive alla fine: prima non si sa quante ne entrano,
        // fra disponibili non mostrate e filtrate da una condizione.
        const d: ReturnType<typeof piega> = debug;
        const quanti = d.corpo.childElementCount;
        d.root.querySelector('.piega-quanti')!.textContent = String(quanti);
        this.dock.append(d.root);
      }

      if (p.terminal) {
        this.dock.append(el('p', 'terminal-note', 'scena finale: da qui non esce nessuna transizione'));
      }

      // La sola parte del dock che la modalita' ascolto recita: quando la
      // scena e' finita, l'uscita non e' una voce di menu ma l'unica cosa
      // rimasta, e il silenzio sarebbe il muro che questa funzione toglie.
      if (!cutscene) this.ascolto.uscite(p.uscite.map((u) => u.label));
    });
  }

  /**
   * La riga in cui si scrive cosa si fa.
   *
   * Resta montata fra un tentativo e l'altro: una frase che non ha fatto match
   * non e' un errore da cui ripartire da zero, e' quasi sempre una frase quasi
   * giusta. Il testo si rilegge nel transcript, il campo si svuota, il fuoco
   * resta dov'e'.
   */
  private rigaInput(p: ActionPrompt, resolve: (c: Command) => void): HTMLElement {
    const form = el('form', 'riga-input');
    const campo = el('input', 'campo');
    campo.type = 'text';
    campo.autocomplete = 'off';
    campo.autocapitalize = 'none';
    campo.spellcheck = false;
    campo.placeholder = 'scrivi cosa fare';
    campo.value = this.ultimoInput;
    const invia = el('button', 'invia', '▸');
    invia.type = 'submit';
    invia.setAttribute('aria-label', 'esegui');
    form.append(campo, invia);

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const testo = campo.value.trim();
      if (testo === '' || this.pressing || this.dead) return;

      this.nuovoTurno();
      this.entry('echo', `· ${testo}`);
      this.pressing = true;
      this.dock.classList.add('bloccato');
      campo.blur();

      let e: EsitoTurno;
      try {
        e = await this.libero.risolvi(p, testo);
      } finally {
        this.pressing = false;
        this.dock.classList.remove('bloccato');
      }
      if (this.dead) return;

      if (e.kind === 'azione' && e.actionId) {
        const a = p.available.find((x) => x.id === e.actionId);
        this.entryVia('picked', `▸ ${a?.label ?? e.actionId}`, e);
        // Questa sopravvive alla regola "il dock non si legge", e non e' una
        // deroga: qui non si sta leggendo una chip, si sta dicendo *cosa il
        // resolver ha capito* da una frase scritta. E' l'unica risposta a
        // "ha preso l'azione che volevo?", e senza schermo non c'e' altro
        // modo di saperlo prima che l'effetto sia gia' applicato.
        this.ascolto.dilo(a?.label ?? e.actionId);
        this.dbg(`resolver: ${e.via ?? '-'}${e.why ? ` · ${e.why}` : ''}`);
        this.ultimoInput = '';
        this.abort = undefined;
        this.chiudiTastiera();
        clear(this.dock);
        resolve({ actionId: e.actionId });
        return;
      }

      // Azione bloccata, verbo del player o nessun match: si mostra testo
      // d'autore e si resta qui. Nessun Effect e' stato applicato — l'engine
      // non ha nemmeno saputo che il giocatore ha scritto qualcosa.
      if (e.verbo === 'look') this.ascolto.riosserva(p.scene);
      // «guarda il walkie» e il tocco sulla chip dell'inventario portano alla
      // stessa risposta d'autore: e' giusto che portino anche alla stessa
      // immagine.
      if (e.verbo === 'esamina' && e.oggetto && e.testo) this.mostraOggetto(e.oggetto);
      if (e.testo) {
        this.entryVia(e.kind === 'verbo' ? 'look' : 'narration', e.testo, e);
        this.ascolto.dilo(e.testo);
      }
      // La nota e' diagnostica d'autore, non narrazione: dice che un testo
      // manca nell'IR, e chi sta giocando non deve leggere un messaggio di
      // errore al posto della storia. Sta sotto il debug come tutto il resto
      // della diagnostica, e il linter la elenca comunque prima di giocare.
      // (Diverso da `problem()`, che segnala un IR *rotto* e si vede sempre:
      // li' non c'e' niente da leggere al suo posto.)
      if (e.nota) this.dbg(e.nota);
      if (!e.testo && !e.nota) {
        this.entry('notice', 'Non succede niente.');
        this.ascolto.dilo('Non succede niente.');
      }
      this.dbg(`resolver: ${e.via ?? '-'}${e.why ? ` · ${e.why}` : ''}`);

      this.ultimoInput = '';
      campo.value = '';
      // Il fuoco torna al campo **solo dove non c'e' una tastiera di sistema**.
      // Su un telefono rimetterlo li' significa riaprire i tasti addosso alla
      // risposta appena arrivata, che e' proprio la riga da leggere per capire
      // come riscrivere la frase: la tastiera si richiama con un tocco, e
      // quello e' un gesto che si fa quando si e' finito di leggere.
      if (this.tastieraFisica) campo.focus({ preventScroll: true });
      this.scrollEnd();
    };

    // Quando la tastiera si apre o si chiude, il viewport visuale cambia
    // altezza e la riga che si stava leggendo finisce sotto ai tasti. Non basta
    // rimpicciolire l'app (lo fa `main.ts`): la lettura va anche riportata al
    // punto giusto, dopo che il browser ha finito di muovere le cose.
    const suViewport = () => {
      if (document.activeElement === campo) this.scrollEnd(true);
    };
    campo.onfocus = () => {
      window.visualViewport?.addEventListener('resize', suViewport);
      // Con la tastiera aperta lo schermo utile si dimezza, e il palco — che
      // e' alto in `dvh`, cioe' misurato sulla finestra intera — si prendeva
      // quasi tutto quello che restava: sopra l'inquadratura, sotto i tasti, e
      // in mezzo due righe di testo. Mentre si scrive non si sta guardando la
      // figura, si sta leggendo cosa e' appena successo per decidere cosa
      // fare: la figura si toglie e le coordinate restano. Torna da sola
      // appena il campo perde il fuoco.
      if (!this.tastieraFisica) document.body.classList.add('tastiera');
      this.scrollEnd(true);
      // Una seconda volta a layout rifatto: la riga da leggere e' quella in
      // fondo, e dove sia lo si sa solo dopo che il palco si e' ritirato.
      requestAnimationFrame(() => this.scrollEnd(true));
    };
    campo.onblur = () => {
      window.visualViewport?.removeEventListener('resize', suViewport);
      document.body.classList.remove('tastiera');
      requestAnimationFrame(() => this.scrollEnd());
    };

    // Il fuoco automatico solo dove non fa danni: su un telefono aprirebbe la
    // tastiera a ogni scena, mangiandosi meta' schermo proprio mentre c'e' da
    // leggere.
    if (this.tastieraFisica) {
      requestAnimationFrame(() => campo.focus({ preventScroll: true }));
    }
    return form;
  }

  /**
   * La descrizione che un oggetto dell'inventario ha *adesso*.
   *
   * Passa da `testoOggetto` del core, quindi tiene conto delle
   * `description_variants`: il walkie scarico e il walkie carico sono lo stesso
   * oggetto con due descrizioni, e quale delle due valga lo decide lo stato.
   * Niente vuol dire che nell'IR non c'e' una `description` — e allora non c'e'
   * niente da mostrare, e chi chiama non deve fingere il contrario.
   */
  descrizioneOggetto(id: string): string | undefined {
    const st = this.state;
    return st ? testoOggetto(this.story, id, (c) => st.meets(c).ok) : undefined;
  }

  /**
   * Guardare una cosa che si ha in mano, scegliendola invece di nominarla.
   *
   * E' lo stesso verbo che si ottiene scrivendo «guarda il walkie», e passa
   * dallo stesso testo d'autore: dal menu si arriva alla stessa risposta, senza
   * dover indovinare come si chiama l'oggetto in una frase. Il risultato va nel
   * transcript e non nel pannello perche' e' testo della storia, e il posto del
   * testo della storia e' la storia — chi chiama chiude il menu prima.
   *
   * Non e' un turno di gioco: nessun `Effect`, nessuna azione, niente che
   * finisca nella traccia. Guardare nello zaino non muove la partita, ed e' la
   * ragione per cui questo puo' stare in un menu senza romperne la
   * riproducibilita'.
   */
  esaminaOggetto(id: string): void {
    if (this.dead) return;
    const testo = this.descrizioneOggetto(id);
    if (!testo) return;
    this.nuovoTurno();
    this.entry('echo', `· ${this.story.items?.find((i) => i.id === id)?.name ?? id}`);
    this.mostraOggetto(id);
    this.entry('look', testo);
    this.ascolto.dilo(testo);
    this.scrollEnd();
  }

  /**
   * L'immagine di un oggetto che si sta guardando.
   *
   * L'icona d'inventario e' un'ancora come le altre — generata una volta per
   * oggetto — e il momento in cui serve e' esattamente questo: quando si tira
   * fuori la cosa dallo zaino per guardarla. Nell'elenco delle chip no: li'
   * l'oggetto e' una voce di menu, e dieci miniature in fila sono un
   * inventario da gioco di ruolo, non la risposta a «cosa ho in mano».
   */
  private mostraOggetto(id: string): void {
    const item = this.story.items?.find((i) => i.id === id);
    if (!item) return;
    const righe: PromptRow[] = [[`items.${id}.visual_prompt`, item.visual_prompt, 'image']];
    const fig = this.immagini.figura(item.image, item.visual_prompt, {
      classe: 'figura-oggetto',
      titolo: item.name,
      righe,
    });
    if (fig) this.push(fig);
  }

  /** Una riga di transcript con il marchio di chi ha deciso il turno. Si vede
   * sempre, non solo in debug: e' l'unico modo di accorgersi *giocando* di
   * quando il backend a vettori serva davvero. */
  private entryVia(cls: string, text: string, e: EsitoTurno): void {
    const p = el('p', `entry ${cls}`);
    p.append(document.createTextNode(text));
    const segno = segnoTurno(e);
    if (segno) p.append(el('span', 'via', segno));
    this.push(p);
  }

  chooseChoice(p: ChoicePrompt): Promise<Command> {
    this.state = p.state;
    this.scene = p.scene;
    this.onUpdate();

    if (this.script) {
      const cmd = this.consumaScript(() => this.script!.chooseChoice(p));
      if (cmd) {
        this.nuovoTurno();
        this.entry('picked', `▸ ${p.available[cmd.choiceIndex ?? 0]?.text ?? ''}`);
        return Promise.resolve(cmd);
      }
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
      // Le battute filtrate: stesso trattamento delle azioni, per la stessa
      // ragione. Qui l'elenco vero — le scelte — e' l'interfaccia e resta
      // aperto; quello che si vede solo col debug sta ripiegato sotto.
      if (p.hidden.length) {
        const { root, corpo } = piega('battute filtrate', p.hidden.length);
        root.classList.add('solo-debug');
        for (const h of p.hidden) {
          const b = el('button', 'choice hidden-act');
          b.disabled = true;
          b.append(document.createTextNode(`× ${h.choice.text}`));
          b.append(el('span', 'why', `→ ${h.choice.goto} · ${h.reason}`));
          corpo.append(b);
        }
        this.dock.append(root);
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
    this.ascolto.finale(o.reason);
    // L'unico punto in cui la partita finisce senza che nessuno chieda piu'
    // niente: senza questo, una ripresa che arriva fino al finale — dove
    // `push` non insegue il fondo perche' e' sotto script — lascerebbe la
    // vista sulla copertina, cioe' all'altro capo di mille blocchi.
    this.scrollEnd();
    this.onUpdate();
  }

  // -------------------------------------------------------------- interni

  /**
   * Vero finche' la partita e' guidata da una traccia **incollata**.
   *
   * Una ripresa non conta, per quanto tecnicamente sia lo stesso meccanismo:
   * il marchio in barra serve a dire «quello che stai guardando non l'hai
   * giocato tu adesso», e riaprire la propria partita e' esattamente il caso
   * opposto.
   */
  get sottoTraccia(): boolean {
    return !!this.script && !this.ripresa;
  }

  /**
   * Consuma un passo della traccia, oppure restituisce `undefined` quando la
   * traccia e' finita — e da quel momento la partita torna in mano a chi
   * guarda.
   *
   * E' la differenza fra le due facce, ed e' voluta. In CLI una traccia che si
   * esaurisce prima del finale e' un **test fallito**: e' il segnale per cui
   * i playthrough di riferimento esistono, e li' l'errore deve propagarsi e far
   * uscire con 1. Qui no: sul web la stessa traccia e' il modo in cui si
   * riprende una partita — si incolla, la si rigioca in un istante, e si
   * continua da dove si era rimasti. Chiudere la partita con «script esaurito»
   * e nessuna riga di input, come faceva prima, e' l'unica cosa che non ha
   * senso in nessuno dei due mondi.
   */
  private consumaScript<T>(passo: () => T): T | undefined {
    try {
      return passo();
    } catch (err) {
      const era = this.ripresa;
      this.script = undefined;
      this.ripresa = false;
      if (err instanceof ScriptEndedError) {
        // Una ripresa che finisce non ha finito niente: e' arrivata dove si
        // era rimasti, che e' tutto quello che doveva fare. Dirlo con «la
        // traccia finisce qui» farebbe cercare una traccia che nessuno ha
        // incollato.
        if (!era) this.entry('notice', 'La traccia finisce qui: da adesso giochi tu.');
      } else if (era) {
        this.entry('problem', `[! ripresa] ${err instanceof Error ? err.message : String(err)}`);
        this.entry(
          'notice',
          "La partita di prima non combacia piu' con questa storia — probabilmente e' stata " +
            'ricompilata da allora. Riparti da qui.',
        );
      } else {
        // Un passo che non corrisponde a niente, non una traccia finita: quasi
        // sempre un salvataggio di una versione precedente della storia. Il
        // messaggio dice quale passo e perche', ed e' informazione che serve —
        // ma la partita **non** si chiude: si e' comunque arrivati fin qui, e
        // restare bloccati davanti a una pagina senza dock e' il peggiore dei
        // due esiti. Da qui si continua a mano.
        this.entry('problem', `[! traccia] ${err instanceof Error ? err.message : String(err)}`);
        this.entry('notice', 'La traccia non combacia con questa storia. Da qui in avanti giochi tu.');
      }
      this.onUpdate();
      return undefined;
    }
  }

  private waitChoice(render: (resolve: (c: Command) => void) => void): Promise<Command> {
    if (this.dead) return Promise.reject(new QuitError());
    return new Promise<Command>((resolve, reject) => {
      this.abort = reject;
      clear(this.dock);
      render((cmd) => {
        this.abort = undefined;
        this.chiudiTastiera();
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
    // Sotto script non c'e' un tocco da cui far partire il turno, ma chi guarda
    // rigiocare una traccia legge come chiunque altro: il turno lo apre il
    // ritorno da qui.
    if (this.script) {
      this.nuovoTurno();
      return Promise.resolve();
    }
    if (this.dead) return Promise.reject(new QuitError());
    return new Promise<void>((resolve, reject) => {
      this.abort = reject;
      clear(this.dock);
      const b = el('button', `choice continue${variant === 'start' ? ' start' : ''}`);
      b.append(el('span', 'segno', '▸'), document.createTextNode(label));
      // Si stacca per prima cosa, non per ultima: `press` puo' uscire senza
      // fare niente (partita gia' abbandonata), e in quel caso il listener
      // sarebbe rimasto attaccato per sempre.
      const stacca = () => {
        document.removeEventListener('keydown', onKey);
        if (this.staccaTasti === stacca) this.staccaTasti = undefined;
      };
      const go = async () => {
        stacca();
        this.ascolto.voce.dimenticaFine();
        if (!(await this.press(b))) return;
        this.abort = undefined;
        clear(this.dock);
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        // Chi sta scrivendo ha la precedenza: puo' esserci un campo aperto nel
        // pannello mentre il dock aspetta un «continua», e spazio e invio
        // devono restare quelli del campo.
        if (staScrivendo(e)) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void go();
        }
      };
      b.onclick = go;
      document.addEventListener('keydown', onKey);
      this.staccaTasti = stacca;
      this.dock.append(b);
      b.focus({ preventScroll: true });
      this.scrollEnd();

      // Avanzamento automatico: finito di recitare, si prosegue da soli.
      // Il bottone resta dov'e' ed e' ancora premibile — chi guarda lo schermo
      // non vede cambiare niente, e chi arriva prima della fine della lettura
      // taglia corto come sempre. Si passa dallo stesso `go`, quindi la strada
      // e' una sola: nessun secondo modo di far avanzare la storia.
      if (this.ascolto.attiva && this.ascolto.impostazioni.avanzamento) {
        this.ascolto.voce.quandoFinisce(() => {
          if (!this.dead) void go();
        });
      }
    });
  }
}
