/**
 * Avvio del player web.
 *
 * Tre modi di ricevere l'IR, in ordine di precedenza: incorporato nella pagina
 * (`window.__ZAISTORY_IR__`, come fa `scripts/embed.mjs`), scaricato da
 * `?ir=URL`, oppure scelto a mano — file, trascinamento o incolla. Nessun
 * server richiesto: la build e' un unico file HTML che si apre anche da
 * `file://`, ed e' il motivo per cui questo player esiste — testare una storia
 * dal telefono senza installare niente.
 */

import './styles.css';
import {
  Engine,
  IRError,
  LexicalResolver,
  ScriptDriver,
  countFindings,
  lintStory,
  makeResolver,
  parseScript,
  parseStory,
  scriviSalvataggio,
  validateStory,
  type Finding,
  type Resolver,
  type Story,
} from '../core/index.js';
import {
  configPlayerSerializzabile,
  leggiConfigPlayer,
  FONT_VALIDI,
  type Font,
  type ConfigPlayer,
} from './config.js';
import { CONFIG_DEFAULT, caricaEmbedder, type ConfigEmbedder } from './embedder.js';
import { ASCOLTO_DEFAULT, Ascolto, type ImpostazioniAscolto } from './ascolto.js';
import { Immagini, baseDegliAsset } from './immagini.js';
import { dimenticaRipresa, leggiRipresa, salvaRipresa } from './ripresa.js';
import { Palco } from './palco.js';
import { Voce } from './voce.js';
import { PLAYER_VERSION } from '../version.js';
import { $, clear, el, staScrivendo } from './dom.js';
import { icona } from './icone.js';
import { TAB_DEBUG, perNiente, renderPanel, type PanelContext, type Tab } from './panel.js';
import { WebUI } from './webui.js';

declare global {
  interface Window {
    /** IR incorporato nella pagina al momento della build. */
    __ZAISTORY_IR__?: unknown;
  }
}

const loader = $('#loader');
const loaderErr = $('#loader-err');
const app = $('#app');
const transcript = $('#transcript');
const dock = $('#dock');
const panel = $('#panel');
const panelBody = $('#panel-body');
const scrim = $('#scrim');
const lintBadge = $('#lint-badge');

$('#panel-version').textContent = `zaiplay v${PLAYER_VERSION}`;

let session: Session | undefined;
let tab: Tab = 'principale';

/**
 * Il carattere della prosa.
 *
 * Vive qui e non in `webui.ts` per la stessa ragione delle immagini: non e'
 * stato di gioco, e ricominciare non deve costringere a risceglierlo. Chi lo
 * applica e' il CSS, da un attributo sul `body` — cosi' vale anche per il
 * transcript gia' scorso, come per il debug.
 */
let font: Font = 'charter';

function impostaFont(f: Font): void {
  font = f;
  document.body.dataset.font = f;
  aggiornaFontUI();
}

/**
 * Il bottone del carattere: un segno e, accanto, il nome di quello corrente.
 *
 * Il nome sta scritto sul bottone e non dietro un menu perche' e' meta' di cio'
 * che serve sapere — l'altra meta' e' come si legge, e quella e' sotto, nella
 * pagina. Cinque nomi in un giro sono pochi abbastanza da non aver bisogno di
 * un elenco: si tocca finche' non si e' contenti, e a ogni tocco cambia sotto
 * gli occhi la stessa scena che si stava leggendo. Un elenco avrebbe chiesto un
 * pannello, e un pannello su telefono copre esattamente cio' su cui si sta
 * decidendo.
 */
function aggiornaFontUI(): void {
  const etichetta = `carattere: ${font}`;
  for (const b of [btnFont, btnFontPannello]) {
    clear(b);
    const segno = icona('font');
    if (segno) b.append(segno);
    b.append(el('span', 'nome', font));
    b.setAttribute('aria-label', etichetta);
    b.title = etichetta;
  }
}

// L'attributo si scrive subito, prima di qualsiasi partita: senza, comparirebbe
// solo alla prima scelta, e un carattere ripreso dal deposito arriverebbe dopo
// che la copertina si e' gia' disegnata. Il `:root` porta comunque lo stesso
// default, cosi' nemmeno il primo istante resta senza.
//
// Qui **solo** l'attributo, e non `impostaFont`: quella disegna anche il
// bottone, che a questo punto del file non esiste ancora — e' un `const` piu'
// in basso, quindi leggerlo da qui non darebbe `undefined` ma un errore secco
// che ferma il modulo. Il bottone si disegna da se' appena e' dichiarato.
document.body.dataset.font = font;

/**
 * Il backend attivo. Parte dal lessicale: deterministico, nessuna rete,
 * nessun byte scaricato — e con gli alias scritti in compilazione copre le
 * frasi centrali. L'embedder si accende dal pannello, quando serve saperlo.
 */
let resolver: Resolver = new LexicalResolver();
let nomeResolver = 'lessicale';
let statoResolver = '';
let configEmbedder: ConfigEmbedder = { ...CONFIG_DEFAULT };

/**
 * La modalita' ascolto.
 *
 * La `Voce` sta qui, viva quanto la pagina: e' l'altoparlante, e non ha
 * ragione di nascere e morire con la partita. L'`Ascolto` invece nasce con
 * l'IR — i suoi registri sono "cosa e' gia' stato descritto in *questa*
 * partita" — mentre le impostazioni restano fuori da entrambi, perche'
 * ricominciare non deve costringere a riscegliere la voce.
 */
const voce = new Voce();
/**
 * Le immagini.
 *
 * Come la voce, vive quanto la pagina e non quanto la partita: dove stanno
 * gli asset non cambia perche' si ricomincia. La base si fissa quando si sa
 * da dove arriva l'IR — e resta indefinita se l'IR e' stato scelto a mano,
 * perche' in quel caso non esiste nessuna cartella storia intorno.
 */
const immagini = new Immagini(undefined, true);
/**
 * Il palco, cioe' dove l'inquadratura corrente sta ferma.
 *
 * Vive quanto la pagina per la stessa ragione delle immagini: e' un pezzo di
 * interfaccia, non un pezzo di partita. Quello che invece appartiene alla
 * partita — quale figura ci sta sopra — se ne va quando si ricomincia.
 */
const palco = new Palco($('#palco'), immagini);
let impAscolto: ImpostazioniAscolto = { ...ASCOLTO_DEFAULT };
let ascolto = new Ascolto({ ir_version: '', id: '', title: '', start_scene: '', scenes: [] }, voce);

/**
 * Accende un backend.
 *
 * Il lessicale non puo' fallire — non va da nessuna parte — quindi il caso
 * interessante e' l'altro, ed e' l'unico posto del player dove qualcosa
 * dipende dalla rete. Quando salta, si resta su quello che funzionava e si
 * dice **dove** e' saltato: senza, l'unica diagnosi che arriva all'utente e'
 * "Failed to fetch", che non dice ne' quale dei tre indirizzi era sbagliato
 * ne' se il problema e' suo.
 */
async function scegliResolver(nome: string, riprova = false): Promise<void> {
  if (nome === nomeResolver && !riprova) return;
  try {
    if (nome === 'lessicale') {
      resolver = new LexicalResolver();
    } else {
      statoResolver = 'attivo i vettori…';
      refreshPanel();
      const { embed, etichetta } = await caricaEmbedder(configEmbedder, (m) => {
        statoResolver = m;
        refreshPanel();
      });
      resolver = makeResolver(nome, { embed, modello: etichetta });
    }
    nomeResolver = nome;
    statoResolver = '';
  } catch (err) {
    resolver = new LexicalResolver();
    nomeResolver = 'lessicale';
    statoResolver = spiega(err as Error);
  }
  session?.ui.usaResolver(resolver);
  refresh();
}

/**
 * Da un errore di rete a una frase che dice cosa fare.
 *
 * Il caso che capita davvero: la pagina pubblicata gira sotto una politica che
 * blocca le richieste verso l'esterno, quindi la libreria si carica ma i pesi
 * del modello no. Chi lo incontra vede "Failed to fetch" e non ha nessun modo
 * di sapere che il problema non e' il suo indirizzo.
 */
function spiega(err: Error): string {
  const msg = err.message || String(err);
  if (/fetch|network|load|import|cors|blocked/i.test(msg)) {
    return (
      `Non riesco a caricarlo: ${msg}\n\n` +
      "Se stai giocando dalla pagina pubblicata, e' probabile che sia questo: quella pagina non puo' " +
      "fare richieste verso l'esterno, quindi il modello non si scarica. Il backend a vettori funziona " +
      'aprendo il file del player in locale, o servendolo da http — oppure puntando gli indirizzi qui ' +
      'sotto a una copia raggiungibile.'
    );
  }
  return `Non riesco ad attivarlo: ${msg}`;
}

interface Session {
  story: Story;
  findings: Finding[];
  engine: Engine;
  ui: WebUI;

}

// --------------------------------------------------------------- pannello

function panelContext(s: Session): PanelContext {
  return {
    story: s.story,
    findings: s.findings,
    ui: s.ui,
    trace: () => s.engine.trace(),
    // Ricominciare e rigiocare fanno ripartire la partita *dietro* al
    // pannello: lasciarlo aperto significa coprire con un pannello di
    // ispezione la prima scena che si voleva vedere.
    onRestart: ricomincia,
    onReplay: (text) => {
      closePanel();
      start(s.story, s.findings, new ScriptDriver(parseScript(text)));
    },
    onLoadOther: () => {
      closePanel();
      showLoader();
    },
    // Guardare una cosa che si ha in mano: il menu si chiude perche' la
    // risposta e' testo della storia, e il posto del testo della storia e' il
    // transcript, non un pannello che gli sta sopra.
    onEsamina: (id) => {
      closePanel();
      s.ui.esaminaOggetto(id);
    },
    debug: document.body.classList.contains('debug'),
    // Il codice si ricalcola a ogni disegno del pannello, che e' anche a ogni
    // mossa: quello che si copia e' sempre la partita fino a un istante fa.
    codiceSalvataggio: () =>
      scriviSalvataggio({
        salvato: new Date().toISOString(),
        partita: {
          story_id: s.story.id,
          ir_version: s.story.ir_version,
          title: s.story.title,
          trace: s.engine.trace(),
        },
        config: configPlayerSerializzabile(configCorrente()),
      }),
    // Le impostazioni prima della partita: `start` fa nascere un `Ascolto`
    // nuovo e lo configura con quelle correnti, quindi applicarle dopo
    // significherebbe cominciare la partita con la voce sbagliata.
    onCarica: (salv, cosa) => {
      if (cosa.config) applicaConfig(leggiConfigPlayer(salv.config, configCorrente()));
      if (cosa.partita && salv.partita) {
        closePanel();
        start(s.story, s.findings, new ScriptDriver([...salv.partita.trace]));
      }
    },
    immagini,
    ascolto,
    onAscolto: (imp) => {
      impAscolto = imp;
      ascolto.configura(imp);
      // Niente `refreshPanel()`: i controlli mostrano gia' il valore che
      // l'utente ha appena mosso, e ridisegnarli sotto il dito farebbe
      // perdere il trascinamento di un cursore a meta'.
    },
    resolver: nomeResolver,
    statoResolver,
    configEmbedder,
    onResolver: (nome) => void scegliResolver(nome),
    onConfigEmbedder: (c) => {
      configEmbedder = c;
      // Si riprova con la modalita' che l'utente aveva scelto; se non ne aveva
      // scelta nessuna coi vettori, l'ibrido e' quella con cui si gioca.
      void scegliResolver(nomeResolver === 'lessicale' ? 'ibrido' : nomeResolver, true);
    },
    onResetEmbedder: () => {
      configEmbedder = { ...CONFIG_DEFAULT };
      statoResolver = '';
      refreshPanel();
    },
  };
}

// ------------------------------------------------------- impostazioni del player

/**
 * Le impostazioni vive, raccolte dai tre posti dove stanno.
 *
 * Non hanno una casa unica in memoria di proposito: ognuna vive accanto a chi
 * la usa. Questa funzione e' l'unico punto in cui si guardano insieme, perche'
 * e' l'unico momento in cui servono insieme — quando si salvano.
 */
function configCorrente(): ConfigPlayer {
  return {
    ascolto: impAscolto,
    embedder: configEmbedder,
    resolver: nomeResolver,
    immagini: immagini.accese,
    font,
    debug: document.body.classList.contains('debug'),
  };
}

function applicaConfig(c: ConfigPlayer): void {
  impAscolto = c.ascolto;
  ascolto.configura(impAscolto);
  immagini.imposta(c.immagini);
  impostaFont(c.font);
  palco.rileggi();
  aggiornaImmaginiUI();
  configEmbedder = c.embedder;
  impostaDebug(c.debug);
  // Il backend si riaccende solo se cambia davvero: `scegliResolver` esce
  // subito quando il nome e' lo stesso, e cosi' il pannello non si ridisegna
  // sotto le dita di chi ha appena premuto «carica».
  void scegliResolver(c.resolver);
}

/**
 * Ricominciare da capo.
 *
 * Sta qui e non nel pannello perche' ha due punti di partenza — la scheda
 * principale, sotto l'inventario, e la scheda «traccia» — e sono la stessa
 * cosa: la domanda si fa una volta sola, in `chiediSeRicominciare`, e la
 * partita riparte in un modo solo.
 */
function ricomincia(): void {
  const s = session;
  if (!s) return;
  closePanel();
  // La partita salvata se ne va **prima** che la nuova cominci: chi ha appena
  // confermato «ricomincia» non deve ritrovarsi quella di prima al prossimo
  // ricaricamento della pagina.
  dimenticaRipresa(s.story);
  start(s.story, s.findings);
}

/**
 * Testo o immagini: l'interruttore, non piu' una scheda del menu.
 *
 * Sta in barra e nel piede del menu accanto al debug, che e' l'altro
 * interruttore della stessa specie: due modi di guardare la stessa storia, e
 * si scelgono guardando quello che cambia. Dentro un pannello che su telefono
 * copre tutto lo schermo, invece, si sceglieva alla cieca — il menu si
 * chiudeva apposta per far vedere l'effetto.
 *
 * Il menu resta chiuso anche adesso se era aperto: si e' toccato un
 * interruttore, non si e' entrati in una scheda.
 */
function impostaImmagini(on: boolean): void {
  immagini.imposta(on);
  closePanel();
  // Le immagini gia' stampate nel transcript restano: quello e' il resoconto
  // di cio' che e' successo, non una vista che si ridisegna, e l'interruttore
  // vale da qui in avanti come tutto il resto. Il palco no: quello e' una
  // vista, e obbedisce subito. Non sparisce pero' — in solo testo la testa
  // dello schermo continua a dire dove siamo, con i prompt al posto della
  // figura e le iniziali al posto delle facce.
  palco.rileggi();
  // La copertina e' una schermata come il palco, non resoconto: se ci si sta
  // sopra deve obbedire subito. Sotto, il transcript gia' stampato resta.
  session?.ui.rileggiCopertina();
  aggiornaImmaginiUI();
}

/**
 * L'interruttore si vede solo quando c'e' davvero qualcosa da scegliere.
 *
 * Un interruttore che non cambia niente e' peggio della sua assenza: chi lo
 * trova lo prova, non vede succedere nulla e conclude che il player e' rotto.
 * Quando non c'e' scelta sparisce, e il perche' resta scritto nel menu.
 */
function aggiornaImmaginiUI(): void {
  const scelta = session ? !perNiente({ immagini, story: session.story }) : false;
  const on = immagini.accese;
  for (const b of [btnImmagini, btnImmaginiPannello]) {
    b.hidden = !scelta;
    b.setAttribute('aria-pressed', String(on));
    const etichetta = on ? 'immagini: accese' : 'immagini: spente (solo i prompt)';
    b.setAttribute('aria-label', etichetta);
    b.title = etichetta;
  }
}

function impostaDebug(on: boolean): void {
  document.body.classList.toggle('debug', on);
  for (const b of [btnDebug, btnDebugPannello]) b.setAttribute('aria-pressed', String(on));
  // Spegnendo il debug le schede di ispezione spariscono dalla striscia: se si
  // era fermi su una di quelle, restare li' vorrebbe dire guardare un pannello
  // che non ha piu' nessuna linguetta accesa.
  if (!on && TAB_DEBUG.includes(tab)) selezionaTab('principale');
  else refreshPanel();
}

function refreshPanel(): void {
  if (panel.hidden || !session) return;
  renderPanel(panelBody, tab, panelContext(session));
}

// ----------------------------------------------------------- barra in testa

/**
 * La riga sotto il titolo: che cosa si sta giocando (IR, linter, script) e a
 * che punto si e' arrivati (scena, beat).
 *
 * La scena porta il suo numero d'ordine in `scenes[]`, non quante se ne sono
 * viste: e' la stessa base del totale che le sta accanto, e resta vera anche
 * ripassando da una scena gia' visitata. Prima che la partita cominci — cioe'
 * sulla copertina — non c'e' nessuna scena corrente e resta il solo totale.
 */
function refreshHeader(): void {
  if (!session) return;
  const { story, findings, ui } = session;

  const i = ui.scene ? story.scenes.findIndex((s) => s.id === ui.scene?.id) : -1;
  const dove = i >= 0 ? `scena ${i + 1}/${story.scenes.length}` : `${story.scenes.length} scene`;

  // Due righe per lo stesso posto, come per i nomi dei campi. A chi gioca
  // interessa a che punto e' — e, se sta rigiocando una traccia, che la sta
  // rigiocando. La versione dell'IR e il conto del linter sono informazioni
  // sul *file*, non sulla storia: stanno col debug.
  // A chi gioca la barra dice **dove si e'**, non a che punto della lista.
  // Il titolo della scena e' un nome d'autore e appartiene alla storia; il suo
  // numero e i passaggi che le restano sono misure del file, e sapere che si e'
  // alla 41esima di 43 e' un anticipo su come andra' a finire che nessuno ha
  // chiesto. Quelli restano col debug, dove servono per sapere dove si e'
  // mentre si collauda.
  //
  // Una scena senza titolo non fa comparire l'id al suo posto: quello e' una
  // chiave per cercare nel JSON, non un nome da leggere.
  const umano: string[] = [];
  if (ui.scene?.title) umano.push(`Scena: ${ui.scene.title}`);

  const ir = [`IR ${story.ir_version}`, dove];
  if (ui.beatCorrente && ui.beatTotali) ir.push(`beat ${ui.beatCorrente}/${ui.beatTotali}`);
  const { errors, warnings } = countFindings(findings);
  if (errors || warnings) ir.push(`linter: ${errors} errori, ${warnings} avvisi`);

  // Il marchio sparisce quando la traccia si esaurisce e la partita torna in
  // mano al giocatore: da quel momento non e' piu' una partita rigiocata.
  if (ui.sottoTraccia) {
    umano.push('traccia');
    ir.push('traccia');
  }

  const meta = $('#story-meta');
  clear(meta);
  meta.append(el('span', 'umano', umano.join(' · ')), el('span', 'ir', ir.join(' · ')));
}

/**
 * Stato e scena sono cambiati: si aggiornano insieme la barra e il pannello, e
 * la partita finisce nel deposito del browser.
 *
 * Qui e non altrove perche' questo e' l'unico punto per cui passano *tutti* i
 * cambiamenti di stato: un salvataggio agganciato ai singoli gestori
 * dimenticherebbe esattamente il caso che non si e' pensato.
 */
function refresh(): void {
  refreshHeader();
  refreshPanel();
  if (session) {
    salvaRipresa(session.story, session.engine.trace(), configPlayerSerializzabile(configCorrente()));
  }
}

function openPanel(): void {
  panel.hidden = false;
  scrim.hidden = false;
  refreshPanel();
}

function closePanel(): void {
  panel.hidden = true;
  scrim.hidden = true;
}

$('#btn-panel').addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
$('#btn-close-panel').addEventListener('click', closePanel);
scrim.addEventListener('click', closePanel);

function selezionaTab(nome: Tab): void {
  tab = nome;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
    b.classList.toggle('on', b.dataset.tab === nome);
  }
  refreshPanel();
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
  b.addEventListener('click', () => selezionaTab(b.dataset.tab as Tab));
}

// Il carattere della prosa: non un interruttore ma un giro. Sta in due posti
// come il debug e le immagini — in barra sotto il pollice mentre si gioca, e
// nel piede del menu. Su telefono verticale il secondo e' l'unico che resta:
// li' la barra tiene solo il titolo, e i comandi si vanno a cercare nel menu.
// Che sia un giro e non un interruttore non cambia niente per la copia: il
// nome del carattere corrente e' scritto su tutti e due i bottoni, quindi
// anche da menu chiuso non c'e' uno stato nascosto da indovinare.
const btnFont = $<HTMLButtonElement>('#btn-font');
const btnFontPannello = $<HTMLButtonElement>('#btn-font-panel');
for (const b of [btnFont, btnFontPannello]) {
  b.addEventListener('click', () => {
    const i = FONT_VALIDI.indexOf(font);
    impostaFont(FONT_VALIDI[(i + 1) % FONT_VALIDI.length]);
    // La partita non si tocca: e' una scelta su come si guarda, e finisce nelle
    // impostazioni insieme alle immagini e alla voce.
    refresh();
  });
}
aggiornaFontUI();

// Due bottoni per lo stesso interruttore: quello in barra, sempre a portata di
// pollice mentre si gioca, e quello in fondo al menu accanto alla versione —
// che e' dove lo si va a cercare quando il player lo si sta usando e non
// programmando.
const btnDebug = $<HTMLButtonElement>('#btn-debug');
const btnDebugPannello = $<HTMLButtonElement>('#btn-debug-panel');
for (const b of [btnDebug, btnDebugPannello]) {
  b.addEventListener('click', () => impostaDebug(!document.body.classList.contains('debug')));
}

// Lo stesso interruttore in due posti, come il debug: in barra sotto il
// pollice mentre si gioca, e nel piede del menu dove lo si va a cercare.
const btnImmagini = $<HTMLButtonElement>('#btn-immagini');
const btnImmaginiPannello = $<HTMLButtonElement>('#btn-immagini-panel');
for (const b of [btnImmagini, btnImmaginiPannello]) {
  // Il segno e' quello che il transcript usa gia' per i prompt d'immagine: la
  // stessa cosa deve avere lo stesso disegno ovunque compaia.
  const segno = icona('image');
  if (segno) b.append(segno);
  b.addEventListener('click', () => impostaImmagini(!immagini.accese));
}

// ---------------------------------------------------------------- partita

function start(story: Story, findings: Finding[], script?: ScriptDriver, ripresa = false): void {
  session?.ui.cancel();
  clear(transcript);
  clear(dock);
  // L'ultima inquadratura della partita di prima non e' la prima di questa: il
  // palco riparte vuoto e ricompare da se' alla prossima immagine.
  palco.svuota();

  // Una partita nuova, una memoria nuova: i registri del collapse acustico
  // sono lunghi quanto la partita, come quello visivo dentro `WebUI`.
  ascolto = new Ascolto(story, voce);
  ascolto.configura(impAscolto);

  const ui = new WebUI({
    story,
    resolver,
    transcript,
    dock,
    onUpdate: refresh,
    script,
    ripresa,
    ascolto,
    immagini,
    palco,
  });
  const engine = new Engine(story, ui);
  session = { story, findings, engine, ui };

  $('#story-title').textContent = story.title;
  refreshHeader();
  aggiornaImmaginiUI();

  const { errors, warnings } = countFindings(findings);
  if (errors || warnings) {
    lintBadge.hidden = false;
    lintBadge.textContent = String(errors || warnings);
    lintBadge.classList.toggle('warn', errors === 0);
  } else {
    lintBadge.hidden = true;
  }

  loader.hidden = true;
  app.hidden = false;

  // La copertina precede la partita e si chiude con un tocco; una partita
  // rifiutata (ricomincia, cambio IR) risolve con QuitError, che non e' un
  // errore da mostrare ma la partita precedente che si chiude.
  void (async () => {
    await ui.intro();
    await engine.run();
  })().catch(() => {});
}

// -------------------------------------------------------------- caricamento

function showLoader(): void {
  session?.ui.cancel();
  loader.hidden = false;
  app.hidden = true;
  loaderErr.hidden = true;
}

function load(data: unknown | string): void {
  try {
    const story = typeof data === 'string' ? parseStory(data) : validateStory(data);

    // La partita di prima, se questa pagina ne aveva una. Le impostazioni si
    // riprendono con lei — meno il backend del resolver, che vale un download
    // e va chiesto: `leggiConfigPlayer` lo legge, e qui lo si rimette su
    // quello che c'e' adesso.
    const salv = leggiRipresa(story);
    if (salv?.config) {
      applicaConfig({ ...leggiConfigPlayer(salv.config, configCorrente()), resolver: nomeResolver });
    }
    start(story, lintStory(story), salv?.partita ? new ScriptDriver([...salv.partita.trace]) : undefined, true);
  } catch (err) {
    loader.hidden = false;
    app.hidden = true;
    loaderErr.hidden = false;
    loaderErr.textContent =
      err instanceof IRError ? `IR non conforme allo schema:\n${err.message}` : `Errore: ${(err as Error).message}`;
  }
}

async function loadFile(file: File): Promise<void> {
  load(await file.text());
}

const fileInput = $<HTMLInputElement>('#file');
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void loadFile(f);
});

const drop = $('#drop');
for (const evt of ['dragenter', 'dragover'] as const) {
  drop.addEventListener(evt, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
for (const evt of ['dragleave', 'drop'] as const) {
  drop.addEventListener(evt, () => drop.classList.remove('over'));
}
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) void loadFile(f);
});

$('#paste-go').addEventListener('click', () => {
  const text = $<HTMLTextAreaElement>('#paste-area').value.trim();
  if (text) load(text);
});

// L'IR puo' arrivare gia' con la pagina: e' il caso del file HTML autonomo
// prodotto da `npm run embed`, quello che si manda a chi deve solo giocare.
const embedded = window.__ZAISTORY_IR__;
const fromUrl = new URLSearchParams(location.search).get('ir');

if (embedded) {
  // La pagina con l'IR dentro sta *nella* cartella della storia: e' cosi' che
  // `start_local_player.sh` la mette, ed e' anche cio' che rende la cartella
  // copiabile su una chiavetta e ancora giocabile.
  immagini.impostaBase(baseDegliAsset());
  load(embedded);
} else if (fromUrl) {
  immagini.impostaBase(baseDegliAsset(fromUrl));
  fetch(fromUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.text();
    })
    .then(load)
    .catch((err: Error) => {
      loaderErr.hidden = false;
      loaderErr.textContent = `Non riesco a scaricare ${fromUrl}: ${err.message}`;
    });
}

/**
 * L'app alta quanto lo spazio che la tastiera lascia scoperto.
 *
 * `100dvh` misura la finestra, e la tastiera di sistema non la rimpicciolisce:
 * sale **sopra** la pagina. Il risultato era che i tasti coprivano il dock,
 * cioe' proprio la riga in cui si scrive cosa fare — l'interfaccia del gioco —
 * e per rivederla bisognava chiudere la tastiera, scrivere di nuovo, e cosi'
 * via. `visualViewport` invece misura quello che si vede davvero, e l'app ci si
 * adatta: il dock resta appoggiato al bordo dei tasti e il transcript si
 * accorcia sopra di lui.
 *
 * `scrollTo(0, 0)` insieme: quando la tastiera si apre iOS scorre il viewport
 * di layout per portare il campo in vista, e siccome la pagina non scorre —
 * l'altezza e' fissa e a scorrere e' il transcript dentro di se' — quello
 * scorrimento sposta tutta l'applicazione lasciando una striscia bianca in
 * cima.
 */
const vv = window.visualViewport;
if (vv) {
  /**
   * Vero quando la tastiera e' chiusa da un gesto di sistema invece che dal
   * fuoco.
   *
   * Il palco si ritira quando il campo prende il fuoco e torna quando lo
   * perde — ma chiudendo la tastiera con il tasto del sistema operativo il
   * campo il fuoco **non lo perde**: `blur` non arriva mai, e il palco
   * restava nascosto per il resto della partita. Il fuoco, da solo, non e'
   * quindi un buon segnale: quello che conta e' se i tasti sono sullo
   * schermo, e a dirlo e' l'altezza del viewport visuale rispetto a quella
   * della finestra, che la tastiera non tocca.
   *
   * `ridottoVisto` serve a non fidarsi di questa misura dove non funziona:
   * su qualche browser il viewport visuale non si stringe affatto, e li' una
   * regola che toglie la classe «appena il viewport e' pieno» la toglierebbe
   * sempre, cioe' subito. Finche' una riduzione non si e' vista almeno una
   * volta non si conclude niente, e il fuoco resta l'unico comando.
   */
  let ridottoVisto = false;
  const nelCampo = () => document.activeElement?.classList.contains('campo') === true;

  const adatta = () => {
    document.documentElement.style.setProperty('--altezza-app', `${vv.height}px`);
    // Quando la tastiera si apre iOS scorre il viewport di layout per portare
    // il campo in vista, e siccome la pagina non scorre — l'altezza e' fissa e
    // a scorrere e' il transcript dentro di se' — quello scorrimento sposta
    // tutta l'applicazione lasciando una striscia vuota in cima.
    if (window.scrollY !== 0) window.scrollTo(0, 0);

    const ridotto = vv.height < window.innerHeight - 100;
    if (ridotto) {
      ridottoVisto = true;
      // I tasti sono tornati su un campo che aveva gia' il fuoco: nessun
      // `focus` da intercettare, ma il palco deve ritirarsi lo stesso.
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

/**
 * Le voci del dock, quelle che si possono davvero scegliere adesso.
 *
 * `offsetParent` nullo vuol dire nascosta: le chip delle azioni fuori dal
 * debug e quelle filtrate da una condizione stanno nel DOM ma non sono in
 * gioco, e una navigazione da tastiera che ci passa sopra sembra rotta.
 */
function voci(): HTMLButtonElement[] {
  return [...dock.querySelectorAll<HTMLButtonElement>('button.choice:not([disabled])')].filter(
    (b) => b.offsetParent !== null,
  );
}

/**
 * Frecce e invio sul dock.
 *
 * E' il modo naturale di scorrere un elenco di battute — ed e' l'elenco delle
 * battute il posto dove serve davvero, perche' nel dialogo le chip *sono*
 * l'interfaccia (si parla a scelte, per la decisione 1.7.0) mentre nelle
 * azioni si scrive.
 *
 * Si sposta il fuoco vero del documento invece di tenere una selezione per
 * conto proprio: cosi' l'invio lo gestisce il bottone da solo, lo screen
 * reader annuncia la voce, e il contorno di `:focus-visible` che c'e' gia'
 * fa da evidenziazione senza aggiungere una seconda idea di "voce corrente"
 * che poi diverge da quella del browser.
 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (staScrivendo(e)) return;
  const v = voci();
  if (v.length === 0) return;
  e.preventDefault();
  const i = v.indexOf(document.activeElement as HTMLButtonElement);
  const giu = e.key === 'ArrowDown';
  const next = i < 0 ? (giu ? 0 : v.length - 1) : (i + (giu ? 1 : -1) + v.length) % v.length;
  v[next].focus();
});

// I numeri restano: sono le stesse cifre stampate accanto a ogni voce.
document.addEventListener('keydown', (e) => {
  if (!/^[1-9]$/.test(e.key)) return;
  if (staScrivendo(e)) return;
  const b = voci()[Number(e.key) - 1];
  if (b) {
    e.preventDefault();
    b.click();
  }
});

export {};
