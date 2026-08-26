/**
 * Core del player ZAiStory: tutto quello che non e' interfaccia.
 *
 * Questo modulo non tocca il DOM, non legge da stdin e non stampa niente.
 * E' la ragione per cui esiste: la stessa logica gira nel player web sul
 * telefono, nella CLI node in CI e — domani — nella PWA, senza essere
 * riscritta tre volte e senza rischiare che le tre versioni divergano.
 *
 * Vincolo architetturale che si vede direttamente nel codice: qui non c'e'
 * logica narrativa. Nessuna azione inventata, nessun testo generato, nessun
 * cambio di stato che non venga da un `Effect` gia' presente nell'IR.
 */

export * from './types.js';
export * from './load.js';
export * from './state.js';
export * from './engine.js';
export * from './lint.js';
export * from './resolver.js';
export * from './script.js';
