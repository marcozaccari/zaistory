/**
 * Test del salvataggio: l'unico dato che entra nel player dopo l'IR, e
 * l'unico che arriva da un incolla.
 *
 * Quello che si verifica qui non e' tanto il giro d'andata e ritorno — quello
 * o funziona o si rompe subito — ma le due cose che si scoprirebbero solo sul
 * telefono di qualcun altro: che un codice passato per una mail (con i suoi a
 * capo di troppo) si legga lo stesso, e che un codice manomesso o troncato dia
 * un messaggio invece di una partita sbagliata in silenzio.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFISSO_SALVATAGGIO,
  SalvataggioError,
  contenuto,
  leggiSalvataggio,
  scriviSalvataggio,
} from '../src/core/index.js';
import { configPlayerDefault, configPlayerSerializzabile, leggiConfigPlayer } from '../src/web/config.js';

const PARTITA = {
  story_id: 'metalhead',
  ir_version: '1.8.0',
  title: 'Metal Head',
  trace: ['a:continua', 'c:d_chiave', 'a:prendi_walkie'],
};

function codice(): string {
  return scriviSalvataggio({ salvato: '2026-08-28T12:00:00.000Z', partita: PARTITA, config: { debug: true } });
}

test('il codice torna identico a come e\' partito', () => {
  const s = leggiSalvataggio(codice());
  assert.deepEqual(s.partita, PARTITA);
  assert.deepEqual(s.config, { debug: true });
  assert.equal(s.salvato, '2026-08-28T12:00:00.000Z');
});

test('il codice e\' una riga sola, riconoscibile dal prefisso', () => {
  const c = codice();
  assert.ok(c.startsWith(PREFISSO_SALVATAGGIO));
  assert.ok(!/\s/.test(c), 'nel codice non ci devono essere spazi ne\' a capo');
});

test('sopravvive agli a capo che ci mette in mezzo una mail', () => {
  const c = codice();
  const spezzato = `\n  ${c.slice(0, 20)}\n${c.slice(20, 60)} \n ${c.slice(60)}  \n`;
  assert.deepEqual(leggiSalvataggio(spezzato).partita, PARTITA);
});

test('una traccia in chiaro si carica lo stesso, ma senza storia', () => {
  const s = leggiSalvataggio('# playthrough\na:continua\nc:d_chiave\n\na:prendi_walkie\n');
  assert.equal(s.partita?.story_id, '');
  assert.deepEqual(s.partita?.trace, PARTITA.trace);
  assert.equal(s.config, undefined);
});

test('anche l\'involucro JSON in chiaro, comodo quando qualcosa non torna', () => {
  const s = leggiSalvataggio(JSON.stringify({ v: 1, partita: PARTITA }));
  assert.deepEqual(s.partita, PARTITA);
});

test('un codice troncato lo dice, invece di caricare mezza partita', () => {
  const c = codice();
  assert.throws(() => leggiSalvataggio(c.slice(0, c.length - 12)), SalvataggioError);
});

test('quello che non e\' un salvataggio viene rifiutato', () => {
  for (const testo of ['', '   ', 'ZAI1.???', JSON.stringify({ v: 1 }), JSON.stringify({ partita: PARTITA })]) {
    assert.throws(() => leggiSalvataggio(testo), SalvataggioError, `avrebbe dovuto rifiutare: ${testo}`);
  }
});

test('una traccia che non e\' un elenco di stringhe non arriva al ScriptDriver', () => {
  assert.throws(
    () => leggiSalvataggio(JSON.stringify({ v: 1, partita: { ...PARTITA, trace: [1, 2] } })),
    SalvataggioError,
  );
});

test('un salvataggio piu\' recente del player chiede di aggiornare il player', () => {
  assert.throws(() => leggiSalvataggio(JSON.stringify({ v: 99, partita: PARTITA })), /piu' recente/);
});

test('contenuto dice che cosa c\'e\' dentro', () => {
  assert.deepEqual(contenuto(leggiSalvataggio(codice())), { partita: true, config: true, passi: 3 });
});

// --- le impostazioni.

test('le impostazioni fanno il giro e tornano uguali', () => {
  const base = configPlayerDefault();
  const mie = { ...base, resolver: 'ibrido', debug: true, ascolto: { ...base.ascolto, attiva: true, velocita: 1.5 } };
  const tornata = leggiConfigPlayer(configPlayerSerializzabile(mie), base);
  assert.deepEqual(tornata, mie);
});

test('un valore fuori scala o inventato torna al default invece di rompere il player', () => {
  const base = configPlayerDefault();
  const c = leggiConfigPlayer(
    { ascolto: { velocita: 40, volume: 'forte', attiva: 'si' }, resolver: 'oracolo', debug: 1 },
    base,
  );
  assert.equal(c.ascolto.velocita, base.ascolto.velocita);
  assert.equal(c.ascolto.volume, base.ascolto.volume);
  assert.equal(c.ascolto.attiva, base.ascolto.attiva);
  assert.equal(c.resolver, base.resolver);
  assert.equal(c.debug, base.debug);
});

test('quello che manca resta com\'era, non torna al default', () => {
  const base = { ...configPlayerDefault(), resolver: 'ibrido' };
  base.ascolto.velocita = 0.8;
  const c = leggiConfigPlayer({ debug: true }, base);
  assert.equal(c.resolver, 'ibrido');
  assert.equal(c.ascolto.velocita, 0.8);
  assert.equal(c.debug, true);
});
