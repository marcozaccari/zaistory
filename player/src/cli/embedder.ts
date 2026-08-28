/**
 * Il modello di embedding per la CLI, da una dipendenza **opzionale**.
 *
 * Sta qui e non nel core di proposito. Il core non deve dipendere da nessun
 * modello: il resolver a vettori riceve una funzione e non sa da dove venga —
 * dal disco in Node, da un CDN nel browser, domani da un servizio. E' quello
 * che permette di provare l'embedder senza che il resto del player se ne
 * accorga, e di buttarlo via senza toccare niente se non si rivela utile.
 *
 * Nessuno `npm install` obbligatorio: chi gioca a menu o col lessicale non
 * scarica niente, e chi non ha la dipendenza riceve un errore che dice cosa
 * installare invece di uno stack trace.
 */

import type { Embed } from '../core/index.js';

/**
 * Un encoder di frasi multilingua piccolo, non un modello generativo: qui
 * serve un vettore, non della prosa. Sostituibile con `--embed-model`, perche'
 * quale modello regga meglio l'italiano su queste scene e' esattamente il tipo
 * di cosa che va misurata e non decisa a priori.
 */
export const MODELLO_DEFAULT = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

export interface Embedder {
  embed: Embed;
  etichetta: string;
}

export async function caricaEmbedder(modello = MODELLO_DEFAULT): Promise<Embedder> {
  let lib: Record<string, unknown>;
  try {
    // Lo specificatore e' composto a runtime apposta: scritto come letterale,
    // TypeScript pretenderebbe di risolverlo in fase di compilazione e il
    // player non compilerebbe piu' senza una dipendenza che deve restare
    // facoltativa.
    const pacchetto = ['@huggingface', 'transformers'].join('/');
    lib = (await import(/* @vite-ignore */ pacchetto)) as Record<string, unknown>;
  } catch {
    throw new Error(
      'il backend "embedding" ha bisogno di una dipendenza opzionale che non risulta installata:\n' +
        '  npm install --no-save @huggingface/transformers\n' +
        "(non e' fra le dipendenze del player apposta: chi gioca col resolver lessicale non deve scaricare niente)",
    );
  }

  const pipeline = lib.pipeline as (task: string, model: string, opts?: unknown) => Promise<unknown>;
  // La quantizzazione a 8 bit e' l'unica ragione per cui un modello del genere
  // sta in un centinaio di megabyte invece che in mezzo giga. Se la versione
  // installata non conosce l'opzione, si riprova senza: meglio lento che fermo.
  let pipe: unknown;
  try {
    pipe = await pipeline('feature-extraction', modello, { dtype: 'q8' });
  } catch {
    pipe = await pipeline('feature-extraction', modello);
  }
  const estrai = pipe as (testi: string[], opts: unknown) => Promise<{ tolist(): number[][] }>;

  const embed: Embed = async (testi) => {
    const out = await estrai(testi, { pooling: 'mean', normalize: true });
    return out.tolist();
  };
  return { embed, etichetta: `embedding ${modello}` };
}
