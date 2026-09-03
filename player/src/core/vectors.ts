/**
 * Il secondo interprete: i vettori.
 *
 * Il parser lessicale decide sempre per primo, e dove ha deciso non si tocca.
 * I vettori intervengono in due punti soltanto, e la regola che li separa sta
 * in una riga: **embedding dove sbagliare non costa niente, lessicale dove
 * sbagliare cambia lo stato.**
 *
 * 1. **Dove il lessicale è muto** — nessuna candidata sopra la soglia — e solo
 *    se la similarità è alta. È la zona grigia: le parafrasi legittime che il
 *    compilatore non ha previsto, dove un rifiuto significa dire di no a un
 *    giocatore che aveva risolto l'enigma. Fuori di lì non toccano niente,
 *    perché gli embedding di frase sono ciechi sulla negazione e sulla
 *    direzione degli argomenti — «non toccare il cavo» e «tocca il cavo» hanno
 *    vettori quasi identici — e un falso positivo qui *esegue*.
 *
 *    Muto per debolezza, non per ambiguità: se due azioni se la giocano alla
 *    pari il problema non è che manchi comprensione, e aggiungerne non lo
 *    risolve.
 *
 * 2. **Nella scelta del fallback**, sempre. Lì sbagliare è gratis: nessun
 *    effetto, nessuna transizione, al peggio una battuta un po' fuori
 *    bersaglio. È l'unico posto del sistema dove la geometria può decidere
 *    senza rischio, ed è anche dove rende di più, perché azzecca la famiglia
 *    del tentativo meglio di una tabella di verbi.
 *
 * `puro` toglie quella prudenza, ed è voluto: serve a **misurare** cosa
 * farebbero i vettori da soli — l'unico modo di dire quanto stanno aggiungendo
 * davvero nell'ibrido invece di limitarsi a confermare. Non è la modalità con
 * cui far giocare qualcuno: lì un falso positivo esegue.
 *
 * Il modello non lo procura questo file: riceve una funzione che trasforma
 * frasi in vettori, e chi costruisce il player decide da dove viene. Così il
 * core non dipende da nessun modello e il file HTML unico resta unico.
 */

import type { Action, Exit, NoMatch, StoryIndex } from './types.js';
import { entitySurfaces, MARGIN, type Resolution } from './parser.js';
import { exitSurfaces } from './engine.js';

/** Trasforma frasi in vettori. La fornisce chi costruisce il player: il web da
 * CDN, la CLI da una dipendenza opzionale. */
export type Embed = (testi: string[]) => Promise<number[][]>;

/**
 * Quanto deve valere la similarità perché i vettori possano eseguire.
 *
 * Più alta della soglia lessicale, e non per simmetria: qui si sta scavalcando
 * un rifiuto già pronunciato, e il prezzo di sbagliare è un effetto che nessuno
 * ha chiesto.
 */
export const SOGLIA_EMBEDDING = 0.72;

/** Come i vettori si mettono accanto al lessicale. Vedi la testata. */
export type ModoVettori = 'ibrido' | 'puro';

export class VectorResolver {
  private cache = new Map<string, number[]>();

  constructor(
    private readonly embed: Embed,
    readonly modo: ModoVettori = 'ibrido',
    readonly etichetta = 'embedding',
  ) {}

  get name(): string {
    return this.modo === 'ibrido'
      ? `lessicale + ${this.etichetta} (i vettori solo dove il lessicale tace)`
      : `${this.etichetta} (solo vettori, nessun lessicale)`;
  }

  /**
   * La candidata più vicina alla frase, se ce n'è una abbastanza vicina e
   * abbastanza sola. `undefined` vuol dire «nemmeno io ho capito», che è una
   * risposta legittima e non un fallimento da aggirare.
   */
  async vicina(
    idx: StoryIndex,
    phrase: string,
    actions: Action[],
    exits: Exit[],
  ): Promise<{ res: Resolution; score: number; runnerUp: number } | undefined> {
    const voci: { res: Resolution; testo: string }[] = [];
    for (const e of exits) {
      const s = exitSurfaces(idx, e);
      if (s.length) voci.push({ res: { kind: 'exit', exit: e, score: 0 }, testo: s.join('. ') });
    }
    for (const a of actions) {
      const s = superfici(idx, a);
      if (s.length) voci.push({ res: { kind: 'action', action: a, score: 0 }, testo: s.join('. ') });
    }
    if (!voci.length) return undefined;

    const vettori = await this.vettori([phrase, ...voci.map((v) => v.testo)]);
    const q = vettori[0];
    let migliore = -1;
    let secondo = -1;
    let vinta: Resolution | undefined;
    voci.forEach((v, i) => {
      const s = coseno(q, vettori[i + 1]);
      if (s > migliore) {
        secondo = migliore;
        migliore = s;
        vinta = v.res;
      } else if (s > secondo) {
        secondo = s;
      }
    });

    if (!vinta || migliore < SOGLIA_EMBEDDING || migliore - Math.max(secondo, 0) < MARGIN) return undefined;
    const res: Resolution =
      vinta.kind === 'action'
        ? { kind: 'action', action: vinta.action, score: migliore }
        : { kind: 'exit', exit: (vinta as { exit: Exit }).exit, score: migliore };
    return { res, score: migliore, runnerUp: Math.max(secondo, 0) };
  }

  /**
   * Il fallback d'autore più vicino al tentativo.
   *
   * Non ne scrive uno: ne **sceglie** uno fra quelli che l'autore ha scritto,
   * esattamente come fa il lessicale con la tabella delle intenzioni. Con un
   * solo fallback in gioco non c'è niente da scegliere e si lascia decidere a
   * chi ha chiamato.
   */
  async fallback(phrase: string, pool: NoMatch[]): Promise<string | undefined> {
    if (pool.length < 2) return undefined;
    const vettori = await this.vettori([phrase, ...pool.map((n) => n.text)]);
    const q = vettori[0];
    let migliore = -1;
    let scelto: NoMatch | undefined;
    pool.forEach((n, i) => {
      const s = coseno(q, vettori[i + 1]);
      if (s > migliore) {
        migliore = s;
        scelto = n;
      }
    });
    return scelto?.text;
  }

  /** Vettori con memoria: le superfici delle candidate tornano identiche a ogni
   * tentativo nello stesso luogo, e ricalcolarle è il grosso del costo. */
  private async vettori(testi: string[]): Promise<number[][]> {
    const mancanti = testi.filter((t) => !this.cache.has(t));
    if (mancanti.length) {
      const nuovi = await this.embed(mancanti);
      mancanti.forEach((t, i) => this.cache.set(t, nuovi[i]));
    }
    return testi.map((t) => this.cache.get(t) ?? []);
  }
}

/**
 * Le superfici di un'azione: come la si può chiamare a parole.
 *
 * Il nome del bersaglio e i suoi alias, più le frasi di prova che il
 * compilatore ha scritto — che sono l'unico posto in cui il *gesto* è scritto
 * per esteso, e per un modello di frasi contano più di qualunque etichetta.
 */
function superfici(idx: StoryIndex, a: Action): string[] {
  const out = [...entitySurfaces(idx, a.target), ...entitySurfaces(idx, a.second_target)];
  for (const t of a.test_phrases ?? []) out.push(t);
  return out;
}

export function coseno(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let p = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    p += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return p / Math.sqrt(na * nb);
}
