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
 * Prezzo da dichiarare a chi lo accende: la prima volta servono rete e un
 * centinaio di megabyte di modello. Dopo, il browser lo tiene in cache e
 * funziona anche offline — ma da `file://` la cache e le richieste
 * cross-origin sono terreno incerto, quindi il posto giusto per provarlo e' il
 * player servito da http.
 */

import type { Embed } from '../core/index.js';

export const MODELLO_DEFAULT = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4/+esm';

export interface Embedder {
  embed: Embed;
  etichetta: string;
}

export async function caricaEmbedder(modello = MODELLO_DEFAULT, avviso?: (s: string) => void): Promise<Embedder> {
  avviso?.(`scarico la libreria di inferenza da ${new URL(CDN).host}…`);
  // `@vite-ignore`: l'URL non deve essere risolto in fase di build, o la
  // libreria finirebbe dentro il file unico — cioe' esattamente cio' che
  // questo modulo esiste per evitare.
  const lib = (await import(/* @vite-ignore */ CDN)) as Record<string, unknown>;

  const env = lib.env as { allowLocalModels?: boolean } | undefined;
  if (env) env.allowLocalModels = false;

  avviso?.(`scarico il modello ${modello} (la prima volta sono un centinaio di MB, poi resta in cache)…`);
  const pipeline = lib.pipeline as (task: string, model: string, opts?: unknown) => Promise<unknown>;
  let pipe: unknown;
  try {
    pipe = await pipeline('feature-extraction', modello, { dtype: 'q8', device: 'webgpu' });
  } catch {
    // Niente WebGPU (o niente quantizzazione): si ripiega su WASM, che gira
    // ovunque — mobile compreso — ed e' piu' lento ma per una frase di cinque
    // parole resta nell'ordine dei millisecondi.
    pipe = await pipeline('feature-extraction', modello, { dtype: 'q8' });
  }
  const estrai = pipe as (testi: string[], opts: unknown) => Promise<{ tolist(): number[][] }>;

  const embed: Embed = async (testi) => {
    const out = await estrai(testi, { pooling: 'mean', normalize: true });
    return out.tolist();
  };
  return { embed, etichetta: `embedding ${modello}` };
}
