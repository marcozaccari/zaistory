/**
 * Il player web: mette insieme i pezzi e tiene il giro dei turni.
 *
 * Qui non c'è nessuna regola di gioco — stanno tutte in `core/`. Questa è
 * un'interfaccia: legge una riga, la passa alla sessione, e dispone quello che
 * torna.
 *
 * Le decisioni che si vedono in questo file:
 *
 * - **l'app è alta quanto il viewport *visuale*, non quanto la finestra.**
 *   `100dvh` misura la finestra, e la tastiera di sistema non la rimpicciolisce:
 *   sale sopra la pagina, e i tasti coprivano il dock — cioè proprio la riga in
 *   cui si scrive cosa fare.
 * - **si comincia con un tocco.** Il trascritto insegue il fondo, e senza
 *   qualcosa che trattenga la lettura la copertina scorrerebbe via prima di
 *   essere vista. Vale doppio con la voce accesa: il primo suono di una pagina
 *   deve venire da un gesto, o il browser lo blocca.
 * - **ricaricare non butta via la partita.** La sequenza di quello che il
 *   giocatore ha scritto *è* la partita, e sta in `localStorage`: su un telefono
 *   ricaricare non è quasi mai un gesto deliberato.
 * - **le impostazioni non sono la partita.** Voce, carattere, immagini e
 *   backend dell'interprete vivono quanto la pagina e non quanto la sessione:
 *   ricominciare non deve costringere a risceglierli.
 */

import './styles.css';

import type { Action, Resolution, Session as SessionType, TurnEvent, TurnResult } from '../core/index.js';
import {
  actionsProgress,
  LoadError,
  Session,
  VectorResolver,
  describeCondition,
  describeEffect,
  displayName,
  isPureObservation,
  loadStory,
  parseStory,
  placeImage,
  systemQuestion,
  verbLabel,
} from '../core/index.js';
import { byId, clear, el, piega, premi, show, staScrivendo } from './dom.js';
import { CONFIG_DEFAULT, caricaEmbedder, type ConfigEmbedder } from './embedder.js';
import { Fonts } from './fonts.js';
import { icona } from './icons.js';
import { Images, hasPublishedImages } from './images.js';
import { lenteAperta } from './lightbox.js';
import type { Origin } from './images.js';
import { ASCOLTO_DEFAULT, Listen, type ImpostazioniAscolto } from './listen.js';
import { Panel } from './panel.js';
import { Stage } from './stage.js';
import { Transcript } from './transcript.js';
import { Voce } from './voice.js';

declare const __ZAIPLAY_VERSION__: string;
declare global {
  interface Window {
    __ZAISTORY__?: unknown;
  }
}

const VERSION = typeof __ZAIPLAY_VERSION__ === 'string' ? __ZAIPLAY_VERSION__ : 'dev';

/**
 * La voce e il giro dei caratteri vivono quanto la pagina, non quanto la
 * partita: sono l'altoparlante e una scelta di lettura, e non hanno ragione di
 * nascere e morire con la sessione.
 *
 * Il carattere si scrive sul `body` subito, prima di qualsiasi partita: senza,
 * comparirebbe solo alla prima scelta e la copertina si sarebbe già disegnata
 * con un altro. Il `:root` del foglio porta comunque lo stesso default, così
 * nemmeno il primo istante resta scoperto.
 */
const voce = new Voce();
const fonts = new Fonts(
  [byId<HTMLButtonElement>('btn-font'), byId<HTMLButtonElement>('btn-font-panel')],
  // Dal piede del menu il giro chiude il pannello, e non è un'incoerenza con
  // gli altri due interruttori che lo lasciano aperto: quelli si giudicano dal
  // bottone — acceso o spento è scritto lì — mentre un carattere si giudica
  // solo leggendoci, e su telefono il pannello copre per intero la pagina su
  // cui si sta decidendo.
  (b) => {
    if (b.id === 'btn-font-panel') {
      show(byId('panel'), false);
      show(byId('scrim'), false);
    }
  },
);
void fonts;

// --------------------------------------------------------------- avvio

async function boot(): Promise<void> {
  fitToKeyboard();

  if (window.__ZAISTORY__) return startGame(window.__ZAISTORY__, { kind: 'embedded' });

  const param = new URLSearchParams(location.search).get('story');
  if (param) {
    try {
      const res = await fetch(param);
      return startGame(await res.json(), { kind: 'url', href: param });
    } catch (e) {
      return loaderError(`non riesco a leggere ${param}: ${(e as Error).message}`);
    }
  }

  wireLoader();
}

function wireLoader(): void {
  const drop = byId('drop');
  const file = byId<HTMLInputElement>('file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) void f.text().then((t) => startText(t));
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) void f.text().then((t) => startText(t));
  });
  byId('paste-go').addEventListener('click', () => startText(byId<HTMLTextAreaElement>('paste-area').value));
}

function startText(text: string): void {
  try {
    startGame(JSON.parse(text), { kind: 'hand' });
  } catch (e) {
    loaderError(e instanceof LoadError ? e.problems.join('\n') : (e as Error).message);
  }
}

function loaderError(msg: string): void {
  const box = byId('loader-err');
  box.hidden = false;
  box.textContent = msg;
}

function startGame(raw: unknown, origin: Origin): void {
  let session: SessionType;
  try {
    session = new Session(loadStory(raw));
  } catch (e) {
    return loaderError(e instanceof LoadError ? e.problems.join('\n') : (e as Error).message);
  }
  show(byId('loader'), false);
  show(byId('app'), true);
  new Game(session, new Images(origin, hasPublishedImages(raw))).begin();
}

// ------------------------------------------------------------- la partita

class Game {
  private dock = byId('dock');
  /** Assegnato nel costruttore e non qui: gli serve `images`, che è un
   * parametro, e l'ordine fra parametri e campi non è una cosa su cui
   * appoggiarsi. */
  private transcript: Transcript;
  private stage: Stage;
  private panel: Panel;
  private listen: Listen;
  private trace: string[] = [];
  private choices: { index: number; text: string }[] = [];
  private ended = false;
  /** La partita è cominciata davvero. Sulla copertina non si è ancora in
   * nessun luogo, e la barra in testa non deve nominarne uno: la storia ha uno
   * stato iniziale da prima che qualcuno la giochi, ma il giocatore lì non c'è
   * ancora. */
  private iniziata = false;
  /** Il dock messo da parte mentre si guarda la copertina, e se il palco era
   * acceso. Il trascritto se lo tiene da sé. */
  private dockDaParte?: { nodi: ChildNode[]; palco: boolean };
  /** Le azioni disfatte, nell'ordine in cui tornerebbero: `rifare[0]` è la
   * prossima. Vivono solo finché non se ne fa una nuova. */
  private rifare: string[] = [];
  /** Vero mentre si sta rifacendo: dice a `feed` di non buttare via il resto
   * della pila che sta consumando. */
  private rifacendo = false;
  private key: string;

  /** Il secondo interprete, quando è acceso. Parte spento: il lessicale è
   * deterministico, non va da nessuna parte e non scarica un byte. */
  private vettori?: VectorResolver;
  private nomeResolver = 'lessicale';
  private statoResolver = '';
  private configEmbedder: ConfigEmbedder = { ...CONFIG_DEFAULT };
  private impAscolto: ImpostazioniAscolto = { ...ASCOLTO_DEFAULT };

  constructor(private session: SessionType, private images: Images) {
    this.key = `zaistory:${session.idx.story.id}`;
    this.transcript = new Transcript(session.idx, images);
    this.stage = new Stage(session.idx, images);
    this.listen = new Listen(session.idx, voce);
    this.listen.configura(this.impAscolto);
    this.panel = new Panel(() => this.session, {
      trace: () => this.trace.join('\n'),
      resume: (t) => {
        // Una partita incollata è un'altra partita: quello che si era disfatto
        // qui non ha più un posto in cui tornare.
        this.rifare = [];
        void this.replay(t.split('\n'));
      },
      restart: () => this.restart(),
      version: VERSION,
      imagesWhy: images.available ? '' : images.why,
      coverLink: () => this.portaCopertina(),
      listen: this.listen,
      onAscolto: (imp) => {
        this.impAscolto = imp;
        this.listen.configura(imp);
        // Niente ridisegno: i controlli mostrano già il valore che l'utente ha
        // appena mosso, e rifarli sotto il dito farebbe perdere il
        // trascinamento di un cursore a metà.
      },
      resolver: () => ({ nome: this.nomeResolver, stato: this.statoResolver, config: this.configEmbedder }),
      onResolver: (nome) => void this.scegliResolver(nome),
      onConfigEmbedder: (c) => {
        this.configEmbedder = c;
        // Si riprova con la modalità che l'utente aveva scelto; se non ne aveva
        // scelta nessuna coi vettori, l'ibrido è quella con cui si gioca.
        void this.scegliResolver(this.nomeResolver === 'lessicale' ? 'ibrido' : this.nomeResolver, true);
      },
      onResetEmbedder: () => {
        this.configEmbedder = { ...CONFIG_DEFAULT };
        this.statoResolver = '';
        this.panel.render();
      },
    });
    this.panel.refreshLint();

    const story = session.idx.story;
    byId('story-title').textContent = story.title;
    this.header();

    this.wireDock();
    this.wireToggles();
    this.wireTasti();
    this.wireMappa();
  }

  // ------------------------------------------------------------ copertina

  begin(): void {
    this.transcript.clear();
    this.dockDaParte = undefined;
    // Le azioni disfatte appartenevano alla partita di prima.
    this.rifare = [];
    this.listen.ricomincia();
    this.iniziata = false;
    this.header();

    // La locandina sta nella copertina, non sul palco: il palco dice *dove si
    // è*, e prima di «inizia» non si è da nessuna parte.
    this.transcript.cover();

    clear(this.dock);
    // Ricaricare non butta via la partita, e il bottone lo deve dire: con una
    // partita salvata premerlo la rigioca fino al punto in cui si era. «Inizia»
    // prometterebbe di ricominciare da capo — l'unica cosa che qui non succede
    // — e chi ha appena ricaricato per sbaglio non ha modo di sapere, prima di
    // premerlo, che quello che ha fatto finora è ancora lì.
    const ripresa = !!localStorage.getItem(this.key);
    const go = this.bottone(ripresa ? 'continua a giocare' : 'inizia', 'choice continue start');
    go.addEventListener('click', () => {
      void (async () => {
        await premi(go);
        // Il primo suono di una pagina deve venire da un gesto: la copertina
        // si recita qui, non al caricamento, o il browser la zittisce.
        this.listen.copertina();
        this.iniziata = true;
        const saved = localStorage.getItem(this.key);
        if (saved) await this.replay(saved.split('\n'));
        else {
          this.transcript.clear();
          this.render(this.session.begin());
        }
      })();
    });
    this.dock.append(go);
  }

  /**
   * La porta per la copertina, in cima al menu.
   *
   * Dove c'è la locandina è la locandina stessa, in miniatura: è l'unica
   * immagine del player che non apra la lente, ed è deliberato. La copertina
   * non è una figura da giudicare: è una **schermata** — la locandina, di cosa
   * parla la storia, con che stile è fatta, che versione del formato chiede — e
   * dopo «inizia» non c'è più, perché il trascritto riparte dal primo turno.
   * Portare lì è più di quello che farebbe la lente, che dell'intera schermata
   * rimetterebbe solo la figura.
   *
   * Dove la locandina non c'è — una storia senza immagini, o le immagini spente
   * dalla barra — resta un bottone. La copertina esiste comunque, ed è il posto
   * in cui sta scritto di cosa parla la storia: senza porta ci si arriverebbe
   * solo ricaricando la pagina.
   *
   * **Se la copertina è già lì la porta è spenta**, e non è una sottigliezza:
   * quello che il menu copre in quel momento è proprio la copertina. Prima di
   * «inizia» premerla avrebbe scambiato quel bottone con «torna a giocare» per
   * rimetterlo subito dopo; a partita in corso avrebbe rimesso in scena quello
   * che c'era già.
   */
  private portaCopertina(): HTMLElement {
    const st = this.session.idx.story;
    const viva = !this.inCopertina;
    return this.miniaturaCopertina(st.cover?.image, viva) ?? this.bottoneCopertina(viva);
  }

  /** La copertina è quello che si sta guardando adesso: quella d'apertura,
   * prima di «inizia», o quella rivista a partita cominciata. */
  private get inCopertina(): boolean {
    return !this.iniziata || this.transcript.sospeso;
  }

  private bottoneCopertina(viva = true): HTMLButtonElement {
    const b = el('button', 'btn copertina', 'rivedi la copertina');
    b.type = 'button';
    b.disabled = !viva;
    if (viva) b.onclick = () => void premi(b).then(() => this.rivediCopertina());
    return b;
  }

  /** La miniatura, quando c'è un'immagine da metterci. */
  private miniaturaCopertina(id: string | undefined, viva = true): HTMLElement | undefined {
    const st = this.session.idx.story;
    if (!id || !this.images.usable) return undefined;

    const fig = el('figure', 'locandina-menu');
    // Un id dichiarato e un file che non arriva sono due cose diverse: qui la
    // porta resta, in forma di bottone. Sparire lascerebbe la copertina
    // irraggiungibile per un asset che non è stato pubblicato.
    const img = this.images.element(id, st.title, () => fig.replaceWith(this.bottoneCopertina(viva)));
    if (!img) return undefined;
    // Non pigra, e non è un dettaglio: sotto di lei c'è «ricomincia», e
    // un'immagine che arriva un istante dopo l'apertura del menu lo fa scendere
    // sotto il dito che stava per premere altro. Il file è già in cache — la
    // copertina l'ha appena mostrato — quindi eager qui non scarica niente.
    img.loading = 'eager';
    // Spenta non è nemmeno un comando: niente fuoco da tastiera, niente ruolo
    // da annunciare, niente titolo che prometta qualcosa. Resta la figura, che
    // dice comunque di che storia si tratta.
    if (viva) {
      // Un bottone intorno a un'immagine i lettori di schermo lo annunciano due
      // volte: resta un'immagine, e si comporta da comando. Stessa regola delle
      // figure che aprono la lente.
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'rivedi la copertina');
      img.title = 'rivedi la copertina';
      img.onclick = () => this.rivediCopertina();
      img.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.rivediCopertina();
        }
      };
    } else {
      fig.classList.add('spenta');
    }
    fig.append(img, el('figcaption', 'ir', id));
    return fig;
  }

  /**
   * La copertina, rivista a partita cominciata.
   *
   * È la stessa schermata dell'inizio, nello stesso posto: non una scheda di
   * menu che la riassume. Cambia solo il bottone in fondo — «torna a giocare»
   * invece di «inizia» — perché è cambiato quello che c'è dietro.
   *
   * La partita non si tocca. Il trascritto e il dock escono dal documento
   * interi e ci rientrano interi, con i loro ascoltatori: «continua» a metà di
   * un blocco, le battute di un dialogo aperto, il campo con dentro quello che
   * si stava scrivendo. Rifarli da capo vorrebbe dire sapere ricostruire ogni
   * stato in cui il dock può trovarsi, e quello è già scritto una volta.
   */
  private rivediCopertina(): void {
    // La porta è già spenta dov'è inutile; qui si tiene comunque, perché
    // «rimettere la copertina sopra la copertina» è la cosa che questo metodo
    // non deve mai fare — la partita da parte la seconda volta sarebbe la
    // copertina stessa, e il ritorno non troverebbe più niente.
    if (this.inCopertina) return;
    this.panel.close();

    this.dockDaParte = { nodi: [...this.dock.childNodes], palco: this.stage.visible };
    this.transcript.sospendi();
    clear(this.dock);
    // Il palco dice *dove si è*, e guardando la copertina non si è da nessuna
    // parte: è la stessa ragione per cui a inizio partita è spento.
    this.stage.hide();

    this.transcript.cover();
    const b = this.bottone('torna a giocare', 'choice continue start');
    b.addEventListener('click', () => void premi(b).then(() => this.tornaAGiocare()));
    this.dock.append(b);
  }

  private tornaAGiocare(): void {
    const d = this.dockDaParte;
    if (!d) return;
    this.dockDaParte = undefined;
    this.transcript.riprendi();
    this.dock.replaceChildren(...d.nodi);
    // Il palco torna com'era, e solo se c'era: `setContext` non ridisegna
    // l'inquadratura della fase — quella è ferma da quando ci si è entrati — ma
    // rimette la riga, il cast e il palco stesso.
    if (d.palco) {
      const s = this.session.snapshot();
      this.stage.setContext(s.place, s.phase);
    }
  }

  private restart(): void {
    localStorage.removeItem(this.key);
    this.session = new Session(this.session.idx);
    this.trace = [];
    this.ended = false;
    this.listen.ricomincia();
    this.stage.hide();
    this.begin();
  }

  /**
   * Rigioca una partita. Sul web una traccia esaurita non è un errore: è il
   * punto in cui si riprende a giocare.
   *
   * Con `eco` restano scritti anche i comandi, come li si era scritti. Serve a
   * chi torna indietro di un'azione: lì la rigiocata deve rimettere il
   * trascritto **com'era**, meno l'ultima mossa, e un flusso in cui le risposte
   * ci sono e le domande no non è quello di prima. Incollando una partita di
   * qualcun altro invece si legge la storia, non la sua tastiera.
   */
  private async replay(lines: string[], eco = false): Promise<void> {
    this.session = new Session(this.session.idx);
    this.trace = [];
    this.ended = false;
    this.listen.ricomincia();
    this.transcript.clear();
    // Muta, e non per pudore: rigiocare venti passi vuol dire venti risposte
    // che nessuno ha chiesto adesso, e la voce le direbbe tutte prima di
    // arrivare al punto in cui si riprende a giocare.
    const eraAttiva = this.impAscolto.attiva;
    this.listen.configura({ ...this.impAscolto, attiva: false });
    this.render(this.session.begin(), true);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      await this.feed(line, true, eco);
      if (this.ended) break;
    }
    this.listen.configura({ ...this.impAscolto, attiva: eraAttiva });
    this.save();
  }

  // ------------------------------------------------------- avanti/indietro

  /**
   * Disfare e rifare un'azione, sotto il debug.
   *
   * Non è un salvataggio a punti: la partita **è** la sequenza di quello che si
   * è scritto, quindi tornare indietro di un'azione vuol dire rigiocare la
   * stessa sequenza meno l'ultima riga. Lo stato che ne esce è quello vero,
   * ricalcolato dal motore, non uno ricostruito a ritroso — e con lui sparisce
   * dal flusso tutto quello che quell'azione aveva scritto, che è il punto:
   * collaudando si prova una frase, si guarda cosa succede, si torna indietro e
   * se ne prova un'altra al suo posto.
   *
   * Sta sotto il debug con le chip e l'ispezione, e per la stessa ragione:
   * potersi rimangiare una mossa cambia la partita in una cosa senza
   * conseguenze, e una storia non si giudica giocandola così.
   */
  private async indietro(): Promise<void> {
    if (!this.trace.length || this.inCopertina) return;
    const passi = this.trace.slice(0, -1);
    // Prima della rigiocata: il dock si ridisegna dentro `replay`, e a quel
    // punto i due bottoni devono già sapere che c'è qualcosa da rifare.
    this.rifare = [this.trace[this.trace.length - 1]!, ...this.rifare];
    await this.replay(passi, true);
  }

  private async avanti(): Promise<void> {
    const linea = this.rifare[0];
    if (linea === undefined || this.inCopertina) return;
    this.rifare = this.rifare.slice(1);
    this.rifacendo = true;
    try {
      // Non in silenzio: si rifà per **guardare** cosa succede, e la risposta
      // arriva com'era arrivata la prima volta, «continua» compresi.
      await this.feed(linea);
    } finally {
      this.rifacendo = false;
    }
  }

  /**
   * La riga degli strumenti, in fondo al dock: l'ispezione a sinistra, i due
   * passi a destra.
   *
   * Sulla stessa linea perché sono due voci sole e stanno larghe: l'elenco
   * delle azioni è chiuso quasi sempre — è una linguetta con un numero accanto
   * — e sotto di lei una seconda riga con dentro due bottoni piccoli era mezzo
   * dito di dock speso per niente. Aperta, l'elenco scende sotto la sua
   * linguetta e i due passi restano dove sono.
   */
  private rigaDebug(ispezione?: HTMLElement): HTMLElement {
    const riga = el('div', 'riga-debug solo-debug');
    riga.append(ispezione ?? el('span'), this.controlliDebug());
    return riga;
  }

  /**
   * I due comandi, a destra.
   *
   * A destra perché non sono la partita: la riga in cui si scrive comincia da
   * sinistra ed è quella che si guarda giocando, questi due stanno in coda come
   * uno strumento appoggiato al banco. Restano nel documento anche a debug
   * spento — a nasconderli è il foglio di stile, come per tutta l'altra
   * diagnostica, così accendere il debug non deve ricostruire il dock.
   */
  private controlliDebug(): HTMLElement {
    const riga = el('div', 'controlli');

    const b = (segno: string, etichetta: string, spento: boolean, fai: () => Promise<void>) => {
      const n = el('button', 'passo');
      n.type = 'button';
      n.disabled = spento;
      n.title = etichetta;
      n.setAttribute('aria-label', etichetta);
      const i = icona(segno);
      if (i) n.append(i);
      else n.append(document.createTextNode(segno === 'back' ? '<' : '>'));
      if (!spento) n.onclick = () => void this.premi(n, fai);
      return n;
    };

    riga.append(
      b('back', "indietro di un'azione", !this.trace.length, () => this.indietro()),
      b('forward', "avanti di un'azione", !this.rifare.length, () => this.avanti()),
    );
    return riga;
  }

  // ---------------------------------------------------------------- turno

  private async feed(line: string, silent = false, eco = false): Promise<void> {
    if (this.ended) return;
    // Una battuta si scrive «battuta 2» nella traccia e «2» sulla tastiera: il
    // secondo è la scorciatoia sotto le dita, il primo è quello che si rilegge
    // in un salvataggio, dove una colonna di cifre nude non dice di che cosa
    // fossero il numero.
    const m = /^battuta\s+([1-9]\d*)$/i.exec(line.trim());
    const n = m ? Number(m[1]) : Number(line);
    const scelta = Number.isInteger(n) && n > 0 && this.session.inDialogue;
    // Sulla pagina va la battuta, non il numero: il numero dice quale casella
    // si è premuta, non cosa si è detto.
    const battuta = scelta ? this.choices.find((c) => c.index === n - 1)?.text : undefined;

    // Un'azione toccata nell'ispezione: si esegue **quella**, non una frase che
    // le somiglia — il punto di premerla è saltare il parser, non metterlo alla
    // prova un'altra volta. Nella traccia va col suo id, ed è l'unico comando
    // del player che non sia una frase: senza, una partita in cui si è premuta
    // una riga dell'ispezione non si rigiocherebbe più.
    const marchio = /^azione\s+(\S+)$/.exec(line.trim());
    const daIspezione = marchio
      ? this.session.candidates().actions.find((a) => a.id === marchio[1])
      : undefined;

    if (!silent || eco) {
      if (battuta) this.transcript.chosen(battuta);
      else this.transcript.echo(daIspezione ? this.etichettaAzione(daIspezione) : line);
    }
    if (!silent) {
      // La voce di prima si ferma: senza, un tocco veloce lascerebbe indietro
      // la risposta al turno precedente, che continuerebbe a parlare sopra
      // quella nuova.
      this.listen.taci();
    }

    const res = daIspezione
      ? this.session.takeResolution({ kind: 'action', action: daIspezione, score: 1 })
      : scelta
        ? this.session.choose(n - 1)
        : await this.turno(line);
    // Nella traccia va solo quello che ha mosso la storia. Una frase che ha
    // ricevuto il ripiego per intenzione non ha fatto succedere niente, e
    // rigiocandola non farebbe succedere niente un'altra volta: tenerla
    // significa allungare il salvataggio con i tentativi andati a vuoto, e
    // farli rileggere tutti a chi lo riprende.
    if (!res.noMatch) {
      this.trace.push(scelta ? `battuta ${n}` : line);
      // Un'azione nuova taglia il ramo che si era disfatto: quello che stava
      // «avanti» apparteneva a una partita che da qui in poi non esiste più.
      // Rifarlo lo rimetterebbe in coda a una storia diversa da quella in cui
      // era stato fatto, e non sarebbe più la stessa partita.
      if (!silent && !this.rifacendo) this.rifare = [];
    }
    // «Guardati intorno» è il contrappeso del collapse acustico: a schermo la
    // composizione resta scritta e si rilegge, all'orecchio si riapre
    // chiedendola. Vedi `listen.ts`.
    this.render(res, silent, !scelta && systemQuestion(line) === 'look_around');
    if (!silent) this.save();
  }

  /**
   * Un turno di prosa libera: il lessicale, e — se acceso — il secondo
   * interprete.
   *
   * L'ordine non è negoziabile e sta scritto in `core/vectors.ts`: il lessicale
   * decide sempre per primo, i vettori parlano solo dove lui è muto, e la scelta
   * del fallback è l'unico posto in cui decidono sempre — perché è l'unico in
   * cui sbagliare non cambia niente.
   */
  private async turno(line: string): Promise<TurnResult> {
    const v = this.vettori;
    if (!v) return this.session.input(line);

    const cosa = this.session.preview(line);
    // Una domanda sull'interfaccia non è un tentativo di agire sul mondo, e
    // nemmeno in modalità di misura ha senso passarla ai vettori.
    if (cosa === 'sistema') return this.session.input(line);
    if (v.modo === 'ibrido' && cosa !== 'muto') return this.session.input(line);

    try {
      const { actions, exits } = this.session.candidates();
      const vicina = await v.vicina(this.session.idx, line, actions, exits);
      if (vicina) return this.session.takeResolution(vicina.res as Resolution);
      const scelto = await v.fallback(line, this.session.fallbackPool());
      return this.session.input(line, { chooseFallback: () => scelto });
    } catch (e) {
      // Un modello che smette di rispondere a metà partita non deve fermare la
      // partita: si torna al lessicale e si dice dove è saltato.
      this.statoResolver = spiega(e as Error);
      this.panel.render();
      return this.session.input(line);
    }
  }

  private render(res: TurnResult, silent = false, riosserva = false): void {
    const snap = this.session.snapshot();
    // Prima dove siamo, poi gli stacchi: i beat con un'inquadratura salgono sul
    // palco in ordine, e l'ultimo resta. Al contrario — il contesto per ultimo —
    // l'inquadratura di base della fase cancellerebbe a ogni turno lo stacco
    // appena fatto.
    this.stage.setContext(snap.place, snap.phase);
    this.choices = res.choices ?? [];
    this.header();
    if (!silent && riosserva) this.listen.riosserva(snap.place, snap.phase);

    // Rigiocando non si aspetta nessuno: venti tocchi su «continua» per tornare
    // al punto in cui si era non sono un ritmo, sono un pedaggio.
    this.mostra(res, silent ? [res.events] : blocchi(res.events), 0, silent, snap);
  }

  /**
   * Un blocco del turno, e il tocco che porta al successivo.
   *
   * Due persone che parlano fra loro sono due battute, non un muro: arrivano
   * una alla volta, ciascuna con la sua comparsa, e a scandirle è «continua».
   * Vale identico per i beat di una narrazione. Il tocco sta **fra** i blocchi
   * e non dopo l'ultimo: là quello che viene dopo — le scelte del dialogo, la
   * riga in cui si scrive — è già pronto da mostrare, e un tocco che non porta
   * niente di nuovo sullo schermo è solo un tocco in più.
   */
  private mostra(
    res: TurnResult,
    blocchi: TurnEvent[][],
    i: number,
    silent: boolean,
    snap: ReturnType<SessionType['snapshot']>,
  ): void {
    const blocco = blocchi[i] ?? [];
    this.transcript.events(blocco);
    for (const e of blocco) if (e.beat) this.stage.frame(e.beat, snap.place?.id);
    if (!silent) this.listen.turno(blocco, snap.place, snap.phase);

    if (i + 1 < blocchi.length) {
      this.transcript.sep();
      clear(this.dock);
      const b = this.bottone('continua', 'choice continue');
      // Una volta sola: l'invio tenuto premuto, o un doppio tocco, salterebbero
      // due blocchi in un colpo — cioè una battuta che nessuno ha letto.
      let fatto = false;
      const vai = () => {
        if (fatto) return;
        fatto = true;
        void this.premi(b, () => this.mostra(res, blocchi, i + 1, silent, snap));
      };
      b.addEventListener('click', vai);
      this.dock.append(b);
      // A schermo spento «continua» è proprio il tocco impossibile da trovare:
      // se la voce sta leggendo, finita la frase si prosegue da soli.
      if (this.listen.attiva && this.impAscolto.avanzamento) {
        voce.quandoFinisce(() => {
          if (this.dock.contains(b)) vai();
        });
      }
      return;
    }

    if (res.ended) {
      this.ended = true;
      this.transcript.ending(res.ended.label);
      if (!silent) this.listen.finale(res.ended.label);
      clear(this.dock);
      const again = this.bottone('ricomincia', 'choice continue start');
      again.addEventListener('click', () => {
        void premi(again).then(() => this.restart());
      });
      this.dock.append(again);
      // Anche qui, e soprattutto qui: un finale è il posto in cui collaudando
      // si vuole tornare indietro di una mossa per vedere l'altro.
      this.dock.append(this.rigaDebug());
      return;
    }
    this.paintDock(res, silent);
  }

  /**
   * La riga sotto il titolo: a che atto siamo, e basta.
   *
   * L'atto è l'unica coordinata che l'inquadratura non dice già. Il luogo stava
   * qui accanto ed è sceso sul palco, insieme al tono: dove si è e com'è sono
   * la stessa domanda, e tenerne le due metà ai capi opposti dello schermo
   * obbligava a leggerle in due posti. Il conto delle azioni, che pure stava
   * qui col debug, è sceso in fondo al dock per la stessa ragione: si legge
   * dove lo si può anche aprire.
   *
   * Col nome del campo davanti, come ogni altra cosa che il player scrive: da
   * solo, un titolo d'atto sotto il titolo della storia si legge come un
   * sottotitolo. E i due nomi delle cose valgono anche qui — «Atto: La taverna»
   * a chi gioca, «atto: atto_uno» a chi collauda, che l'id è quello da citare a
   * chi compila la storia.
   */
  private header(): void {
    const s = this.session.snapshot();
    const idx = this.session.idx;
    const box = byId('story-meta');
    clear(box);
    if (!this.iniziata || !s.place) return;

    // La versione del formato e l'id del file stavano qui e non ci sono più —
    // sono informazioni sul *file*, non sulla storia, e le si legge sulla
    // copertina; gli id di luogo e fase stanno nella scheda «stato», che è dove
    // si va quando si ispeziona.
    const atto = idx.acts.get(s.act);
    const dove = el('span', 'dove');
    dove.append(el('span', 'umano', `Atto: ${atto?.title || s.act}`), el('span', 'ir', `atto: ${s.act}`));
    box.append(dove);
  }

  // ----------------------------------------------------------------- dock

  private paintDock(res: TurnResult, silent = false): void {
    clear(this.dock);

    if (this.choices.length) {
      // Nel dialogo l'elenco delle battute si vede sempre: si agisce a parole,
      // si parla a scelte.
      for (const c of this.choices) {
        const b = el('button', 'choice');
        b.append(el('span', 'idx', String(c.index + 1)), document.createTextNode(c.text));
        b.addEventListener('click', () => void this.premi(b, () => this.feed(String(c.index + 1))));
        this.dock.append(b);
      }
      // In dialogo la riga in cui si scrive non c'è, ma la battuta sbagliata è
      // proprio la mossa che collaudando si vuole rifare in un altro modo.
      this.dock.append(this.rigaDebug());
      return;
    }

    if (res.suggestedExit) {
      // Quando gli enigmi sono finiti non c'è più niente da proteggere, e
      // continuare a chiedere di indovinare la frase giusta è solo un muro.
      const uscita = res.suggestedExit;
      const b = this.bottone(uscita.label, 'choice continue');
      const vai = () => void this.premi(b, () => this.feed(uscita.label));
      b.addEventListener('click', vai);
      this.dock.append(b);
      // L'unica parte del dock che si recita, e l'unico posto in cui
      // l'avanzamento automatico ha senso: qui il passo è uno solo.
      if (!silent) {
        this.listen.uscite([uscita.label]);
        if (this.listen.attiva && this.impAscolto.avanzamento) {
          voce.quandoFinisce(() => {
            if (this.dock.contains(b)) vai();
          });
        }
      }
    }

    const row = el('form', 'riga-input');
    const input = el('input', 'campo');
    input.type = 'text';
    input.placeholder = 'scrivi cosa fare';
    input.autocomplete = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    // Il palco si ritira mentre si scrive: chi ha il dito sui tasti non sta
    // guardando la figura, sta leggendo cosa è appena successo per decidere
    // cosa scrivere.
    // ...ma solo dove i tasti sono davvero sullo schermo. Con un mouse il
    // fuoco nel campo non copre niente, e ritirare il palco lì vorrebbe dire
    // far sparire l'inquadratura per tutta la partita: il fuoco, su desktop, il
    // campo non lo perde mai.
    const tastiSuSchermo = !matchMedia('(pointer: fine)').matches;
    if (tastiSuSchermo) {
      input.addEventListener('focus', () => document.body.classList.add('tastiera'));
      input.addEventListener('blur', () => document.body.classList.remove('tastiera'));
    }
    input.addEventListener('keydown', (e) => {
      // I numeri sono la scorciatoia delle scelte, ma solo a campo vuoto:
      // scrivere «2 passi indietro» non deve scegliere la seconda battuta.
      if (!input.value && this.choices.length && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        void this.feed(e.key);
      }
    });

    // Il segno del tasto che fa la stessa cosa: chi scrive manda con invio, e
    // il bottone è quell'invio per chi ha il pollice invece della tastiera.
    const send = el('button', 'invia');
    send.type = 'submit';
    send.setAttribute('aria-label', 'esegui');
    const segnoInvio = icona('enter');
    if (segnoInvio) send.append(segnoInvio);
    else send.append(document.createTextNode('▸'));

    // I due cassetti, accanto al campo: sono le scorciatoie che saltano la
    // digitazione — «vai» e «guarda quello che ho» — e per questo stanno qui e
    // non in barra, dove vivono le impostazioni.
    const zaino = this.bottoneCassetto('bag', 'cosa hai in mano', () => this.apriInventario());
    const mappa = this.bottoneCassetto('map', 'i luoghi', () => this.apriMappa());

    // Campo e invio sono un pezzo solo, e stanno in una scatola loro: il
    // triangolo esegue quello che c'è scritto accanto, i due cassetti no. Con
    // tutti e quattro nella stessa fila e lo stesso spazio in mezzo, l'invio
    // sembrava il primo di tre bottoni invece della fine della riga.
    const campo = el('div', 'campo-invia');
    campo.append(input, send);
    row.append(campo, zaino, mappa);
    row.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      void this.feed(v);
    };
    this.dock.append(row);
    this.dock.append(this.rigaDebug(this.ispezione()));

    // Il fuoco automatico vale solo dove la tastiera non costa niente: su un
    // telefono rimettercelo dopo una frase che non ha fatto match significa
    // riaprire i tasti addosso alla risposta appena arrivata.
    if (matchMedia('(pointer: fine)').matches) input.focus();
  }

  /**
   * L'ispezione del luogo, sotto il debug.
   *
   * L'interfaccia è la riga di testo; **le chip sono uno strumento** e si
   * vedono solo ispezionando. Non è una questione di gusto: un elenco che
   * mostra le azioni utili risolve gli enigmi al posto del giocatore, e finché
   * resta acceso non si può giudicare quanto una storia compilata sia davvero
   * difficile.
   *
   * Tre cose, nell'ordine in cui ci si fanno le domande collaudando: **con che
   * gesto** si può agire qui, **su cosa**, e **cosa cambia** ciascuna azione.
   * L'ultima è quella che conta di più: un luogo dove nessuna azione sblocca
   * niente è un vicolo cieco, e così si vede a colpo d'occhio invece che
   * giocandoci contro.
   *
   * Nasce chiusa. Aperto il debug, quello che si guarda è quasi sempre il
   * trascritto — cosa ha capito il parser, quale fallback è uscito — e una fase
   * con otto azioni coprirebbe mezzo schermo sopra la riga in cui si scrive.
   * Il conto accanto al titolo risponde già a metà della domanda.
   */
  private ispezione(): HTMLElement | undefined {
    const st = this.session.state;
    const { actions } = this.session.candidates();
    if (!actions.length) return undefined;

    // Le candidate comprendono quelle la cui condizione non è soddisfatta: si
    // elencano lo stesso, perché la domanda che ci si fa collaudando è quasi
    // sempre *perché* una non compare.
    const aperte = actions.filter((a) => st.ok(a.condition));

    // Accanto al titolo, a che punto è il luogo: lo stesso conto che decide il
    // consiglio dell'uscita. «Quante ne restano» è la domanda che ci si fa
    // quando l'uscita non viene offerta e non si capisce perché, e la si fa
    // qui, con davanti l'elenco che a un tocco dice anche *quali*. Dove non c'è
    // niente da contare — un luogo di sole osservazioni — resta il numero delle
    // candidate, che è comunque quello che l'elenco sta per mostrare.
    const s = this.session.snapshot();
    const p = actionsProgress(this.session.idx, s.place, s.phase, st);
    const conto = p.total ? `${p.done}/${p.total} rimanenti ${p.left}` : actions.length;
    const { root, corpo } = piega('azioni', conto);

    const chips = (voci: string[]) => {
      const riga = el('div', 'chips');
      for (const v of voci) riga.append(el('span', 'chip', v));
      return riga;
    };

    const verbi = [...new Set(aperte.map((a) => a.verb))];
    if (verbi.length) corpo.append(chips(verbi.map(verbLabel)));

    // Su cosa si agisce: le tre specie insieme, perché al parser non importa
    // quale sia — quello che conta è che il complemento nomini qualcosa che è
    // qui.
    const bersagli = new Set<string>();
    for (const a of aperte) {
      for (const t of [a.target, a.second_target]) {
        const nome = this.nomeBersaglio(t);
        if (nome) bersagli.add(nome);
      }
    }
    if (bersagli.size) corpo.append(chips([...bersagli]));

    for (const a of actions) {
      const ok = st.ok(a.condition);
      // Si tocca e si gioca. È la scorciatoia che l'elenco prometteva senza
      // mantenerla: chi collauda legge «sblocca», vuole vedere cosa sblocca, e
      // fin qui doveva indovinare da sé la frase che ci arriva. Anche quelle
      // con la condizione chiusa — è così che si legge la `blocked_narration`,
      // che altrimenti non la vede nessuno.
      const riga = el('button', 'act');
      riga.type = 'button';
      riga.onclick = () => void this.premi(riga, () => this.feed(`azione ${a.id}`));
      const testa = el('div', 'head');
      testa.append(el('span', `mark ${ok ? 'on' : 'off'}`, ok ? '●' : '×'));
      testa.append(el('span', undefined, this.etichettaAzione(a)));
      // Un'azione che non muove niente si può rileggere per sempre; una che
      // sblocca è quella che fa avanzare la storia, ed è l'unica cosa che si
      // cerca quando una fase sembra ferma.
      if (!isPureObservation(a)) testa.append(el('span', 'why', 'sblocca'));
      if (st.executed(a.id)) testa.append(el('span', 'why', 'già fatta'));
      riga.append(testa);
      riga.append(
        el('span', 'meta', `${a.id} · condizione: ${describeCondition(a.condition)} · effetto: ${describeEffect(a.effect)}`),
      );
      corpo.append(riga);
    }
    return root;
  }

  /** Come si legge un'azione: il gesto e su cosa. È la riga dell'ispezione, ed
   * è anche l'eco che entra nel flusso quando la si gioca da lì — chi rilegge
   * deve ritrovare la stessa cosa che ha toccato. */
  private etichettaAzione(a: Action): string {
    return [verbLabel(a.verb), this.nomeBersaglio(a.target), this.nomeBersaglio(a.second_target)]
      .filter(Boolean)
      .join(' · ');
  }

  /** Come si chiama un bersaglio per chi legge. Il protagonista non è un
   * bersaglio: è chi guarda. */
  private nomeBersaglio(id: string | undefined): string | undefined {
    const idx = this.session.idx;
    if (!id || id === idx.story.protagonist) return undefined;
    const e = idx.props.get(id) ?? idx.characters.get(id) ?? idx.items.get(id);
    return e ? displayName(e) : id;
  }

  private bottoneCassetto(segno: string, etichetta: string, apri: () => void): HTMLButtonElement {
    const b = el('button', 'cassetto-apri');
    b.type = 'button';
    b.title = etichetta;
    b.setAttribute('aria-label', etichetta);
    const i = icona(segno);
    if (i) b.append(i);
    else b.append(document.createTextNode(etichetta));
    b.addEventListener('click', () => {
      // Il cassetto si apre su tutto lo schermo: la tastiera qui va chiusa, e
      // va chiusa **adesso** e non un istante prima — il dock tiene il fuoco
      // finché il tocco non è arrivato a destinazione. Vedi `wireDock`.
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      apri();
    });
    return b;
  }

  /**
   * L'inventario: i nomi degli oggetti, e ognuno si può guardare.
   *
   * Toccarne uno chiude il cassetto e ne fa leggere la descrizione nel
   * trascritto — la stessa che si otterrebbe nominandolo mentre si gioca.
   * Quello che si ha in mano è l'unica cosa che il giocatore non può rileggere
   * scorrendo indietro, perché non è mai stata scritta tutta insieme da nessuna
   * parte: per questo ha una superficie sua e non una voce di menu.
   */
  private apriInventario(): void {
    const corpo = byId('inventario-corpo');
    clear(corpo);
    const inv = this.session.snapshot().inventory;

    if (!inv.length) {
      corpo.append(el('p', 'empty', 'non hai niente con te'));
    } else {
      const box = el('div', 'chips inventario');
      for (const it of inv) {
        if (!it) continue;
        // Un oggetto senza descrizione non è toccabile: non c'è niente da
        // leggere e il player non lo inventa. Il linter intanto lo segnala, che
        // è il posto dove quel buco va risolto.
        const leggibile = !!(it.description || it.description_variants?.length);
        const chip = leggibile ? el('button', 'chip oggetto') : el('span', 'chip');

        // La figura dell'oggetto, dove esiste. Il nome resta e non si sposta:
        // la miniatura è un aiuto a riconoscere la cosa in mezzo alle altre, e
        // le cose che si hanno in mano si riconoscono prima da come sono fatte
        // che da come si chiamano. L'`alt` è vuoto apposta — il nome è la riga
        // accanto, e ripeterlo lo farebbe leggere due volte.
        const mini = this.images.usable ? this.images.element(it.image, '') : undefined;
        if (mini) {
          mini.className = 'mini';
          chip.classList.add('con-figura');
          chip.append(mini);
        }
        chip.append(document.createTextNode(displayName(it)));

        if (chip instanceof HTMLButtonElement) {
          chip.type = 'button';
          chip.onclick = async () => {
            await premi(chip);
            this.chiudiCassetti();
            void this.lookAt(it.id);
          };
        }
        box.append(chip);
      }
      corpo.append(box);
    }
    show(byId('inventario'), true);
    show(byId('scrim'), true);
  }

  /** Il segno davanti a «inizia», «continua» e all'uscita rimasta: cresce da
   * solo senza portarsi dietro il bottone, ed è per questo che sta in un suo
   * `span`. */
  private bottone(testo: string, cls: string): HTMLButtonElement {
    const b = el('button', cls);
    b.type = 'button';
    b.append(el('span', 'segno', '▸'), document.createTextNode(testo));
    return b;
  }

  /** Mentre un tocco è in corso il dock non accetta altro: due azioni partite
   * insieme sarebbero due passi di storia. */
  private async premi(b: HTMLElement, poi: () => void | Promise<void>): Promise<void> {
    this.dock.classList.add('bloccato');
    await premi(b);
    this.dock.classList.remove('bloccato');
    await poi();
  }

  private async lookAt(itemId: string): Promise<void> {
    const it = this.session.idx.items.get(itemId);
    if (it) await this.feed(`guarda ${it.name}`);
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, this.trace.join('\n'));
    } catch {
      // Una scheda in incognito, o lo spazio finito: non è un motivo per
      // fermare la partita.
    }
  }

  // ----------------------------------------------------------------- mappa

  /**
   * La mappa: ci si muove a scelte, come si parla a scelte.
   *
   * Non è una seconda interfaccia che scavalca il parser — «vai al magazzino»
   * scritto a mano fa la stessa identica cosa — è la scorciatoia che salta la
   * digitazione, e per questo il bottone che la apre sta accanto al campo e non
   * in barra. Una destinazione chiusa non sparisce: si vede che c'è una strada
   * e che adesso non si passa.
   */
  private apriMappa(): void {
    const mappa = byId('mappa');
    const corpo = byId('mappa-corpo');
    clear(corpo);
    const snap = this.session.snapshot();
    const idx = this.session.idx;

    const st = this.session.state;
    // **Solo i luoghi di questo atto.** Un atto è un mondo chiuso: quello che
    // viene dopo non è un posto in cui si possa andare, è la storia che gira
    // pagina. L'uscita che cambia atto resta percorribile — sta nel testo e
    // nel consiglio in fondo al dock — ma non è una destinazione da mappa, e
    // metterla qui accanto alle altre la farebbe sembrare un giro da fare.
    const nellAtto = (id: string) => idx.actOfPlace.get(id) === st.act;
    const visitati = new Set(st.history);
    const uscite = new Map(snap.exits.filter((e) => nellAtto(e.to)).map((e) => [e.to, e]));

    const grid = el('div', 'luoghi');
    const passati = el('div', 'luoghi');

    // Dove si è adesso, per prima e spenta. Non è una destinazione — non si
    // tocca — ma una mappa che mostra solo le strade e non il punto da cui
    // partono chiede di ricordarselo, ed è l'unica cosa che chi la apre sa
    // già. Il posto giusto per dirla è accanto alle altre, alla stessa scala.
    if (snap.place) grid.append(this.scheda(snap.place.id, displayName(snap.place), 'sei qui', 'qui'));

    for (const pl of idx.places.values()) {
      if (!nellAtto(pl.id) || pl.id === snap.place?.id) continue;
      const e = uscite.get(pl.id);
      const aperta = e ? st.meets(e.condition).ok : false;

      // Aperta adesso: è una destinazione, e si tocca. L'etichetta è quella
      // dell'uscita e non il nome del luogo — è la frase che si scriverebbe.
      if (e && aperta) {
        const label = e.label || displayName(pl);
        const b = this.scheda(pl.id, label, 'accessibile');
        b.disabled = false;
        b.addEventListener('click', () => {
          void (async () => {
            await premi(b);
            this.chiudiMappa();
            await this.feed(label);
          })();
        });
        grid.append(b);
        continue;
      }

      // Già stata, e adesso no: sotto il filo, spenta. Si vede sempre — anche
      // giocando — perché è la sola parte della mappa che risponde a «dove
      // sono stato», e quella domanda non è un'ispezione: è la memoria del
      // posto, che al giocatore appartiene quanto l'inventario.
      if (visitati.has(pl.id)) {
        passati.append(this.scheda(pl.id, displayName(pl), 'ci sei già stato', 'visitato'));
        continue;
      }

      // Chiusa o irraggiungibile: solo col debug. Una porta che non si apre e
      // un posto a cui non porta ancora nessuna strada sono la stessa cosa per
      // chi gioca — roba che non c'è — e stamparla è dire che esiste qualcosa
      // da trovare, cioè risolvere mezzo enigma.
      grid.append(this.scheda(pl.id, displayName(pl), e ? 'chiuso' : 'irraggiungibile', 'chiuso solo-debug'));
    }

    if (grid.childElementCount) corpo.append(grid);
    if (passati.childElementCount) {
      corpo.append(el('hr', 'sep-mappa'));
      corpo.append(passati);
    }
    // Il vicolo cieco si dice dopo la griglia, non al posto suo: «sei qui» è
    // comunque la risposta alla prima metà della domanda.
    if (!uscite.size) {
      corpo.append(
        el(
          'p',
          'empty',
          snap.exits.length
            ? 'Da qui la strada porta fuori da questo atto: non è un posto in cui tornare.'
            : 'Non conosci nessuna strada da qui.',
        ),
      );
    }
    show(mappa, true);
    show(byId('scrim'), true);
  }

  /** Una casella della mappa: la figura del luogo, il nome, e in che stato è.
   * Nasce spenta — la sola che si tocchi è la destinazione aperta, e l'accende
   * chi la costruisce. */
  private scheda(placeId: string, nome: string, stato: string, classe = ''): HTMLButtonElement {
    const b = el('button', `luogo${classe ? ` ${classe}` : ''}`);
    b.type = 'button';
    b.disabled = true;
    // Una destinazione si riconosce dalla figura prima che dal nome. Dove
    // l'immagine non c'è — o è spenta — resta il testo: il riquadro è una
    // griglia, la riga sparisce e non lascia un buco.
    const img = this.images.usable
      ? this.images.element(placeImage(this.session.idx, this.session.idx.places.get(placeId)), nome)
      : undefined;
    if (img) b.append(img);
    b.append(el('span', 'nome', nome), el('span', 'stato', stato));
    return b;
  }

  private chiudiMappa(): void {
    show(byId('mappa'), false);
    show(byId('scrim'), false);
  }

  /** Chiude il cassetto aperto, qualunque sia. Torna vero se ce n'era uno: chi
   * chiama lo usa per sapere se il gesto è stato speso. */
  private chiudiCassetti(): boolean {
    const aperti = ['mappa', 'inventario'].filter((id) => !byId(id).hidden);
    for (const id of aperti) show(byId(id), false);
    if (aperti.length) show(byId('scrim'), false);
    return aperti.length > 0;
  }

  private wireMappa(): void {
    byId('btn-chiudi-mappa').addEventListener('click', () => this.chiudiCassetti());
    byId('btn-chiudi-inventario').addEventListener('click', () => this.chiudiCassetti());
    // Lo stesso velo chiude i cassetti e il pannello: sono superfici della
    // stessa applicazione, e due modi di chiudersi si noterebbero.
    byId('scrim').addEventListener('click', () => this.chiudiCassetti());
  }

  // ------------------------------------------------------------ interruttori

  /**
   * Un tocco su un bottone del dock non deve togliere il fuoco al campo
   * *prima* del clic.
   *
   * Il bug si vedeva solo su telefono, e sembrava una cosa sola: si scriveva
   * una frase, si toccava il triangolo d'invio, la tastiera si chiudeva e la
   * frase restava lì. Non era l'invio a non funzionare: era il tocco a non
   * arrivarci. Toccando il bottone il campo perde il fuoco per primo, cade
   * `body.tastiera`, il palco si riapre — e il dock scivola giù da sotto il
   * dito prima che il clic parta.
   *
   * `preventDefault` sul `pointerdown` tiene il fuoco dov'è: niente blur,
   * niente riflusso, il bottone resta fermo e il clic arriva. Chi ha bisogno di
   * chiudere la tastiera lo fa dopo e di sua iniziativa — i due cassetti, che
   * si aprono su tutto lo schermo.
   *
   * Sta sul dock e non sui singoli bottoni perché il dock si ridisegna a ogni
   * turno e i bottoni sono altri ogni volta: qui l'ascoltatore si mette una
   * volta sola, e vale anche per quelli che verranno.
   */
  private wireDock(): void {
    this.dock.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('button')) return;
      if (document.activeElement instanceof HTMLInputElement) e.preventDefault();
    });
  }

  private wireToggles(): void {
    const debugButtons = [byId<HTMLButtonElement>('btn-debug'), byId<HTMLButtonElement>('btn-debug-panel')];
    const setDebug = (on: boolean) => {
      document.body.classList.toggle('debug', on);
      for (const b of debugButtons) b.setAttribute('aria-pressed', String(on));
      const snap = this.session.snapshot();
      this.stage.setContext(snap.place, snap.phase);
      this.panel.suDebug(on);
    };
    for (const b of debugButtons) {
      b.addEventListener('click', () => {
        setDebug(b.getAttribute('aria-pressed') !== 'true');
        // Dal piede del menu il debug chiude il pannello, come il giro dei
        // caratteri: quello che accende sta quasi tutto **sotto** il menu — le
        // chip nel dock, l'ispezione del luogo, la meccanica nel trascritto — e
        // restare sul pannello vuol dire premere e non vedere succedere niente.
        if (b.id === 'btn-debug-panel') this.panel.close();
      });
    }

    // La scelta fra testo e immagini compare solo quando c'è davvero qualcosa
    // da scegliere: un interruttore che non cambia niente è peggio della sua
    // assenza — chi lo trova lo prova, non vede succedere nulla e conclude che
    // il player è rotto.
    const imgButtons = [byId<HTMLButtonElement>('btn-immagini'), byId<HTMLButtonElement>('btn-immagini-panel')];
    for (const b of imgButtons) {
      // Il segno è quello che il trascritto usa già per i prompt d'immagine: la
      // stessa cosa deve avere lo stesso disegno ovunque compaia.
      const segno = icona('image');
      if (segno) b.append(segno);
      b.hidden = !this.images.available;
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        this.images.off = !on;
        for (const o of imgButtons) {
          o.setAttribute('aria-pressed', String(on));
          const etichetta = on ? 'immagini: accese' : 'immagini: spente (solo i prompt)';
          o.setAttribute('aria-label', etichetta);
          o.title = etichetta;
        }
        const snap = this.session.snapshot();
        this.stage.setContext(snap.place, snap.phase);
      });
    }
  }

  /**
   * Frecce e cifre sul dock.
   *
   * È il modo naturale di scorrere un elenco di battute — ed è l'elenco delle
   * battute il posto dove serve davvero, perché nel dialogo le voci *sono*
   * l'interfaccia, mentre nelle azioni si scrive.
   *
   * Si sposta il fuoco vero del documento invece di tenere una selezione per
   * conto proprio: così l'invio lo gestisce il bottone da solo, lo screen reader
   * annuncia la voce, e il contorno di `:focus-visible` che c'è già fa da
   * evidenziazione.
   */
  private wireTasti(): void {
    const voci = () => [...this.dock.querySelectorAll<HTMLButtonElement>('button.choice:not([disabled])')];

    document.addEventListener('keydown', (e) => {
      // Esc chiude il cassetto aperto — la mappa o il menu. Prima di ogni
      // altra cosa, e anche mentre si scrive: è il gesto con cui si esce da
      // una schermata, non una scorciatoia di gioco. La lente ha la sua Esc e
      // viene prima: chiudere l'immagine non deve chiudere anche quello che
      // sta sotto.
      if (e.key === 'Escape') {
        if (lenteAperta()) return;
        const menu = !byId('panel').hidden;
        if (this.chiudiCassetti()) e.preventDefault();
        else if (menu) {
          this.panel.close();
          e.preventDefault();
        }
        return;
      }
      if (staScrivendo(e)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const v = voci();
        if (!v.length) return;
        e.preventDefault();
        const i = v.indexOf(document.activeElement as HTMLButtonElement);
        const giu = e.key === 'ArrowDown';
        v[i < 0 ? (giu ? 0 : v.length - 1) : (i + (giu ? 1 : -1) + v.length) % v.length].focus();
        return;
      }
      // L'invio esegue il passo unico del dock: «continua», «inizia»,
      // «ricomincia», l'uscita rimasta. Arriva qui solo dove non si scrive —
      // il campo, quando c'è, se lo prende da sé — e con le battute di un
      // dialogo aperte non fa niente: quelle sono una scelta, e sceglierne una
      // per inerzia è il modo più rapido di dire una cosa che non si voleva
      // dire.
      if (e.key === 'Enter') {
        const b = this.dock.querySelector<HTMLButtonElement>('button.choice.continue:not([disabled])');
        if (b) {
          e.preventDefault();
          b.click();
        }
        return;
      }
      // Le cifre restano: sono le stesse stampate accanto a ogni voce.
      if (/^[1-9]$/.test(e.key)) {
        const b = voci()[Number(e.key) - 1];
        if (b) {
          e.preventDefault();
          b.click();
        }
      }
    });
  }

  // ---------------------------------------------------- il secondo interprete

  /**
   * Accende un backend.
   *
   * Il lessicale non può fallire — non va da nessuna parte — quindi il caso
   * interessante è l'altro, ed è l'unico posto del player dove qualcosa dipende
   * dalla rete. Quando salta, si resta su quello che funzionava e si dice
   * **dove** è saltato: senza, l'unica diagnosi che arriva a chi gioca è
   * «Failed to fetch», che non dice né quale dei tre indirizzi fosse sbagliato
   * né se il problema sia suo.
   */
  private async scegliResolver(nome: string, riprova = false): Promise<void> {
    if (nome === this.nomeResolver && !riprova) return;
    try {
      if (nome === 'lessicale') {
        this.vettori = undefined;
      } else {
        this.statoResolver = 'attivo i vettori…';
        this.panel.render();
        const { embed, etichetta } = await caricaEmbedder(this.configEmbedder, (m) => {
          this.statoResolver = m;
          this.panel.render();
        });
        this.vettori = new VectorResolver(embed, nome === 'vettori' ? 'puro' : 'ibrido', etichetta);
      }
      this.nomeResolver = nome;
      this.statoResolver = '';
    } catch (err) {
      this.vettori = undefined;
      this.nomeResolver = 'lessicale';
      this.statoResolver = spiega(err as Error);
    }
    this.panel.render();
  }

}

/** Un evento che qualcuno dice: è quello che apre un blocco. Il resto — suoni,
 * cambi di stato, diagnostica — sta appeso a ciò che lo precede. */
function parlante(e: TurnEvent): boolean {
  return e.kind === 'narration' || e.kind === 'say' || e.kind === 'system';
}

/**
 * Il turno diviso in blocchi da leggere uno alla volta.
 *
 * Un blocco è una cosa detta con appesi i campi che la descrivono. Non è logica
 * di flusso che il player si inventa: gli eventi e il loro ordine restano
 * quelli che il core ha deciso, cambia il momento in cui si vedono, che è
 * impaginazione.
 */
function blocchi(events: TurnEvent[]): TurnEvent[][] {
  const out: TurnEvent[][] = [];
  for (const e of events) {
    const ultimo = out[out.length - 1];
    if (!ultimo || (parlante(e) && ultimo.some(parlante))) out.push([e]);
    else ultimo.push(e);
  }
  return out;
}

/**
 * Da un errore di rete a una frase che dice cosa fare.
 *
 * Il caso che capita davvero: la pagina pubblicata gira sotto una politica che
 * blocca le richieste verso l'esterno, quindi la libreria si carica ma i pesi
 * del modello no. Chi lo incontra vede «Failed to fetch» e non ha nessun modo
 * di sapere che il problema non è il suo indirizzo.
 */
function spiega(err: Error): string {
  const msg = err.message || String(err);
  if (/fetch|network|load|import|cors|blocked/i.test(msg)) {
    return (
      `Non riesco a caricarlo: ${msg}\n\n` +
      'Se stai giocando dalla pagina pubblicata, è probabile che sia questo: quella pagina non può fare ' +
      'richieste verso l’esterno, quindi il modello non si scarica. Il backend a vettori funziona aprendo il ' +
      'file del player in locale, o servendolo da http — oppure puntando gli indirizzi qui sotto a una copia ' +
      'raggiungibile.'
    );
  }
  return `Non riesco ad attivarlo: ${msg}`;
}

/**
 * L'altezza dell'app segue il viewport visuale.
 *
 * `100dvh` misura la finestra, e la tastiera di sistema non la rimpicciolisce:
 * sale **sopra** la pagina. Il risultato era che i tasti coprivano il dock, cioè
 * proprio la riga in cui si scrive cosa fare, e per rivederla bisognava
 * chiudere la tastiera, scrivere di nuovo, e così via. `visualViewport` invece
 * misura quello che si vede davvero.
 *
 * `scrollTo(0, 0)` insieme: quando la tastiera si apre iOS scorre il viewport di
 * layout per portare il campo in vista, e siccome la pagina non scorre —
 * l'altezza è fissa e a scorrere è il trascritto dentro di sé — quello
 * scorrimento sposta tutta l'applicazione lasciando una striscia vuota in cima.
 */
function fitToKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;

  /**
   * Il palco si ritira quando il campo prende il fuoco e torna quando lo perde
   * — ma chiudendo la tastiera con il tasto del sistema operativo il campo il
   * fuoco **non lo perde**: `blur` non arriva mai. Il fuoco da solo non è
   * quindi un buon segnale: quello che conta è se i tasti sono sullo schermo, e
   * a dirlo è l'altezza del viewport visuale rispetto a quella della finestra,
   * che la tastiera non tocca.
   *
   * `ridottoVisto` serve a non fidarsi di questa misura dove non funziona: su
   * qualche browser il viewport visuale non si stringe affatto, e lì una regola
   * che toglie la classe «appena il viewport è pieno» la toglierebbe sempre.
   */
  let ridottoVisto = false;
  const nelCampo = () => document.activeElement?.classList.contains('campo') === true;

  const adatta = () => {
    document.documentElement.style.setProperty('--altezza-app', `${vv.height}px`);
    if (window.scrollY !== 0) window.scrollTo(0, 0);

    const ridotto = vv.height < window.innerHeight - 100;
    if (ridotto) {
      ridottoVisto = true;
      if (nelCampo()) document.body.classList.add('tastiera');
    } else if (ridottoVisto) {
      ridottoVisto = false;
      document.body.classList.remove('tastiera');
    }
  };
  vv.addEventListener('resize', adatta);
  vv.addEventListener('scroll', adatta);
  adatta();
}

// L'avvio sta in fondo di proposito: `boot()` può arrivare a costruire `Game`
// nello stesso giro sincrono — succede con la storia incorporata — e una classe
// dichiarata più sotto non è ancora inizializzata. Chiamarlo in cima costava un
// «Cannot access before initialization» che si vede solo nella build.
void boot();

export { parseStory };
