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

/** Coppia chiave/valore in una <dl class="kv">. */
export function kv(dl: HTMLElement, key: string, value: string): void {
  dl.append(el('dt', undefined, key), el('dd', undefined, value));
}
