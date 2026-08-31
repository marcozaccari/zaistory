/**
 * Il palco: l'inquadratura corrente, ferma in alto.
 *
 * Fino a ieri le immagini scorrevano dentro il transcript come il testo, ed
 * era la scelta giusta finche' il player era un resoconto da leggere. Con le
 * immagini pubblicate non lo e' piu': l'inquadratura e' *dove si e'*, non una
 * cosa detta un momento fa, e in una cutscene di nove beat quella di adesso
 * usciva dallo schermo appena si scorreva per leggere la riga sotto. Chi gioca
 * si trovava a fare avanti e indietro fra il testo e la figura che lo
 * illustra: due movimenti per una cosa sola.
 *
 * Da qui in avanti l'inquadratura sta ferma in cima e il testo le scorre
 * sotto. **Ogni immagine nuova prende il posto della precedente**: il palco e'
 * uno, e mostra sempre l'ultima cosa che si e' vista. Un nodo senza `image`
 * non lo svuota — si resta dove si era, che e' esattamente cio' che succede in
 * una stanza dove non e' cambiata l'inquadratura.
 *
 * ## Perche' si collassa, e in due stati soltanto
 *
 * Un'immagine ferma in alto costa altezza al testo, e quanta ne costa dipende
 * da cosa si sta facendo: in un dialogo lungo serve leggere, davanti a una
 * scena nuova serve guardare. La maniglia sotto il palco alterna fra le due
 * misure e basta — grande e ridotta. Tre stati (o un trascinamento ad altezza
 * libera) sembravano piu' ricchi e sono un'altra cosa da imparare per una
 * decisione che ha due risposte: "voglio vederla" e "adesso no".
 *
 * Ridotto e non chiuso, di proposito: chiuderla del tutto e' gia' possibile e
 * si chiama spegnere le immagini, che e' una scelta sulla storia e sta nel
 * pannello. La maniglia e' una scelta sul momento.
 *
 * ## Cosa il palco non fa
 *
 * Non porta i prompt. Restano nel transcript, dove sono il resoconto di cio'
 * che l'IR dichiara — collassati su una riga, perche' l'immagine li mostra
 * gia'. Il prompt di *questa* inquadratura si legge dove si guarda
 * l'inquadratura: a schermo intero, come didascalia, che e' il posto dove si
 * decide se l'asset va bene.
 */

import { el } from './dom.js';
import { apriGrande, type Immagini } from './immagini.js';

export class Palco {
  private root: HTMLElement;
  private tela: HTMLElement;
  private maniglia: HTMLButtonElement;
  private immagini: Immagini;
  private ridotto = false;
  /**
   * L'id dell'inquadratura in scena.
   *
   * Serve a non riassegnare `src` quando due beat di fila condividono
   * l'immagine: riassegnarlo fa ripartire la decodifica e il palco sfarfalla
   * per un fotogramma su una figura che non e' cambiata.
   */
  private corrente?: string;

  constructor(root: HTMLElement, immagini: Immagini) {
    this.root = root;
    this.immagini = immagini;
    this.tela = dentro(root, '.palco-tela');
    this.maniglia = dentro<HTMLButtonElement>(root, '.palco-maniglia');
    this.maniglia.onclick = () => {
      this.ridotto = !this.ridotto;
      this.applica();
    };
    this.applica();
  }

  /**
   * Porta un'inquadratura sul palco. Vero se c'e' finita davvero: `false`
   * quando non c'e' un id, quando le immagini sono spente o quando non si sa
   * dove cercarle — e in quel caso chi chiama sa che i prompt vanno mostrati
   * per intero, perche' non c'e' nessuna immagine a mostrarli al posto loro.
   */
  mostra(id: string | undefined, alt?: string): boolean {
    if (!id || !this.immagini.accese) return false;
    const src = this.immagini.url(id);
    if (!src) return false;
    this.root.hidden = false;
    document.body.classList.add('con-palco');
    if (id === this.corrente) return true;
    this.corrente = id;

    const img = new Image();
    img.src = src;
    // `alt` e' l'image_prompt: l'unica descrizione d'autore di cio' che si
    // vede, e in ascolto l'unica cosa che rende udibile un'inquadratura.
    img.alt = alt ?? '';
    img.decoding = 'async';
    // Toccarla la apre grande, con il prompt per didascalia. Resta
    // un'immagine e non un bottone intorno a un'immagine, che i lettori di
    // schermo annunciano due volte.
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
    // Un id dichiarato nell'IR e un file che non arriva sono due cose diverse,
    // e la seconda va detta: senza, una pubblicazione parziale sembra una
    // scena senza immagine.
    img.onerror = () => {
      this.tela.replaceChildren(el('p', 'manca', `(immagine «${id}» dichiarata nell'IR ma non trovata)`));
    };

    // L'id sotto l'immagine, come sotto le figure del transcript: si vede solo
    // a debug acceso, e li' e' il modo di sapere quale file si sta guardando
    // senza aprire il pannello.
    this.tela.replaceChildren(img, el('p', 'ir palco-id', id));
    return true;
  }

  /**
   * Il palco torna vuoto e sparisce.
   *
   * Due momenti soli: una partita nuova — la precedente e' finita, e l'ultima
   * inquadratura di quella non e' la prima di questa — e le immagini spente,
   * dove un pannello che resta acceso sarebbe l'interruttore che non fa
   * niente.
   */
  svuota(): void {
    this.corrente = undefined;
    this.tela.replaceChildren();
    this.root.hidden = true;
    document.body.classList.remove('con-palco');
  }

  private applica(): void {
    // Le due misure stanno nel CSS e non qui: su telefono il collasso toglie
    // altezza, su schermo largo toglie larghezza alla colonna dell'immagine, e
    // quale delle due lo decide la media query.
    document.body.classList.toggle('palco-ridotto', this.ridotto);
    this.maniglia.setAttribute('aria-expanded', String(!this.ridotto));
    const etichetta = this.ridotto ? "allarga l'immagine" : "riduci l'immagine";
    this.maniglia.setAttribute('aria-label', etichetta);
    this.maniglia.title = etichetta;
  }
}

function dentro<T extends Element = HTMLElement>(root: HTMLElement, sel: string): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`elemento mancante nel palco: ${sel}`);
  return node;
}
