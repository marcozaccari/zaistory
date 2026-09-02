/**
 * Il palco: l'inquadratura corrente e cio' che la descrive, fermi in alto.
 *
 * Fino a ieri le immagini scorrevano dentro il transcript come il testo, ed
 * era la scelta giusta finche' il player era un resoconto da leggere. Con le
 * immagini pubblicate non lo e' piu': l'inquadratura e' *dove si e'*, non una
 * cosa detta un momento fa, e in una cutscene di nove beat quella di adesso
 * usciva dallo schermo appena si scorreva per leggere la riga sotto.
 *
 * Da qui in avanti l'inquadratura sta ferma in cima e il testo le scorre
 * sotto. **Ogni immagine nuova prende il posto della precedente**: il palco e'
 * uno, e mostra sempre l'ultima cosa che si e' vista. Un nodo senza `image`
 * non lo svuota — si resta dove si era, che e' esattamente cio' che succede in
 * una stanza dove non e' cambiata l'inquadratura.
 *
 * ## Cosa il palco porta, e perche' non e' solo l'immagine
 *
 * Porta tutto cio' che *si guarda*: la figura, il **tono** della scena, dove
 * siamo, chi e' in campo, e le facce del cast di scena di lato. La ragione e'
 * la stessa per cui l'immagine e' salita quassu': sono le coordinate
 * dell'inquadratura, cioe' la risposta a «dove sono e chi ho davanti», e una
 * risposta che scorre via col transcript costringe a risalire proprio mentre
 * si sta guardando la figura che la illustra.
 *
 * In basso, nel transcript, resta cio' che *si ascolta e si legge*: la
 * narrazione, il parlato, l'ambiente sonoro, gli effetti, i timbri di
 * narrazione. Un'immagine non li mostra, e sono l'unico modo di sapere che
 * esistono.
 *
 * ## I prompt stanno dentro la cosa che descrivono
 *
 * Non su una riga a parte: si aprono allargando cio' a cui appartengono —
 * l'inquadratura si tocca e si apre grande con `image_prompt` e l'aspetto del
 * luogo per didascalia, una faccia si tocca e si apre con `visual_prompt` e il
 * timbro di quel personaggio. E' il collegamento piu' corto possibile fra un
 * asset e il testo che lo produce, ed e' anche il momento in cui serve: quando
 * si sta decidendo se quell'asset va bene.
 *
 * Il tono invece **non** si nasconde dietro un tocco, mai: non e' un prompt di
 * generazione ma la chiave di lettura di tutto quello che c'e' sotto, e vale
 * per la scena intera.
 *
 * ## Il palco c'e' sempre, anche senza immagini
 *
 * In solo testo — immagini spente, o storia non ancora illustrata — al posto
 * della figura c'e' il prompt dell'inquadratura, e al posto delle facce le
 * iniziali. Un posto solo dove guardare in tutte e due le modalita': la testa
 * dello schermo dice sempre dove siamo, cambia solo se lo dica con un'immagine
 * o con le parole che la produrranno.
 *
 * ## Perche' si riduce, e in due stati soltanto
 *
 * Un'immagine ferma in alto costa altezza al testo, e quanta ne costa dipende
 * da cosa si sta facendo: in un dialogo lungo serve leggere, davanti a una
 * scena nuova serve guardare. La maniglia sotto il palco alterna fra le due
 * misure e basta — grande e ridotta. Ridotto e non chiuso, di proposito:
 * chiuderlo del tutto e' gia' possibile e si chiama spegnere le immagini, che
 * e' una scelta sulla storia e sta nel pannello. La riga del tono resta
 * visibile anche da ridotto: e' cio' che il collasso non deve poter togliere.
 */

import { el } from './dom.js';
import { apriGrande, type Immagini } from './immagini.js';
import { doppio } from './nomi.js';
import { promptRow, type PromptRow } from './prompt.js';

/** Un personaggio del cast di scena, come il palco lo mostra. */
export interface Volto {
  id: string;
  nome: string;
  /** L'ancora gia' pubblicata, se c'e'. */
  image?: string;
  aspetto?: string;
  /** Vero se l'aspetto e' un override locale della scena e non quello della
   * roster: e' una scelta d'autore, e una svista si vede solo se si distingue
   * dall'ereditata. */
  aspettoOverride?: boolean;
  voce?: string;
  voceOverride?: boolean;
}

/** Tutto cio' che il palco mostra di un'inquadratura. */
export interface Inquadratura {
  /** L'immagine gia' pubblicata per questo nodo. */
  image?: string;
  image_prompt?: string;
  /** Il tono che vale adesso. Sempre visibile, mai dietro un tocco. */
  tono?: string;
  luogo?: { id: string; nome: string; aspetto?: string };
  /** Gli id di chi e' in campo in questa inquadratura. */
  inCampo?: string[];
  /** Come chiamare cio' che si sta guardando nella lente: il titolo della
   * scena. */
  titolo?: string;
}

export class Palco {
  private root: HTMLElement;
  private tela: HTMLElement;
  private facce: HTMLElement;
  private riga: HTMLElement;
  private maniglia: HTMLButtonElement;
  private immagini: Immagini;
  private ridotto = false;
  /**
   * L'id della figura **disegnata adesso** nella tela.
   *
   * Serve a non riassegnare `src` quando due beat di fila condividono
   * l'immagine: riassegnarlo fa ripartire la decodifica e il palco sfarfalla
   * per un fotogramma su una figura che non e' cambiata.
   */
  private corrente?: string;
  /**
   * L'id dell'inquadratura **in scena**, che non e' la stessa cosa.
   *
   * Un nodo senza `image` non sposta la macchina: resta quella di prima, e
   * questo campo e' la memoria di quale sia. Tenerlo separato da `corrente`
   * non e' pignoleria — `corrente` dice cosa c'e' nel DOM e va azzerato ogni
   * volta che la tela va ricostruita, per esempio riaccendendo le immagini.
   * Quando erano lo stesso campo, riaccenderle in un beat che non dichiara
   * un'immagine propria cancellava anche il ricordo di quale fosse: le facce
   * tornavano e la figura no.
   */
  private inScena?: string;
  /** L'ultima inquadratura ricevuta e il cast della scena in corso: servono a
   * ridisegnare il palco quando cambia il *modo* di mostrarlo (immagini
   * accese o spente) senza aspettare il beat successivo. */
  private ultima?: Inquadratura;
  private cast: Volto[] = [];

  constructor(root: HTMLElement, immagini: Immagini) {
    this.root = root;
    this.immagini = immagini;
    this.tela = dentro(root, '.palco-tela');
    this.facce = dentro(root, '.palco-cast');
    this.riga = dentro(root, '.palco-riga');
    this.maniglia = dentro<HTMLButtonElement>(root, '.palco-maniglia');
    this.maniglia.onclick = () => {
      this.ridotto = !this.ridotto;
      this.applica();
    };
    this.applica();
  }

  /** Si entra in una scena: cast nuovo e inquadratura di base. */
  scena(inq: Inquadratura, cast: Volto[]): void {
    this.cast = cast;
    this.disegnaCast();
    this.mostra(inq);
  }

  /** Un beat: stessa scena, inquadratura nuova. Il cast non cambia — cambia
   * chi di loro e' in campo. */
  inquadratura(inq: Inquadratura): void {
    this.mostra(inq);
  }

  /**
   * Ridisegna con l'inquadratura che c'e' gia'.
   *
   * Serve quando si accendono o spengono le immagini a partita in corso: il
   * palco non e' un resoconto ma una vista, e una vista che aspetta il beat
   * successivo per obbedire e' un interruttore che sembra rotto.
   */
  rileggi(): void {
    if (!this.ultima) return;
    // Solo `corrente`: la tela va ricostruita, ma quale inquadratura sia in
    // scena non cambia perche' si accendono o si spengono le immagini.
    this.corrente = undefined;
    this.disegnaCast();
    this.mostra(this.ultima);
  }

  /**
   * Il palco torna vuoto e sparisce.
   *
   * Un momento solo: una partita nuova. La precedente e' finita, e la sua
   * ultima inquadratura non e' la prima di questa — sulla copertina non c'e'
   * ancora nessuna scena, quindi non c'e' niente da dire in cima allo schermo.
   */
  svuota(): void {
    this.corrente = undefined;
    this.inScena = undefined;
    this.ultima = undefined;
    this.cast = [];
    this.tela.replaceChildren();
    this.facce.replaceChildren();
    this.riga.replaceChildren();
    this.root.hidden = true;
    document.body.classList.remove('con-palco');
  }

  // ------------------------------------------------------------- interni

  private mostra(inq: Inquadratura): void {
    this.ultima = inq;
    this.root.hidden = false;
    document.body.classList.add('con-palco');
    this.disegnaRiga(inq);
    this.marcaInCampo(inq.inCampo);
    this.disegnaTela(inq);
  }

  private disegnaTela(inq: Inquadratura): void {
    // Un nodo che dichiara un'immagine sposta la macchina; uno che non la
    // dichiara lascia in scena quella di prima, che e' esattamente cio' che
    // succede in una stanza dove l'inquadratura non e' cambiata.
    if (inq.image) this.inScena = inq.image;
    const id = this.inScena;
    const src = id && this.immagini.accese ? this.immagini.url(id) : undefined;

    if (!src) {
      // Niente da mostrare: solo testo, o storia non ancora illustrata. Al
      // posto della figura vanno i prompt, che sono l'unica descrizione
      // d'autore di cio' che si vedrebbe.
      this.corrente = undefined;
      this.tela.replaceChildren(this.tavola(inq));
      return;
    }

    if (id === this.corrente) return;
    this.corrente = id;

    const img = new Image();
    img.src = src;
    // `alt` e' l'image_prompt: l'unica descrizione d'autore di cio' che si
    // vede, e in ascolto l'unica cosa che rende udibile un'inquadratura.
    img.alt = inq.image_prompt ?? '';
    img.decoding = 'async';
    // Toccarla la apre grande, con i suoi prompt per didascalia. Resta
    // un'immagine e non un bottone intorno a un'immagine, che i lettori di
    // schermo annunciano due volte.
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.title = "guardala a schermo intero, con i prompt che l'hanno prodotta";
    const guarda = () => apriGrande({ src, titolo: inq.titolo, righe: this.righeInquadratura(inq) });
    img.onclick = guarda;
    img.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        guarda();
      }
    };
    // Un id dichiarato nell'IR e un file che non arriva sono due cose diverse,
    // e la seconda va detta: senza, una pubblicazione parziale sembra una
    // scena senza immagine.
    img.onerror = () => {
      this.corrente = undefined;
      this.tela.replaceChildren(
        el('p', 'manca', `(immagine «${id}» dichiarata nell'IR ma non trovata)`),
        this.tavola(inq),
      );
    };

    // L'id sotto l'immagine, come sotto le figure del transcript: si vede solo
    // a debug acceso, e li' e' il modo di sapere quale file si sta guardando
    // senza aprire il pannello.
    this.tela.replaceChildren(img, el('p', 'ir palco-id', id));
  }

  /**
   * La tela quando non c'e' un'immagine: i prompt al posto della figura.
   *
   * Non e' un segnaposto muto ne' un errore — e' la modalita' testo, dove
   * quello che si legge qui e' esattamente cio' che il generatore produrra'.
   */
  private tavola(inq: Inquadratura): HTMLElement {
    const box = el('div', 'palco-tavola');
    const righe = this.righeInquadratura(inq);
    if (righe.length === 0) {
      box.append(el('p', 'palco-vuoto', '(nessuna inquadratura dichiarata per questo nodo)'));
      return box;
    }
    for (const r of righe) {
      if (r[1]) box.append(promptRow(r as [string, string, PromptRow[2], boolean?]));
    }
    return box;
  }

  /** I prompt visivi di un'inquadratura: quello che la lente mostra e quello
   * che, senza immagini, sta al posto della figura. */
  private righeInquadratura(inq: Inquadratura): PromptRow[] {
    return [
      ['image_prompt', inq.image_prompt, 'image'],
      [
        inq.luogo ? `places.${inq.luogo.id}.visual_prompt` : 'place',
        inq.luogo?.aspetto,
        'image',
      ],
    ].filter((r) => !!r[1]) as PromptRow[];
  }

  /**
   * La riga sotto l'immagine: il tono, dove siamo, chi e' in campo.
   *
   * Sempre visibile, anche da ridotto. Il tono soprattutto: e' la chiave con
   * cui si legge tutto quello che scorre sotto, e nasconderlo dietro un tocco
   * significherebbe che nove volte su dieci non lo si guarda.
   */
  private disegnaRiga(inq: Inquadratura): void {
    const righe: PromptRow[] = [
      ['place', inq.luogo ? doppio(inq.luogo.nome, `${inq.luogo.id} — ${inq.luogo.nome}`) : undefined, 'none'],
      ['characters_in_frame', this.nomiInCampo(inq.inCampo), 'none'],
    ];

    this.riga.replaceChildren();
    // Il tono per primo e con una classe sua. Non e' un campo come gli altri e
    // non si legge come un campo: fuori dal debug perde il nome «tono» e prende
    // la maiuscola, cioe' torna a essere la frase che l'autore ha scritto —
    // «Silenzio tra tre persone che si conoscono da troppo tempo». Etichettarla
    // la fa sembrare un dato, ed e' l'unica riga del palco che dato non e'.
    if (inq.tono) {
      const tono = promptRow(['scene_tone', inq.tono, 'none']);
      tono.classList.add('tono');
      this.riga.append(tono);
    }
    for (const r of righe) {
      if (r[1]) this.riga.append(promptRow(r as [string, string, PromptRow[2], boolean?]));
    }
    this.riga.hidden = this.riga.childElementCount === 0;
  }

  /**
   * Chi e' in campo, coi nomi del cast quando li si conosce.
   *
   * Torna `undefined` quando le facce lo dicono gia': una riga «in campo ·
   * Laura, Mark» sotto due ritratti accesi e un terzo spento e' la stessa cosa
   * scritta due volte, e la seconda occupa la striscia che serve al tono.
   * Resta invece quando qualcuno in campo **non** ha una faccia — un
   * personaggio nominato dall'inquadratura ma assente da `scene.characters`:
   * li' la riga e' l'unico posto dove quel nome compare, e la sua presenza e'
   * anche il modo di accorgersi dell'incoerenza nell'IR.
   */
  private nomiInCampo(ids?: string[]) {
    if (!ids?.length) return undefined;
    const nome = (id: string) => this.cast.find((v) => v.id === id)?.nome ?? id;
    const senzaFaccia = ids.filter((id) => !this.cast.some((v) => v.id === id));
    if (this.cast.length > 0 && senzaFaccia.length === 0) return undefined;
    return doppio(ids.map(nome).join(', '), ids.join(', '));
  }

  /**
   * Le facce del cast, di lato all'inquadratura.
   *
   * Ci sono tutti quelli del cast, marcati: chi l'inquadratura dichiara in
   * `characters_in_frame` e' acceso, gli altri portano `fuori`. A deciderne la
   * sorte e' poi il CSS, e non questo codice: a chi gioca i `fuori` non si
   * mostrano affatto — `scene.characters` elenca anche chi deve ancora
   * entrare, e una faccia spenta in fila lo annuncia — mentre col debug si
   * vedono spenti, perche' li' la domanda e' cosa dichiara l'inquadratura.
   *
   * Che sia il CSS a scegliere e non il codice non e' un dettaglio: accendere
   * il debug a partita in corso non ricostruisce il palco, come per tutta
   * l'altra diagnostica.
   */
  private disegnaCast(): void {
    this.facce.replaceChildren();
    this.facce.hidden = this.cast.length === 0;
    for (const v of this.cast) {
      const b = el('button', 'volto');
      b.type = 'button';
      b.dataset.id = v.id;
      const src = v.image && this.immagini.accese ? this.immagini.url(v.image) : undefined;
      if (src) {
        const img = new Image();
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        b.append(img);
      } else {
        // Senza ancora, le iniziali: un posto riconoscibile nella fila, che
        // resta toccabile per arrivare ai prompt di quel personaggio.
        b.append(el('span', 'iniziali', iniziali(v.nome)));
      }
      b.append(el('span', 'nome', v.nome));
      b.title = `${v.nome} — aspetto e voce`;
      b.onclick = () =>
        apriGrande({
          src,
          titolo: v.nome,
          righe: [
            [`visual_prompt${v.aspettoOverride ? ' (override)' : ''}`, v.aspetto, 'image'],
            [`voice.style_prompt${v.voceOverride ? ' (override)' : ''}`, v.voce, 'voice'],
          ],
        });
      this.facce.append(b);
    }
  }

  private marcaInCampo(ids?: string[]): void {
    const set = new Set(ids ?? []);
    // Un'inquadratura che non dichiara nessuno non spegne nessuno: "non
    // dichiarato" non vuol dire "non c'e'", e spegnere tutta la fila
    // direbbe una cosa che l'IR non dice.
    const nessuno = set.size === 0;
    for (const b of this.facce.querySelectorAll<HTMLElement>('.volto')) {
      b.classList.toggle('fuori', !nessuno && !set.has(b.dataset.id ?? ''));
    }
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

/** Le iniziali di un nome: al massimo due, che a 44 pixel e' quanto ci sta. */
function iniziali(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function dentro<T extends Element = HTMLElement>(root: HTMLElement, sel: string): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`elemento mancante nel palco: ${sel}`);
  return node;
}
