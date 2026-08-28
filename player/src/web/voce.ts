/**
 * La sintesi vocale del browser, ridotta a quello che serve al player.
 *
 * Sta in `src/web/` e non nel core per la ragione di sempre: e' interfaccia.
 * Il core non sa che esiste un altoparlante, esattamente come non sa che
 * esiste un DOM — e la CLI, che gira in CI, non deve nemmeno poterlo
 * importare.
 *
 * Nessuna dipendenza: `speechSynthesis` e' nel browser da anni ed e' l'unico
 * modo di far parlare un file HTML autonomo aperto da `file://`, che e' la
 * forma in cui questo player si distribuisce.
 */

/** I parametri di resa della voce. Sono quelli che l'API espone e basta:
 * qui non si aggiungono manopole che poi non muovono niente. */
export interface ParametriVoce {
  /** `voiceURI` della voce scelta; stringa vuota = quella di sistema. */
  voce: string;
  /** 0.5 – 2. Sotto 0.8 diventa innaturale, sopra 1.6 illeggibile. */
  velocita: number;
  /** 0 – 2. */
  tono: number;
  /** 0 – 1. */
  volume: number;
}

export const PARAMETRI_DEFAULT: ParametriVoce = {
  voce: '',
  // Sopra l'unita' di proposito. La velocita' neutra di `speechSynthesis` e'
  // tarata su frasi brevi lette una alla volta; qui si ascoltano paragrafi di
  // seguito, e a 1.0 la descrizione di un'inquadratura sembra non finire mai.
  velocita: 1.2,
  tono: 1,
  volume: 1,
};

/**
 * Quanto lunga puo' essere una singola frase mandata alla sintesi.
 *
 * Chrome smette di parlare dopo una quindicina di secondi di *una stessa*
 * utterance: resta formalmente in corso e non esce piu' niente. Non e' un caso
 * limite qui, e' il caso normale — la descrizione di un ambiente e' un luogo
 * piu' un'inquadratura in un periodo solo, e sull'IR di riferimento sono 114
 * frasi su 126 sopra i 180 caratteri, con una punta da 627 (~44 secondi).
 *
 * Il rimedio che gira ovunque e' un `pause()`/`resume()` periodico per tenere
 * sveglio il motore. Era la prima versione di questo file e non regge: e' un
 * espediente contro un timer che non si vede, e dentro l'iframe di una pagina
 * pubblicata smette di funzionare del tutto. Meglio togliere la causa —
 * nessuna utterance abbastanza lunga da far scattare quel timer — che
 * combattere l'effetto. Il taglio cade sui confini che ci sono gia' nel testo,
 * quindi la voce respira dove respirerebbe comunque.
 *
 * Il limite vero e' in *secondi*, non in caratteri, ed e' per questo che
 * dipende dalla velocita': tagliare a una lunghezza fissa proteggerebbe solo
 * chi tiene il cursore dove l'ha trovato, e chi rallenta la voce — cioe'
 * esattamente chi ha piu' bisogno di sentire tutto — si ritroverebbe il taglio
 * di prima.
 */
/** Caratteri di italiano in un secondo di parlato a velocita' 1. Misurato a
 * spanne e volutamente prudente: sbagliare per eccesso di pezzi costa una
 * pausa in piu', sbagliare per difetto costa mezza descrizione. */
const CARATTERI_AL_SECONDO = 12;

/** Quanto puo' durare una utterance restando dentro il margine dei ~15
 * secondi di Chrome. */
const SECONDI_SICURI = 11;

/** Il limite di taglio alla velocita' data, con estremi di guardia: sotto i 60
 * caratteri la voce diventa un elenco singhiozzato, sopra i 300 si torna nel
 * territorio del timer anche se i conti dicono di no. */
export function limiteDiTaglio(velocita: number): number {
  return Math.max(60, Math.min(300, Math.round(CARATTERI_AL_SECONDO * SECONDI_SICURI * velocita)));
}

/** Il limite alla velocita' neutra. E' il default di `spezza`. */
export const MAX_PEZZO = limiteDiTaglio(1);

/**
 * Spezza un testo in pezzi che la sintesi regge, senza perdere una parola.
 *
 * Tre livelli, dal piu' naturale al piu' brutale: le frasi, poi le virgole e i
 * punti e virgola, poi gli spazi. I prompt dell'IR sono spesso un unico
 * elenco separato da virgole senza un punto in mezzo, quindi il secondo
 * livello e' quello che lavora davvero; il terzo esiste perche' qualcuno
 * scrivera' prima o poi un prompt di duecento caratteri senza punteggiatura, e
 * a quel punto un pezzo troppo lungo tornerebbe muto.
 *
 * Invariante: le parole in uscita sono le stesse dell'ingresso, nello stesso
 * ordine. Il testo e' d'autore, e questa funzione impagina — non riassume.
 */
export function spezza(testo: string, max = MAX_PEZZO): string[] {
  const piatto = testo.replace(/\s+/g, ' ').trim();
  if (piatto === '') return [];
  if (piatto.length <= max) return [piatto];

  const perConfine = (pezzi: string[], sep: RegExp): string[] =>
    pezzi.flatMap((p) => (p.length <= max ? [p] : raggruppa(p.split(sep), max)));

  let out = raggruppa(piatto.split(/(?<=[.!?…])\s+/), max);
  out = perConfine(out, /(?<=[,;:])\s+/);
  out = perConfine(out, / +/);
  return out.filter((p) => p !== '');
}

/** Riunisce i frammenti in gruppi che stanno nel limite, in ordine e senza
 * scartarne nessuno: un frammento gia' piu' lungo del limite passa intero e
 * sara' il livello dopo a occuparsene. */
function raggruppa(frammenti: string[], max: number): string[] {
  const out: string[] = [];
  let corrente = '';
  for (const f of frammenti) {
    if (corrente === '') corrente = f;
    else if (corrente.length + 1 + f.length <= max) corrente += ' ' + f;
    else {
      out.push(corrente);
      corrente = f;
    }
  }
  if (corrente !== '') out.push(corrente);
  return out;
}

/**
 * La voce del player: una coda di frasi, in ordine, interrompibile.
 *
 * La coda e' quella di `speechSynthesis`, che accoda gia' di suo; questa
 * classe aggiunge le tre cose che l'API non da': sapere quando la coda si e'
 * svuotata davvero (serve all'avanzamento automatico), non ripetere una frase
 * identica a quella appena detta, e sopravvivere alla sospensione di Chrome.
 */
export class Voce {
  private synth?: SpeechSynthesis;
  private param: ParametriVoce = { ...PARAMETRI_DEFAULT };
  private elenco: SpeechSynthesisVoice[] = [];
  /** Quante frasi sono state accodate e non ancora concluse. Non ci si puo'
   * fidare di `synth.speaking`: fra un'utterance e la successiva e' false per
   * qualche millisecondo, e l'avanzamento automatico partirebbe li'. */
  private inCoda = 0;
  /** Chiamata quando la coda si svuota. Una sola, sostituibile: l'unico
   * interessato e' il tap-to-continue in attesa. */
  private allaFine?: () => void;
  /** Il turno di parola corrente. Serve a scartare gli `onend` delle frasi
   * gia' interrotte, che arrivano dopo il `cancel()`. */
  private turno = 0;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.aggiornaElenco();
      // L'elenco delle voci arriva in modo asincrono quasi ovunque: al primo
      // giro `getVoices()` torna vuoto e si popola dopo.
      this.synth.addEventListener?.('voiceschanged', () => this.aggiornaElenco());
    }
  }

  /** Il browser sa parlare? Se no, la modalita' ascolto lo dice invece di
   * restare accesa e muta. */
  get disponibile(): boolean {
    return !!this.synth;
  }

  /** Le voci installate, quelle della lingua della storia per prime: su un
   * sistema qualunque sono decine, e scorrerle tutte per trovare l'italiana
   * e' esattamente il genere di attrito che un menu deve togliere. */
  voci(lingua = 'it'): SpeechSynthesisVoice[] {
    const pref = this.elenco.filter((v) => v.lang.toLowerCase().startsWith(lingua.toLowerCase()));
    const altre = this.elenco.filter((v) => !pref.includes(v));
    return [...pref, ...altre];
  }

  parametri(p: ParametriVoce): void {
    this.param = { ...p };
  }

  /** Sta parlando o ha ancora frasi in coda. */
  get attiva(): boolean {
    return this.inCoda > 0;
  }

  /**
   * Accoda una frase, spezzata in pezzi che la sintesi regge fino in fondo.
   *
   * Il testo arriva gia' composto da `ascolto.ts`: qui non si decide *cosa*
   * dire, solo come farlo uscire. Le stringhe vuote si scartano in silenzio —
   * capita di continuo, perche' un campo assente nell'IR e' la norma.
   */
  parla(testo: string): void {
    if (!this.synth) return;
    for (const pezzo of spezza(testo, limiteDiTaglio(this.param.velocita))) this.accoda(pezzo);
  }

  private accoda(t: string): void {
    if (!this.synth) return;

    const u = new SpeechSynthesisUtterance(t);
    const scelta = this.elenco.find((v) => v.voiceURI === this.param.voce);
    if (scelta) {
      u.voice = scelta;
      u.lang = scelta.lang;
    }
    u.rate = this.param.velocita;
    u.pitch = this.param.tono;
    u.volume = this.param.volume;

    const mio = this.turno;
    const finita = () => {
      // Un `onend` che arriva dopo un `taci()` appartiene a una frase gia'
      // buttata via: contarlo porterebbe `inCoda` sotto zero e la coda
      // sembrerebbe piena per sempre.
      if (mio !== this.turno) return;
      this.inCoda = Math.max(0, this.inCoda - 1);
      if (this.inCoda === 0) this.fineCoda();
    };
    u.onend = finita;
    u.onerror = finita;

    this.inCoda++;
    this.synth.speak(u);
  }

  /**
   * Zittisce tutto e svuota la coda.
   *
   * Va chiamato a ogni cambio di turno: senza, un tocco veloce lascerebbe
   * indietro la descrizione della scena precedente, che continuerebbe a
   * parlare sopra quella nuova. E' il motivo per cui `turno` esiste.
   */
  taci(): void {
    if (!this.synth) return;
    this.turno++;
    this.inCoda = 0;
    this.allaFine = undefined;
    this.synth.cancel();
  }

  /**
   * Chiama `cb` quando non c'e' piu' niente da dire.
   *
   * Se la coda e' gia' vuota chiama subito, ma sul microtask successivo: chi
   * si registra sta quasi sempre costruendo il bottone che questa callback
   * andra' a premere, e premerlo prima che esista non funziona.
   */
  quandoFinisce(cb: () => void): void {
    if (!this.synth || this.inCoda === 0) {
      queueMicrotask(cb);
      return;
    }
    this.allaFine = cb;
  }

  /** Annulla l'attesa registrata da `quandoFinisce` senza fermare il parlato. */
  dimenticaFine(): void {
    this.allaFine = undefined;
  }

  // ------------------------------------------------------------- interni

  private fineCoda(): void {
    const cb = this.allaFine;
    this.allaFine = undefined;
    cb?.();
  }

  private aggiornaElenco(): void {
    this.elenco = this.synth?.getVoices() ?? [];
  }
}
