/**
 * Il palco: l'inquadratura corrente, ferma in alto, con il racconto che le
 * scorre sotto.
 *
 * Tre regole, e tutte e tre vengono da come si legge davvero una storia
 * illustrata:
 *
 * - **ogni immagine nuova prende il posto della precedente.** Finché le figure
 *   scorrevano dentro il testo, quella di adesso usciva dallo schermo appena si
 *   scorreva per leggere la riga che la commenta: due movimenti per una cosa
 *   sola.
 * - **un nodo senza immagine non svuota il palco**: resta l'ultima
 *   inquadratura, che è esattamente ciò che succede quando la macchina non si
 *   è spostata.
 * - **la riga delle coordinate non si nasconde mai.** Sta in cima, sopra la
 *   figura, e contiene il tono — l'unico campo che non descrive un'immagine, e
 *   la chiave con cui si legge tutto quello che sta sotto.
 *
 * Il collasso della maniglia stringe la figura, mai la riga: ridurre serve a
 * leggere meglio, non a leggere alla cieca.
 */

import type { Background, NarrationBeat, Phase, PhaseCharacter, Place, StoryIndex } from '../core/index.js';
import { displayName } from '../core/index.js';
import { byId, clear, el, initials } from './dom.js';
import type { Images } from './images.js';
import { apriGrande } from './lightbox.js';
import { promptNudi, promptRow, type PromptRow } from './prompt.js';
import { doppio } from './names.js';

export class Stage {
  private root = byId('palco');
  private riga = byId('palco-riga');
  private tela = byId('palco-tela');
  private cast = byId('palco-cast');
  private handle = byId<HTMLButtonElement>('palco-maniglia');
  private current?: { image?: string; prompt?: string; sound?: string; place?: string; inFrame: string[] };
  /** Dove siamo adesso: serve a `frame`, che ridisegna la riga e il cast e non
   * riceve né il luogo né la fase. */
  private place?: Place;
  private phase?: Phase;
  /** L'ultima fase di cui si è vista l'inquadratura di base. Il palco la
   * mostra **entrando**, e da lì in poi la lascia stare: rimetterla a ogni
   * turno cancellerebbe lo stacco che un beat ha appena fatto — «ogni immagine
   * nuova prende il posto della precedente» vale anche per lei. */
  private lastPhase = '';

  constructor(
    private readonly idx: StoryIndex,
    private readonly images: Images,
  ) {
    this.handle.addEventListener('click', () => {
      const ridotto = document.body.classList.toggle('palco-ridotto');
      this.handle.setAttribute('aria-expanded', String(!ridotto));
      const etichetta = ridotto ? "allarga l'immagine" : "riduci l'immagine";
      this.handle.setAttribute('aria-label', etichetta);
      this.handle.title = etichetta;
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
    document.body.classList.remove('con-palco');
  }

  /** Una nuova inquadratura da un `background` o da un beat di narrazione. */
  frame(b: Background | NarrationBeat | undefined, placeId?: string): void {
    if (!b) return;
    const prompt = 'image_prompt' in b ? b.image_prompt : undefined;
    if (!b.image && !prompt) return; // niente da mostrare: il palco resta com'è
    this.current = {
      image: b.image,
      prompt,
      sound: 'ambient_sound_prompt' in b ? b.ambient_sound_prompt : (b as NarrationBeat).sound_effect_prompt,
      place: placeId ?? this.current?.place,
      inFrame: b.characters_in_frame ?? [],
    };
    this.mostra();
    this.paint();
    // La riga e il cast dicono *questa* inquadratura: chi è in campo cambia
    // con lo stacco, non con la stanza.
    this.disegnaRiga(this.place, this.phase);
    this.paintCast(this.phase);
  }

  /**
   * Dove siamo. Si chiama **prima** dei beat del turno: l'inquadratura di base
   * della fase è il punto di partenza, e uno stacco che arriva dopo la
   * sostituisce.
   */
  setContext(pl: Place | undefined, ph: Phase | undefined): void {
    if (!ph && !pl) return;
    this.mostra();
    this.place = pl;
    this.phase = ph;
    if (this.current) this.current.place = pl?.id ?? this.current.place;

    if (ph && ph.id !== this.lastPhase) {
      this.lastPhase = ph.id;
      this.frame(ph.background, pl?.id);
    }
    this.disegnaRiga(pl, ph);
    this.paintCast(ph);
  }

  private mostra(): void {
    this.root.hidden = false;
    document.body.classList.add('con-palco');
  }

  /**
   * La riga delle coordinate: dove siamo, com'è, chi è in campo.
   *
   * Il luogo e il tono per primi, con una classe ciascuno, e sono i due che si
   * vedono anche a debug spento: dove si è e la chiave con cui si legge quello
   * che scorre sotto. Nessuno dei due si legge come un campo — fuori dal debug
   * perdono il nome e prendono la maiuscola, cioè tornano a essere il nome e la
   * frase che l'autore ha scritto. Etichettarli li fa sembrare dati, e dati non
   * sono.
   *
   * Il luogo prima del tono, e sotto la figura invece che in barra: il posto in
   * cui si guarda per sapere dove si è è l'inquadratura, non la testata, e i
   * due erano la stessa domanda — dove siamo e com'è — divisa fra i due capi
   * dello schermo.
   */
  private disegnaRiga(pl: Place | undefined, ph: Phase | undefined): void {
    clear(this.riga);

    if (pl) {
      const l = promptRow(['place', doppio(displayName(pl), `${pl.id} — ${displayName(pl)}`), 'none']);
      l.classList.add('dove');
      this.riga.append(l);
    }

    const tono = ph?.tone ?? this.idx.story.global_style?.default_tone;
    if (tono) {
      const t = promptRow(['tone', tono, 'none']);
      t.classList.add('tono');
      this.riga.append(t);
    }

    const inCampo = this.nomiInCampo();
    if (inCampo) this.riga.append(promptRow(['characters_in_frame', inCampo, 'none']));

    this.riga.hidden = this.riga.childElementCount === 0;
  }

  /**
   * Chi è in campo, coi nomi del cast quando li si conosce.
   *
   * La riga si vede solo col debug — fuori di lì lo dicono le facce qui sotto —
   * e lì la domanda è cosa l'inquadratura *dichiara*: quindi si scrive sempre,
   * anche quando i ritratti accesi la ripetono.
   */
  private nomiInCampo() {
    const ids = this.current?.inFrame ?? [];
    if (!ids.length) return undefined;
    const nome = (id: string) => displayName(this.idx.characters.get(id) ?? { id });
    return doppio(ids.map(nome).join(', '), ids.join(', '));
  }

  private paint(): void {
    clear(this.tela);
    const c = this.current;
    if (!c) return;

    const img = this.images.usable
      ? this.images.element(c.image, c.prompt ?? '', (id) => this.mostraPrompt(id))
      : undefined;
    if (img) {
      this.tela.classList.remove('nuda');
      // Toccare l'inquadratura la apre grande, coi prompt che l'hanno
      // prodotta: è lì che si decide se quell'asset va bene.
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.title = 'guardala a schermo intero';
      const guarda = () => apriGrande({ src: img.src, titolo: this.titolo(), righe: this.righe() });
      img.addEventListener('click', guarda);
      img.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          guarda();
        }
      });
      this.tela.append(img);
    } else {
      this.mostraPrompt();
    }
  }

  /**
   * Il palco c'è sempre, anche senza immagini: al posto della figura i prompt
   * che la produrranno. Non è un segnaposto muto — è esattamente ciò che il
   * generatore riceverebbe, ed è il motivo per cui la modalità testo esiste.
   */
  private mostraPrompt(missingId?: string): void {
    clear(this.tela);
    this.tela.classList.add('nuda');
    const tavola = el('div', 'palco-tavola');
    const righe = promptNudi([
      ['image_prompt', this.current?.prompt, 'image'],
      ['ambient_sound_prompt', this.current?.sound, 'sound'],
    ]);
    if (righe) tavola.append(righe);
    else tavola.append(el('p', 'palco-vuoto', 'Nessuna inquadratura dichiarata qui.'));
    if (missingId) {
      tavola.append(el('p', 'manca', `l'immagine "${missingId}" è dichiarata ma il file non c'è`));
    }
    this.tela.append(tavola);
  }

  private paintCast(ph: Phase | undefined): void {
    clear(this.cast);
    const inFrame = this.current?.inFrame ?? [];
    const debug = document.body.classList.contains('debug');

    // Chi è in campo ha una faccia anche se la fase corrente non lo elenca.
    //
    // Succede a ogni stacco che scavalca una fase: i beat di una cutscene
    // arrivano mentre la fase che vale *adesso* è già la successiva, e la sua
    // roster non è quella dell'inquadratura che si sta guardando. Mark schiacciato
    // sotto il Cane-robot è dichiarato in campo dal beat e non compare fra i
    // personaggi della fase che gli sopravvive: senza questa unione resta senza
    // miniatura proprio nel momento in cui la figura lo mostra.
    //
    // La roster della fase resta prima, ed è giusto: è lì che stanno gli
    // override d'aspetto e di voce. Chi arriva dall'inquadratura ricade sulla
    // scheda globale del personaggio.
    const roster: PhaseCharacter[] = [...(ph?.characters ?? [])];
    for (const id of inFrame) {
      if (!roster.some((c) => c.id === id) && this.idx.characters.has(id)) roster.push({ id });
    }

    for (const c of roster) {
      // Il protagonista sta in fila con gli altri: che ci sia non è affatto
      // scontato — una cutscene può raccontare una scena in cui il personaggio
      // del giocatore proprio non c'è — e la fase lo dice dichiarandolo o no
      // fra i suoi `characters`. Toglierlo d'ufficio faceva sparire l'unica
      // faccia il cui vedersi o meno è un'informazione di trama.
      const acceso = inFrame.length === 0 || inFrame.includes(c.id);
      // A chi gioca i non inquadrati non si mostrano affatto: `characters`
      // elenca chiunque sia presente, anche chi deve ancora entrare, e una
      // faccia spenta in fila annuncia che sta per arrivare qualcuno. Col
      // debug si vedono, perché lì la domanda è cosa *dichiara*
      // l'inquadratura.
      if (!acceso && !debug) continue;

      const ch = this.idx.characters.get(c.id);
      const nome = displayName(ch ?? { id: c.id });
      const box = el('button', `volto${acceso ? '' : ' fuori'}`);
      box.title = nome;
      const img = this.images.usable ? this.images.element(c.image ?? ch?.image, nome) : undefined;
      if (img) box.append(img);
      else box.append(el('span', 'iniziali', initials(nome)));
      box.append(el('span', 'nome', nome));
      // Anche senza immagine il volto si apre: in solo testo — o prima che gli
      // asset esistano — allargare un personaggio deve comunque portare ai suoi
      // prompt, perché è lì che vivono.
      box.addEventListener('click', () =>
        apriGrande({
          src: this.images.usable ? this.images.url(c.image ?? ch?.image) : undefined,
          titolo: nome,
          righe: [
            [`visual_prompt${c.visual_prompt ? ' (override)' : ''}`, c.visual_prompt ?? ch?.visual_prompt, 'image'],
            [`voice.style_prompt${c.voice ? ' (override)' : ''}`, (c.voice ?? ch?.voice)?.style_prompt, 'voice'],
          ],
        }),
      );
      this.cast.append(box);
    }
    this.cast.hidden = this.cast.childElementCount === 0;
  }

  /**
   * Di cosa è l'inquadratura che si sta guardando: il luogo, e la fase quando
   * ne ha un titolo suo.
   *
   * Sulla copertina non c'è né l'uno né l'altra — la partita non è ancora
   * cominciata — e lì vale il titolo della storia: è pur sempre il nome di ciò
   * che si sta guardando, ed è scritto nel file come tutto il resto.
   */
  private titolo(): string {
    const pl = this.current?.place ? this.idx.places.get(this.current.place) : undefined;
    return [pl && displayName(pl), this.phase?.title].filter(Boolean).join(' — ') || this.idx.story.title;
  }

  /** I prompt che hanno prodotto — o che produrranno — questa inquadratura.
   * Sono gli stessi che la modalità testo mette al posto della figura: nella
   * lente stanno accanto al risultato, che è dove servono per giudicarlo. */
  private righe(): PromptRow[] {
    const c = this.current;
    const pl = c?.place ? this.idx.places.get(c.place) : undefined;
    return [
      ['image_prompt', c?.prompt, 'image'],
      ['ambient_sound_prompt', c?.sound, 'sound'],
      [pl ? `places.${pl.id}.visual_prompt` : 'place', pl?.visual_prompt, 'image'],
    ];
  }
}
