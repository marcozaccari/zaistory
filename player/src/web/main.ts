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
  ScriptDriver,
  countFindings,
  lintStory,
  parseScript,
  parseStory,
  validateStory,
  type Finding,
  type Story,
} from '../core/index.js';
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
    onRestart: () => start(s.story, s.findings),
    onReplay: (text) => start(s.story, s.findings, new ScriptDriver(parseScript(text))),
    onLoadOther: () => {
      closePanel();
      showLoader();
    },
  };
}

function refreshPanel(): void {
  if (panel.hidden || !session) return;
  renderPanel(panelBody, tab, panelContext(session));
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

  const ui = new WebUI({ story, transcript, dock, onUpdate: refreshPanel, script });
  const engine = new Engine(story, ui);
  session = { story, findings, engine, ui };

  $('#story-title').textContent = story.title;
  const { errors, warnings } = countFindings(findings);
  const lint = errors || warnings ? ` · linter: ${errors} errori, ${warnings} avvisi` : '';
  $('#story-meta').textContent = `IR ${story.ir_version} · ${story.scenes.length} scene${lint}${script ? ' · script' : ''}`;

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

// Un piccolo aiuto per chi gioca da tastiera: i numeri scelgono le voci.
document.addEventListener('keydown', (e) => {
  if (!/^[1-9]$/.test(e.key)) return;
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
  const buttons = dock.querySelectorAll<HTMLButtonElement>('button.choice:not([disabled])');
  const b = buttons[Number(e.key) - 1];
  if (b) {
    e.preventDefault();
    b.click();
  }
});

export {};
