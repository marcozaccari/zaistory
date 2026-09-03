/**
 * Il trascritto: quello che è successo, in ordine.
 *
 * Nella stessa colonna scrivono registri diversi — l'autore, i personaggi, il
 * player quando commenta, la macchina quando mostra un prompt — e il foglio di
 * stile dà a ciascuno una voce: un colore, un carattere, uno spazio. Qui si
 * decide soltanto **di chi è** ogni riga; come suoni lo dice il CSS.
 *
 * Due cose vale la pena sapere leggendo questo file.
 *
 * **I prompt di generazione si vedono sempre**, non solo in debug. Sono il
 * segnaposto di quello che diventeranno immagine, suono e voce, ed è leggendoli
 * mentre si gioca che ci si accorge che un beat ha cambiato inquadratura senza
 * dirlo o che manca un suono: si rilegge la storia con gli occhi del modulo
 * assets, prima che il modulo assets esista.
 *
 * **Le diagnostiche stanno sotto il debug.** Dove la storia non ha il testo che
 * servirebbe, il player ripiega sul fallback d'autore e la nota si vede solo a
 * debug acceso: chi gioca non legge mai un messaggio di errore al posto della
 * storia. Diverso `problem`, che si vede sempre — quello segnala una storia
 * **rotta**, e lì non c'è niente da leggere al suo posto.
 */

import type { Named, StoryIndex, TurnEvent } from '../core/index.js';
import { displayName } from '../core/index.js';
import { byId, el, piega } from './dom.js';
import type { Images } from './images.js';
import { doppio, nomeCampo, type Doppio } from './names.js';
import { promptGroup, promptNudi, promptRow, valore, type PromptRow } from './prompt.js';

export class Transcript {
  private root = byId('transcript');
  /** Quello che c'è scritto, mentre al suo posto si guarda la copertina. */
  private daParte?: { nodi: ChildNode[]; scorrimento: number };

  constructor(private readonly idx: StoryIndex, private readonly images: Images) {}

  /** Quello che il giocatore ha scritto, ripetuto in chiaro: senza, dopo tre
   * turni non si sa più a cosa risponde cosa. */
  echo(text: string): void {
    this.add(el('p', 'entry echo', `· ${text}`));
  }

  /**
   * La battuta che ha scelto il giocatore.
   *
   * Ha la forma di tutte le altre — il nome sopra, la riga sotto — perché è la
   * stessa cosa: qualcuno che parla dentro la scena. Al suo posto c'era il
   * numero della scelta, e quella forma diceva «questo l'ha registrato il
   * player» invece di «questo l'hai detto tu»: chi rileggeva vedeva il dialogo
   * interrompersi a ogni sua mossa e ricominciare dopo.
   *
   * Una sola differenza, ed è il nome: azzurro invece che oro. Nella regola del
   * player l'oro è quello che ha scritto l'autore e l'azzurro quello che ha
   * fatto il giocatore, e una battuta scelta è l'unica riga della storia a
   * essere tutte e due — parole d'autore, dette perché qualcuno le ha volute.
   *
   * Il nome è `story.protagonist`, che è facoltativo: dove non c'è si torna
   * all'eco di prima invece di inventarne uno. Il player non scrive testo che
   * nella storia non ci sia, e un nome è testo.
   */
  chosen(text: string): void {
    const id = this.idx.story.protagonist;
    const ch = id ? this.idx.characters.get(id) : undefined;
    if (!ch) return this.echo(text);
    const p = el('p', 'entry line giocatore');
    p.append(el('span', 'speaker', displayName(ch)), document.createTextNode(text));
    this.add(p);
  }

  /**
   * La copertina: quello che vale per tutta la storia, prima che cominci.
   *
   * Risponde in un colpo d'occhio alle domande che ci si fa aprendo una storia
   * che non si è compilata adesso — di cosa parla, in che lingua, con che
   * versione del formato, che stile hanno le immagini e le voci. Lo stile
   * globale sta qui e non nelle fasi perché è lì che agisce:
   * `image_style_suffix` finisce in coda a *ogni* prompt d'immagine, e
   * `narrator_voice` vale per tutta la narrazione.
   *
   * **La copertina non è un'inquadratura**, ed è la ragione per cui la
   * locandina sta qui e non sul palco: il palco dice *dove si è*, e prima di
   * «inizia» non si è da nessuna parte. È una schermata, non un resoconto — ci
   * si sta sopra finché non si decide di cominciare.
   */
  cover(): void {
    const st = this.idx.story;
    const box = el('div', 'cover');

    // La locandina, prima di tutto: è la risposta all'unica domanda che ci si
    // fa aprendo una storia che non si conosce — «di cosa parla?» — e nessun
    // paragrafo la dà altrettanto in fretta. Senza immagini restano i prompt
    // che la produrranno, ma sotto la descrizione: sopra il titolo, un muro di
    // testo lo seppellirebbe.
    const righe = this.righeCopertina();
    const locandina = this.images.figure(st.cover?.image, {
      classe: 'locandina',
      titolo: st.title,
      righe,
      // A chi gioca la copertina si apre nuda: è una locandina, si guarda. Il
      // titolo e i prompt tornano col debug, dove anche lei è un asset da
      // decidere.
      soloImmagine: true,
    });
    if (locandina) box.append(locandina);

    box.append(el('h1', undefined, st.title));
    if (st.description) box.append(el('p', 'desc', st.description));

    if (!locandina) {
      const prompt = promptNudi(righe);
      if (prompt) {
        prompt.className = 'assets';
        box.append(prompt);
      }
    }

    // Due gruppi, e la linea passa fra «di che storia si tratta» e «di che file
    // si tratta». Versione e lingua restano a tutti: riguardano la storia che
    // si sta per giocare, e la versione è la sola cosa che spieghi perché una
    // build vecchia non la apra. Il resto è l'identità del *file*, e a chi
    // gioca direbbe soltanto che sta guardando dentro una macchina.
    const dl = el('dl', 'kv');
    const meta = (campo: string, v: string | Doppio | undefined, soloDebug = false) => {
      if (!v) return;
      const cls = soloDebug ? 'only-debug' : undefined;
      const dt = el('dt', cls);
      dt.append(el('span', 'umano', nomeCampo(campo)), el('span', 'ir', campo));
      const dd = el('dd', cls);
      dd.append(valore(v));
      dl.append(dt, dd);
    };
    meta('zaistory_version', st.zaistory_version);
    meta('language', st.language);
    const g = st.generated_by;
    if (g) meta('generated_by', `${g.compiler} ${g.compiler_version}${g.model ? ` · ${g.model}` : ''}`, true);
    meta('id', st.id, true);
    meta('acts', String(st.acts.length), true);
    meta('places', String(this.idx.places.size), true);
    const primo = this.idx.acts.get(st.start_act);
    meta('start_act', doppio(primo?.title || st.start_act, st.start_act), true);
    meta('failure_mode', st.failure_mode === 'alternate_endings' ? 'sì' : 'no', true);
    if (dl.childElementCount) box.append(dl);

    const gs = st.global_style;
    const stile = promptGroup('global_style', [
      ['default_tone', gs?.default_tone, 'none'],
      ['image_style_suffix', gs?.image_style_suffix, 'image'],
      ['narrator_voice.style_prompt', gs?.narrator_voice?.style_prompt, 'voice'],
      ['ambient_music_tags', gs?.ambient_music_tags?.join(', '), 'music'],
    ]);
    if (stile) box.append(stile);

    const dettagli = this.anagrafica();
    if (dettagli.childElementCount) box.append(dettagli);

    this.add(box);
  }

  /** I prompt che hanno prodotto — o che produrranno — la locandina. */
  private righeCopertina(): PromptRow[] {
    const st = this.idx.story;
    return [
      ['image_prompt', st.cover?.image_prompt, 'image'],
      ['place', this.nomeLuogo(st.cover?.place), 'none'],
      ['characters_in_frame', this.nomiInCampo(st.cover?.characters_in_frame), 'none'],
    ];
  }

  /**
   * L'anagrafica della storia, sotto il debug: chi c'è, dove si va, cosa si
   * può avere in mano, quali flag la muovono.
   *
   * Elenchi documentali e roster sono materiale da ispezione, non da
   * copertina: chi apre una storia vuole sapere *che storia è*, non leggere
   * l'anagrafica dei suoi flag. Restano nel documento e compaiono col debug,
   * come tutta l'altra diagnostica — e tutti chiusi, col conto nel titolo, che
   * è già metà della domanda che ci si fa davvero.
   */
  private anagrafica(): HTMLElement {
    const st = this.idx.story;
    const box = el('div', 'only-debug');

    if (st.characters?.length) {
      const { root, corpo } = piega('personaggi', st.characters.length);
      for (const c of st.characters) {
        const g = promptGroup(
          `characters.${c.id}`,
          [
            ['visual_prompt', c.visual_prompt, 'image'],
            ['voice.style_prompt', c.voice?.style_prompt, 'voice'],
          ],
          displayName(c),
        );
        corpo.append(g ?? el('span', 'gname', `characters.${c.id}`));
      }
      box.append(root);
    }

    const luoghi = [...this.idx.places.values()];
    if (luoghi.length) {
      const { root, corpo } = piega('luoghi', luoghi.length);
      for (const pl of luoghi) {
        const g = promptGroup(`places.${pl.id}`, [['visual_prompt', pl.visual_prompt, 'image']], displayName(pl));
        corpo.append(g ?? el('span', 'gname', `places.${pl.id}`));
      }
      box.append(root);
    }

    const chips = (titolo: string, valori: string[]) => {
      if (!valori.length) return;
      const { root, corpo } = piega(titolo, valori.length);
      const riga = el('div', 'chips');
      for (const v of valori) riga.append(el('span', 'chip', v));
      corpo.append(riga);
      box.append(root);
    };
    chips(
      'oggetti',
      (st.items ?? []).map((i) => (i.aliases?.length ? `${displayName(i)} (${i.aliases.join(', ')})` : displayName(i))),
    );
    chips('inventario iniziale', st.initial_inventory ?? []);

    // I flag sono locali all'atto, e l'elenco lo dice: senza l'atto davanti,
    // due flag omonimi di atti diversi sembrerebbero lo stesso.
    const flags = st.acts.flatMap((a) => (a.flags ?? []).map((f) => `${a.id} · ${f}`));
    chips('flag', flags);
    chips(
      'flag di transito',
      (st.carry_flags ?? []).map((c) => (c.description ? `${c.id} — ${c.description}` : c.id)),
    );

    return box;
  }

  /** Il luogo con il suo nome davanti all'id, quando lo si conosce. */
  private nomeLuogo(id: string | undefined): Doppio | string | undefined {
    if (!id) return undefined;
    const pl = this.idx.places.get(id);
    return pl ? doppio(displayName(pl), `${id} — ${displayName(pl)}`) : id;
  }

  /** Chi è in campo, coi nomi del cast quando li si conosce. */
  private nomiInCampo(ids: string[] | undefined): Doppio | undefined {
    if (!ids?.length) return undefined;
    const nome = (id: string) => displayName(this.idx.characters.get(id) ?? { id });
    return doppio(ids.map(nome).join(', '), ids.join(', '));
  }

  events(list: TurnEvent[]): void {
    for (const e of list) {
      switch (e.kind) {
        case 'narration': {
          // Il `look` è testo d'autore rileggibile e senza conseguenze: prende
          // la sua voce, senza il corsivo che nel trascritto dice «è appena
          // successo qualcosa».
          const guardarsi = e.by === 'verbo di sistema';
          // La figura **prima** della descrizione: si tira fuori la cosa, poi
          // si dice com'è. Al contrario sarebbe una didascalia.
          if (e.about) this.figure(e.about);
          const p = el('p', `entry ${guardarsi ? 'look' : 'narration'}`, e.text);
          if (e.by) p.append(el('span', 'via', e.by));
          this.add(p);
          if (e.beat) this.fields(e.beat);
          break;
        }
        case 'say': {
          const p = el('p', 'entry line');
          p.append(el('span', 'speaker', e.speaker ?? ''), document.createTextNode(e.text));
          this.add(p);
          if (e.voice?.style_prompt) this.field('voice_override.style_prompt', e.voice.style_prompt, 'voice');
          break;
        }
        case 'system':
          this.add(el('p', 'entry notice', e.text));
          break;
        case 'sound':
          this.field(e.field ?? 'play_sound_prompt', e.text, 'sound');
          break;
        // `.dbg` e non `solo-debug`: la seconda classe il foglio di stile non
        // la conosce fuori dal dock, e una diagnostica senza regola è una
        // diagnostica **visibile**, cioè un messaggio di macchina in mezzo
        // alla storia.
        case 'state':
          this.add(el('p', 'dbg', `[${e.text}]`));
          break;
        case 'note':
          this.add(el('p', 'dbg', `(${e.text})`));
          break;
        case 'problem':
          this.add(el('p', 'entry problem', `!! ${e.text}`));
          break;
      }
    }
  }

  /** Il confine fra un blocco di narrazione e il successivo. Senza un segno,
   * due paragrafi in corsivo di seguito sembrano lo stesso testo e non si
   * capisce cosa abbia aggiunto il tocco su «continua». */
  sep(): void {
    this.add(el('hr', 'beat-sep'));
  }

  ending(label?: string): void {
    const box = el('div', 'entry finish');
    box.append(el('h3', undefined, '— fine —'));
    if (label) box.append(el('p', undefined, label));
    this.add(box);
  }

  /**
   * L'immagine della cosa che si sta guardando.
   *
   * Il momento in cui serve è esattamente questo: quando si tira fuori la cosa
   * dallo zaino — o ci si avvicina a quella che sta nella stanza — per
   * guardarla. Nel cassetto dell'inventario la stessa figura c'è, ma in
   * miniatura dentro la pastiglia: lì serve a **riconoscere** l'oggetto in
   * mezzo agli altri, qui a guardarlo. Sono due mestieri diversi, ed è per
   * questo che le misure sono diverse.
   *
   * I **personaggi** non passano di qui: la loro faccia sta sul palco, dove
   * risponde alla domanda per tutta la scena invece che una volta sola nella
   * riga in cui li si è nominati.
   */
  private figure(about: Named): void {
    if (about.kind === 'character') return;
    const e = about.kind === 'item' ? this.idx.items.get(about.id) : this.idx.props.get(about.id);
    if (!e) return;
    const fig = this.images.figure(e.image, {
      classe: 'figura-oggetto',
      titolo: displayName(e),
      righe: [[`${about.kind === 'item' ? 'items' : 'objects'}.${e.id}.visual_prompt`, e.visual_prompt, 'image']],
      // Nella lente c'è l'oggetto, il suo nome e il suo aspetto: la riga è una
      // sola e il campo si capisce da ciò che si sta guardando, quindi
      // premetterle «aspetto» è etichettare l'unica cosa in pagina.
      senzaEtichette: true,
    });
    if (fig) this.add(fig);
  }

  /** Il suono del beat non si stampa qui: arriva come evento suo, subito dopo
   * la narrazione, ed è il core a dire da quale campo viene. Stamparlo in tutti
   * e due i posti lo faceva comparire due volte. */
  private fields(b: { image_prompt?: string; voice?: { style_prompt?: string } }): void {
    if (b.image_prompt) this.field('image_prompt', b.image_prompt, 'image');
    if (b.voice?.style_prompt) this.field('narration_voice.style_prompt', b.voice.style_prompt, 'voice');
  }

  private field(label: string, value: string, media: 'image' | 'sound' | 'voice' | 'music' | 'none'): void {
    const p = el('p', 'entry');
    p.append(promptRow([label, value, media]));
    this.add(p);
  }

  private add(n: HTMLElement): void {
    this.root.append(n);
    this.root.scrollTop = this.root.scrollHeight;
  }

  clear(): void {
    this.daParte = undefined;
    this.root.replaceChildren();
  }

  /**
   * Mette da parte quello che c'è scritto, e poi lo rimette dov'era.
   *
   * Serve a una cosa sola: rivedere la copertina a partita cominciata. Sono i
   * nodi veri, non una copia — il trascritto **è** la memoria della partita, e
   * ricostruirlo da capo vorrebbe dire rigiocarla. Torna anche lo scorrimento:
   * si stava leggendo un punto preciso, e riprendere dal fondo dopo aver
   * guardato una figura è perdere il segno.
   */
  sospendi(): void {
    if (this.daParte) return;
    this.daParte = { nodi: [...this.root.childNodes], scorrimento: this.root.scrollTop };
    this.root.replaceChildren();
  }

  riprendi(): void {
    const d = this.daParte;
    if (!d) return;
    this.daParte = undefined;
    this.root.replaceChildren(...d.nodi);
    this.root.scrollTop = d.scorrimento;
  }

  /** C'è qualcosa da parte, cioè: al posto della partita si sta guardando
   * altro. */
  get sospeso(): boolean {
    return !!this.daParte;
  }
}
