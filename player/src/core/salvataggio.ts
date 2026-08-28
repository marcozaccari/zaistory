/**
 * Il salvataggio: una partita e le impostazioni del giocatore, in una riga.
 *
 * Niente di nuovo viene inventato qui. Una partita e' gia' interamente
 * descritta dalla sua traccia — il resolver puo' solo scegliere fra azioni
 * gia' definite, quindi la sequenza degli id *e'* la partita — e le
 * impostazioni sono gia' un pugno di parametri che vivono fuori da essa.
 * Questo modulo fa una cosa sola: mette le due cose in un involucro solo,
 * abbastanza corto da stare negli appunti e abbastanza robusto da
 * sopravvivere al viaggio (una mail che manda a capo, una chat che aggiunge
 * spazi, un incolla che si porta dietro un ritorno a capo di troppo).
 *
 * E' cosi' che si passa dal desktop al telefono senza nessun server: si copia
 * il codice, lo si manda dove si vuole, lo si incolla dall'altra parte.
 *
 * Due decisioni che vale la pena non dimenticare.
 *
 * **Il codice e' sincrono.** Niente compressione, per quanto il risultato sia
 * piu' lungo del necessario: comprimere nel browser vuol dire
 * `CompressionStream`, che e' asincrono, e una `await` prima di
 * `clipboard.writeText()` fa scadere il gesto dell'utente e la scrittura negli
 * appunti viene rifiutata. Un salvataggio da qualche kilobyte di base64 si
 * incolla ovunque; una copia che fallisce a intermittenza no.
 *
 * **La partita porta con se' di quale storia e'.** Rigiocare una traccia in
 * una storia diversa non da' un errore: da' una partita silenziosamente
 * sbagliata. `story_id` e `ir_version` servono a chi carica per rifiutare la
 * prima e avvisare della seconda.
 *
 * Che cosa ci sia dentro `config` questo modulo non lo sa e non deve saperlo:
 * le impostazioni sono dell'interfaccia (la voce, il backend del resolver, il
 * debug), e il core non ha nessuna opinione su di loro. Le trasporta e basta.
 */

import { parseScript } from './script.js';

/** Versione dell'involucro. Cambia solo se cambia la forma, non il contenuto. */
export const SALVATAGGIO_VERSIONE = 1;

/** Il prefisso che rende un codice riconoscibile a occhio e a `startsWith`. */
export const PREFISSO_SALVATAGGIO = 'ZAI1.';

/** La partita: la traccia piu' l'identita' della storia che la rende valida. */
export interface PartitaSalvata {
  /** `id` della storia. Vuoto quando il codice era una traccia in chiaro. */
  story_id: string;
  /** Versione dell'IR al momento del salvataggio. Vuota, come sopra. */
  ir_version: string;
  /** Titolo, solo per mostrarlo a chi carica. */
  title: string;
  /** La sequenza di id: azioni e scelte di dialogo, nell'ordine giocato. */
  trace: string[];
}

export interface Salvataggio {
  v: number;
  /** Quando e' stato scritto, in ISO. Serve solo a chi carica, per capire quale dei due codici che ha in giro e' il piu' recente. */
  salvato?: string;
  partita?: PartitaSalvata;
  /** Le impostazioni, opache al core. */
  config?: Record<string, unknown>;
}

/** Un codice che non si riesce a leggere. Il messaggio e' per chi ha incollato. */
export class SalvataggioError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SalvataggioError';
  }
}

/** Che cosa c'e' dentro, senza doverlo frugare a mano. */
export function contenuto(s: Salvataggio): { partita: boolean; config: boolean; passi: number } {
  return {
    partita: !!s.partita,
    config: !!s.config && Object.keys(s.config).length > 0,
    passi: s.partita?.trace.length ?? 0,
  };
}

/** Scrive il codice da copiare negli appunti. */
export function scriviSalvataggio(dati: Omit<Salvataggio, 'v'>): string {
  const doc: Salvataggio = { v: SALVATAGGIO_VERSIONE, ...dati };
  return PREFISSO_SALVATAGGIO + base64urlEncode(new TextEncoder().encode(JSON.stringify(doc)));
}

/**
 * Legge quello che e' stato incollato.
 *
 * Accetta tre forme, e le accetta di proposito: il codice vero, l'involucro
 * JSON in chiaro (comodo da guardare quando qualcosa non torna) e una traccia
 * nuda — cioe' esattamente quello che il pannello «traccia» copia e quello che
 * i file `.playthrough.txt` contengono. L'ultima e' senza storia: chi la carica
 * lo scoprira' da `story_id` vuoto.
 */
export function leggiSalvataggio(testo: string): Salvataggio {
  const grezzo = testo.trim();
  if (grezzo === '') throw new SalvataggioError('Non c\'e\' niente da leggere: incolla il codice.');

  if (grezzo.startsWith('{')) return valida(json(grezzo));

  // Gli spazi vanno via *dopo* aver escluso il JSON: dentro una stringa JSON
  // sarebbero significativi, dentro un base64 non possono che essere danni del
  // viaggio (una mail che manda a capo, una chat che spezza le righe lunghe).
  const compatto = grezzo.replace(/\s+/g, '');
  if (compatto.startsWith(PREFISSO_SALVATAGGIO)) {
    const bytes = base64urlDecode(compatto.slice(PREFISSO_SALVATAGGIO.length));
    return valida(json(new TextDecoder().decode(bytes)));
  }

  const trace = parseScript(grezzo);
  if (trace.length === 0) {
    throw new SalvataggioError(
      'Non riconosco quello che hai incollato: un codice di salvataggio comincia con ' +
        `«${PREFISSO_SALVATAGGIO}».`,
    );
  }
  return { v: SALVATAGGIO_VERSIONE, partita: { story_id: '', ir_version: '', title: '', trace } };
}

function json(testo: string): unknown {
  try {
    return JSON.parse(testo);
  } catch {
    throw new SalvataggioError('Il codice e\' arrivato rotto: quello che contiene non si legge.');
  }
}

/**
 * Controlla la forma prima di restituirla.
 *
 * Vale la pena essere severi: questo e' l'unico dato del player che arriva da
 * fuori dopo l'IR, e a differenza dell'IR non passa da nessun validatore di
 * schema. Un `trace` che non e' un elenco di stringhe farebbe esplodere il
 * `ScriptDriver` molto piu' avanti, dove nessuno lo collegherebbe piu'
 * all'incolla.
 */
function valida(doc: unknown): Salvataggio {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new SalvataggioError('Il codice non contiene un salvataggio.');
  }
  const d = doc as Record<string, unknown>;

  if (typeof d.v !== 'number') throw new SalvataggioError('Il codice non dice di che versione e\'.');
  if (d.v > SALVATAGGIO_VERSIONE) {
    throw new SalvataggioError(
      `Questo salvataggio e' di una versione piu' recente del player (v${d.v} contro v${SALVATAGGIO_VERSIONE}): ` +
        'aggiorna il player e riprova.',
    );
  }

  const out: Salvataggio = { v: d.v };
  if (typeof d.salvato === 'string') out.salvato = d.salvato;

  if (d.partita !== undefined) {
    const p = d.partita;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      throw new SalvataggioError('La partita dentro il codice non ha la forma giusta.');
    }
    const pp = p as Record<string, unknown>;
    if (!Array.isArray(pp.trace) || pp.trace.some((t) => typeof t !== 'string')) {
      throw new SalvataggioError('La traccia dentro il codice non e\' un elenco di passi.');
    }
    out.partita = {
      story_id: typeof pp.story_id === 'string' ? pp.story_id : '',
      ir_version: typeof pp.ir_version === 'string' ? pp.ir_version : '',
      title: typeof pp.title === 'string' ? pp.title : '',
      trace: pp.trace as string[],
    };
  }

  if (d.config !== undefined) {
    if (typeof d.config !== 'object' || d.config === null || Array.isArray(d.config)) {
      throw new SalvataggioError('Le impostazioni dentro il codice non hanno la forma giusta.');
    }
    out.config = d.config as Record<string, unknown>;
  }

  if (!out.partita && !out.config) throw new SalvataggioError('Il codice e\' valido ma vuoto: non c\'e\' niente da caricare.');
  return out;
}

// ------------------------------------------------------------------ base64url
//
// Base64 normale userebbe `+` e `/`, che in un URL e in qualche client di posta
// vengono riscritti. La variante url-safe e senza padding attraversa indenne
// una barra degli indirizzi, un QR e il corpo di una mail.

function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) {
    throw new SalvataggioError('Il codice contiene caratteri che non gli appartengono: forse e\' stato copiato a meta\'.');
  }
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new SalvataggioError('Il codice e\' incompleto: manca un pezzo rispetto a quando e\' stato copiato.');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
