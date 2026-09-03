/**
 * La lente: quello che si sta guardando, grande quanto lo schermo.
 *
 * Nel trascritto e sul palco un'immagine sta dentro la misura di chi legge.
 * Toccandola si apre com'è — che poi è il modo in cui la si giudica quando si
 * sta decidendo se quell'asset va bene. Si chiude con un tocco in qualunque
 * punto, con la ✕ o con Esc: a schermo intero non c'è nient'altro da fare lì
 * dentro, e cercare la ✕ con il pollice su un telefono grande è esattamente
 * l'attrito che questa modalità dovrebbe togliere.
 *
 * **La didascalia non è cerimonia**: sono i prompt che hanno prodotto — o che
 * produrranno — ciò che si sta guardando, ed è guardandoli accanto all'immagine
 * grande che si decide se l'asset va bene. È anche il motivo per cui la lente
 * si apre **anche senza immagine**: in solo testo, o prima che gli asset
 * esistano, allargare un'inquadratura o un personaggio deve comunque portare
 * ai suoi prompt, perché è lì che vivono.
 *
 * Ce n'è una sola per pagina, creata alla prima apertura: è un pezzo
 * d'interfaccia della pagina, non della storia.
 */

import { el } from './dom.js';
import { promptNudi, type PromptRow } from './prompt.js';

/** Cosa si guarda quando si allarga qualcosa. */
export interface Lente {
  /** Può mancare: senza immagine restano il titolo e i prompt. */
  src?: string;
  /** Di chi o di cosa: il nome del personaggio, dell'oggetto, del luogo. */
  titolo?: string;
  /** I prompt che descrivono ciò che si sta guardando, col nome che hanno
   * nella storia. */
  righe?: PromptRow[];
  /**
   * Fuori dal debug non si mostra altro che l'immagine.
   *
   * Le altre si aprono grandi *per essere giudicate*, e il prompt accanto è
   * metà del giudizio. Col debug il testo torna comunque, perché lì ogni
   * immagine è un asset da decidere.
   */
  soloImmagine?: boolean;
  /**
   * Fuori dal debug le righe si leggono senza il nome del campo.
   *
   * Serve dove la riga è una sola e il campo si capisce da ciò che si sta
   * guardando: un oggetto tirato fuori dallo zaino ha una descrizione e basta,
   * e premetterle «aspetto» è etichettare l'unica cosa in pagina.
   */
  senzaEtichette?: boolean;
}

interface Nodi {
  root: HTMLElement;
  img: HTMLImageElement;
  titolo: HTMLElement;
  didascalia: HTMLElement;
}

let nodi: Nodi | undefined;
/** Chi aveva il fuoco prima: dopo la chiusura ci torna, altrimenti da tastiera
 * si riparte dall'inizio del documento a ogni immagine guardata. */
let fuocoPrecedente: HTMLElement | undefined;

function crea(): Nodi {
  const root = el('div', 'lightbox');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'immagine a schermo intero');

  const img = new Image();
  img.className = 'lightbox-img';
  img.decoding = 'async';

  const chiudi = el('button', 'lightbox-close', '✕');
  chiudi.type = 'button';
  chiudi.setAttribute('aria-label', 'chiudi');

  const titolo = el('p', 'lightbox-titolo');
  const didascalia = el('div', 'lightbox-cap');

  // L'ordine conta: il foglio di stile rimette la didascalia in alto quando
  // l'immagine è nascosta, e per farlo la cerca come sorella *dopo* di lei.
  root.append(img, chiudi, titolo, didascalia);
  document.body.append(root);

  root.onclick = chiudiLente;
  // La storia sotto continua a esistere: la rotellina non deve scorrerla
  // mentre si guarda un'immagine.
  root.onwheel = (e) => e.preventDefault();

  nodi = { root, img, titolo, didascalia };
  return nodi;
}

function chiudiLente(): void {
  if (!nodi || nodi.root.hidden) return;
  nodi.root.hidden = true;
  // Via il `src`: un'immagine grande che resta in memoria è la stessa che il
  // browser ridisegna alla prossima apertura, prima di quella giusta.
  nodi.img.removeAttribute('src');
  fuocoPrecedente?.focus({ preventScroll: true });
  fuocoPrecedente = undefined;
}

/** La lente è aperta adesso? Serve a chi ha una sua Esc: chiudere l'immagine
 * non deve chiudere anche il cassetto che sta sotto. */
export function lenteAperta(): boolean {
  return !!nodi && !nodi.root.hidden;
}

/** Apre la lente. */
export function apriGrande(lente: Lente): void {
  const n = nodi ?? crea();
  fuocoPrecedente = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;

  const righe = lente.righe ?? [];
  // L'`alt` dell'immagine grande resta il primo prompt: è la descrizione
  // d'autore di ciò che si vede, e per chi non vede è l'unica.
  const primo = righe.find((r) => typeof r[1] === 'string')?.[1];

  if (lente.src) {
    n.img.src = lente.src;
    n.img.alt = typeof primo === 'string' ? primo : (lente.titolo ?? '');
    n.img.hidden = false;
  } else {
    n.img.removeAttribute('src');
    n.img.hidden = true;
  }

  n.titolo.textContent = lente.titolo ?? '';
  n.titolo.hidden = !lente.titolo;

  const box = promptNudi(righe);
  n.didascalia.replaceChildren(...(box ? [box] : []));
  n.didascalia.hidden = !box;

  // La scelta la fa il CSS, non questo codice: accendere il debug mentre la
  // lente è aperta deve bastare a far comparire il testo, senza riaprirla.
  n.root.classList.toggle('nuda', !!lente.soloImmagine);
  n.root.classList.toggle('senza-etichette', !!lente.senzaEtichette);
  n.root.hidden = false;
  n.root.querySelector<HTMLElement>('.lightbox-close')?.focus({ preventScroll: true });
}

// Esc chiude. Sta qui e non nel player perché è la lente a saperlo fare, e
// perché deve valere anche quando il fuoco è finito da qualche altra parte.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && nodi && !nodi.root.hidden) {
    // La stessa Esc chiuderebbe il pannello sotto, e chi chiude un'immagine
    // non ha chiesto di uscire dal menu.
    e.stopPropagation();
    chiudiLente();
  }
});
