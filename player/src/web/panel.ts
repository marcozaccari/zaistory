/**
 * Il pannello di debug: quello che nel player CLI sono i comandi `:stato`,
 * `:scena`, `:azioni`, `:traccia` e il linter.
 *
 * Mostra lo stato di gioco (piccolo e interamente derivabile dagli Effect
 * applicati) e **tutte** le azioni della scena, comprese quelle filtrate, con
 * accanto il motivo per cui non compaiono.
 */

import {
  type Finding,
  type Scene,
  type Story,
  countFindings,
  describeCondition,
  describeEffect,
  findCharacter,
  isRepeatable,
  nodeIds,
  sceneType,
  toneOf,
} from '../core/index.js';
import { clear, el, kv, premi } from './dom.js';
import type { WebUI } from './webui.js';

export type Tab = 'stato' | 'scena' | 'linter' | 'traccia';

export interface PanelContext {
  story: Story;
  findings: Finding[];
  ui: WebUI;
  trace: () => string[];
  onRestart: () => void;
  onReplay: (script: string) => void;
  onLoadOther: () => void;
}

export function renderPanel(body: HTMLElement, tab: Tab, ctx: PanelContext): void {
  clear(body);
  switch (tab) {
    case 'stato':
      renderStato(body, ctx);
      break;
    case 'scena':
      renderScena(body, ctx);
      break;
    case 'linter':
      renderLinter(body, ctx);
      break;
    case 'traccia':
      renderTraccia(body, ctx);
      break;
  }
}

function chips(values: string[], vuoto: string): HTMLElement {
  if (values.length === 0) return el('p', 'empty', vuoto);
  const box = el('div', 'chips');
  for (const v of values) box.append(el('span', 'chip', v));
  return box;
}

function renderStato(body: HTMLElement, { ui, story }: PanelContext): void {
  const st = ui.state;
  if (!st) {
    body.append(el('p', 'empty', 'La partita non e\' ancora cominciata.'));
    return;
  }
  body.append(el('h3', undefined, 'scena corrente'));
  body.append(el('p', undefined, st.scene || '—'));

  body.append(el('h3', undefined, 'flag attivi'));
  body.append(chips(st.sortedFlags(), 'nessun flag impostato'));

  body.append(el('h3', undefined, 'inventario'));
  body.append(
    chips(
      st.inventory.map((id) => story.items?.find((i) => i.id === id)?.name ?? `${id} [senza scheda]`),
      'inventario vuoto',
    ),
  );

  body.append(el('h3', undefined, 'scene visitate'));
  body.append(el('p', undefined, st.history.length ? st.history.join(' → ') : '—'));
}

function renderScena(body: HTMLElement, ctx: PanelContext): void {
  const sc = ctx.ui.scene;
  if (!sc) {
    body.append(el('p', 'empty', 'Nessuna scena in corso.'));
    return;
  }

  body.append(el('h3', undefined, 'parametri'));
  const dl = el('dl', 'kv');
  kv(dl, 'id', sc.id);
  if (sc.title) kv(dl, 'title', sc.title);
  kv(dl, 'scene_type', sceneType(sc));
  // `look` non e' un'azione e non compare nel dock di proposito: nel player
  // definitivo e' una domanda che si fa a parole. Qui si legge perche' senza
  // non si potrebbe collaudare (ne' accorgersi che manca).
  kv(dl, 'look', sc.look || '— mancante');
  kv(dl, 'scene_tone', sc.scene_tone || `${toneOf(ctx.story, sc)} (default globale)`);
  if (sc.background) {
    kv(dl, 'background.image_prompt', sc.background.image_prompt);
    if (sc.background.ambient_sound_prompt) kv(dl, 'background.ambient_sound_prompt', sc.background.ambient_sound_prompt);
  } else {
    kv(dl, 'background', '— mancante');
  }
  if (sc.on_enter_flags_set?.length) kv(dl, 'on_enter_flags_set', sc.on_enter_flags_set.join(', '));
  kv(dl, 'narration', `${(sc.narration ?? []).length} beat`);
  if (sc.dialogue_tree) kv(dl, 'dialogue_tree', `start=${sc.dialogue_tree.start} · nodi: ${nodeIds(sc).join(', ')}`);
  if (sc.characters?.length) {
    kv(
      dl,
      'characters',
      sc.characters
        .map((c) => {
          const g = findCharacter(ctx.story, c.id);
          return g?.name ? `${g.name} (${c.id})` : `${c.id} [non nella roster globale]`;
        })
        .join(', '),
    );
  }
  body.append(dl);

  body.append(el('h3', undefined, `azioni della scena (${sc.actions.length})`));
  if (sc.actions.length === 0) {
    body.append(el('p', 'empty', "nessuna azione: e' un finale, oppure un vicolo cieco"));
  }
  for (const a of sc.actions) {
    body.append(actionRow(sc, a, ctx));
  }
}

function actionRow(sc: Scene, a: Scene['actions'][number], ctx: PanelContext): HTMLElement {
  const st = ctx.ui.state;
  let ok = true;
  let why = '';
  if (st) {
    if (!isRepeatable(a) && st.consumed(sc.id, a.id)) {
      ok = false;
      why = "gia' usata (repeatable: false)";
    } else {
      const m = st.meets(a.condition);
      ok = m.ok;
      why = m.why;
    }
  }

  const row = el('div', 'act');
  const head = el('div', 'head');
  head.append(el('span', `mark ${ok ? 'on' : 'off'}`, ok ? '✓' : '×'));
  head.append(el('span', undefined, a.label || '(senza label)'));
  row.append(head);
  if (!ok && why) row.append(el('span', 'why', why));
  row.append(el('span', 'meta', `id: ${a.id} · condizione: ${describeCondition(a.condition)} · effetto: ${describeEffect(a.effect)}`));
  return row;
}

function renderLinter(body: HTMLElement, { findings }: PanelContext): void {
  const { errors, warnings, infos } = countFindings(findings);
  body.append(el('h3', undefined, `${errors} errori · ${warnings} avvisi · ${infos} info`));
  if (findings.length === 0) {
    body.append(el('p', 'empty', "nessuna segnalazione: la storia e' staticamente sana"));
    return;
  }
  const order: Finding['level'][] = ['errore', 'avviso', 'info'];
  for (const level of order) {
    for (const f of findings.filter((x) => x.level === level)) {
      const row = el('div', `finding ${f.level}`);
      row.append(el('span', 'lv', f.level));
      row.append(document.createTextNode(f.msg));
      if (f.where) row.append(el('span', 'where', f.where));
      body.append(row);
    }
  }
  body.append(
    el('p', 'hint', "il linter e' statico: trova le porte chiuse a chiave, non dice se la storia si gioca bene. Per quello serve giocarla."),
  );
}

function renderTraccia(body: HTMLElement, ctx: PanelContext): void {
  const trace = ctx.trace();
  body.append(el('h3', undefined, `traccia (${trace.length} passi)`));
  body.append(
    el(
      'p',
      'empty',
      "Poiche' il resolver puo' solo scegliere tra azioni gia' definite, questa sequenza descrive per intero la partita: rigiocarla e' il test di regressione della storia.",
    ),
  );
  body.append(el('pre', 'trace', trace.length ? trace.join('\n') : '(vuota)'));

  const btns = el('div', 'rowbtns');
  const copy = el('button', 'btn', 'copia');
  copy.onclick = async () => {
    // Qui la pressione non si aspetta: scrivere negli appunti richiede che il
    // gesto dell'utente sia ancora "fresco", e mettere un timer davanti alla
    // chiamata basta a farla rifiutare. Il bottone resta al suo posto, quindi
    // il tocco si vede lo stesso.
    void premi(copy).then(() => copy.classList.remove('premuto'));
    try {
      await navigator.clipboard.writeText(trace.join('\n'));
      copy.textContent = 'copiata';
      setTimeout(() => (copy.textContent = 'copia'), 1200);
    } catch {
      copy.textContent = 'selezionala a mano';
    }
  };
  // Questi tre invece rifanno il pannello sotto le proprie dita: senza la
  // trattenuta il tocco non si vedrebbe affatto, come per le chip del dock.
  const restart = el('button', 'btn', 'ricomincia');
  restart.onclick = async () => {
    await premi(restart);
    ctx.onRestart();
  };
  const other = el('button', 'btn', 'cambia IR');
  other.onclick = async () => {
    await premi(other);
    ctx.onLoadOther();
  };
  btns.append(copy, restart, other);
  body.append(btns);

  body.append(el('h3', undefined, 'rigioca uno script'));
  const ta = el('textarea');
  ta.rows = 6;
  ta.placeholder = 'a:continua\na:parla_oste\nc:d_chiave\n…';
  ta.style.width = '100%';
  ta.className = 'trace';
  body.append(ta);
  const go = el('button', 'btn primary', 'rigioca');
  go.style.marginTop = '8px';
  go.onclick = async () => {
    await premi(go);
    ctx.onReplay(ta.value);
  };
  body.append(go);
}
