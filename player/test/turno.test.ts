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

const CON_BERSAGLI: Story = parseStory(
  JSON.stringify({
    ir_version: '1.8.0',
    id: 'b',
    title: 'Bersagli',
    start_scene: 's0',
    characters: [{ id: 'tommy', name: 'Tommy' }],
    items: [
      { id: 'cassa', name: 'la cassa di legno' },
      { id: 'fucile', name: 'il fucile' },
    ],
    scenes: [
      {
        id: 's0',
        look: 'Un magazzino.',
        background: { image_prompt: 'un magazzino' },
        actions: [
          { id: 'apri', label: 'Aprire la cassa', target: 'cassa', aliases: ['apri la cassa'], effect: { set_flag: 'aperta' } },
          { id: 'parla', label: 'Parlare con Tommy', target: 'tommy', aliases: ['parla con tommy'], effect: { narration: 'x' } },
          {
            id: 'prendi',
            label: 'Prendere il fucile',
            target: 'fucile',
            aliases: ['prendi il fucile'],
            condition: { flag_present: 'aperta' },
            blocked_narration: 'Non ancora.',
            effect: { add_inventory: 'fucile' },
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
    .map((a) => ({ action: a, reason: state.meets(a.condition).why, perche: 'condizione' as const }));
  return { story: STORIA, scene: sc, state, available: disponibili, hidden: nascoste, terminal: false, uscite: [] };
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

  // Senza verbo di percezione, e senza un'azione della scena che se ne
  // occupi, si risponde comunque con la descrizione: e' pur sempre testo
  // d'autore su *quella* cosa, mentre il fallback per intenzione parlerebbe
  // d'altro. Quello che conta e' che l'azione della scena, quando c'e', vinca
  // — ed e' il test qui sotto.
  const presa = await libero.risolvi(prompt(st), 'prendi la chiave');
  assert.equal(presa.verbo, 'esamina');
  assert.match(presa.testo ?? '', /pesante di quanto sembri|testa lavorata a foglia/);
});

test("un'azione della scena vince sulla descrizione dell'oggetto", async () => {
  const st = new GameState();
  st.inventory.push('cassa');
  const sc = CON_BERSAGLI.scenes[0];
  const p: ActionPrompt = {
    story: CON_BERSAGLI,
    scene: sc,
    state: st,
    available: sc.actions.filter((a) => st.meets(a.condition).ok),
    hidden: sc.actions.filter((a) => !st.meets(a.condition).ok).map((a) => ({ action: a, reason: 'x', perche: 'condizione' as const })),
    terminal: false,
    uscite: [],
  };
  const e = await new InputLibero(CON_BERSAGLI, new LexicalResolver()).risolvi(p, 'apri la cassa');
  // La precedenza e' quella di sempre: prima il resolver, poi i verbi del
  // player. La descrizione non deve poter scippare un'azione all'autore.
  assert.equal(e.kind, 'azione');
  assert.equal(e.actionId, 'apri');
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

// --------------------------------------------------------------------------
// «Cosa posso fare?»
//
// E' il compromesso fra due cose vere: un player a parole in cui non si trova
// la frase giusta e' un player in cui la storia si ferma, ma l'elenco delle
// azioni risolve gli enigmi al posto del giocatore. La risposta dice **cosa**
// e' in gioco, mai **come** si usa — ed e' su questo confine che i test qui
// sotto stanno di guardia.

test('«cosa posso fare» e le sue forme sono un verbo del player', () => {
  for (const frase of [
    'cosa posso fare',
    'che posso fare',
    'cosa posso fare qui',
    'che si fa adesso',
    'aiuto',
    'sono bloccato',
    'non so cosa fare',
    'suggerimento',
    'suggeriscimi qualcosa',
  ]) {
    assert.equal(verboDelPlayer(frase), 'aiuto', `non riconosciuta: "${frase}"`);
  }
});

test('con un complemento non e piu una richiesta di aiuto', () => {
  // Sono azioni della scena, e scippargliele vorrebbe dire rispondere con un
  // elenco a chi stava chiedendo di una cosa precisa.
  for (const frase of ['cosa posso fare con la leva', 'aiuto mark', 'aiuta il ragazzo', 'cosa faccio con la corda']) {
    assert.notEqual(verboDelPlayer(frase), 'aiuto', `scippata all'autore: "${frase}"`);
  }
});

/** Una scena con dei bersagli veri: un oggetto, una persona, e un'azione
 * nascosta da una condizione che non deve trapelare. */
test('l aiuto nomina i bersagli, non le azioni', async () => {
  const st = new GameState();
  const sc = CON_BERSAGLI.scenes[0];
  const disponibili = sc.actions.filter((a) => st.meets(a.condition).ok);
  const p: ActionPrompt = {
    story: CON_BERSAGLI,
    scene: sc,
    state: st,
    available: disponibili,
    hidden: sc.actions.filter((a) => !st.meets(a.condition).ok).map((a) => ({ action: a, reason: 'x', perche: 'condizione' as const })),
    terminal: false,
    uscite: [],
  };
  const e = await new InputLibero(CON_BERSAGLI, new LexicalResolver()).risolvi(p, 'cosa posso fare');

  assert.equal(e.verbo, 'aiuto');
  assert.ok(e.testo?.includes('la cassa di legno'), e.testo);
  assert.ok(e.testo?.includes('Tommy'), e.testo);
  // Nessuna label: quello sarebbe l'elenco delle azioni, cioe' la soluzione.
  for (const a of sc.actions) assert.ok(!e.testo?.includes(a.label), `ha svelato "${a.label}"`);
  // E niente che venga da un'azione ancora bloccata: sarebbe un anticipo.
  assert.ok(!e.testo?.includes('il fucile'), e.testo);
});

test('senza bersagli l aiuto risponde con la scena, non con una nota di errore', async () => {
  // `target` e' opzionale nello schema e "ambiente" e' la sua convenzione per
  // un bersaglio generico: un IR conforme non deve poter far comparire una
  // diagnostica. La prima versione la faceva comparire in 26 scene su 43.
  const st = new GameState();
  const e = await new InputLibero(STORIA, new LexicalResolver()).risolvi(prompt(st), 'cosa posso fare');
  assert.equal(e.verbo, 'aiuto');
  assert.equal(e.nota, undefined, 'un IR valido non deve produrre note');
  // Il `look` c'e': e' il pezzo che porta l'indizio, e nessun pezzo piu'
  // povero deve coprirlo.
  assert.match(e.testo ?? '', /Una stanza vuota\./);
  // Nessun nome da `Scene.characters`: la roster contiene anche chi il
  // giocatore deve ancora scoprire.
  assert.doesNotMatch(e.testo ?? '', /In gioco/);
  for (const a of STORIA.scenes[0].actions) assert.ok(!e.testo?.includes(a.label));
});

test('il look segue lo stato anche nell aiuto', async () => {
  // E' il pezzo che porta l'indizio: l'unico testo della scena che cambia
  // quando cambia lo stato. Se l'aiuto non lo dicesse, l'indizio resterebbe
  // raggiungibile solo da chi pensa di scrivere «guardati intorno».
  const st = new GameState();
  st.flags.add('acceso');
  const e = await new InputLibero(STORIA, new LexicalResolver()).risolvi(prompt(st), 'cosa posso fare');
  assert.match(e.testo ?? '', /con la luce accesa/);
  assert.doesNotMatch(e.testo ?? '', /Una stanza vuota/);
});

test('senza bersagli e senza nessuno in scena resta il look', async () => {
  const deserta: Story = parseStory(
    JSON.stringify({
      ir_version: '1.8.0',
      id: 'd',
      title: 'Deserta',
      start_scene: 's0',
      scenes: [
        {
          id: 's0',
          look: 'Un corridoio che non finisce.',
          background: { image_prompt: 'un corridoio' },
          // Tutti i target sono generici: e' il caso di 26 scene su 43 in
          // "Metal Head", e la risposta giusta e' l'ambiente stesso.
          actions: [{ id: 'vai', label: 'Andare', target: 'ambiente', aliases: ['vai'], effect: { narration: 'x' } }],
        },
      ],
    }),
  );
  const st = new GameState();
  const sc = deserta.scenes[0];
  const e = await new InputLibero(deserta, new LexicalResolver()).risolvi(
    { story: deserta, scene: sc, state: st, available: sc.actions, hidden: [], terminal: false, uscite: [] },
    'cosa posso fare',
  );
  assert.equal(e.nota, undefined);
  assert.equal(e.testo, 'Un corridoio che non finisce.');
});

test('la domanda di aiuto non puo far partire un azione', async () => {
  // Il caso vero: su "Metal Head" «cosa posso fare» somigliava abbastanza agli
  // alias di certe azioni da eseguirle, e in una scena sparava al tetto del
  // furgone. Qui l'azione ha come alias proprio la domanda: deve perdere.
  const trappola: Story = parseStory(
    JSON.stringify({
      ir_version: '1.8.0',
      id: 't',
      title: 'Trappola',
      start_scene: 's0',
      scenes: [
        {
          id: 's0',
          look: 'Una stanza con una leva.',
          background: { image_prompt: 'una stanza' },
          actions: [
            {
              id: 'spara',
              label: 'Sparare',
              aliases: ['cosa posso fare', 'che posso fare', 'aiuto', 'spara'],
              effect: { set_flag: 'sparato' },
            },
          ],
        },
      ],
    }),
  );
  const st = new GameState();
  const sc = trappola.scenes[0];
  const p: ActionPrompt = {
    story: trappola,
    scene: sc,
    state: st,
    available: sc.actions,
    hidden: [],
    terminal: false,
    uscite: [],
  };
  for (const frase of ['cosa posso fare', 'aiuto']) {
    const e = await new InputLibero(trappola, new LexicalResolver()).risolvi(p, frase);
    assert.equal(e.kind, 'verbo', `"${frase}" ha fatto partire qualcosa`);
    assert.equal(e.actionId, undefined);
  }
  // La stessa azione, chiesta per quello che e', continua a partire.
  const ok = await new InputLibero(trappola, new LexicalResolver()).risolvi(p, 'spara');
  assert.equal(ok.kind, 'azione');
  assert.equal(ok.actionId, 'spara');
});

test("chiedere di nuovo un'azione gia' usata non accusa l'IR di un buco", async () => {
  // `blocked_narration` risponde a una *condizione* non soddisfatta. Lo schema
  // non ha, e non deve avere, un campo per «l'hai gia' fatto»: pretenderlo
  // faceva comparire «manca blocked_narration nell'IR» su un IR conforme.
  const usaEBasta: Story = parseStory(
    JSON.stringify({
      ir_version: '1.8.0',
      id: 'u',
      title: 'Una volta sola',
      start_scene: 's0',
      player_voice: {
        no_match_narration: [{ intent: 'generico', text: 'Non serve a niente.' }],
      },
      scenes: [
        {
          id: 's0',
          look: 'Una stanza con una leva.',
          background: { image_prompt: 'una stanza' },
          actions: [
            {
              id: 'tira',
              label: 'Tirare la leva',
              aliases: ['tira la leva', 'abbassa la leva'],
              repeatable: false,
              effect: { set_flag: 'tirata' },
            },
          ],
        },
      ],
    }),
  );
  const st = new GameState();
  st.consume('s0', 'tira');
  const sc = usaEBasta.scenes[0];
  const p: ActionPrompt = {
    story: usaEBasta,
    scene: sc,
    state: st,
    available: [],
    hidden: [{ action: sc.actions[0], reason: "gia' usata (repeatable: false)", perche: 'gia-usata' }],
    terminal: false,
    uscite: [],
  };
  const e = await new InputLibero(usaEBasta, new LexicalResolver()).risolvi(p, 'tira la leva');

  assert.notEqual(e.kind, 'bloccata');
  assert.equal(e.nota, undefined, `nessuna nota attesa, invece: ${e.nota}`);
  // Risponde testo d'autore, e il motivo resta nella diagnostica del collaudo.
  assert.equal(e.testo, 'Non serve a niente.');
  assert.match(e.why ?? '', /gia' usata/);
});
