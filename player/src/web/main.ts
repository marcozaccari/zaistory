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

import type { Resolution, Session as SessionType, TurnResult } from '../core/index.js';
import { LoadError, Session, VectorResolver, displayName, loadStory, parseStory, systemQuestion } from '../core/index.js';
import { byId, clear, el, premi, show, staScrivendo } from './dom.js';
import { CONFIG_DEFAULT, caricaEmbedder, type ConfigEmbedder } from './embedder.js';
import { Fonts } from './fonts.js';
import { icona } from './icons.js';
import { Images, hasPublishedImages } from './images.js';
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
  private transcript = new Transcript();
  private stage: Stage;
  private panel: Panel;
  private listen: Listen;
  private trace: string[] = [];
  private choices: { index: number; text: string }[] = [];
  private ended = false;
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
    this.stage = new Stage(session.idx, images, (src, cap) => this.fullscreen(src, cap));
    this.listen = new Listen(session.idx, voce);
    this.listen.configura(this.impAscolto);
    this.panel = new Panel(session, {
      trace: () => this.trace.join('\n'),
      resume: (t) => void this.replay(t.split('\n')),
      restart: () => this.restart(),
      lookAt: (id) => void this.lookAt(id),
      version: VERSION,
      imagesWhy: images.available ? '' : images.why,
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

    this.wireToggles();
    this.wireTasti();
    this.wireMappa();
  }

  // ------------------------------------------------------------ copertina

  begin(): void {
    const story = this.session.idx.story;
    this.transcript.clear();
    this.listen.ricomincia();

    if (story.cover) this.stage.frame(story.cover);
    this.transcript.cover(story.title, story.description, story.global_style);

    clear(this.dock);
    const go = this.bottone('inizia', 'choice continue start');
    go.addEventListener('click', () => {
      void (async () => {
        await premi(go);
        // Il primo suono di una pagina deve venire da un gesto: la copertina
        // si recita qui, non al caricamento, o il browser la zittisce.
        this.listen.copertina();
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

  private restart(): void {
    localStorage.removeItem(this.key);
    this.session = new Session(this.session.idx);
    this.trace = [];
    this.ended = false;
    this.listen.ricomincia();
    this.stage.hide();
    this.begin();
  }

  /** Rigioca una partita. Sul web una traccia esaurita non è un errore: è il
   * punto in cui si riprende a giocare. */
  private async replay(lines: string[]): Promise<void> {
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
      await this.feed(line, true);
      if (this.ended) break;
    }
    this.listen.configura({ ...this.impAscolto, attiva: eraAttiva });
    this.save();
  }

  // ---------------------------------------------------------------- turno

  private async feed(line: string, silent = false): Promise<void> {
    if (this.ended) return;
    if (!silent) {
      this.transcript.echo(line);
      // La voce di prima si ferma: senza, un tocco veloce lascerebbe indietro
      // la risposta al turno precedente, che continuerebbe a parlare sopra
      // quella nuova.
      this.listen.taci();
    }
    this.trace.push(line);

    const n = Number(line);
    const scelta = Number.isInteger(n) && n > 0 && this.session.inDialogue;
    const res = scelta ? this.session.choose(n - 1) : await this.turno(line);
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
    for (const e of res.events) if (e.beat) this.stage.frame(e.beat, snap.place?.id);

    this.transcript.events(res.events);
    this.choices = res.choices ?? [];
    if (!silent) {
      if (riosserva) this.listen.riosserva(snap.place, snap.phase);
      this.listen.turno(res.events, snap.place, snap.phase);
    }
    this.header();

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
      return;
    }
    this.paintDock(res, silent);
  }

  /**
   * La riga sotto il titolo: dove si è, e — col debug — di quale file si tratta.
   *
   * Due righe per lo stesso posto, come per i nomi dei campi. A chi gioca
   * interessa dove si trova; la versione del formato e il conto del linter sono
   * informazioni sul *file*, non sulla storia, e stanno col debug.
   */
  private header(): void {
    const s = this.session.snapshot();
    const story = this.session.idx.story;
    const umano: string[] = [];
    if (s.place) umano.push(displayName(s.place));

    const meta = [`zaistory ${story.zaistory_version}`, story.id];
    if (s.place) meta.push(`${s.place.id}/${s.phase?.id ?? '—'}`);

    const box = byId('story-meta');
    clear(box);
    box.append(el('span', 'umano', umano.join(' · ')), el('span', 'ir', meta.join(' · ')));
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

    const send = el('button', 'invia', '▸');
    send.type = 'submit';
    send.setAttribute('aria-label', 'esegui');

    const mappa = el('button', 'mappa-apri');
    mappa.type = 'button';
    mappa.title = 'dove andare';
    mappa.setAttribute('aria-label', 'dove andare');
    const segno = icona('map');
    if (segno) mappa.append(segno);
    mappa.addEventListener('click', () => this.apriMappa());

    row.append(input, send, mappa);
    row.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      void this.feed(v);
    };
    this.dock.append(row);

    // Il fuoco automatico vale solo dove la tastiera non costa niente: su un
    // telefono rimettercelo dopo una frase che non ha fatto match significa
    // riaprire i tasti addosso alla risposta appena arrivata.
    if (matchMedia('(pointer: fine)').matches) input.focus();
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

    if (!snap.exits.length) {
      corpo.append(el('p', 'empty', 'Non conosci nessuna strada da qui.'));
    } else {
      const grid = el('div', 'luoghi');
      for (const e of snap.exits) {
        const dest = idx.places.get(e.to);
        const aperta = this.session.state.meets(e.condition);
        const b = el('button', `luogo${aperta.ok ? '' : ' chiuso'}`);
        b.type = 'button';
        const img = this.images.usable ? this.images.element(dest?.image, dest?.name ?? e.to) : undefined;
        if (img) b.append(img);
        b.append(el('span', 'nome', e.label || displayName(dest ?? { id: e.to })));
        b.append(el('span', 'stato', aperta.ok ? 'aperto' : 'chiuso'));
        b.addEventListener('click', () => {
          void (async () => {
            await premi(b);
            this.chiudiMappa();
            await this.feed(e.label || displayName(dest ?? { id: e.to }));
          })();
        });
        grid.append(b);
      }
      corpo.append(grid);
    }
    show(mappa, true);
    show(byId('scrim'), true);
  }

  private chiudiMappa(): void {
    show(byId('mappa'), false);
    show(byId('scrim'), false);
  }

  private wireMappa(): void {
    byId('btn-chiudi-mappa').addEventListener('click', () => this.chiudiMappa());
    // Lo stesso velo chiude la mappa e il pannello: sono due cassetti della
    // stessa applicazione, e due modi di chiudersi si noterebbero.
    byId('scrim').addEventListener('click', () => this.chiudiMappa());
  }

  // ------------------------------------------------------------ interruttori

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
      b.addEventListener('click', () => setDebug(b.getAttribute('aria-pressed') !== 'true'));
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

  private fullscreen(src: string, caption: string): void {
    const box = el('div', 'pieno');
    const img = new Image();
    img.src = src;
    box.append(img);
    if (caption) box.append(el('p', 'didascalia', caption));
    // Si chiude con un tocco ovunque: su un telefono un popup che si chiude in
    // un punto solo è il modo più rapido di far uscire qualcuno dalla partita.
    box.addEventListener('click', () => box.remove());
    document.body.append(box);
  }
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
