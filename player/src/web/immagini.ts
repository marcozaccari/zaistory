/**
 * Le immagini della storia.
 *
 * L'IR non porta percorsi: porta l'**id** dell'immagine gia' prodotta per un
 * nodo (`background.image`, `narration[].image`, `characters[].image`), e la
 * corrispondenza con il file e' una convenzione — `assets/images/<id>.webp`
 * dentro la cartella della storia. Qui c'e' tutto quello che il player sa
 * sull'argomento: dove cercarle e come mostrarle.
 *
 * Perche' una **base** invece di un percorso relativo e basta: il player e'
 * un file solo, e puo' essere aperto da posti diversi dalla storia che sta
 * giocando. Con l'IR incorporato la pagina *sta* nella cartella della storia,
 * quindi la base e' la pagina stessa; con `?ir=...` la base e' la cartella di
 * quell'URL; con un file scelto a mano non esiste nessuna cartella, e allora
 * non ci sono immagini — si gioca in solo testo, come si e' sempre giocato.
 *
 * Quando un'immagine e' dichiarata ma non arriva, il player **non mette un
 * segnaposto muto**: lo dice, con l'id, come fa per ogni altro buco dell'IR.
 * Un'immagine che manca e' un dato che manca, e chi sta collaudando la storia
 * deve poterlo vedere senza aprire la console.
 *
 * ## Due modi, non un interruttore in piu'
 *
 * `testo` e `immagini` sono due modi di leggere la stessa storia, e si
 * escludono: in `testo` si vedono i prompt — cosa *verrebbe* generato, che e'
 * quello che serve mentre si lavora sull'IR — e in `immagini` si vede il
 * risultato. Mostrare tutti e due insieme sembrava gratis e non lo e': fra
 * un'inquadratura e la sua descrizione l'occhio sceglie l'immagine, il testo
 * diventa rumore lungo mezzo schermo, e la scena si legge peggio di prima.
 *
 * I prompt pero' non spariscono: restano **dentro** l'immagine, dietro un
 * bottone. Il collegamento e' quello — non "il prompt sta anche qui sotto da
 * qualche parte", ma "questo e' il testo che ha prodotto *questa* immagine".
 *
 * ## A schermo intero
 *
 * Nel transcript le immagini stanno dentro una colonna di lettura e non
 * superano mezzo schermo: e' la misura giusta per *leggere*, non per
 * *guardare*. Toccandone una si apre com'e', grande quanto lo schermo — che
 * poi e' il modo in cui la si giudica quando si sta decidendo se quell'asset
 * va bene. Si chiude con un tocco, con Esc, o con la freccia indietro del
 * telefono, dove un popup che si chiude solo con la ✕ e' il modo piu' rapido
 * di far uscire qualcuno dalla partita.
 */

import { el } from './dom.js';

/** Dove stanno gli asset di questa storia, se si sa. */
export function baseDegliAsset(irUrl?: string): string | undefined {
  try {
    // `new URL('.', x)` e' la cartella di x: l'unico modo corretto di dire
    // "accanto a questo file" senza fare i conti sulle stringhe.
    return new URL('.', irUrl ? new URL(irUrl, location.href) : location.href).href;
  } catch {
    return undefined;
  }
}

/** I due modi di leggere una storia. */
export type ModoImmagini = 'testo' | 'immagini';

/**
 * Il popup a schermo intero. Uno solo per pagina, creato alla prima apertura.
 *
 * Vive fuori dalla classe perche' non e' roba della storia: e' un pezzo di
 * interfaccia della pagina, e ce n'e' uno anche se un giorno le `Immagini`
 * diventassero due.
 */
let popup: { root: HTMLElement; img: HTMLImageElement; didascalia: HTMLElement } | undefined;
/** Chi aveva il fuoco prima: dopo la chiusura ci torna, altrimenti da tastiera
 * si riparte dall'inizio del documento a ogni immagine guardata. */
let fuocoPrecedente: HTMLElement | undefined;

function creaPopup(): NonNullable<typeof popup> {
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

  const didascalia = el('p', 'lightbox-cap');

  root.append(img, chiudi, didascalia);
  document.body.append(root);

  // Un tocco in qualunque punto chiude: a schermo intero non c'e' nient'altro
  // da fare li' dentro, e cercare la ✕ con il pollice su un telefono grande e'
  // esattamente l'attrito che questa modalita' dovrebbe togliere.
  root.onclick = chiudiPopup;
  // Anche la storia sotto continua a esistere: la rotellina non deve scorrerla
  // mentre si guarda un'immagine.
  root.onwheel = (e) => e.preventDefault();
  return { root, img, didascalia };
}

function chiudiPopup(): void {
  if (!popup || popup.root.hidden) return;
  popup.root.hidden = true;
  popup.img.removeAttribute('src');
  document.body.classList.remove('con-lightbox');
  fuocoPrecedente?.focus({ preventScroll: true });
  fuocoPrecedente = undefined;
}

/** Apre un'immagine a schermo intero. `alt` diventa la didascalia: e' il
 * prompt che l'ha prodotta, cioe' l'unica descrizione d'autore di cio' che si
 * sta guardando. */
export function apriGrande(src: string, alt?: string): void {
  popup = popup ?? creaPopup();
  fuocoPrecedente = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  popup.img.src = src;
  popup.img.alt = alt ?? '';
  popup.didascalia.textContent = alt ?? '';
  popup.didascalia.hidden = !alt;
  popup.root.hidden = false;
  document.body.classList.add('con-lightbox');
  popup.root.querySelector<HTMLElement>('.lightbox-close')?.focus({ preventScroll: true });
}

// Esc chiude. Sta qui e non nel player perche' e' il popup a saperlo fare, e
// perche' deve valere anche quando il fuoco e' finito da qualche altra parte.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && popup && !popup.root.hidden) {
    e.stopPropagation();
    chiudiPopup();
  }
});

export class Immagini {
  /** La cartella della storia. Assente: il player non sa dove cercare. */
  private base?: string;
  private attive: boolean;

  constructor(base: string | undefined, attive: boolean) {
    this.base = base;
    this.attive = attive;
  }

  get modo(): ModoImmagini {
    return this.accese ? 'immagini' : 'testo';
  }

  /** Si sa solo all'avvio, quando si sa da dove e' arrivato l'IR. */
  impostaBase(base: string | undefined): void {
    this.base = base;
  }

  /** Per il pannello: dove sta cercando, se sta cercando. */
  get cartella(): string | undefined {
    return this.base;
  }

  /** C'e' un posto dove cercarle. Non dice che esistano. */
  get disponibili(): boolean {
    return !!this.base;
  }

  get accese(): boolean {
    return this.attive && !!this.base;
  }

  imposta(v: boolean): void {
    this.attive = v;
  }

  url(id: string): string | undefined {
    if (!this.base) return undefined;
    return new URL(`assets/images/${encodeURIComponent(id)}.webp`, this.base).href;
  }

  /**
   * L'immagine di un nodo, pronta da appendere. `undefined` se non c'e'
   * niente da mostrare — nessun id, o immagini spente.
   *
   * `alt` non e' cerimonia: e' il prompt che ha prodotto l'immagine, cioe'
   * l'unica descrizione d'autore di cio' che si vede. In ascolto e' anche
   * l'unica cosa che rende quell'inquadratura udibile.
   */
  figura(id: string | undefined, alt?: string, opzioni: OpzioniFigura = {}): HTMLElement | undefined {
    if (!id || !this.accese) return undefined;
    const src = this.url(id);
    if (!src) return undefined;
    const fig = el('figure', opzioni.classe ?? 'shot');
    // La cornice esiste per una ragione sola: stringersi addosso
    // all'immagine. Quando e' l'altezza a limitarla — su desktop, dove un
    // quadrato largo quanto la colonna sarebbe alto quanto la finestra —
    // l'immagine e' piu' stretta della figura, e un bottone appoggiato
    // all'angolo *della figura* finirebbe a mezz'aria accanto a lei.
    const cornice = el('span', 'cornice');
    const img = new Image();
    img.src = src;
    img.alt = alt ?? '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // Toccarla la apre grande. E' un bottone a tutti gli effetti — si
    // raggiunge col tab e risponde a invio — ma resta un'immagine e non un
    // `<button>` intorno a un'immagine, che i lettori di schermo annunciano
    // due volte.
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.title = 'guardala a schermo intero';
    img.onclick = () => apriGrande(src, alt);
    img.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        apriGrande(src, alt);
      }
    };
    // Un id dichiarato nell'IR e un file che non arriva sono due cose
    // diverse, e la seconda va detta: senza, un errore di pubblicazione
    // sembra una scena senza immagine.
    img.onerror = () => {
      fig.replaceChildren(el('p', 'manca', `(immagine «${id}» dichiarata nell'IR ma non trovata)`));
    };
    cornice.append(img);
    fig.append(cornice);
    // Il testo che ha prodotto questa immagine, dentro la sua cornice: e' il
    // modo di dire che i due sono la stessa cosa vista da due lati. Il bottone
    // resta visibile sempre e non solo al passaggio del mouse — meta' del
    // collaudo si fa dal telefono, dove il mouse non passa mai.
    if (opzioni.prompt) {
      const box = opzioni.prompt;
      box.classList.add('prompt-box');
      box.hidden = true;
      const b = el('button', 'prompt-toggle');
      b.type = 'button';
      b.setAttribute('aria-expanded', 'false');
      const etichetta = el('span', undefined, 'prompt');
      const caret = el('span', 'caret', '▸');
      b.append(caret, etichetta);
      b.onclick = () => {
        box.hidden = !box.hidden;
        b.setAttribute('aria-expanded', String(!box.hidden));
        b.classList.toggle('aperto', !box.hidden);
        caret.textContent = box.hidden ? '▸' : '▾';
      };
      cornice.append(b);
      fig.append(box);
    }
    const sotto = el('figcaption', 'ir', id);
    fig.append(sotto);
    return fig;
  }
}

export interface OpzioniFigura {
  /** La classe della cornice: `shot` per un'inquadratura, `ritratto` per
   * un'ancora di personaggio. */
  classe?: string;
  /** Le righe di prompt che questa immagine sostituisce, da tenere a
   * disposizione dietro un bottone. */
  prompt?: HTMLElement;
}
