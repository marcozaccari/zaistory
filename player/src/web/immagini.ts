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
 * ## Due posti, non uno
 *
 * Le **inquadrature** — la scena e i suoi beat — non stanno qui dentro: vanno
 * sul palco (`palco.ts`), ferme in cima allo schermo, perche' dicono *dove si
 * e'* e non *cosa e' successo un momento fa*. Qui restano le immagini che sono
 * riferimenti dentro un discorso: l'icona di un oggetto che si sta guardando,
 * e la locandina in testa alla copertina. Quelle nel flusso ci stanno bene,
 * perche' appartengono alla riga accanto a cui compaiono. Il ritratto di un
 * personaggio invece e' salito sul palco, dove risponde alla domanda mentre la
 * si ha, invece che una volta sola all'ingresso in scena.
 *
 * ## A schermo intero
 *
 * Nel transcript e sul palco un'immagine sta dentro la misura di chi legge.
 * Toccandola si apre com'e', grande quanto lo schermo — che poi e' il modo in
 * cui la si giudica quando si sta decidendo se quell'asset va bene. Si chiude
 * con un tocco, con Esc, o con la freccia indietro del telefono, dove un popup
 * che si chiude solo con la ✕ e' il modo piu' rapido di far uscire qualcuno
 * dalla partita.
 */

import { el } from './dom.js';
import { promptNudi, type PromptRow } from './prompt.js';

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
let popup:
  | { root: HTMLElement; img: HTMLImageElement; titolo: HTMLElement; didascalia: HTMLElement }
  | undefined;
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

  const titolo = el('p', 'lightbox-titolo');
  const didascalia = el('div', 'lightbox-cap');

  root.append(img, chiudi, titolo, didascalia);
  document.body.append(root);

  // Un tocco in qualunque punto chiude: a schermo intero non c'e' nient'altro
  // da fare li' dentro, e cercare la ✕ con il pollice su un telefono grande e'
  // esattamente l'attrito che questa modalita' dovrebbe togliere.
  root.onclick = chiudiPopup;
  // Anche la storia sotto continua a esistere: la rotellina non deve scorrerla
  // mentre si guarda un'immagine.
  root.onwheel = (e) => e.preventDefault();
  return { root, img, titolo, didascalia };
}

function chiudiPopup(): void {
  if (!popup || popup.root.hidden) return;
  popup.root.hidden = true;
  popup.img.removeAttribute('src');
  document.body.classList.remove('con-lightbox');
  fuocoPrecedente?.focus({ preventScroll: true });
  fuocoPrecedente = undefined;
}

/**
 * Cosa si guarda quando si allarga qualcosa.
 *
 * `src` puo' mancare, e non e' un caso limite: in solo testo — o prima che le
 * immagini siano state generate — allargare un'inquadratura o un personaggio
 * deve comunque portare ai suoi prompt, perche' e' li' che adesso vivono. Con
 * l'immagine si guarda il risultato, senza si legge cosa lo produrra'.
 */
export interface Lente {
  src?: string;
  /** Di chi o di cosa si sta guardando: il nome del personaggio, il titolo
   * della scena. */
  titolo?: string;
  /** I prompt che descrivono cio' che si sta guardando, col nome che hanno
   * nell'IR. */
  righe?: PromptRow[];
}

/**
 * Apre a schermo intero.
 *
 * La didascalia non e' cerimonia: sono i prompt che hanno prodotto — o che
 * produrranno — cio' che si sta guardando, ed e' guardandoli accanto
 * all'immagine grande che si decide se l'asset va bene. Nel transcript non ci
 * sono piu': li' resterebbero a scorrere via, qui stanno attaccati alla cosa
 * di cui parlano.
 */
export function apriGrande(lente: Lente): void {
  popup = popup ?? creaPopup();
  fuocoPrecedente = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;

  const righe = lente.righe ?? [];
  // L'`alt` dell'immagine grande resta il primo prompt: e' la descrizione
  // d'autore di cio' che si vede, e per chi non vede e' l'unica.
  const primo = righe.find((r) => typeof r[1] === 'string')?.[1];

  if (lente.src) {
    popup.img.src = lente.src;
    popup.img.alt = typeof primo === 'string' ? primo : (lente.titolo ?? '');
    popup.img.hidden = false;
  } else {
    popup.img.removeAttribute('src');
    popup.img.hidden = true;
  }

  popup.titolo.textContent = lente.titolo ?? '';
  popup.titolo.hidden = !lente.titolo;

  const box = promptNudi(righe);
  popup.didascalia.replaceChildren(...(box ? [box] : []));
  popup.didascalia.hidden = !box;

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
  figura(id: string | undefined, alt: string | undefined, opzioni: OpzioniFigura): HTMLElement | undefined {
    if (!id || !this.accese) return undefined;
    const src = this.url(id);
    if (!src) return undefined;
    const fig = el('figure', opzioni.classe);
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
    const guarda = () => apriGrande({ src, titolo: opzioni.titolo, righe: opzioni.righe });
    img.onclick = guarda;
    img.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        guarda();
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
    // Niente bottone per aprire i prompt qui sotto. C'era, e faceva una cosa
    // che l'immagine grande fa gia' meglio: allargandola i prompt si leggono
    // per didascalia, accanto a cio' che descrivono e nel momento in cui
    // servono — quando si sta decidendo se quell'asset va bene. Due strade per
    // la stessa lettura sono una di troppo, e questa costava una pastiglia
    // appoggiata sull'angolo di ogni figura.
    const sotto = el('figcaption', 'ir', id);
    fig.append(sotto);
    return fig;
  }
}

export interface OpzioniFigura {
  /** La classe della figura: `figura-oggetto` per l'icona di una cosa che si
   * sta guardando, `locandina` per la copertina della storia. Obbligatoria: da
   * quando le inquadrature vivono sul palco non esiste piu' una figura
   * "normale" a cui ricadere, e un default silenzioso sarebbe una classe che
   * il CSS non conosce. */
  classe: string;
  /** Di cosa e' l'immagine: diventa il titolo della lente a schermo intero. */
  titolo?: string;
  /** Gli stessi prompt, dentro la lente: allargare un'immagine e' il modo di
   * guardarla per decidere se va bene, e li' il prompt serve accanto. */
  righe?: PromptRow[];
}
