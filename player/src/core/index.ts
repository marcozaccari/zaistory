/**
 * Il core: la logica di gioco, e solo quella.
 *
 * Non tocca il DOM e non legge da stdin. Web e CLI sono interfacce: se una
 * regola si trova duplicata lì, è nel posto sbagliato.
 */

export * from './types.js';
export * from './lexical.js';
export * from './verbs.js';
export * from './state.js';
export * from './engine.js';
export * from './parser.js';
export * from './turn.js';
export * from './load.js';
export * from './lint.js';
export * from './coverage.js';
export * from './vectors.js';
