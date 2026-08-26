/**
 * Test della lettura severa dell'IR.
 *
 * E' la rete di sicurezza architetturale: un campo plausibile ma inventato dal
 * compilatore va scartato, non accettato in silenzio.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IRError, parseStory } from '../src/core/index.js';

const MINIMA = {
  ir_version: '1.2.0',
  id: 'prova',
  title: 'Prova',
  start_scene: 'unica',
  scenes: [
    {
      id: 'unica',
      background: { image_prompt: 'una stanza' },
      actions: [],
    },
  ],
};

function parse(mutate: (s: any) => void = () => {}): void {
  const doc = structuredClone(MINIMA);
  mutate(doc);
  parseStory(JSON.stringify(doc));
}

test('un IR minimo valido si carica', () => {
  parse();
});

test('un campo fuori dallo schema fa fallire il caricamento', () => {
  assert.throws(
    () => parse((s) => (s.scenes[0].musica = 'allegra')),
    (err: unknown) => err instanceof IRError && /campo non previsto/.test((err as Error).message),
  );
});

test('un campo fuori dallo schema annidato in profondita\' viene comunque visto', () => {
  assert.throws(
    () => parse((s) => (s.scenes[0].background.video_prompt = 'un carrello')),
    (err: unknown) => err instanceof IRError && /video_prompt/.test((err as Error).message),
  );
});

test('una scena su file esterno viene rifiutata con un messaggio chiaro', () => {
  assert.throws(
    () => parse((s) => s.scenes.push({ ref: 'scenes/altra.ir.json' })),
    (err: unknown) => err instanceof IRError && /file esterno/.test((err as Error).message),
  );
});

test('start_scene deve puntare a una scena esistente', () => {
  assert.throws(
    () => parse((s) => (s.start_scene = 'inesistente')),
    (err: unknown) => err instanceof IRError && /start_scene/.test((err as Error).message),
  );
});

test('un id di scena duplicato viene rifiutato', () => {
  assert.throws(
    () => parse((s) => s.scenes.push(structuredClone(s.scenes[0]))),
    (err: unknown) => err instanceof IRError && /duplicato/.test((err as Error).message),
  );
});

test('scene_type accetta solo i valori dello schema', () => {
  assert.throws(
    () => parse((s) => (s.scenes[0].scene_type = 'filmato')),
    (err: unknown) => err instanceof IRError && /non ammesso/.test((err as Error).message),
  );
});

test("una scena senza actions diventa una lista vuota, non un errore di caricamento", () => {
  const doc = structuredClone(MINIMA) as any;
  delete doc.scenes[0].actions;
  const story = parseStory(JSON.stringify(doc));
  assert.deepEqual(story.scenes[0].actions, []);
});
