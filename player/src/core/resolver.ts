/**
 * Il resolver dell'input testuale libero.
 *
 * L'interfaccia e' fissata dall'architettura: riceve le azioni disponibili
 * nella scena, il testo libero del giocatore e il tono della scena, e ritorna
 * l'id di un'azione *gia' esistente* oppure nessun match con una narrazione di
 * fallback in-character.
 *
 * Vincolo non negoziabile: un resolver non genera mai un effetto di sua
 * iniziativa, sceglie solo quale azione gia' definita eseguire. E' l'equivalente
 * moderno del "Non puoi farlo" dei punta-e-clicca: coerente col tono della
 * scena, ma senza alcun potere sullo stato del gioco.
 *
 * Vincolo aggiunto in 1.8.0, gemello del primo e altrettanto stretto: **un
 * resolver non genera mai nemmeno il testo del fallback**. Lo sceglie fra
 * quelli che l'autore ha scritto in `no_match_narration`, classificando il
 * tipo di tentativo. Un fallback generato inventerebbe scenario che nella
 * scena non esiste — e in un gioco a enigmi una lampada nominata per colore e'
 * un falso indizio su cui il giocatore perde dieci minuti — e non sarebbe
 * controllabile da nessun linter.
 */

import type { Intent, NoMatch } from './types.js';
import { affinita, classificaIntento, penalitaIntento, radici, simili } from './lexical.js';

/**
 * Un'azione tra cui il resolver puo' scegliere.
 *
 * Solo azioni di scena: le scelte di dialogo non arrivano mai qui. Il parlato
 * si gioca a scelte esplicite come nelle avventure grafiche classiche, e
 * quando un dialogue_tree e' aperto il player mostra l'elenco e il resolver non
 * viene nemmeno interpellato.
 */
export interface Candidate {
  id: string;
  label: string;
  target?: string;
  aliases?: string[];
  /**
   * L'azione esiste in questa scena ma la sua `Condition` non e' soddisfatta.
   *
   * Le azioni bloccate vanno passate lo stesso al resolver, ed e' la differenza
   * fra un menu e una conversazione: in un menu una voce filtrata sparisce e non
   * c'e' niente da dire, a parole il giocatore la chiede comunque. Se il
   * resolver ne sceglie una, il player mostra `blocked_narration` e **non
   * applica nessun effetto**: nessun flag, nessuna transizione, nessun oggetto.
   * Il vincolo "il resolver non genera logica" resta intatto — qui non genera
   * nemmeno il testo, che e' d'autore.
   */
  blocked?: boolean;
}

/**
 * L'anagrafica di una cosa nominabile — un oggetto, un personaggio — a cui
 * un'azione si riferisce col suo `target`.
 *
 * Serve perche' una frase nomina spesso la cosa e non il gesto: «il coltellino»
 * deve poter arrivare all'azione che ha `target: coltellino`, anche se
 * l'etichetta di quell'azione dice tutt'altro.
 */
export interface Entity {
  id: string;
  name?: string;
  aliases?: string[];
}

export interface ResolveRequest {
  candidates: Candidate[];
  input: string;
  tone: string;
  /** Anagrafiche a cui le azioni puntano con `target`. */
  world?: Entity[];
  /** I fallback d'autore fra cui scegliere quando non c'e' match: prima quelli
   * della scena, poi quelli globali. */
  noMatch?: NoMatch[];
  /** Indice di rotazione fra fallback della stessa intenzione, cosi' che due
   * tentativi di seguito non ricevano la stessa frase. */
  giro?: number;
}

/** Chi ha deciso l'esito. Si mostra giocando, di proposito: e' il solo modo di
 * accorgersi *mentre si gioca* di quanto spesso il backend costoso serva
 * davvero, invece di dedurlo da un benchmark. */
export type Via = 'lessicale' | 'embedding';

/** O un id di azione esistente, o niente. */
export interface ResolveResult {
  /** "" = nessun match. */
  actionId: string;
  /** Narrazione in-character da mostrare quando actionId e' vuoto. Sempre
   * testo d'autore: il resolver lo sceglie, non lo scrive. */
  fallback?: string;
  /** Il backend che ha deciso questo esito. */
  via?: Via;
  /** L'intenzione riconosciuta nella frase, quando non c'e' stato match. */
  intent?: Intent;
  /** Punteggio del vincitore e del secondo classificato: il secondo dice
   * quanto la scelta fosse contesa, che e' l'informazione che manca quando un
   * resolver sbaglia. */
  score?: number;
  runnerUp?: number;
  /** Riga diagnostica breve, per il debug e per la copertura. */
  why?: string;
}

/** Il contratto comune ai backend previsti (menu, lessicale, embedding,
 * Claude). Il resto del player non cambia al variare del backend: si sceglie
 * all'avvio e basta. */
export interface Resolver {
  /** Nome mostrato all'avvio. */
  readonly name: string;
  resolve(req: ResolveRequest): Promise<ResolveResult>;
}

// ------------------------------------------------------------------ soglie

/**
 * Le tre costanti che traducono in numeri la preferenza del progetto: meglio
 * un rifiuto che un'esecuzione sbagliata.
 *
 * - `ACCETTA` e' quanto deve valere il migliore per essere eseguito.
 * - `MARGINE` e' quanto deve staccare il secondo. Due azioni della stessa
 *   scena che se la giocano alla pari sono un'ambiguita' vera, e a
 *   un'ambiguita' vera si risponde con un fallback, non tirando a indovinare:
 *   sbagliando qui si applica un `Effect` che il giocatore non ha chiesto.
 * - `CERTEZZA` scavalca il margine: un alias detto quasi alla lettera e' una
 *   richiesta esplicita, non un indizio.
 *
 * Stanno esportate perche' sono il primo posto dove mettere le mani quando una
 * storia risulta troppo sorda o troppo credulona.
 */
export const ACCETTA = 0.55;
export const MARGINE = 0.08;
export const CERTEZZA = 0.92;

/**
 * Quanto pesa, nel punteggio finale, il fatto che la candidata conosca *anche
 * le altre* parole della frase.
 *
 * Serve a rompere i pareggi, e i pareggi qui non sono teorici: due azioni
 * della stessa scena possono avere un alias quasi identico ("apri il cassetto"
 * e "apri i cassetti"), e su quello solo il punteggio e' lo stesso a due
 * decimali. Chi ha in un *altro* dei suoi alias la parola che resta —
 * "scrivania", "schedario" — sa di che cosa si sta parlando, e vince. E'
 * poco per costruzione: deve spostare i pari merito, non decidere le partite.
 */
export const PESO_UNIONE = 0.12;

// -------------------------------------------------------------- lessicale

/** Il punteggio di una candidata, con la superficie che l'ha prodotto. */
export interface Punteggio {
  id: string;
  valore: number;
  /** Quale fra etichetta, alias e nome dell'oggetto ha fatto il punteggio:
   * serve a capire *perche'* una frase e' arrivata dove e' arrivata. */
  superficie: string;
}

/**
 * Le superfici di una candidata: tutte le stringhe con cui la si puo' chiedere.
 *
 * L'etichetta ci sta ma vale come le altre: e' scritta per essere letta su un
 * bottone, non per essere detta. Il grosso della copertura sono gli `aliases`,
 * che il compilatore genera apposta, piu' il nome e gli alias della cosa a cui
 * l'azione punta.
 */
export function superfici(c: Candidate, mondo?: Entity[]): string[] {
  const out = [c.label, ...(c.aliases ?? [])].filter((s): s is string => !!s);
  if (c.target) {
    const e = mondo?.find((x) => x.id === c.target);
    if (e?.name) out.push(e.name);
    for (const a of e?.aliases ?? []) out.push(a);
  }
  return out;
}

/** Classifica le candidate per affinita' con la frase, dalla migliore in giu'. */
export function classifica(req: ResolveRequest): Punteggio[] {
  const ingresso = radici(req.input);
  const out: Punteggio[] = [];
  for (const c of req.candidates) {
    let migliore = 0;
    let quale = '';
    const unione = new Set<string>();
    for (const s of superfici(c, req.world)) {
      const rs = radici(s);
      for (const r of rs) unione.add(r);
      const v = affinita(ingresso, rs) * penalitaIntento(ingresso, rs);
      if (v > migliore) {
        migliore = v;
        quale = s;
      }
    }
    // Quanto della frase la candidata riconosce mettendo insieme *tutti* i
    // suoi alias, non solo quello che ha fatto il punteggio.
    const riconosciute = ingresso.filter((r) => [...unione].some((u) => simili(r, u))).length;
    const unioneRichiamo = ingresso.length ? riconosciute / ingresso.length : 0;
    out.push({
      id: c.id,
      valore: migliore * (1 - PESO_UNIONE) + unioneRichiamo * PESO_UNIONE,
      superficie: quale,
    });
  }
  out.sort((a, b) => b.valore - a.valore);
  return out;
}

/**
 * Sceglie il fallback d'autore per un'intenzione.
 *
 * Prima quelli scritti per la scena, poi quelli globali (l'ordine della pool
 * e' gia' quello); a parita' di intenzione si ruota, cosi' due rifiuti di
 * seguito non danno la stessa frase. Se per quell'intenzione non c'e' niente
 * si ripiega su `generico`, ed e' la ragione per cui `generico` va scritto
 * sempre. Se non c'e' nemmeno quello, il player non inventa: non dice niente e
 * lo segnala come diagnostica.
 */
export function scegliFallback(pool: NoMatch[] | undefined, intent: Intent, giro = 0): string | undefined {
  if (!pool?.length) return undefined;
  const suoi = pool.filter((n) => n.intent === intent);
  const lista = suoi.length ? suoi : pool.filter((n) => n.intent === 'generico');
  if (!lista.length) return undefined;
  return lista[((giro % lista.length) + lista.length) % lista.length].text;
}

/**
 * Backend 2: matcher lessicale sugli alias scritti in compilazione.
 *
 * Zero dipendenze, zero rete, zero byte scaricati, deterministico. Copre le
 * frasi centrali — quelle che gli `aliases` prevedono — e rifiuta il resto,
 * che e' il modo giusto di sbagliare quando sbagliare significa applicare un
 * `Effect`.
 */
export class LexicalResolver implements Resolver {
  readonly name = 'lessicale (deterministico, nessun modello)';

  async resolve(req: ResolveRequest): Promise<ResolveResult> {
    return this.decidi(req);
  }

  /** La stessa decisione, sincrona: la usano il backend a embedding, che parte
   * da qui, e il rapporto di copertura, che ne fa migliaia di seguito. */
  decidi(req: ResolveRequest): ResolveResult {
    if (req.input.trim() === '') return { actionId: '', via: 'lessicale' };

    const classifiche = classifica(req);
    const primo = classifiche[0];
    const secondo = classifiche[1];
    const score = primo?.valore ?? 0;
    const runnerUp = secondo?.valore ?? 0;

    // La certezza scavalca il margine, ma non il pari merito: due candidate
    // con lo stesso identico punteggio restano un'ambiguita' anche quando
    // valgono 1.00, e sceglierne una sarebbe scegliere la prima dell'elenco.
    const certo = score >= CERTEZZA && score > runnerUp;
    const netto = score >= ACCETTA && score - runnerUp >= MARGINE;
    if (primo && (certo || netto)) {
      return {
        actionId: primo.id,
        via: 'lessicale',
        score,
        runnerUp,
        why: `"${primo.superficie}" ${score.toFixed(2)} (secondo ${runnerUp.toFixed(2)})`,
      };
    }

    const intent = classificaIntento(req.input);
    const perche =
      score < ACCETTA
        ? `nessuna candidata sopra ${ACCETTA} (migliore ${score.toFixed(2)})`
        : `ambigua: ${score.toFixed(2)} contro ${runnerUp.toFixed(2)}, margine < ${MARGINE}`;
    return {
      actionId: '',
      via: 'lessicale',
      intent,
      score,
      runnerUp,
      fallback: scegliFallback(req.noMatch, intent, req.giro ?? 0),
      why: perche,
    };
  }
}

// -------------------------------------------------------------- embedding

/**
 * Calcola i vettori di un elenco di frasi. La fornisce chi costruisce il
 * player — la CLI da una dipendenza opzionale, il web da CDN — cosi' il core
 * non dipende da nessun modello e il file HTML unico resta unico.
 */
export type Embed = (testi: string[]) => Promise<number[][]>;

export const SOGLIA_EMBEDDING = 0.72;

/**
 * Come i vettori si mettono accanto al lessicale.
 *
 * - `ibrido` — il lessicale decide, i vettori intervengono solo dove tace.
 *   E' la modalita' con cui si **gioca**.
 * - `puro` — i vettori decidono da soli, il lessicale non viene consultato.
 *   E' la modalita' con cui si **misura**: serve a sapere cosa farebbe
 *   l'embedder da solo, che e' l'unico modo di dire quanto sta aggiungendo
 *   davvero nell'ibrido invece di limitarsi a confermare.
 */
export type ModoEmbedding = 'ibrido' | 'puro';

/**
 * Backend 3: embedding locali.
 *
 * In `ibrido` non e' una cascata ingenua. Il lessicale ha sempre la precedenza
 * sulla risoluzione di un'azione, e l'embedder interviene in due punti
 * soltanto:
 *
 * 1. **dove il lessicale e' muto** — nessuna candidata sopra la soglia — e
 *    solo se la similarita' e' alta. E' la zona grigia: le parafrasi legittime
 *    che il compilatore non ha previsto, dove un rifiuto significa dire di no
 *    a un giocatore che aveva risolto l'enigma. Fuori di li' non tocca niente,
 *    perche' gli embedding di frase sono ciechi sulla negazione e sulla
 *    direzione degli argomenti — «non toccare il cavo» e «tocca il cavo»
 *    hanno vettori quasi identici — e un falso positivo qui *esegue*.
 * 2. **nella scelta del fallback**, sempre. Li' sbagliare e' gratis: nessun
 *    effetto, nessuna transizione, al peggio una battuta un po' fuori
 *    bersaglio. E' l'unico posto del sistema dove la geometria puo' decidere
 *    senza rischio, ed e' anche dove rende di piu', perche' azzecca la
 *    famiglia del tentativo meglio di una tabella di verbi.
 *
 * In una riga: embedding dove sbagliare non costa niente, lessicale dove
 * sbagliare cambia lo stato.
 *
 * In `puro` quella prudenza non c'e', ed e' voluto: si vuole vedere l'errore,
 * non evitarlo. Non e' la modalita' con cui far giocare qualcuno.
 */
export class EmbeddingResolver implements Resolver {
  readonly name: string;

  private base = new LexicalResolver();
  private cache = new Map<string, number[]>();

  constructor(
    private embed: Embed,
    private modo: ModoEmbedding = 'ibrido',
    etichetta = 'embedding',
  ) {
    this.name =
      modo === 'ibrido'
        ? `lessicale + ${etichetta} (i vettori solo dove il lessicale tace)`
        : `${etichetta} (solo vettori, nessun lessicale)`;
  }

  async resolve(req: ResolveRequest): Promise<ResolveResult> {
    if (req.input.trim() === '') return { actionId: '', via: 'embedding' };

    // Nell'ibrido il lessicale parla per primo, e se ha deciso non si tocca.
    const lessicale = this.modo === 'ibrido' ? this.base.decidi(req) : undefined;
    if (lessicale?.actionId) return lessicale;

    // Si prova con i vettori solo quando il lessicale e' muto per debolezza,
    // non per ambiguita': se due azioni se la giocano alla pari il problema non
    // e' che manchi comprensione, e aggiungerne non lo risolve. Nel modo puro
    // non c'e' nessun lessicale da cui ereditare l'ambiguita'.
    const ambigua = this.modo === 'ibrido' && (lessicale?.score ?? 0) >= ACCETTA;
    let esito: ResolveResult = lessicale
      ? { ...lessicale, via: 'lessicale' }
      : { actionId: '', via: 'embedding', intent: classificaIntento(req.input) };

    if (!ambigua && req.candidates.length > 0) {
      const { id, migliore, secondo } = await this.vicina(req);
      if (id && migliore >= SOGLIA_EMBEDDING && migliore - Math.max(secondo, 0) >= MARGINE) {
        return {
          actionId: id,
          via: 'embedding',
          score: migliore,
          runnerUp: secondo,
          why:
            this.modo === 'ibrido'
              ? `lessicale muto (${(lessicale?.score ?? 0).toFixed(2)}), embedding ${migliore.toFixed(2)}`
              : `embedding ${migliore.toFixed(2)} (secondo ${secondo.toFixed(2)})`,
        };
      }
      const perche = `embedding ${migliore.toFixed(2)} sotto ${SOGLIA_EMBEDDING}`;
      esito = { ...esito, why: esito.why ? `${esito.why}; ${perche}` : perche };
    }

    // Instradamento del fallback: qui l'embedder decide sempre, in tutte e due
    // le modalita', perche' qui sbagliare non costa niente.
    const pool = req.noMatch ?? [];
    if (pool.length > 1) {
      const vettori = await this.vettori([req.input, ...pool.map((n) => n.text)]);
      const q = vettori[0];
      let migliore = -1;
      let scelto = pool[0];
      pool.forEach((n, i) => {
        const s = coseno(q, vettori[i + 1]);
        if (s > migliore) {
          migliore = s;
          scelto = n;
        }
      });
      return {
        ...esito,
        via: 'embedding',
        fallback: scelto.text,
        intent: scelto.intent,
        why: `${esito.why ?? ''}; fallback per vettore ${migliore.toFixed(2)}`,
      };
    }
    if (!esito.fallback && esito.intent) {
      esito = { ...esito, fallback: scegliFallback(req.noMatch, esito.intent, req.giro ?? 0) };
    }
    return esito;
  }

  /** La candidata piu' vicina alla frase, e quanto stacca la seconda. */
  private async vicina(req: ResolveRequest): Promise<{ id: string; migliore: number; secondo: number }> {
    const frasi = req.candidates.map((c) => superfici(c, req.world).join('. '));
    const vettori = await this.vettori([req.input, ...frasi]);
    const q = vettori[0];
    let migliore = -1;
    let secondo = -1;
    let id = '';
    req.candidates.forEach((c, i) => {
      const s = coseno(q, vettori[i + 1]);
      if (s > migliore) {
        secondo = migliore;
        migliore = s;
        id = c.id;
      } else if (s > secondo) {
        secondo = s;
      }
    });
    return { id, migliore, secondo };
  }

  /** Vettori con memoria: le superfici delle candidate tornano identiche a
   * ogni tentativo nella stessa scena, e ricalcolarle e' il grosso del costo. */
  private async vettori(testi: string[]): Promise<number[][]> {
    const mancanti = testi.filter((t) => !this.cache.has(t));
    if (mancanti.length) {
      const nuovi = await this.embed(mancanti);
      mancanti.forEach((t, i) => this.cache.set(t, nuovi[i]));
    }
    return testi.map((t) => this.cache.get(t) ?? []);
  }
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

// ----------------------------------------------------------------- scelta

export interface ResolverOptions {
  /** Necessaria per i backend a vettori, che il core non sa costruire da solo:
   * il modello lo procura chi costruisce il player. */
  embed?: Embed;
  /** Etichetta del modello, per il nome mostrato all'avvio. */
  modello?: string;
}

/** I nomi con cui si sceglie una modalita'. */
export const MODALITA = ['lessicale', 'embedding', 'ibrido'] as const;
export type Modalita = (typeof MODALITA)[number];

export function makeResolver(name: string, o: ResolverOptions = {}): Resolver {
  switch (name.toLowerCase()) {
    case '':
    case 'lessicale':
    case 'lexical':
      return new LexicalResolver();
    case 'embedding':
    case 'embed':
    case 'vettori':
      return new EmbeddingResolver(vuoleEmbed(o, name), 'puro', o.modello ?? 'embedding');
    case 'ibrido':
    case 'lessicale+embedding':
    case 'misto':
      return new EmbeddingResolver(vuoleEmbed(o, name), 'ibrido', o.modello ?? 'embedding');
    case 'claude':
      throw new Error(
        `il backend resolver "${name}" e' previsto dall'architettura ma non ancora implementato: per ora usa --resolver lessicale`,
      );
    default:
      throw new Error(`resolver sconosciuto "${name}" (${MODALITA.join(', ')}, claude)`);
  }
}

function vuoleEmbed(o: ResolverOptions, name: string): Embed {
  if (!o.embed) {
    throw new Error(
      `il backend "${name}" ha bisogno di una funzione di embedding: la CLI la prende da una dipendenza opzionale, il player web da CDN`,
    );
  }
  return o.embed;
}
