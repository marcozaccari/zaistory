/**
 * Le impostazioni del giocatore: quelle che vivono fuori dalla partita.
 *
 * La distinzione non e' nuova, e' gia' quella dell'ascolto: ricominciare non
 * deve costringere a riscegliere la voce. Qui viene solo portata alle sue
 * conseguenze — se non appartengono alla partita, allora si salvano e si
 * caricano separatamente da lei, ed e' per questo che il pannello «disco»
 * chiede *che cosa* caricare invece di decidere da solo.
 *
 * Cosa c'e' dentro: come si sente la storia (`ascolto`), con quale backend si
 * gioca (`resolver`, `embedder`) e se il debug e' acceso. Cosa non c'e': la
 * storia caricata. L'IR non e' un'impostazione, e' quello su cui si gioca.
 *
 * Tutto quello che rientra passa da `leggiConfigPlayer`, che non si fida di
 * niente: un codice incollato non e' un file di configurazione scritto da noi,
 * e un cursore fuori scala o una modalita' che non esiste piu' non devono
 * poter rompere il player. Quello che non si riconosce torna al default, in
 * silenzio — non e' un errore da mostrare, e' un campo in piu' o in meno fra
 * due versioni.
 */

import { ASCOLTO_DEFAULT, type ImpostazioniAscolto } from './ascolto.js';
import { CONFIG_DEFAULT, type ConfigEmbedder } from './embedder.js';

/** I nomi di backend che il player sa accendere. */
export const RESOLVER_VALIDI = ['lessicale', 'ibrido', 'embedding'] as const;

export interface ConfigPlayer {
  ascolto: ImpostazioniAscolto;
  embedder: ConfigEmbedder;
  resolver: string;
  /** Se mostrare le immagini pubblicate della storia, quando ci sono. */
  immagini: boolean;
  debug: boolean;
}

export function configPlayerDefault(): ConfigPlayer {
  return {
    ascolto: { ...ASCOLTO_DEFAULT },
    embedder: { ...CONFIG_DEFAULT },
    resolver: 'lessicale',
    immagini: true,
    debug: false,
  };
}

/**
 * Fonde quello che e' arrivato con quello che c'e' adesso.
 *
 * La base non e' il default ma la configurazione corrente: un codice salvato
 * da una versione piu' vecchia del player non deve azzerare le impostazioni
 * che quella versione non conosceva.
 */
export function leggiConfigPlayer(raw: Record<string, unknown> | undefined, base: ConfigPlayer): ConfigPlayer {
  if (!raw) return base;

  const a = oggetto(raw.ascolto);
  const e = oggetto(raw.embedder);

  return {
    ascolto: {
      attiva: bool(a.attiva, base.ascolto.attiva),
      suoniEVoci: bool(a.suoniEVoci, base.ascolto.suoniEVoci),
      avanzamento: bool(a.avanzamento, base.ascolto.avanzamento),
      // La voce e' un `voiceURI` di *questo* sistema: su un altro device quel
      // nome quasi certamente non esiste. Si trasporta lo stesso — spesso i due
      // device sono lo stesso browser — e chi la applica ripiega sulla voce di
      // sistema quando non la trova, che e' esattamente cio' che fa gia' oggi
      // per una stringa vuota.
      voce: stringa(a.voce, base.ascolto.voce),
      velocita: numero(a.velocita, 0.5, 2, base.ascolto.velocita),
      tono: numero(a.tono, 0, 2, base.ascolto.tono),
      volume: numero(a.volume, 0, 1, base.ascolto.volume),
    },
    embedder: {
      libreria: stringa(e.libreria, base.embedder.libreria),
      modello: stringa(e.modello, base.embedder.modello),
      host: stringa(e.host, base.embedder.host),
    },
    resolver: (RESOLVER_VALIDI as readonly string[]).includes(String(raw.resolver))
      ? String(raw.resolver)
      : base.resolver,
    immagini: bool(raw.immagini, base.immagini),
    debug: bool(raw.debug, base.debug),
  };
}

function oggetto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}

function stringa(v: unknown, def: string): string {
  return typeof v === 'string' ? v : def;
}

/** Fuori scala o non numero: si torna al default. Un cursore a 40 non e' una
 * preferenza, e' un codice manomesso o un formato cambiato. */
function numero(v: unknown, min: number, max: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def;
}

/**
 * La configurazione come dato da trasportare.
 *
 * Il salvataggio non conosce i campi delle impostazioni — per lui `config` e'
 * un oggetto opaco — quindi la copia esplicita si fa qui, dove i campi si
 * sanno. Vale anche come elenco leggibile di che cosa viaggia davvero.
 */
export function configPlayerSerializzabile(c: ConfigPlayer): Record<string, unknown> {
  return {
    ascolto: { ...c.ascolto },
    embedder: { ...c.embedder },
    resolver: c.resolver,
    immagini: c.immagini,
    debug: c.debug,
  };
}
