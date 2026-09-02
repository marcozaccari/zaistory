/**
 * Test del linter: `mini.ir.json` e' una storia sana, `rotta.ir.json` contiene
 * un esemplare di ogni difetto che il linter deve saper trovare.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { countFindings, formatFinding, lintStory, parseStory, type DialogueNode, type Finding, type Level, type Story } from '../src/core/index.js';

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
    ['storia senza locandina', 'errore', 'manca cover'],
    ['characters_in_frame fuori dalla roster', 'errore', 'fantasma'],
    ['provenienza assente', 'avviso', 'generated_by'],
  ];
  for (const [nome, level, frag] of casi) {
    assert.ok(has(fs, level, frag), `il linter non ha trovato: ${nome} (cercavo "${frag}" come ${level})`);
  }

  assert.ok(countFindings(fs).errors > 0, 'una storia rotta deve produrre errori');
});

/**
 * Il dialogo spogliato delle didascalie.
 *
 * Non e' un difetto di struttura — un dialogo cosi' si gioca benissimo — ma e'
 * la firma di una compilazione che ha buttato via quello che nella
 * sceneggiatura stava fra le battute. Il controllo e' un *rapporto* e non un
 * conteggio apposta: la regola "zero descrizioni" lasciava passare proprio il
 * caso da cui e' nato, undici battute con una sola didascalia superstite.
 */

function conDialogo(nodi: Record<string, DialogueNode>): Story {
  return {
    ir_version: '1.8.0',
    id: 'prova',
    title: 'Prova',
    start_scene: 'a',
    characters: [{ id: 'tommy', name: 'Tommy' }],
    scenes: [
      {
        id: 'a',
        look: 'Una stanza.',
        background: { image_prompt: 'una stanza' },
        dialogue_tree: { start: 'n1', nodes: nodi },
        actions: [{ id: 'parla', label: 'Parlare', aliases: ['parla'], effect: { goto_dialogue: 'n1' } }],
      },
    ],
  };
}

/** `n` battute in fila, l'ultima chiude. */
function battute(n: number): Record<string, DialogueNode> {
  const out: Record<string, DialogueNode> = {};
  for (let i = 1; i <= n; i++) {
    out[`n${i}`] = i < n
      ? { speaker: 'tommy', text: `battuta ${i}`, next: `n${i + 1}` }
      : { speaker: 'tommy', text: `battuta ${i}`, end: true };
  }
  return out;
}

test('un dialogo lungo senza didascalie viene segnalato', () => {
  const fs = lintStory(conDialogo(battute(6)));
  assert.ok(has(fs, 'info', 'didascalie'), 'sei battute di fila senza una descrizione dovevano accendere il controllo');
});

test('una sola didascalia su undici battute non basta', () => {
  const nodi = battute(11);
  nodi.n5 = { speaker: 'narrator', text: 'Tommy guarda Laura nello specchietto.', next: 'n6' };
  const fs = lintStory(conDialogo(nodi));
  assert.ok(has(fs, 'info', 'didascalie'), 'e il caso da cui il controllo e nato: non deve passare');
});

test('un dialogo scritto fitto resta zitto', () => {
  const nodi = battute(6);
  for (const id of ['n2', 'n5']) {
    nodi[id] = { ...nodi[id], speaker: 'narrator', text: 'Qualcosa succede intorno alle parole.' };
  }
  const fs = lintStory(conDialogo(nodi));
  assert.ok(!has(fs, 'info', 'didascalie'), 'due descrizioni su sei nodi non sono un dialogo spogliato');
});

test('uno scambio di tre battute non e un dialogo spogliato', () => {
  const fs = lintStory(conDialogo(battute(3)));
  assert.ok(!has(fs, 'info', 'didascalie'), 'sotto la soglia il controllo deve tacere');
});

/**
 * Il flag che cambia la scena senza che la scena lo dica.
 *
 * Se un flag apre o chiude un'azione *qui*, per definizione qui e' cambiato
 * qualcosa, e il `look` e' l'unico posto in cui il giocatore puo' accorgersene.
 * Il caso da cui e' nato: una fuga fra gli scaffali in cui notare un carrello
 * chiudeva «corri» e apriva «rovescia il carrello», con zero look_variants e
 * il carrello mai nominato.
 */

function conFlag(look_variants?: Array<{ condition: { flag_present: string }; text: string }>): Story {
  return {
    ir_version: '1.8.0',
    id: 'f',
    title: 'Flag',
    start_scene: 'a',
    scenes: [
      {
        id: 'a',
        look: 'Un corridoio fra scaffali.',
        look_variants,
        background: { image_prompt: 'un corridoio' },
        actions: [
          { id: 'nota', label: 'Notare il carrello', aliases: ['guarda'], effect: { set_flag: 'carrello_visto' } },
          {
            id: 'rovescia',
            label: 'Rovesciare il carrello',
            aliases: ['rovescia'],
            condition: { flag_present: 'carrello_visto' },
            blocked_narration: 'Non c\'e\' niente da rovesciare.',
            effect: { goto_scene: 'b' },
          },
        ],
      },
      { id: 'b', look: 'Fuori.', background: { image_prompt: 'fuori' }, actions: [] },
    ],
  };
}

test('un flag che cambia le azioni della scena senza cambiare il look viene segnalato', () => {
  const fs = lintStory(conFlag());
  assert.ok(has(fs, 'avviso', 'carrello_visto'), 'la scena muta doveva essere segnalata');
});

test('con la variante corrispondente il controllo tace', () => {
  const fs = lintStory(
    conFlag([{ condition: { flag_present: 'carrello_visto' }, text: 'Un carrello di plastica a meta corridoio.' }]),
  );
  assert.ok(!has(fs, 'avviso', 'carrello_visto'), 'con la variante non c\'e\' niente da segnalare');
});

test('un flag impostato altrove non e affare di questa scena', () => {
  // La condizione c'e', ma il flag non lo produce questa scena: pretendere che
  // la stanza racconti qualcosa che qui non e' successo sarebbe sbagliato.
  const story = conFlag();
  story.scenes[0].actions[0].effect = { narration: 'Niente.' };
  const fs = lintStory(story);
  assert.ok(!has(fs, 'avviso', 'carrello_visto'));
});
