/** Quattro aiuti per non scrivere `document.createElement` duecento volte. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`manca #${id} nell'HTML`);
  return n as T;
}

export function clear(n: HTMLElement): void {
  while (n.firstChild) n.removeChild(n.firstChild);
}

export function show(n: HTMLElement, visible: boolean): void {
  n.hidden = !visible;
}

/** Le iniziali di un nome, per quando una faccia non ha ancora un ritratto. */
export function initials(name: string): string {
  const parts = name.replace(/^(il|lo|la|l')\s*/i, '').split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

/**
 * Trattiene un bottone nello stato premuto quanto basta a vederlo.
 *
 * Serve ovunque il bottone sparisca nello stesso istante del click — le voci
 * del dock, che vengono svuotate, e i bottoni del pannello che ricostruiscono
 * quello che sta loro intorno. In quei casi `:active` da solo vive qualche
 * millisecondo: non è una questione di durata dell'animazione, è che non
 * c'era niente da animare.
 */
export const DURATA_PRESSIONE = 140;

export function premi(b: HTMLElement): Promise<void> {
  b.classList.add('premuto');
  return new Promise((r) => setTimeout(r, DURATA_PRESSIONE));
}

/**
 * Vero se l'evento arriva da un campo di testo.
 *
 * Serve a ogni scorciatoia da tastiera che vive su `document`: lì le frecce
 * muovono il cursore, le cifre scrivono cifre e l'invio manda la frase, e una
 * scorciatoia che se li prende rompe l'unica interfaccia che il player ha.
 */
export function staScrivendo(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
}

/** Coppia chiave/valore in una <dl class="kv">. */
export function kv(dl: HTMLElement, key: string, value: string): void {
  dl.append(el('dt', undefined, key), el('dd', undefined, value));
}

/**
 * Un blocco che nasce chiuso e si apre toccandolo.
 *
 * Serve dove il player mostra elenchi da ispezionare — i flag, gli oggetti, le
 * azioni sotto il debug. Chiusi, il conto accanto al titolo dice già metà di
 * quello che si voleva sapere, e l'altra metà è a un tocco.
 *
 * Il conto è un numero quasi sempre, ma non deve esserlo: dove la domanda è «a
 * che punto siamo» invece che «quanti sono», al suo posto sta la frase che lo
 * dice.
 */
export function piega(titolo: string, quanti?: number | string): { root: HTMLDetailsElement; corpo: HTMLElement } {
  const root = el('details', 'piega');
  const testa = el('summary');
  testa.append(el('span', 'piega-titolo', titolo));
  if (quanti !== undefined) testa.append(el('span', 'piega-quanti', String(quanti)));
  const corpo = el('div', 'piega-corpo');
  root.append(testa, corpo);
  return { root, corpo };
}

/**
 * Una domanda che va risolta prima di andare avanti.
 *
 * Non usa `confirm()` del browser per due motivi che contano davvero: quel
 * riquadro blocca l'intera pagina — compresa la voce che sta leggendo, che
 * resterebbe a metà frase — e ha l'aspetto del sistema operativo, cioè di
 * qualcosa che non appartiene alla storia che si sta guardando.
 */
export function conferma(o: { titolo: string; testo: string; ok: string; annulla?: string }): Promise<boolean> {
  return new Promise((risolvi) => {
    const scrim = el('div', 'conferma-scrim');
    const card = el('div', 'conferma');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const titolo = el('h3', undefined, o.titolo);
    const id = `conferma-${Date.now()}`;
    titolo.id = id;
    card.setAttribute('aria-labelledby', id);
    card.append(titolo, el('p', undefined, o.testo));

    const btns = el('div', 'rowbtns');
    const no = el('button', 'btn', o.annulla ?? 'annulla');
    const si = el('button', 'btn primary', o.ok);
    btns.append(no, si);
    card.append(btns);
    scrim.append(card);

    const chiudi = (risposta: boolean) => {
      document.removeEventListener('keydown', suTasto, true);
      scrim.remove();
      risolvi(risposta);
    };
    const suTasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // La stessa Esc chiuderebbe anche il pannello sotto, e chi annulla una
        // domanda non ha chiesto di uscire dal menu.
        e.stopPropagation();
        chiudi(false);
      }
    };

    no.onclick = () => chiudi(false);
    si.onclick = async () => {
      await premi(si);
      chiudi(true);
    };
    scrim.onclick = (e) => {
      if (e.target === scrim) chiudi(false);
    };
    document.addEventListener('keydown', suTasto, true);

    document.body.append(scrim);
    // Il fuoco va sulla risposta prudente: un invio partito per inerzia non
    // deve poter cancellare la partita.
    no.focus();
  });
}
