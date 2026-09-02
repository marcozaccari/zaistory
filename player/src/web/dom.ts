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

/**
 * Vero se l'evento arriva da un campo di testo.
 *
 * Serve a ogni scorciatoia da tastiera che vive su `document`: li' le frecce
 * muovono il cursore, lo spazio scrive uno spazio e l'invio manda la frase, e
 * una scorciatoia che se li prende rompe l'unica interfaccia che il player ha.
 * Sta qui e non in un modulo solo perche' se ne servono due — la barra delle
 * scorciatoie e il tap-to-continue — e due copie divergono.
 */
export function staScrivendo(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
}

/**
 * Un blocco che nasce chiuso e si apre toccandolo.
 *
 * Serve dove il player mostra *elenchi da ispezionare* — la roster, i luoghi,
 * i flag, gli oggetti, le azioni sotto il debug. Sono cose che vanno esistere
 * nel documento, perche' senza di loro il debug non direbbe niente, ma che
 * aperte tutte insieme sono mezzo schermo di elenco fra chi legge e cio' che
 * stava leggendo. Chiuse, il conto accanto al titolo dice gia' la meta' di
 * quello che si voleva sapere — «quanti personaggi ha questa storia» — e
 * l'altra meta' e' a un tocco.
 *
 * `<details>` nativo e non un bottone fatto a mano: si apre con la tastiera,
 * lo screen reader lo annuncia per quello che e', e la ricerca del browser lo
 * trova anche chiuso. Un finto accordion costa codice per fare peggio.
 */
export function piega(titolo: string, quanti?: number): { root: HTMLDetailsElement; corpo: HTMLElement } {
  const root = el('details', 'piega');
  const testa = el('summary');
  testa.append(el('span', 'piega-titolo', titolo));
  if (quanti !== undefined) testa.append(el('span', 'piega-quanti', String(quanti)));
  const corpo = el('div', 'piega-corpo');
  root.append(testa, corpo);
  return { root, corpo };
}

/** Coppia chiave/valore in una <dl class="kv">. */
export function kv(dl: HTMLElement, key: string, value: string): void {
  dl.append(el('dt', undefined, key), el('dd', undefined, value));
}

/**
 * Una domanda che va risolta prima di andare avanti.
 *
 * Non usa `confirm()` del browser per due motivi che contano davvero: quel
 * riquadro blocca l'intera pagina — compresa la voce che sta leggendo, che
 * resterebbe a meta' frase — e ha l'aspetto del sistema operativo, cioe' di
 * qualcosa che non appartiene alla storia che si sta guardando. Questo invece
 * e' un pezzo di player come gli altri: prende i colori del tema, si chiude con
 * Esc o toccando fuori, e la risposta prudente e' gia' sotto il dito.
 *
 * Serve dove un tocco distratto costa la partita. Non e' una cortesia: da
 * quando la partita si puo' salvare, «ricomincia» e' l'unico bottone del player
 * che possa buttare via qualcosa di irrecuperabile.
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
        // `stopPropagation`: la stessa Esc chiuderebbe anche il pannello
        // sotto, e chi annulla una domanda non ha chiesto di uscire dal menu.
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
