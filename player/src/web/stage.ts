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

import type { Background, NarrationBeat, Phase, Place, StoryIndex } from '../core/index.js';
import { displayName } from '../core/index.js';
import { byId, clear, el, initials } from './dom.js';
import type { Images } from './images.js';
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
    private readonly onOpenFull: (src: string, caption: string) => void,
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
   * La riga delle coordinate: il tono, dove siamo, chi è in campo.
   *
   * Il tono per primo e con una classe sua. Non è un campo come gli altri e non
   * si legge come un campo: fuori dal debug perde il nome e prende la
   * maiuscola, cioè torna a essere la frase che l'autore ha scritto.
   * Etichettarla la fa sembrare un dato, ed è l'unica riga del palco che dato
   * non è.
   */
  private disegnaRiga(pl: Place | undefined, ph: Phase | undefined): void {
    clear(this.riga);

    const tono = ph?.tone ?? this.idx.story.global_style?.default_tone;
    if (tono) {
      const t = promptRow(['tone', tono, 'none']);
      t.classList.add('tono');
      this.riga.append(t);
    }

    const righe: PromptRow[] = [
      ['place', pl ? doppio(displayName(pl), `${pl.id} — ${displayName(pl)}`) : undefined, 'none'],
      ['characters_in_frame', this.nomiInCampo(ph), 'none'],
    ];
    for (const r of righe) if (r[1]) this.riga.append(promptRow(r as [string, string, 'none']));

    this.riga.hidden = this.riga.childElementCount === 0;
  }

  /**
   * Chi è in campo, coi nomi del cast quando li si conosce.
   *
   * Torna `undefined` quando le facce lo dicono già: una riga «in campo ·
   * Laura, Mark» sotto due ritratti accesi è la stessa cosa scritta due volte,
   * e la seconda occupa la striscia che serve al tono.
   */
  private nomiInCampo(ph: Phase | undefined) {
    const ids = this.current?.inFrame ?? [];
    if (!ids.length) return undefined;
    const roster = (ph?.characters ?? []).map((c) => c.id).filter((id) => id !== this.idx.story.protagonist);
    const senzaFaccia = ids.filter((id) => !roster.includes(id));
    if (roster.length > 0 && senzaFaccia.length === 0) return undefined;
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
      img.addEventListener('click', () => this.onOpenFull(img.src, this.caption()));
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
    for (const c of ph?.characters ?? []) {
      if (c.id === this.idx.story.protagonist) continue;
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
      box.addEventListener('click', () => {
        const src = this.images.url(c.image ?? ch?.image);
        const cap = [nome, c.visual_prompt ?? ch?.visual_prompt, ch?.voice?.style_prompt && `Voce: ${ch.voice.style_prompt}`]
          .filter(Boolean)
          .join(' — ');
        if (src) this.onOpenFull(src, cap);
        else alert(cap);
      });
      this.cast.append(box);
    }
    this.cast.hidden = this.cast.childElementCount === 0;
  }

  private caption(): string {
    const c = this.current;
    const pl = c?.place ? this.idx.places.get(c.place) : undefined;
    return [c?.prompt, pl?.visual_prompt].filter(Boolean).join(' — ');
  }
}
