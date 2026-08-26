/**
 * La versione del player.
 *
 * Sorgente unica: il campo `version` di `package.json`. Il browser un
 * package.json da leggere non ce l'ha, quindi per il web il numero diventa una
 * costante sostituita da vite (`define`) sia in build sia in `npm run dev`; la
 * CLI, che il package.json ce l'ha accanto, se lo legge da sola in
 * `cli/version.ts`. Due strade per non trascinare `node:fs` dentro il bundle
 * del browser, ma un solo numero da aggiornare.
 */

declare const __ZAIPLAY_VERSION__: string | undefined;

export const PLAYER_VERSION: string =
  typeof __ZAIPLAY_VERSION__ === 'string' ? __ZAIPLAY_VERSION__ : 'sconosciuta';
