/**
 * Il giro dei caratteri: l'unica scelta di lettura ancora aperta.
 *
 * Non è un tema e non è una palette — quelle sono decise, una sola e scura, e
 * la gerarchia delle voci del testo è uscita da una prova a sei varianti di cui
 * in `styles.css` resta la vincitrice. Qui si sceglie una cosa sola: **con
 * quale carattere è scritta la prosa d'autore**.
 *
 * Cosa non tocca, e non è una svista: le battute stanno al monospazio perché
 * fanno il paio con il graziato della narrazione — graziato contro passo fisso
 * è il salto più netto della pagina, ed è quello fra chi racconta e chi parla;
 * i prompt e l'interfaccia stanno nel bastoni perché non sono una scelta di
 * lettura ma il modo in cui il player dice «questo non è la storia».
 *
 * Tre e non cinque. Un giro corto si prova tutto: più è lungo e più è probabile
 * fermarsi al primo che non disturba. Due graziati che si giudicano uno contro
 * l'altro, e il bastoni di sistema che fa da termine di paragone — se leggendo
 * con quello non manca niente, il graziato non stava facendo il lavoro che gli
 * si attribuisce.
 *
 * Nessun font esterno: sono pile di caratteri che i sistemi hanno già. La
 * regola del file unico non cambia per un menu di prova.
 */

import { el } from './dom.js';
import { icona } from './icons.js';

export const FONT_VALIDI = ['charter', 'schoolbook', 'sistema'] as const;
export type Font = (typeof FONT_VALIDI)[number];

const CHIAVE = 'zaistory:font';

export class Fonts {
  private corrente: Font = 'charter';

  /** `dopo` serve al bottone del piede: da lì il giro chiude il menu, perché su
   * telefono il pannello copre per intero la pagina su cui si sta decidendo —
   * chiudere è il gesto che fa vedere la scelta. Il bottone in barra non chiude
   * niente perché lì la pagina si vede già. */
  constructor(
    private readonly bottoni: HTMLButtonElement[],
    private readonly dopo?: (b: HTMLButtonElement) => void,
  ) {
    this.corrente = leggi();
    for (const b of bottoni) {
      b.addEventListener('click', () => {
        this.avanti();
        this.dopo?.(b);
      });
    }
    this.applica();
  }

  get font(): Font {
    return this.corrente;
  }

  set(f: Font): void {
    this.corrente = FONT_VALIDI.includes(f) ? f : 'charter';
    this.applica();
  }

  private avanti(): void {
    const i = FONT_VALIDI.indexOf(this.corrente);
    this.corrente = FONT_VALIDI[(i + 1) % FONT_VALIDI.length];
    this.applica();
  }

  private applica(): void {
    document.body.dataset.font = this.corrente;
    try {
      localStorage.setItem(CHIAVE, this.corrente);
    } catch {
      // Una scheda in incognito: si gioca lo stesso, si riparte da Charter.
    }
    const etichetta = `carattere: ${this.corrente}`;
    for (const b of this.bottoni) {
      b.replaceChildren();
      const segno = icona('font');
      if (segno) b.append(segno);
      b.append(el('span', 'nome', this.corrente));
      b.title = etichetta;
      b.setAttribute('aria-label', etichetta);
    }
  }
}

function leggi(): Font {
  try {
    const v = localStorage.getItem(CHIAVE);
    if (v && (FONT_VALIDI as readonly string[]).includes(v)) return v as Font;
  } catch {
    // niente
  }
  return 'charter';
}
