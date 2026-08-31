/**
 * Il modello di embedding per il player web, caricato da CDN **solo se lo si
 * accende**.
 *
 * Il vincolo che questo file esiste per rispettare: la build resta *un solo
 * file HTML*, che si apre da `file://` e si gioca dal telefono senza
 * installare niente. Bundlare una libreria di inferenza dentro quel file lo
 * farebbe esplodere e romperebbe il requisito per tutti, compresi i nove
 * giocatori su dieci che non useranno mai i vettori. Quindi l'import e'
 * dinamico, sta dietro alla scelta del backend, e chi non lo sceglie non
 * scarica un byte.
 *
 * Tre indirizzi, tutti configurabili dal pannello e non incisi nel codice: da
 * dove viene la libreria, quale modello, e da quale host prendere i pesi.
 * Servono davvero — un mirror interno, una copia locale servita da un static
 * server, un modello diverso da provare — e servono soprattutto perche' il
 * posto dove questo backend fallisce e' sempre uno di quei tre, e senza poterli
 * cambiare l'unica diagnosi possibile e' "Failed to fetch".
 */

import type { Embed } from '../core/index.js';

export interface ConfigEmbedder {
  /** Modulo ESM da importare (la libreria di inferenza). */
  libreria: string;
  /** Identificatore del modello. */
  modello: string;
  /** Host da cui scaricare i pesi. */
  host: string;
}

export const CONFIG_DEFAULT: ConfigEmbedder = {
  // Versione fissata, non '@4': questo modulo e' l'unica cosa che il player
  // scarica a runtime, e un range lascerebbe che una minor pubblicata domani
  // cambi il comportamento di una pagina gia' pubblicata, senza un commit.
  libreria: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm',
  // Un encoder di frasi multilingua piccolo, non un modello generativo: qui
  // serve un vettore, non della prosa.
  modello: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  host: 'https://huggingface.co/',
};

export interface Embedder {
  embed: Embed;
  etichetta: string;
}

export async function caricaEmbedder(cfg: ConfigEmbedder, avviso?: (s: string) => void): Promise<Embedder> {
  avviso?.(`carico la libreria da ${dominio(cfg.libreria)}…`);
  // `@vite-ignore`: l'URL non deve essere risolto in fase di build, o la
  // libreria finirebbe dentro il file unico — cioe' esattamente cio' che
  // questo modulo esiste per evitare.
  const lib = (await import(/* @vite-ignore */ cfg.libreria)) as Record<string, unknown>;

  const env = lib.env as { allowLocalModels?: boolean; remoteHost?: string } | undefined;
  if (env) {
    env.allowLocalModels = false;
    if (cfg.host) env.remoteHost = cfg.host.endsWith('/') ? cfg.host : cfg.host + '/';
  }

  avviso?.(`scarico ${cfg.modello} da ${dominio(cfg.host)} (la prima volta sono un centinaio di MB, poi resta in cache)…`);
  const pipeline = lib.pipeline as (task: string, model: string, opts?: unknown) => Promise<unknown>;
  let pipe: unknown;
  try {
    pipe = await pipeline('feature-extraction', cfg.modello, { dtype: 'q8', device: 'webgpu' });
  } catch {
    // Niente WebGPU (o niente quantizzazione): si ripiega su WASM, che gira
    // ovunque — mobile compreso — ed e' piu' lento ma per una frase di cinque
    // parole resta nell'ordine dei millisecondi.
    pipe = await pipeline('feature-extraction', cfg.modello, { dtype: 'q8' });
  }
  const estrai = pipe as (testi: string[], opts: unknown) => Promise<{ tolist(): number[][] }>;

  const embed: Embed = async (testi) => {
    const out = await estrai(testi, { pooling: 'mean', normalize: true });
    return out.tolist();
  };
  return { embed, etichetta: `embedding ${cfg.modello}` };
}

function dominio(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
