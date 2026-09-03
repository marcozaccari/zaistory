/**
 * La modalità ascolto: la storia recitata invece che letta.
 *
 * Il player mostra i prompt di generazione come testo perché un giorno saranno
 * immagine, suono e voce. Chi non guarda lo schermo ha lo stesso bisogno, e ce
 * l'ha *adesso*: la descrizione di un'inquadratura letta ad alta voce è
 * l'immagine, finché l'immagine non esiste. Da qui la modalità: non un lettore
 * di schermo attaccato sopra, ma una seconda uscita del player, che riceve gli
 * stessi dati dell'altra e li dispone per l'orecchio.
 *
 * Tre regole tengono in piedi il resto.
 *
 * 1. **Non si inventa prosa, come da nessun'altra parte.** Ogni frase che esce
 *    di qui è testo d'autore preso dalla storia. Le uniche parole del player
 *    sono le etichette dei campi — «Ambiente:», «Personaggio:», «Voce:» — e
 *    sono le stesse che sullo schermo stanno scritte accanto al valore, dette
 *    invece che disegnate. Un'etichetta non è narrazione: è il nome della cosa.
 *
 * 2. **Si collassa come si collassa a schermo.** Il palco mostra per intero il
 *    prompt di un luogo o di un personaggio la prima volta e poi lo lascia
 *    fermo lì; all'orecchio non esiste niente che resti fermo, quindi la stessa
 *    regola diventa: la prima volta la composizione per intero, dalla seconda
 *    solo il nome. Il registro è separato da quello visivo di proposito — sono
 *    due uscite indipendenti, e giocare a schermo spento non deve cambiare
 *    quello che si vedrebbe riaccendendolo — ma la regola è identica.
 *
 * 3. **Il dock non si legge.** Né «scrivi cosa fai», né le scelte di dialogo,
 *    né la conferma della voce appena toccata: è tutto rumore che copre la
 *    storia, e una scelta la si tocca perché la si è già vista. Si recita
 *    quello che *è successo* — narrazione, battute, esito dei comandi — non
 *    l'interfaccia con cui lo si è chiesto.
 *
 *    Un'eccezione sola, e non contraddice la regola: **l'uscita mostrata
 *    quando nel luogo non resta più niente da fare**. Lì il dock non è un
 *    elenco fra cui scegliere, è l'unica cosa rimasta — e tacerla
 *    significherebbe lasciare chi non guarda lo schermo esattamente nel muro
 *    che questa regola voleva togliere.
 */

import type { Phase, Place, StoryIndex, TurnEvent } from '../core/index.js';
import { displayName } from '../core/index.js';
import { PARAMETRI_DEFAULT, Voce, type ParametriVoce } from './voice.js';

export interface ImpostazioniAscolto extends ParametriVoce {
  /** La modalità è accesa. */
  attiva: boolean;
  /**
   * Recita anche i prompt di suono e i prompt del tipo di voce.
   *
   * Spento di default: sono i campi che descrivono *come* qualcosa suonerà, e
   * sentirseli leggere da una voce sintetica in mezzo alla storia è una
   * rottura del quarto muro continua. Chi sta collaudando la resa sonora di
   * una storia invece li vuole tutti, ed è l'unico modo di verificarli senza
   * guardare.
   */
  suoniEVoci: boolean;
  /**
   * Finita la lettura, si prosegue da soli.
   *
   * Vale dove c'è un solo passo possibile — l'uscita suggerita, la battuta
   * unica di un dialogo. Resta spegnibile perché il ritmo del tocco è anche il
   * modo in cui si rilegge un passaggio.
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
 * finale conta: è quello che fa respirare la sintesi fra un campo e l'altro. */
function periodo(parti: Array<string | undefined | false>): string {
  return parti
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => (/[.!?…:]$/.test(p.trim()) ? p.trim() : p.trim() + '.'))
    .join(' ');
}

export class Listen {
  private imp: ImpostazioniAscolto = { ...ASCOLTO_DEFAULT };

  /** I luoghi la cui descrizione è già stata recitata per intero. */
  private luoghi = new Set<string>();
  /** Le inquadrature già recitate, per testo del prompt: due beat con lo stesso
   * `image_prompt` sono la stessa inquadratura, e ridirla è ripetersi. */
  private inquadrature = new Set<string>();
  /** I prompt di personaggio già recitati: `id NUL campo NUL testo`, perché un
   * override locale è un valore diverso e va risentito la prima volta. */
  private personaggi = new Set<string>();
  /** Dove eravamo l'ultima volta: la composizione si ridice solo entrando. */
  private dove = '';

  constructor(
    private idx: StoryIndex,
    readonly voce: Voce,
  ) {}

  // ------------------------------------------------------------ impostazioni

  get impostazioni(): ImpostazioniAscolto {
    return { ...this.imp };
  }

  /** Vera solo se la modalità è accesa *e* il browser sa parlare: altrove
   * resterebbe accesa e muta, che è il peggiore dei due stati. */
  get attiva(): boolean {
    return this.imp.attiva && this.voce.disponibile;
  }

  configura(imp: ImpostazioniAscolto): void {
    const eraAttiva = this.attiva;
    this.imp = { ...imp };
    this.voce.parametri(imp);
    if (eraAttiva && !this.attiva) this.voce.taci();
  }

  /** Una partita nuova riparte senza memoria: i registri sono lunghi quanto la
   * partita, altrimenti ricominciando il primo luogo arriverebbe già collassato
   * — cioè muto. */
  ricomincia(): void {
    this.luoghi.clear();
    this.inquadrature.clear();
    this.personaggi.clear();
    this.dove = '';
    this.voce.taci();
  }

  taci(): void {
    this.voce.taci();
  }

  /** La lingua dichiarata dalla storia, per proporre le voci giuste nel menu. */
  get lingua(): string {
    return this.idx.story.language || 'it';
  }

  // ------------------------------------------------------------------ dettato

  /**
   * La copertina.
   *
   * Titolo e descrizione perché sono la storia; lo stile globale perché è il
   * prompt che finisce in coda a *ogni* immagine, cioè la cornice dentro cui va
   * immaginato tutto il resto. I metadati (versione, id, numero di atti)
   * restano muti: servono a riconoscere un file, non a giocarlo.
   */
  copertina(): void {
    if (!this.attiva) return;
    const st = this.idx.story;
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

  /**
   * Un turno intero: prima dove siamo, poi cosa è successo.
   *
   * È lo stesso ordine con cui la pagina si impagina — il palco in cima, il
   * racconto sotto — e per la stessa ragione: prima si sa dove si è, poi si
   * capisce quello che accade lì.
   *
   * La composizione si ridice solo **entrando**, cioè quando il posto è
   * cambiato. Un turno che non sposta niente non ha nessun luogo da annunciare:
   * ridirlo a ogni frase sarebbe la ripetizione che la regola 2 esiste per
   * togliere.
   */
  turno(events: TurnEvent[], pl: Place | undefined, ph: Phase | undefined): void {
    if (!this.attiva) return;
    const chiave = `${pl?.id ?? ''}/${ph?.id ?? ''}`;
    if (chiave !== this.dove) {
      this.dove = chiave;
      for (const f of this.composizione(pl, ph, false)) this.voce.parla(f);
    }
    for (const e of events) this.evento(e);
  }

  private evento(e: TurnEvent): void {
    switch (e.kind) {
      case 'narration': {
        if (e.beat?.image_prompt && this.primaVolta(this.inquadrature, e.beat.image_prompt, false)) {
          this.voce.parla(periodo([e.beat.image_prompt]));
        }
        this.voce.parla(e.text);
        // Il suono del beat arriva come evento suo, subito dopo: recitarlo
        // anche da qui lo direbbe due volte.
        if (this.imp.suoniEVoci && e.voice?.style_prompt) this.voce.parla(`Voce: ${e.voice.style_prompt}`);
        return;
      }
      case 'say': {
        if (this.imp.suoniEVoci && e.voice?.style_prompt) this.voce.parla(`Voce: ${e.voice.style_prompt}`);
        // Una didascalia non la dice nessuno: arriva come narrazione, e infatti
        // qui non ci passa. Qui c'è sempre qualcuno che parla.
        this.voce.parla(e.speaker ? `${e.speaker}: ${e.text}` : e.text);
        return;
      }
      case 'system':
        this.voce.parla(e.text);
        return;
      case 'sound':
        if (this.imp.suoniEVoci) this.voce.parla(`Suono: ${e.text}`);
        return;
      // `state`, `note` e `problem` sono diagnostica: si vedono a debug acceso e
      // non si recitano mai. Chi ascolta sta giocando, non collaudando — e una
      // voce che legge «manca description su x» in mezzo alla storia è il modo
      // più rapido di uscirne.
      default:
        return;
    }
  }

  /**
   * «Guardati intorno»: la composizione per intero, di nuovo.
   *
   * È il contrappeso del collapse. Collassare fa risparmiare ripetizioni, ma
   * toglie a chi ascolta l'unico modo di rifarsi un'immagine di dove si trova;
   * a schermo quella riga resta lì e si rilegge, all'orecchio si riapre
   * chiedendolo. I registri non si toccano: è una rilettura su richiesta, non
   * una prima visita, e la volta dopo si torna a collassare.
   *
   * Il testo di `look` non lo dice questo metodo: arriva dal core come esito
   * del verbo, e lo recita la strada normale subito dopo.
   */
  riosserva(pl: Place | undefined, ph: Phase | undefined): void {
    if (!this.attiva) return;
    for (const f of this.composizione(pl, ph, true)) this.voce.parla(f);
  }

  /**
   * Le uscite mostrate quando non resta niente da fare: l'unica parte del dock
   * che si recita. Non è l'elenco delle azioni che rientra dalla finestra —
   * quando questo metodo viene chiamato, nel luogo non è rimasto nessun enigma
   * da proteggere.
   */
  uscite(etichette: string[]): void {
    if (!this.attiva || etichette.length === 0) return;
    for (const e of etichette) this.voce.parla(e);
  }

  /** Il finale, con il motivo per cui la partita si è chiusa. */
  finale(motivo?: string): void {
    if (!this.attiva) return;
    this.voce.parla(periodo(['Fine', motivo]));
  }

  /**
   * Prova la voce, anche a modalità spenta: è la sola cosa che si fa nel menu
   * prima di accenderla, e chiederle di essere già accesa per poterla regolare
   * sarebbe un giro assurdo.
   *
   * Il testo di prova è il titolo della storia, non una frase di comodo: anche
   * qui non si inventa niente, e per giunta è il campione più utile — sono i
   * nomi propri della storia quelli su cui una voce sintetica inciampa.
   */
  prova(): void {
    this.voce.taci();
    this.voce.parla(periodo([this.idx.story.title, this.idx.story.description]));
  }

  // ------------------------------------------------------------------ interni

  /**
   * Le frasi che descrivono dove si è: l'ambiente, l'inquadratura di base, chi
   * c'è. `tutto` salta i registri senza aggiornarli: è la strada di `riosserva`.
   */
  private composizione(pl: Place | undefined, ph: Phase | undefined, tutto: boolean): string[] {
    const out: string[] = [];
    const bg = ph?.background;
    const nuova = bg?.image_prompt ? this.primaVolta(this.inquadrature, bg.image_prompt, tutto) : false;

    out.push(periodo([this.dettaLuogo(pl, ph, tutto), nuova ? bg?.image_prompt : undefined]));

    if (this.imp.suoniEVoci && nuova && bg?.ambient_sound_prompt) {
      out.push(`Ambiente sonoro: ${bg.ambient_sound_prompt}`);
    }

    // Chi c'è: aspetto e voce come valgono *qui*, cioè l'override della fase se
    // c'è, altrimenti la roster. È la stessa scelta che fa il palco a schermo.
    for (const c of ph?.characters ?? []) {
      if (c.id === this.idx.story.protagonist) continue;
      const g = this.idx.characters.get(c.id);
      const nome = displayName(g ?? { id: c.id });
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
   * Il luogo: il nome sempre, la descrizione solo la prima volta.
   *
   * È il cuore della regola. Senza il nome, chi ascolta non sa di essere
   * tornato dove era già stato; con la descrizione ogni volta, la storia annega
   * in un paragrafo ripetuto cinque volte per stanza.
   */
  private dettaLuogo(pl: Place | undefined, ph: Phase | undefined, tutto: boolean): string | undefined {
    if (!pl) return ph?.title ? `Ambiente: ${ph.title}` : undefined;
    // L'identità visiva è del posto, non del nodo del grafo: due luoghi legati
    // da `same_as` sono la stessa stanza in due atti, e ridescriverla al
    // secondo passaggio sarebbe raccontare da capo un posto in cui si è già
    // stati.
    const identita = pl.same_as ?? pl.id;
    const primo = this.primaVolta(this.luoghi, identita, tutto);
    return periodo([`Ambiente: ${displayName(pl)}`, primo ? pl.visual_prompt : undefined]);
  }

  /**
   * true se questa chiave non era ancora stata recitata, e da adesso lo è.
   *
   * Con `tutto` risponde sempre true e non registra niente: è la rilettura su
   * richiesta, che non deve consumare la prima volta di nessuno.
   */
  private primaVolta(registro: Set<string>, k: string, tutto: boolean): boolean {
    if (tutto) return true;
    if (registro.has(k)) return false;
    registro.add(k);
    return true;
  }
}

/** La chiave del registro dei personaggi. */
function chiave(id: string, campo: string, valore?: string): string {
  return `${id} ${campo} ${valore ?? ''}`;
}
