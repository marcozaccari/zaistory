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
  validateStory,
  type Finding,
  type Resolver,
  type Story,
} from '../core/index.js';
import { CONFIG_DEFAULT, caricaEmbedder, type ConfigEmbedder } from './embedder.js';
import { ASCOLTO_DEFAULT, Ascolto, type ImpostazioniAscolto } from './ascolto.js';
import { Voce } from './voce.js';
import { PLAYER_VERSION } from '../version.js';
import { $, clear, staScrivendo } from './dom.js';
import { renderPanel, type PanelContext, type Tab } from './panel.js';
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

$('#panel-foot').textContent = `zaiplay v${PLAYER_VERSION}`;

let session: Session | undefined;
let tab: Tab = 'stato';

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
    onRestart: () => {
      closePanel();
      start(s.story, s.findings);
    },
    onReplay: (text) => {
      closePanel();
      start(s.story, s.findings, new ScriptDriver(parseScript(text)));
    },
    onLoadOther: () => {
      closePanel();
      showLoader();
    },
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
  const parti = [`IR ${story.ir_version}`];

  const i = ui.scene ? story.scenes.findIndex((s) => s.id === ui.scene?.id) : -1;
  parti.push(i >= 0 ? `scena ${i + 1}/${story.scenes.length}` : `${story.scenes.length} scene`);
  if (ui.beatCorrente && ui.beatTotali) parti.push(`beat ${ui.beatCorrente}/${ui.beatTotali}`);

  const { errors, warnings } = countFindings(findings);
  if (errors || warnings) parti.push(`linter: ${errors} errori, ${warnings} avvisi`);
  // Il marchio sparisce quando la traccia si esaurisce e la partita torna in
  // mano al giocatore: da quel momento non e' piu' una partita rigiocata.
  if (ui.sottoTraccia) parti.push('traccia');

  $('#story-meta').textContent = parti.join(' · ');
}

/** Stato e scena sono cambiati: si aggiornano insieme la barra e il pannello. */
function refresh(): void {
  refreshHeader();
  refreshPanel();
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

for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab as Tab;
    for (const other of document.querySelectorAll('#tabs button')) other.classList.toggle('on', other === b);
    // Su un telefono in verticale le schede non ci stanno tutte e la striscia
    // scorre: quella appena scelta va portata dentro la vista, altrimenti si
    // tocca una voce e resta mezza fuori dal bordo.
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    refreshPanel();
  });
}

const btnDebug = $<HTMLButtonElement>('#btn-debug');
btnDebug.addEventListener('click', () => {
  const on = document.body.classList.toggle('debug');
  btnDebug.setAttribute('aria-pressed', String(on));
});

// ---------------------------------------------------------------- partita

function start(story: Story, findings: Finding[], script?: ScriptDriver): void {
  session?.ui.cancel();
  clear(transcript);
  clear(dock);

  // Una partita nuova, una memoria nuova: i registri del collapse acustico
  // sono lunghi quanto la partita, come quello visivo dentro `WebUI`.
  ascolto = new Ascolto(story, voce);
  ascolto.configura(impAscolto);

  const ui = new WebUI({ story, resolver, transcript, dock, onUpdate: refresh, script, ascolto });
  const engine = new Engine(story, ui);
  session = { story, findings, engine, ui };

  $('#story-title').textContent = story.title;
  refreshHeader();

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
    start(story, lintStory(story));
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
  load(embedded);
} else if (fromUrl) {
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
