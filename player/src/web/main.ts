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
import { MODELLO_DEFAULT, caricaEmbedder } from './embedder.js';
import { PLAYER_VERSION } from '../version.js';
import { $, clear } from './dom.js';
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

async function scegliResolver(nome: string): Promise<void> {
  if (nome === nomeResolver) return;
  try {
    if (nome === 'embedding') {
      statoResolver = 'attivo il backend a vettori…';
      refreshPanel();
      const { embed, etichetta } = await caricaEmbedder(MODELLO_DEFAULT, (m) => {
        statoResolver = m;
        refreshPanel();
      });
      resolver = makeResolver('embedding', { embed, modello: etichetta });
    } else {
      resolver = new LexicalResolver();
    }
    nomeResolver = nome;
    statoResolver = '';
  } catch (err) {
    // Il fallimento va detto e basta: si resta sul backend che funzionava,
    // che e' sempre quello che non ha bisogno di rete.
    statoResolver = `non riesco ad attivarlo: ${(err as Error).message}`;
  }
  session?.ui.usaResolver(resolver);
  refresh();
}

interface Session {
  story: Story;
  findings: Finding[];
  engine: Engine;
  ui: WebUI;
  /** La partita e' guidata da uno script di playthrough. */
  scripted: boolean;
}

// --------------------------------------------------------------- pannello

function panelContext(s: Session): PanelContext {
  return {
    story: s.story,
    findings: s.findings,
    ui: s.ui,
    trace: () => s.engine.trace(),
    onRestart: () => start(s.story, s.findings),
    onReplay: (text) => start(s.story, s.findings, new ScriptDriver(parseScript(text))),
    onLoadOther: () => {
      closePanel();
      showLoader();
    },
    resolver: nomeResolver,
    statoResolver,
    onResolver: (nome) => void scegliResolver(nome),
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
  const { story, findings, ui, scripted } = session;
  const parti = [`IR ${story.ir_version}`];

  const i = ui.scene ? story.scenes.findIndex((s) => s.id === ui.scene?.id) : -1;
  parti.push(i >= 0 ? `scena ${i + 1}/${story.scenes.length}` : `${story.scenes.length} scene`);
  if (ui.beatCorrente && ui.beatTotali) parti.push(`beat ${ui.beatCorrente}/${ui.beatTotali}`);

  const { errors, warnings } = countFindings(findings);
  if (errors || warnings) parti.push(`linter: ${errors} errori, ${warnings} avvisi`);
  if (scripted) parti.push('script');

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

  const ui = new WebUI({ story, resolver, transcript, dock, onUpdate: refresh, script });
  const engine = new Engine(story, ui);
  session = { story, findings, engine, ui, scripted: !!script };

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

/** Vero se si sta scrivendo: li' le frecce muovono il cursore, e devono. */
function staScrivendo(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && /^(INPUT|TEXTAREA)$/.test(t.tagName);
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
