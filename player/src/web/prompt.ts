/**
 * Le righe di prompt: l'unico modo in cui il player scrive un campo dell'IR.
 *
 * Stavano dentro `webui.ts` finche' il transcript era l'unico posto che le
 * mostrava. Da quando i prompt visivi vivono sul palco e dentro la lente a
 * schermo intero i posti sono tre, e tre copie della stessa etichetta
 * divergono al primo campo aggiunto: la tabella dei nomi umani sta in
 * `nomi.ts`, il segno in `icone.ts`, e l'impaginazione qui.
 */

import { el } from './dom.js';
import { icona, iconaGruppo } from './icone.js';
import { nomeCampo, type Doppio } from './nomi.js';

/** Il tipo di risorsa che un prompt descrive: da' il colore all'etichetta, e
 * basta scorrere per vedere dove mancano le immagini o i suoni.
 * `none` e' per i parametri che non sono prompt di generazione (il tono). */
export type Media = 'image' | 'sound' | 'voice' | 'music' | 'none';

/**
 * [nome del campo nell'IR, valore, tipo di media, ereditato?]
 *
 * `ereditato` marca un valore gia' scritto per intero piu' su — perche'
 * l'inquadratura lo riceve dalla scena, o perche' e' la stessa descrizione
 * gia' letta a una comparsa precedente: si mostra su una riga sola, troncata,
 * e si apre toccandola.
 */
export type PromptRow = [string, string | Doppio | undefined, Media, boolean?];

/** Una riga con un valore: quello che resta dopo aver scartato i campi vuoti. */
type RigaPiena = [string, string | Doppio, Media, boolean?];

function piene(rows: PromptRow[]): RigaPiena[] {
  return rows.filter((r): r is RigaPiena => !!r[1]);
}

/**
 * L'etichetta del campo: il segno del suo tipo di media, poi il nome — quello
 * per chi legge e quello che il campo ha nell'IR, tutti e due nel documento.
 * Quale dei due si veda lo decide il debug, dal CSS.
 */
export function etichetta(label: string, media: Media): HTMLElement {
  const span = el('span', 'label');
  const segno = icona(media);
  if (segno) span.append(segno);
  span.append(el('span', 'umano', nomeCampo(label)), el('span', 'ir', label));
  return span;
}

/** Un valore che porta un id dentro: il nome a chi legge, l'id a chi ispeziona. */
export function valore(v: string | Doppio): Node {
  if (typeof v === 'string') return document.createTextNode(v);
  const span = el('span');
  span.append(el('span', 'umano', v.umano), el('span', 'ir', v.ir));
  return span;
}

export function promptRow([label, value, media, ereditato]: RigaPiena): HTMLElement {
  if (!ereditato) {
    const row = el('span', `prompt m-${media}`);
    row.append(etichetta(label, media), valore(value));
    return row;
  }

  // Ereditato: il testo per intero e' gia' passato piu' su, ma un blocco che non
  // contiene tutti i suoi ingredienti costringe a risalire per sapere cosa
  // verra' generato. Una riga sola lo ricorda senza allagare la pagina — il
  // paragrafo di un luogo tornerebbe fino a cinque volte nella stessa scena.
  const row = el('button', `prompt m-${media} ereditato`);
  row.type = 'button';
  row.setAttribute('aria-expanded', 'false');
  // Il triangolino sta prima del testo: in coda se lo mangerebbe il
  // troncamento, cioe' sparirebbe esattamente quando serve a dire "c'e'
  // dell'altro, toccami".
  const caret = el('span', 'caret', '▸');
  row.append(etichetta(label, media), caret, valore(value));
  row.onclick = () => {
    const aperto = row.classList.toggle('aperto');
    row.setAttribute('aria-expanded', String(aperto));
    caret.textContent = aperto ? '▾' : '▸';
  };
  return row;
}

/**
 * Le righe senza intestazione, pronte a stare dentro una figura o una lente.
 *
 * Niente nome del gruppo qui: il gruppo e' l'immagine che le contiene, e
 * ripetere «ambientazione» sopra a un'inquadratura che si sta guardando non
 * aggiunge niente.
 */
export function promptNudi(rows: PromptRow[]): HTMLElement | undefined {
  const present = piene(rows);
  if (present.length === 0) return undefined;
  const box = el('div');
  for (const row of present) box.append(promptRow(row));
  return box;
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
export function promptGroup(
  name: string,
  rows: PromptRow[],
  who?: string,
  /** Un elemento da tenere nel gruppo anche quando non c'e' nessuna riga. */
  extra?: HTMLElement,
): HTMLElement | undefined {
  const present = piene(rows);
  if (present.length === 0 && !extra) return undefined;
  const box = el('div', 'group');
  const head = el('span', 'gname');
  const segno = iconaGruppo(name);
  if (segno) head.append(segno);
  // A chi legge, un gruppo che ha un nome proprio si chiama con quello: il
  // personaggio e' «Mark», non `characters.mark` seguito da Mark.
  head.append(el('span', 'umano', who ?? nomeCampo(name)));
  const ir = el('span', 'ir', name);
  if (who) ir.append(el('span', 'who', who));
  head.append(ir);
  box.append(head);
  for (const row of present) box.append(promptRow(row));
  if (extra) box.append(extra);
  return box;
}
