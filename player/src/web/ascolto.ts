/**
 * La modalita' ascolto: la storia recitata invece che letta.
 *
 * Il player mostra i prompt di generazione come testo perche' un giorno
 * saranno immagine, suono e voce. Chi non guarda lo schermo ha lo stesso
 * bisogno, e ce l'ha *adesso*: la descrizione di un'inquadratura letta ad alta
 * voce e' l'immagine, finche' l'immagine non esiste. Da qui la modalita': non
 * un lettore di schermo attaccato sopra, ma una seconda uscita del player,
 * che riceve gli stessi dati dell'altra e li dispone per l'orecchio.
 *
 * Tre regole tengono in piedi il resto.
 *
 * 1. **Non si inventa prosa, come da nessun'altra parte.** Ogni frase che esce
 *    di qui e' testo d'autore preso dall'IR. Le uniche parole del player sono
 *    le etichette dei campi — «Ambiente:», «Personaggio:», «Voce:» — e sono le
 *    stesse che sullo schermo stanno scritte accanto al valore, dette invece
 *    che disegnate. Un'etichetta non e' narrazione: e' il nome della cosa.
 *
 * 2. **Si collassa come si collassa a schermo.** Il transcript mostra per
 *    intero il prompt di un luogo o di un personaggio la prima volta, e da li'
 *    in poi lo riduce a una riga richiudibile. All'orecchio la riga
 *    richiudibile non esiste, quindi la stessa regola diventa: la prima volta
 *    la composizione per intero, dalla seconda solo il nome. Il registro e'
 *    separato da quello visivo di proposito — sono due uscite indipendenti, e
 *    giocare a schermo spento non deve cambiare quello che si vedrebbe
 *    riaccendendolo — ma la regola e' identica, e va tenuta identica.
 *
 * 3. **Il dock non si legge.** Ne' «continua», ne' «scrivi cosa fare», ne' le
 *    scelte di dialogo, ne' la conferma della chip appena toccata: e' tutto
 *    rumore che copre la storia, e una chip la si tocca perche' la si e' gia'
 *    vista. Si recita quello che *e' successo* — narrazione, battute, esito
 *    dei comandi — non l'interfaccia con cui lo si e' chiesto.
 *
 *    Un'eccezione sola, e non contraddice la regola: **l'uscita mostrata
 *    quando nella scena non resta piu' niente da fare**. Li' il dock non e'
 *    un elenco fra cui scegliere, e' l'unica cosa rimasta — e tacerla
 *    significherebbe lasciare chi non guarda lo schermo esattamente nel muro
 *    che questa regola voleva togliere. Il testo e' la label d'autore, che
 *    dice anche *dove* si sta andando.
 */

import {
  type DialogueNode,
  type NarrationBeat,
  type Scene,
  type Story,
  type VoiceSpec,
  displayName,
  findCharacter,
  findPlace,
  isDidascalia,
  speakerName,
} from '../core/index.js';
import { PARAMETRI_DEFAULT, Voce, type ParametriVoce } from './voce.js';

export interface ImpostazioniAscolto extends ParametriVoce {
  /** La modalita' e' accesa. */
  attiva: boolean;
  /**
   * Recita anche i prompt di suono e i prompt del tipo di voce.
   *
   * Spento di default: sono i campi che descrivono *come* qualcosa suonera',
   * e sentirseli leggere da una voce sintetica in mezzo alla storia e' una
   * rottura del quarto muro continua. Chi sta collaudando la resa sonora di un
   * IR invece li vuole tutti, ed e' l'unico modo di verificarli senza guardare.
   */
  suoniEVoci: boolean;
  /**
   * Finita la lettura, si prosegue da soli.
   *
   * Acceso di default insieme alla modalita': un «continua» che va cercato a
   * tentoni sullo schermo e' esattamente l'ostacolo che questa modalita'
   * esiste per togliere. Resta spegnibile perche' il ritmo del tocco e' anche
   * il modo in cui si rilegge un passaggio.
   */
  avanzamento: boolean;
}

export const ASCOLTO_DEFAULT: ImpostazioniAscolto = {
  ...PARAMETRI_DEFAULT,
  attiva: false,
  suoniEVoci: false,
  avanzamento: true,
};

/** Unisce i pezzi di un dettato in un periodo solo, saltando i vuoti. Il punto
 * finale conta: e' quello che fa respirare la sintesi fra un campo e l'altro. */
function periodo(parti: Array<string | undefined | false>): string {
  return parti
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => (/[.!?…:]$/.test(p.trim()) ? p.trim() : p.trim() + '.'))
    .join(' ');
}

export class Ascolto {
  private imp: ImpostazioniAscolto = { ...ASCOLTO_DEFAULT };

  /**
   * I luoghi la cui descrizione e' gia' stata recitata per intero.
   *
   * Chiave: l'id del luogo. Il `visual_prompt` di un luogo viene dalla roster
   * e non ha override di scena, quindi l'id basta a identificarlo — a
   * differenza dei personaggi, dove un override e' un valore diverso e va
   * risentito.
   */
  private luoghi = new Set<string>();
  /** Le inquadrature gia' recitate: `<scena>` per lo sfondo, `<scena>#<n>` per
   * i beat. E' l'unita' di "prima visita": tornare nella stessa scena non
   * rilegge l'inquadratura, ma una scena nuova nello stesso luogo si', perche'
   * l'`image_prompt` e' l'unica cosa che vale solo li'. */
  private inquadrature = new Set<string>();
  /** I prompt di personaggio gia' recitati, con la stessa chiave del registro
   * visivo (`id NUL campo NUL testo`) e per la stessa ragione: un override
   * locale e' un valore diverso, e va risentito la prima volta che compare. */
  private personaggi = new Set<string>();

  constructor(
    private story: Story,
    readonly voce: Voce,
  ) {}

  // ------------------------------------------------------------ impostazioni

  get impostazioni(): ImpostazioniAscolto {
    return { ...this.imp };
  }

  /** Vera solo se la modalita' e' accesa *e* il browser sa parlare: altrove
   * resterebbe accesa e muta, che e' il peggiore dei due stati. */
  get attiva(): boolean {
    return this.imp.attiva && this.voce.disponibile;
  }

  configura(imp: ImpostazioniAscolto): void {
    const eraAttiva = this.attiva;
    this.imp = { ...imp };
    this.voce.parametri(imp);
    if (eraAttiva && !this.attiva) this.voce.taci();
  }

  /**
   * Una partita nuova riparte senza memoria: i registri sono lunghi quanto la
   * partita, come quello visivo di `WebUI`, altrimenti ricominciando la prima
   * scena arriverebbe gia' collassata — cioe' muta.
   */
  ricomincia(): void {
    this.luoghi.clear();
    this.inquadrature.clear();
    this.personaggi.clear();
    this.voce.taci();
  }

  taci(): void {
    this.voce.taci();
  }

  // ------------------------------------------------------------------ dettato

  /** Una riga di testo d'autore: narrazione, `look`, esito di un comando. */
  dilo(testo?: string): void {
    if (!this.attiva || !testo) return;
    this.voce.parla(testo);
  }

  /**
   * La copertina.
   *
   * Titolo e descrizione perche' sono la storia; lo stile globale perche' e'
   * il prompt che finisce in coda a *ogni* immagine, cioe' la cornice dentro
   * cui va immaginato tutto il resto. I metadati (versione, id, numero di
   * scene) restano muti: servono a riconoscere un file, non a giocarlo.
   */
  copertina(): void {
    if (!this.attiva) return;
    const st = this.story;
    const g = st.global_style;
    this.voce.parla(periodo([st.title, st.description]));
    this.voce.parla(
      periodo([
        g?.image_style_suffix && `Stile delle immagini: ${g.image_style_suffix}`,
        this.imp.suoniEVoci && g?.narrator_voice?.style_prompt
          ? `Voce del narratore: ${g.narrator_voice.style_prompt}`
          : undefined,
        this.imp.suoniEVoci && g?.ambient_music_tags?.length
          ? `Musica: ${g.ambient_music_tags.join(', ')}`
          : undefined,
      ]),
    );
  }

  /** L'ingresso in una scena: l'inquadratura di base e chi c'e' dentro. */
  scena(sc: Scene): void {
    if (!this.attiva) return;
    for (const f of this.inquadraturaScena(sc, false)) this.voce.parla(f);
  }

  /** Un beat di narrazione: prima la sua inquadratura, poi il testo — lo
   * stesso ordine con cui il transcript li impagina, e per la stessa ragione:
   * prima si vede dove si e', poi si sente cosa succede. */
  beat(sc: Scene, b: NarrationBeat, index: number): void {
    if (!this.attiva) return;
    for (const f of this.inquadraturaBeat(sc, b, index, false)) this.voce.parla(f);
    this.voce.parla(b.text);
  }

  /**
   * Una battuta di dialogo, con chi la dice — o una didascalia, che non la dice
   * nessuno.
   *
   * Sentire «Narratore» davanti a «Tommy guarda Laura nello specchietto»
   * sposta la scena in un documentario. Le didascalie sono l'unica prosa che
   * dentro un dialogo racconta cosa succede mentre si parla: vanno dette e
   * basta.
   */
  battuta(n: DialogueNode): void {
    if (!this.attiva) return;
    if (this.imp.suoniEVoci && n.voice_override?.style_prompt) {
      this.voce.parla(`Voce: ${n.voice_override.style_prompt}`);
    }
    this.voce.parla(isDidascalia(n) ? n.text : `${speakerName(this.story, n.speaker)}: ${n.text}`);
  }

  /** Il prompt di un suono prodotto da un `Effect`. */
  suono(prompt?: string): void {
    if (!this.attiva || !this.imp.suoniEVoci || !prompt) return;
    this.voce.parla(`Suono: ${prompt}`);
  }

  /** Il prompt di voce di una narrazione. */
  vocePrompt(v?: VoiceSpec): void {
    if (!this.attiva || !this.imp.suoniEVoci || !v?.style_prompt) return;
    this.voce.parla(`Voce: ${v.style_prompt}`);
  }

  /**
   * «Guardati intorno»: la composizione per intero, di nuovo.
   *
   * E' il contrappeso del collapse. Collassare fa risparmiare ripetizioni, ma
   * toglie a chi ascolta l'unico modo di rifarsi un'immagine di dove si trova;
   * a schermo quella riga si riapre con un tocco, all'orecchio si riapre
   * chiedendolo. I registri non si toccano: e' una rilettura su richiesta, non
   * una prima visita, e la volta dopo si torna a collassare.
   *
   * Il testo di `look` non lo dice questo metodo: arriva dal core come esito
   * del verbo, e lo recita la strada normale subito dopo.
   */
  riosserva(sc: Scene): void {
    if (!this.attiva) return;
    for (const f of this.inquadraturaScena(sc, true)) this.voce.parla(f);
  }

  /**
   * Prova la voce, anche a modalita' spenta: e' la sola cosa che si fa nel
   * menu prima di accenderla, e chiederle di essere gia' accesa per poterla
   * regolare sarebbe un giro assurdo.
   *
   * Il testo di prova e' il titolo della storia, non una frase di comodo:
   * anche qui non si inventa niente, e per giunta e' il campione piu' utile —
   * sono i nomi propri della storia quelli su cui una voce sintetica
   * inciampa.
   */
  prova(): void {
    this.voce.taci();
    this.voce.parla(periodo([this.story.title, this.story.description]));
  }

  /** La lingua dichiarata dall'IR, per proporre le voci giuste nel menu. */
  get lingua(): string {
    return this.story.language || 'it';
  }

  /**
   * Le uscite mostrate a scena finita: l'unica parte del dock che si recita.
   *
   * Non e' l'elenco delle azioni che rientra dalla finestra — quando questo
   * metodo viene chiamato, nella scena non e' rimasto nessun enigma da
   * proteggere.
   */
  uscite(etichette: string[]): void {
    if (!this.attiva || etichette.length === 0) return;
    for (const e of etichette) this.voce.parla(e);
  }

  /** Il finale, con il motivo per cui la partita si e' chiusa. */
  finale(motivo: string): void {
    if (!this.attiva) return;
    this.voce.parla(motivo);
  }

  // ------------------------------------------------------------------ interni

  /**
   * Le frasi dell'inquadratura di scena.
   *
   * `tutto` salta i registri senza aggiornarli: e' la strada di `riosserva`.
   */
  private inquadraturaScena(sc: Scene, tutto: boolean): string[] {
    const out: string[] = [];
    const bg = sc.background;
    const nuova = this.primaVolta(this.inquadrature, sc.id, tutto);

    out.push(periodo([this.dettaLuogo(bg?.place, sc, tutto), nuova ? bg?.image_prompt : undefined]));

    if (this.imp.suoniEVoci && nuova && bg?.ambient_sound_prompt) {
      out.push(`Ambiente sonoro: ${bg.ambient_sound_prompt}`);
    }

    // Chi c'e': aspetto e voce come valgono *qui*, cioe' l'override di scena
    // se c'e', altrimenti la roster. E' la stessa scelta che fa la scheda di
    // scena a schermo.
    for (const c of sc.characters ?? []) {
      const g = findCharacter(this.story, c.id);
      const nome = g ? displayName(g) : c.id;
      const aspetto = c.visual_prompt ?? g?.visual_prompt;
      const stile = c.voice?.style_prompt ?? g?.voice?.style_prompt;
      const dettaAspetto = this.primaVolta(this.personaggi, chiave(c.id, 'visual_prompt', aspetto), tutto);
      const dettaVoce =
        this.imp.suoniEVoci && this.primaVolta(this.personaggi, chiave(c.id, 'voice.style_prompt', stile), tutto);
      out.push(
        periodo([
          `Personaggio: ${nome}`,
          dettaAspetto ? aspetto : undefined,
          dettaVoce && stile ? `Voce: ${stile}` : undefined,
        ]),
      );
    }

    return out.filter((f) => f !== '');
  }

  /**
   * Le frasi dell'inquadratura di un beat.
   *
   * Stessa regola dello sfondo, con in piu' il cast dichiarato dal beat, che
   * si dice per nome e basta: chi e' gia' stato descritto all'ingresso non va
   * ridescritto a ogni stacco.
   */
  private inquadraturaBeat(sc: Scene, b: NarrationBeat, index: number, tutto: boolean): string[] {
    const nuova = this.primaVolta(this.inquadrature, `${sc.id}#${index}`, tutto);
    const out: string[] = [];

    const cast = (b.characters_in_frame ?? [])
      .map((id) => {
        const c = findCharacter(this.story, id);
        return c ? displayName(c) : id;
      })
      .join(', ');

    out.push(
      periodo([
        b.place ? this.dettaLuogo(b.place, sc, tutto) : undefined,
        cast ? `In scena: ${cast}` : undefined,
        nuova ? b.image_prompt : undefined,
      ]),
    );

    if (this.imp.suoniEVoci && nuova && b.sound_effect_prompt) out.push(`Suono: ${b.sound_effect_prompt}`);
    if (this.imp.suoniEVoci && b.voice?.style_prompt) out.push(`Voce: ${b.voice.style_prompt}`);

    return out.filter((f) => f !== '');
  }

  /**
   * Il luogo: il nome sempre, la descrizione solo la prima volta.
   *
   * E' il cuore della regola. Senza il nome, chi ascolta non sa di essere
   * tornato dove era gia' stato; con la descrizione ogni volta, la storia
   * annega in un paragrafo ripetuto cinque volte a scena.
   *
   * Un luogo che l'IR non dichiara non ha nome da dire: resta il titolo della
   * scena, che e' il solo appiglio che l'autore ha lasciato.
   */
  private dettaLuogo(placeId: string | undefined, sc: Scene, tutto: boolean): string | undefined {
    if (!placeId) return sc.title ? `Ambiente: ${sc.title}` : undefined;
    const pl = findPlace(this.story, placeId);
    const nome = pl?.name || placeId;
    const primo = this.primaVolta(this.luoghi, placeId, tutto);
    return periodo([`Ambiente: ${nome}`, primo ? pl?.visual_prompt : undefined]);
  }

  /**
   * true se questa chiave non era ancora stata recitata, e da adesso lo e'.
   *
   * Con `tutto` risponde sempre true e non registra niente: e' la rilettura su
   * richiesta, che non deve consumare la prima volta di nessuno.
   */
  private primaVolta(registro: Set<string>, k: string, tutto: boolean): boolean {
    if (tutto) return true;
    if (registro.has(k)) return false;
    registro.add(k);
    return true;
  }
}

/** La chiave del registro dei personaggi: stessa forma di quella visiva in
 * `WebUI.giaLetto` — sono la stessa regola scritta per due uscite diverse, e
 * devono restare confrontabili a occhio. */
function chiave(id: string, campo: string, valore?: string): string {
  return `${id} ${campo} ${valore ?? ''}`;
}
