/**
 * Dove stanno le immagini.
 *
 * La storia le nomina per **id**, mai per percorso: è il player a comporre
 * `assets/images/<id>.webp` relativo alla cartella della storia. Così il file
 * resta trasportabile e non nomina né file su disco né generatori.
 *
 * Quale sia quella cartella lo decide **da dove è arrivata la storia**, e non
 * c'è nessun modo di indovinarlo in un caso: una storia scelta a mano non ha
 * una cartella intorno, e lì si gioca in solo testo. Il pannello lo dice,
 * invece di lasciar credere che le immagini siano rotte.
 */

export type Origin =
  | { kind: 'embedded' }
  | { kind: 'url'; href: string }
  | { kind: 'hand' };

export class Images {
  /** La cartella in cui cercare, o niente se non esiste una storia intorno. */
  readonly base?: string;
  /** Gli id dichiarati e non trovati: si dicono, invece di mettere un
   * segnaposto muto. È l'unico modo di accorgersi di una pubblicazione
   * parziale senza aprire la console. */
  readonly missing = new Set<string>();

  /** Spento da chi gioca: la storia ha le immagini, ma adesso si vuole leggere
   * quello che verrebbe generato. */
  off = false;

  constructor(origin: Origin, private readonly declared: boolean) {
    if (origin.kind === 'embedded') this.base = dirOf(location.href);
    else if (origin.kind === 'url') this.base = dirOf(new URL(origin.href, location.href).href);
  }

  /** La storia ha immagini pubblicate e sappiamo dove cercarle? Se no, non si
   * mostra nessun interruttore: uno che non cambia niente è peggio della sua
   * assenza — chi lo trova lo prova, non vede succedere nulla e conclude che
   * il player è rotto. */
  get available(): boolean {
    return this.declared && this.base !== undefined;
  }

  /** Si mostrano adesso? */
  get usable(): boolean {
    return this.available && !this.off;
  }

  /** Perché non si può scegliere, detto a parole. */
  get why(): string {
    if (!this.declared) return 'questa storia non ha ancora immagini pubblicate';
    if (!this.base) return 'la storia è stata aperta a mano: non c\'è una cartella in cui cercare le immagini';
    return '';
  }

  url(id: string | undefined): string | undefined {
    if (!id || !this.base) return undefined;
    return `${this.base}assets/images/${id}.webp`;
  }

  /**
   * Un'immagine, oppure niente.
   *
   * Se il file non c'è **si dice**, con il suo id: stessa regola del testo
   * mancante, il player non mette segnaposti muti. È l'unico modo di
   * accorgersi di una pubblicazione parziale senza aprire la console. Chi
   * chiama può passare un `onMissing` per rimettere al suo posto quello che
   * l'immagine avrebbe sostituito — il prompt — invece di lasciare un buco.
   */
  element(id: string | undefined, alt: string, onMissing?: (id: string) => void): HTMLImageElement | undefined {
    const src = this.url(id);
    if (!src || !id) return undefined;
    const img = new Image();
    img.src = src;
    img.alt = alt;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      this.missing.add(id);
      img.remove();
      onMissing?.(id);
    });
    return img;
  }
}

function dirOf(href: string): string {
  const u = new URL(href);
  u.hash = '';
  u.search = '';
  u.pathname = u.pathname.replace(/[^/]*$/, '');
  return u.href;
}

/** La storia dichiara almeno un'immagine pubblicata? */
export function hasPublishedImages(story: unknown): boolean {
  return JSON.stringify(story).includes('"image"');
}
