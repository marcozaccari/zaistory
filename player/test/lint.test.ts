/**
 * Test del linter: `mini.ir.json` e' una storia sana, `rotta.ir.json` contiene
 * un esemplare di ogni difetto che il linter deve saper trovare.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { countFindings, formatFinding, lintStory, parseStory, type Finding, type Level } from '../src/core/index.js';

function run(name: string): Finding[] {
  const path = fileURLToPath(new URL(`../../testdata/${name}`, import.meta.url));
  return lintStory(parseStory(readFileSync(path, 'utf8')));
}

function has(fs: Finding[], level: Level, frag: string): boolean {
  return fs.some((f) => f.level === level && (f.msg + ' ' + f.where).includes(frag));
}

test('una storia sana non produce errori', () => {
  const fs = run('mini.ir.json');
  const errori = fs.filter((f) => f.level === 'errore').map(formatFinding);
  assert.deepEqual(errori, []);
});

test('una storia rotta produce tutti i difetti attesi', () => {
  const fs = run('rotta.ir.json');

  const casi: Array<[string, Level, string]> = [
    ['goto_scene verso scena inesistente', 'errore', 'scena_inesistente'],
    ['oggetto mai dato', 'errore', 'chiave_mai_data'],
    ['flag mai impostato', 'errore', 'flag_mai_impostato'],
    ['scelta verso nodo inesistente', 'errore', 'd_inesistente'],
    ['nodo monco', 'errore', 'nodo monco'],
    ['nodo irraggiungibile', 'avviso', 'irraggiungibile'],
    ['dialogo senza ingresso', 'avviso', 'goto_dialogue'],
    ['speaker fuori dalla roster globale', 'errore', 'lo speaker "voce"'],
    ['place verso un luogo inesistente', 'errore', 'luogo_inesistente'],
    ['characters_in_frame fuori dalla roster', 'errore', 'fantasma'],
    ['provenienza assente', 'avviso', 'generated_by'],
  ];
  for (const [nome, level, frag] of casi) {
    assert.ok(has(fs, level, frag), `il linter non ha trovato: ${nome} (cercavo "${frag}" come ${level})`);
  }

  assert.ok(countFindings(fs).errors > 0, 'una storia rotta deve produrre errori');
});
