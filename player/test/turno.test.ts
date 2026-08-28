/**
 * Test del turno giocato a parole: matcher lessicale, verbi del player,
 * azioni bloccate, fallback d'autore.
 *
 * Quello che questi test difendono non e' la percentuale di frasi capite —
 * quella si misura con `--copertura` su una storia vera, e cambia con gli
 * alias che il compilatore scrive. Qui si difendono le **invarianti**: che il
 * resolver preferisca tacere a sbagliare, che un'azione bloccata non applichi
 * niente, che nessun testo mostrato al giocatore sia stato inventato dal
 * player, e che i verbi del player non scippino mai un'azione dell'autore.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EmbeddingResolver,
  InputLibero,
  LexicalResolver,
  classifica,
  classificaIntento,
  copertura,
  parseStory,
  radici,
  scegliFallback,
  verboDelPlayer,
  type ActionPrompt,
  type Story,
} from '../src/core/index.js';
import { GameState } from '../src/core/state.js';

// ------------------------------------------------------------------ radici

test('la normalizzazione toglie accenti, punteggiatura e parole vuote', () => {
  assert.deepEqual(radici("Apro l'armadietto con la chiave!"), ['apr', 'armadiett', 'chiav']);
  assert.deepEqual(radici('perché però non lo apro'), ['apr']);
});

test('le radici fanno cadere singolare e plurale sulla stessa forma', () => {
  assert.deepEqual(radici('porta'), radici('porte'));
  assert.deepEqual(radici('cassetto'), radici('cassetti'));
});

test("le locuzioni comuni valgono il verbo che sostituiscono", () => {
  assert.deepEqual(radici("do un'occhiata al furgone"), radici('guardo il furgone'));
});

// -------------------------------------------------------------- intenzioni

test('le intenzioni classificano il verbo, non il sostantivo', () => {
  assert.equal(classificaIntento('guardo la porta'), 'percezione');
  assert.equal(classificaIntento('apro la porta'), 'manipolazione');
  assert.equal(classificaIntento('esco dalla porta'), 'movimento');
  assert.equal(classificaIntento('chiedo a Mark della porta'), 'sociale');
  assert.equal(classificaIntento('sfondo la porta'), 'forza');
  assert.equal(classificaIntento('porta'), 'generico');
});

// ------------------------------------------------------- verbi del player

test('i verbi del player riconoscono solo le forme strette', () => {
  assert.equal(verboDelPlayer('guardati intorno'), 'look');
  assert.equal(verboDelPlayer('dove mi trovo'), 'look');
  assert.equal(verboDelPlayer('osservo la stanza'), 'look');
  assert.equal(verboDelPlayer('cosa ho nello zaino'), 'inventario');
  assert.equal(verboDelPlayer('inventario'), 'inventario');
  assert.equal(verboDelPlayer("chi c'è qui?"), 'presenti');
  assert.equal(verboDelPlayer("chi c'è con me"), 'presenti');
  assert.equal(verboDelPlayer('quali sono i personaggi qui'), 'presenti');
  assert.equal(verboDelPlayer('chi è presente'), 'presenti');
  assert.equal(verboDelPlayer('con chi sono'), 'presenti');
  assert.equal(verboDelPlayer("guarda chi c'è"), 'presenti');
  // Un complemento vero e non e' piu' una domanda sui presenti: e' un'azione.
  assert.equal(verboDelPlayer("chi c'è dietro la porta"), 'nessuno');
  assert.equal(verboDelPlayer('chiedi a Mark'), 'nessuno');
  assert.equal(verboDelPlayer('chiama Tommy'), 'nessuno');
  // Un sostantivo concreto in piu' e non e' piu' un verbo di sistema: e'
  // un'azione della scena, e trattarla come "guardati intorno" vorrebbe dire
  // nascondere al giocatore un'azione che esisteva.
  assert.equal(verboDelPlayer('guarda il camino'), 'nessuno');
  assert.equal(verboDelPlayer('prendi il coltello'), 'nessuno');
});

// -------------------------------------------------------------- matching

const CANDIDATE = [
  { id: 'apri_cassa', label: 'Aprire il registratore di cassa', aliases: ['apri la cassa', 'guarda nella cassa'] },
  { id: 'guarda_porta', label: 'Osservare la porta', aliases: ['guarda la porta', 'osserva la porta'] },
];

test('una frase centrale arriva alla sua azione', async () => {
  const r = new LexicalResolver();
  const res = await r.resolve({ candidates: CANDIDATE, input: 'apro la cassa', tone: '' });
  assert.equal(res.actionId, 'apri_cassa');
  assert.equal(res.via, 'lessicale');
});

test('verbi di famiglia diversa non si scambiano il sostantivo', async () => {
  const r = new LexicalResolver();
  const res = await r.resolve({ candidates: CANDIDATE, input: 'guardo la porta', tone: '' });
  assert.equal(res.actionId, 'guarda_porta');
});

test('davanti a un pareggio il resolver tace invece di tirare a indovinare', async () => {
  // Due azioni con lo stesso identico alias: e' un'ambiguita' vera, e a
  // un'ambiguita' vera si risponde con un fallback. Sbagliare qui vorrebbe
  // dire applicare un Effect che il giocatore non ha chiesto.
  const r = new LexicalResolver();
  const res = await r.resolve({
    candidates: [
      { id: 'a', label: 'Aprire la porta', aliases: ['apri la porta'] },
      { id: 'b', label: 'Aprire la porta', aliases: ['apri la porta'] },
    ],
    input: 'apri la porta',
    tone: '',
  });
  assert.equal(res.actionId, '');
});

test('il nome di un oggetto arriva alla azione che lo ha come target', async () => {
  const r = new LexicalResolver();
  const res = await r.resolve({
    candidates: [{ id: 'taglia', label: 'Recidere', target: 'coltello', aliases: ['recidi'] }],
    input: 'uso il coltellino',
    tone: '',
    world: [{ id: 'coltello', name: 'coltello da lavoro', aliases: ['coltellino', 'lama'] }],
  });
  assert.equal(res.actionId, 'taglia');
});

test('la classifica ordina dalla candidata migliore in giu', () => {
  const c = classifica({ candidates: CANDIDATE, input: 'guarda nella cassa', tone: '' });
  assert.equal(c[0].id, 'apri_cassa');
  assert.ok(c[0].valore > c[1].valore);
});

// -------------------------------------------------------------- fallback

const POOL = [
  { intent: 'percezione' as const, text: 'Non c\'e\' altro da vedere.' },
  { intent: 'generico' as const, text: 'Non succede niente.' },
  { intent: 'generico' as const, text: 'Le cose restano dove sono.' },
];

test('il fallback si sceglie per intenzione, e ruota', () => {
  assert.equal(scegliFallback(POOL, 'percezione'), "Non c'e' altro da vedere.");
  assert.equal(scegliFallback(POOL, 'generico', 0), 'Non succede niente.');
  assert.equal(scegliFallback(POOL, 'generico', 1), 'Le cose restano dove sono.');
});

test("un'intenzione senza testo ripiega su generico, e senza generico non si inventa niente", () => {
  assert.equal(scegliFallback(POOL, 'forza'), 'Non succede niente.');
  assert.equal(scegliFallback([{ intent: 'percezione', text: 'x' }], 'forza'), undefined);
  assert.equal(scegliFallback([], 'generico'), undefined);
  assert.equal(scegliFallback(undefined, 'generico'), undefined);
});

// ----------------------------------------------------------------- turno

const STORIA: Story = parseStory(
  JSON.stringify({
    ir_version: '1.8.0',
    id: 'prova',
    title: 'Prova',
    start_scene: 's1',
    player_voice: {
      inventory_intro: ['Nelle tasche:'],
      inventory_empty: ['Niente addosso.'],
      presence_intro: ['Con te:'],
      presence_alone: ['Sei solo.'],
      no_match_narration: [{ intent: 'generico', text: 'Non succede niente.' }],
    },
    items: [
      {
        id: 'chiave',
        name: 'chiave di ottone',
        aliases: ['chiavetta'],
        description: 'Fredda, piu' + String.fromCharCode(39) + ' pesante di quanto sembri.',
        description_variants: [{ condition: { flag_present: 'acceso' }, text: 'Alla luce si vede la testa lavorata a foglia.' }],
      },
    ],
    characters: [
      { id: 'oste', name: "L'oste" },
      { id: 'tizio', name: 'Un tizio al banco' },
    ],
    scenes: [
      {
        id: 's1',
        background: { image_prompt: 'x' },
        characters: [{ id: 'oste' }, { id: 'tizio' }],
        look: 'Una stanza vuota.',
        look_variants: [{ condition: { flag_present: 'acceso' }, text: 'La stanza, con la luce accesa.' }],
        no_match_narration: [{ intent: 'forza', text: 'Non c\'e\' niente da rompere.' }],
        actions: [
          { id: 'accendi', label: 'Accendere la luce', aliases: ['accendi la luce'], effect: { set_flag: 'acceso' } },
          {
            id: 'esci',
            label: 'Uscire',
            aliases: ['esci', 'vai via'],
            condition: { flag_present: 'acceso' },
            blocked_narration: 'Al buio non si trova nemmeno la maniglia.',
            effect: { goto_scene: 's1' },
          },
        ],
      },
    ],
  }),
);

function prompt(state: GameState): ActionPrompt {
  const sc = STORIA.scenes[0];
  const disponibili = sc.actions.filter((a) => state.meets(a.condition).ok);
  const nascoste = sc.actions
    .filter((a) => !state.meets(a.condition).ok)
    .map((a) => ({ action: a, reason: state.meets(a.condition).why }));
  return { story: STORIA, scene: sc, state, available: disponibili, hidden: nascoste, terminal: false };
}

test("un'azione bloccata mostra il testo d'autore e non applica niente", async () => {
  const st = new GameState();
  const libero = new InputLibero(STORIA, new LexicalResolver());
  const e = await libero.risolvi(prompt(st), 'esci');
  assert.equal(e.kind, 'bloccata');
  assert.equal(e.testo, 'Al buio non si trova nemmeno la maniglia.');
  assert.equal(e.actionId, 'esci');
  // Il vincolo che tutto il resto poggia su: nessuno stato e' cambiato.
  assert.equal(st.flags.size, 0);
  assert.deepEqual(st.inventory, []);
});

test('i verbi del player rispondono solo dopo che il resolver ha detto di no', async () => {
  const st = new GameState();
  const libero = new InputLibero(STORIA, new LexicalResolver());

  const look = await libero.risolvi(prompt(st), 'guardati intorno');
  assert.equal(look.kind, 'verbo');
  assert.equal(look.testo, 'Una stanza vuota.');

  st.flags.add('acceso');
  const look2 = await libero.risolvi(prompt(st), 'guardati intorno');
  assert.equal(look2.testo, 'La stanza, con la luce accesa.');

  const inv = await libero.risolvi(prompt(st), 'cosa ho nello zaino');
  assert.equal(inv.testo, 'Niente addosso.');
  st.inventory.push('chiave');
  const inv2 = await libero.risolvi(prompt(st), 'inventario');
  assert.equal(inv2.testo, 'Nelle tasche: chiave di ottone.');

  // I nomi vengono dalla roster, la cornice dall'autore: il player mette in
  // fila, non scrive.
  const chi = await libero.risolvi(prompt(st), "chi c'è qui?");
  assert.equal(chi.kind, 'verbo');
  assert.equal(chi.verbo, 'presenti');
  assert.equal(chi.testo, "Con te: L'oste e Un tizio al banco.");
});

test('in una scena senza nessuno la solitudine e\' una frase d\'autore', async () => {
  const st = new GameState();
  const libero = new InputLibero(STORIA, new LexicalResolver());
  const p = prompt(st);
  const solitaria = { ...p, scene: { ...p.scene, characters: [] } };
  const chi = await libero.risolvi(solitaria, 'chi c\'è con me');
  assert.equal(chi.testo, 'Sei solo.');
});

test("guardare un oggetto che si ha in mano risponde con la sua descrizione", async () => {
  const st = new GameState();
  const libero = new InputLibero(STORIA, new LexicalResolver());

  // Non in inventario: non e' materia dei verbi del player.
  const prima = await libero.risolvi(prompt(st), 'guarda la chiave');
  assert.notEqual(prima.verbo, 'esamina');

  st.inventory.push('chiave');
  const e = await libero.risolvi(prompt(st), 'guarda la chiavetta');
  assert.equal(e.kind, 'verbo');
  assert.equal(e.verbo, 'esamina');
  assert.match(e.testo ?? '', /pesante di quanto sembri/);

  // La descrizione cambia con lo stato: un oggetto che si trasforma e non lo
  // dice diventa una bugia che il giocatore rilegge ogni volta.
  st.flags.add('acceso');
  const dopo = await libero.risolvi(prompt(st), 'esamina la chiave');
  assert.match(dopo.testo ?? '', /testa lavorata a foglia/);

  // Senza verbo di percezione non e' un esame: "prendi la chiave" deve poter
  // restare un'azione della scena.
  const presa = await libero.risolvi(prompt(st), 'prendi la chiave');
  assert.notEqual(presa.verbo, 'esamina');
});

test('la scena vince sul globale nella scelta del fallback', async () => {
  const st = new GameState();
  const libero = new InputLibero(STORIA, new LexicalResolver());
  const forza = await libero.risolvi(prompt(st), 'sfondo il muro a calci');
  assert.equal(forza.kind, 'niente');
  assert.equal(forza.testo, "Non c'e' niente da rompere.");
  const generico = await libero.risolvi(prompt(st), 'zzz qwerty');
  assert.equal(generico.testo, 'Non succede niente.');
});

test("un'azione disponibile viene eseguita e dichiara chi l'ha scelta", async () => {
  const st = new GameState();
  const libero = new InputLibero(STORIA, new LexicalResolver());
  const e = await libero.risolvi(prompt(st), 'accendi la luce');
  assert.equal(e.kind, 'azione');
  assert.equal(e.actionId, 'accendi');
  assert.equal(e.via, 'lessicale');
});

// ------------------------------------------------------------- embedding

/**
 * Un "modello" finto e deterministico: ogni frase diventa un vettore sulle
 * parole che contiene.
 *
 * Non misura la qualita' di nessun embedder — misura la **logica intorno**:
 * che in ibrido il lessicale parli per primo, che in puro non venga
 * consultato affatto, e che il fallback lo instradino sempre i vettori. Sono
 * le tre cose che si possono rompere cambiando il codice, e le uniche che un
 * test puo' difendere senza scaricare un centinaio di megabyte.
 */
function embedFinto(vocabolario: string[]) {
  return async (testi: string[]): Promise<number[][]> =>
    testi.map((t) => {
      const parole = new Set(t.toLowerCase().split(/[^a-zà-ù]+/).filter(Boolean));
      return vocabolario.map((v) => (parole.has(v) ? 1 : 0));
    });
}

const CANDIDATE_EMB = [
  { id: 'apri_cassa', label: 'Aprire il registratore', aliases: ['apri la cassa'] },
  { id: 'guarda_porta', label: 'Osservare la porta', aliases: ['guarda la porta'] },
];

test('in ibrido il lessicale decide per primo e i vettori non lo scavalcano', async () => {
  // I vettori, da soli, punterebbero altrove: il vocabolario e' fatto apposta
  // perche' "porta" pesi piu' del verbo.
  const r = new EmbeddingResolver(embedFinto(['porta', 'cassa', 'apri', 'guarda']), 'ibrido');
  const res = await r.resolve({ candidates: CANDIDATE_EMB, input: 'apri la cassa', tone: '' });
  assert.equal(res.actionId, 'apri_cassa');
  assert.equal(res.via, 'lessicale');
});

test('in puro decidono i vettori, e il lessicale non viene consultato', async () => {
  const r = new EmbeddingResolver(embedFinto(['porta', 'cassa', 'apri', 'guarda', 'registratore', 'osservare']), 'puro');
  const res = await r.resolve({ candidates: CANDIDATE_EMB, input: 'apri la cassa', tone: '' });
  assert.equal(res.actionId, 'apri_cassa');
  assert.equal(res.via, 'embedding');
});

test('senza nessuna candidata vicina si torna a un fallback, scelto dai vettori', async () => {
  const pool = [
    { intent: 'generico' as const, text: 'Non succede niente.' },
    { intent: 'forza' as const, text: 'Non c\'e\' niente da rompere a calci.' },
  ];
  const r = new EmbeddingResolver(embedFinto(['calci', 'rompere', 'porta', 'cassa', 'niente', 'succede']), 'puro');
  const res = await r.resolve({ candidates: CANDIDATE_EMB, input: 'rompere a calci', tone: '', noMatch: pool });
  assert.equal(res.actionId, '');
  assert.equal(res.via, 'embedding');
  assert.match(res.fallback ?? '', /calci/);
});

test('il nome della modalita dice quale delle tre e', () => {
  const e = embedFinto(['x']);
  assert.match(new EmbeddingResolver(e, 'ibrido').name, /lessicale \+/);
  assert.match(new EmbeddingResolver(e, 'puro').name, /solo vettori/);
  assert.equal(new LexicalResolver().name, 'lessicale (deterministico, nessun modello)');
});

// ------------------------------------------------------------- copertura

test('la copertura distingue le frasi perse da quelle sbagliate', async () => {
  const storia: Story = parseStory(
    JSON.stringify({
      ir_version: '1.8.0',
      id: 'c',
      title: 'C',
      start_scene: 's',
      scenes: [
        {
          id: 's',
          background: { image_prompt: 'x' },
          actions: [
            {
              id: 'apri',
              label: 'Aprire la cassa',
              aliases: ['apri la cassa'],
              test_phrases: ['apri la cassa', 'zzz nulla di riconoscibile'],
              effect: { narration: 'x' },
            },
          ],
        },
      ],
    }),
  );
  const c = await copertura(storia, new LexicalResolver());
  assert.equal(c.totale, 2);
  assert.equal(c.prese, 1);
  assert.equal(c.perse.length, 1);
  assert.equal(c.sbagliate.length, 0);
});
