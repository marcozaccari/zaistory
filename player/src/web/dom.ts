/** Micro-helper per il DOM: il player web non usa nessun framework. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function $<T extends Element = HTMLElement>(sel: string): T {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error(`elemento mancante nel documento: ${sel}`);
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/**
 * Trattiene un bottone nello stato premuto quanto basta a vederlo.
 *
 * Serve ovunque il bottone sparisca nello stesso istante del click — le chip
 * del dock, che vengono svuotate, e i bottoni del pannello che ricostruiscono
 * quello che sta loro intorno. In quei casi `:active` da solo vive qualche
 * millisecondo: non e' una questione di durata dell'animazione, e' che non
 * c'era niente da animare.
 *
 * Il ritardo si paga a ogni interazione, per questo resta corto: giusto il
 * tempo che la campitura arrivi a fondo.
 */
export const DURATA_PRESSIONE = 140;

export function premi(b: HTMLElement): Promise<void> {
  b.classList.add('premuto');
  return new Promise((r) => setTimeout(r, DURATA_PRESSIONE));
}

/** Coppia chiave/valore in una <dl class="kv">. */
export function kv(dl: HTMLElement, key: string, value: string): void {
  dl.append(el('dt', undefined, key), el('dd', undefined, value));
}
