/**
 * I test del core: caricamento severo, scelta della fase, parser, turno.
 *
 * La fixture è `testdata/mini.zaistory.json`, la stessa che sta accanto allo
 * schema: una storia che esercita ogni costrutto invece di illustrarne uno.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { LoadError, parseStory } from '../src/core/load.js';
import { Session } from '../src/core/turn.js';
import { currentPhase, currentPlace } from '../src/core/engine.js';
import { classifyIntent, systemQuestion } from '../src/core/verbs.js';
import { lint } from '../src/core/lint.js';
import { coverage } from '../src/core/coverage.js';
import { GameState } from '../src/core/state.js';
import { VectorResolver } from '../src/core/vectors.js';

const RAW = readFileSync(new URL('../../testdata/mini.zaistory.json', import.meta.url), 'utf8');

function fresh(): Session {
  const s = new Session(parseStory(RAW));
  s.begin();
  return s;
}

function texts(r: { events: { text: string }[] }): string {
  return r.events.map((e) => e.text).join(' | ');
}

// ------------------------------------------------------------ caricamento

test('carica la fixture e ne indicizza i pezzi', () => {
  const idx = parseStory(RAW);
  assert.equal(idx.story.id, 'mini');
  assert.equal(idx.acts.size, 2);
  assert.equal(idx.places.size, 3);
  assert.equal(idx.actOfPlace.get('cortile'), 'atto_due');
  assert.ok(idx.props.has('bancone'));
});

test('un campo non previsto fa fallire il caricamento', () => {
  const broken = JSON.parse(RAW);
  broken.acts[0].places[0].colore = 'blu';
  assert.throws(() => parseStory(JSON.stringify(broken)), (e: unknown) => {
    assert.ok(e instanceof LoadError);
    assert.match(e.message, /campo non previsto/);
    return true;
  });
});

test("un'uscita verso un luogo inesistente fa fallire il caricamento", () => {
  const broken = JSON.parse(RAW);
  broken.acts[0].places[0].exits[0].to = 'nessun_posto';
  assert.throws(() => parseStory(JSON.stringify(broken)), /non esiste/);
});

// ------------------------------------------------------------------ fasi

test('la fase è la prima la cui condizione è soddisfatta', () => {
  const s = fresh();
  const pl = currentPlace(s.idx, s.state);
  assert.equal(currentPhase(pl, s.state)?.id, 'taverna_arrivo');
  s.state.flags.add('chiave_scoperta');
  assert.equal(currentPhase(pl, s.state)?.id, 'taverna_dopo');
});

test("entrare alza i flag d'ingresso della fase", () => {
  const s = fresh();
  assert.ok(s.state.flags.has('strada_nota'));
});

// ---------------------------------------------------------------- parser

test('una frase libera arriva all\'azione giusta', () => {
  const s = fresh();
  const r = s.input('do un\'occhiata al bancone');
  assert.match(texts(r), /ripiano in ombra/);
  assert.ok(s.state.flags.has('oste_diffidente'));
});

test('il verbo sbagliato non fa partire l\'azione giusta', () => {
  const s = fresh();
  // «guarda» non deve eseguire un'azione di manipolazione sullo stesso oggetto
  s.state.flags.add('oste_diffidente');
  const r = s.input('guardo il luccichio sotto il banco');
  assert.equal(s.state.hasItem('chiave'), false, 'guardare non deve raccogliere');
  assert.ok(texts(r).length > 0);
});

test('un\'azione bloccata riceve la sua blocked_narration e non applica niente', () => {
  const s = fresh();
  const r = s.input('afferro il luccichio sotto il banco');
  assert.match(texts(r), /Non hai ancora visto niente/);
  assert.equal(s.state.hasItem('chiave'), false);
  assert.equal(s.state.flags.has('chiave_scoperta'), false);
});

test('«usa X con Y» risolve solo se sono nominati tutti e due', () => {
  const s = fresh();
  s.input('accendo il lume');
  assert.equal(s.state.hasItem('lanterna_accesa'), false, 'un complemento solo non deve bastare');
  const coppia = s.input('do fuoco alla lanterna con le braci del camino');
  assert.match(texts(coppia), /stoppino/);
  assert.ok(s.state.hasItem('lanterna_accesa'));
  assert.equal(s.state.hasItem('lanterna_spenta'), false, 'la trasformazione toglie il vecchio oggetto');
});

// ---------------------------------------------------------------- uscite

test('un\'uscita bloccata lo dice, e non sposta', () => {
  const s = fresh();
  const r = s.input('esco dalla porta sulla strada');
  assert.match(texts(r), /chiusa a chiave/);
  assert.equal(s.state.place, 'taverna');
});

test('con la chiave si esce, e la transizione si vede una volta sola', () => {
  const s = fresh();
  s.input('do un\'occhiata al bancone');
  s.input('afferro il luccichio sotto il banco');
  assert.ok(s.state.hasItem('chiave'));

  const uscita = s.input('vado sulla strada');
  assert.equal(s.state.place, 'strada');
  assert.match(texts(uscita), /aria di fuori/);

  s.input('torno nella taverna');
  assert.equal(s.state.place, 'taverna');
  const seconda = s.input('vado sulla strada');
  assert.doesNotMatch(texts(seconda), /aria di fuori/, 'la cutscene di passaggio non si rivede');
});

test('«dove posso andare» elenca solo le uscite conosciute', () => {
  const s = fresh();
  const r = s.input('dove posso andare');
  assert.match(texts(r), /porta sulla strada/);
});

// -------------------------------------------------------------- dialoghi

test('il dialogo si gioca a scelte, e le scelte cambiano lo stato', () => {
  const s = fresh();
  const apre = s.input('parlo con l\'oste');
  assert.ok(apre.choices && apre.choices.length === 2, 'le battute disponibili si vedono sempre');
  const scelta = s.choose(1);
  assert.match(texts(scelta), /posa lo straccio/);
  assert.ok(s.state.flags.has('ha_offeso_oste'));
});

test('nel dialogo scrivere non risolve azioni', () => {
  const s = fresh();
  s.input('parlo con l\'oste');
  const r = s.input('afferro il luccichio');
  assert.match(texts(r), /si sceglie una battuta/);
});

// ----------------------------------------------------- verbi di sistema

test('«guardati intorno» dà il look, e cambia con lo stato', () => {
  const s = fresh();
  assert.match(texts(s.input('guardati intorno')), /Quattro tavoli/);
  s.input('do un\'occhiata al bancone');
  assert.match(texts(s.input('dove sono')), /non ti toglie gli occhi di dosso/);
});

test('l\'inventario risponde con i nomi, non con gli id', () => {
  const s = fresh();
  assert.match(texts(s.input('cosa ho nello zaino')), /lanterna spenta/);
});

test('«chi c\'è qui» non elenca il protagonista', () => {
  const s = fresh();
  const r = texts(s.input('chi c\'è qui'));
  assert.match(r, /oste/i);
  assert.doesNotMatch(r, /vagabondo/i);
});

test('«cosa posso fare» dà i bersagli, non le azioni', () => {
  const s = fresh();
  const r = texts(s.input('cosa posso fare'));
  assert.match(r, /In gioco:/);
  assert.doesNotMatch(r, /prendi_chiave/);
});

test('una domanda non fa mai partire un\'azione', () => {
  const s = fresh();
  s.input('aiuto');
  assert.equal(s.state.flags.size, 1, 'solo il flag d\'ingresso');
});

// ------------------------------------------------------------- fallback

test('una frase incomprensibile riceve il fallback per intenzione', () => {
  const s = fresh();
  assert.match(texts(s.input('spacco tutto a calci')), /Le mani non trovano/);
  assert.match(texts(s.input('canto una canzone')), /Non ti viene in mente/);
});

test('un turno che non risolve niente lo dichiara', () => {
  const s = fresh();
  // Serve a chi tiene una traccia rigiocabile: una frase che non ha mosso la
  // storia non la muoverà nemmeno rigiocandola.
  assert.equal(s.input('spacco tutto a calci').noMatch, true);
  assert.equal(s.input("do un'occhiata al bancone").noMatch, undefined);
  assert.equal(s.input('cosa ho con me').noMatch, undefined);
});

test('una frase che nomina una cosa in mano parla di quella cosa', () => {
  const s = fresh();
  const r = texts(s.input('la lanterna spenta'));
  assert.match(r, /stoppino corto/);
});

test('la risposta di una cosa nominata dice di quale cosa parla', () => {
  const s = fresh();
  const e = s.input('la lanterna spenta').events.find((x) => x.about);
  // Senza questo, la faccia web dovrebbe rifare da capo la scelta del
  // bersaglio per sapere di che immagine si tratta.
  assert.deepEqual(e?.about, { kind: 'item', id: 'lanterna_spenta' });
});

test("un oggetto d'ambiente nominato si distingue da uno in mano", () => {
  const s = fresh();
  // Non «il bancone»: lì c'è un'azione d'autore, e un'azione vince sempre.
  const e = s.input('il camino').events.find((x) => x.about);
  assert.deepEqual(e?.about, { kind: 'prop', id: 'camino' });
});

// -------------------------------------------------- atti, finale, memoria

test('la storia arriva al finale, e il carry flag attraversa l\'atto', () => {
  const s = fresh();
  s.input('parlo con l\'oste');
  s.choose(1); // offende l'oste: carry flag
  s.input('do un\'occhiata al bancone');
  s.input('afferro il luccichio sotto il banco');
  s.input('do fuoco alla lanterna con le braci del camino');
  s.input('vado sulla strada');
  s.input('proseguo verso il cortile');
  assert.equal(s.state.place, 'cortile');
  assert.equal(s.state.act, 'atto_due');

  assert.ok(s.state.flags.has('ha_offeso_oste'), 'il carry flag sopravvive');
  assert.equal(s.state.flags.has('oste_diffidente'), false, 'i flag locali muoiono con l\'atto');
  assert.ok(s.state.hasItem('chiave'), 'l\'inventario attraversa');

  const look = texts(s.input('guardati intorno'));
  assert.match(look, /sguardo dell.oste/, 'il carry flag cambia cosa dice la storia');

  const fine = s.input('batto sulla porta');
  assert.equal(fine.ended?.kind, 'natural');
});

// --------------------------------------------------------- microunità

test('le domande di sistema si riconoscono per forma intera', () => {
  assert.equal(systemQuestion('cosa posso fare'), 'help');
  assert.equal(systemQuestion('cosa posso fare con la leva'), undefined);
  assert.equal(systemQuestion('inventario'), 'inventory');
});

test('le intenzioni classificano le quattro famiglie', () => {
  assert.equal(classifyIntent('osservo la stanza'), 'perception');
  assert.equal(classifyIntent('prendo la chiave'), 'manipulation');
  assert.equal(classifyIntent('spacco la porta'), 'manipulation');
  assert.equal(classifyIntent('chiedo all\'oste'), 'communication');
  assert.equal(classifyIntent('torno indietro'), 'movement');
  assert.equal(classifyIntent('bla bla'), 'generic');
});

// ---------------------------------------------------------------- linter

test('la fixture non ha errori di giocabilità', () => {
  const findings = lint(parseStory(RAW));
  const errors = findings.filter((x) => x.severity === 'errore');
  assert.deepEqual(errors, [], errors.map((e) => `${e.where}: ${e.message}`).join('\n'));
});

test('il linter vede un flag richiesto che nessuno alza', () => {
  const broken = JSON.parse(RAW);
  const fase = broken.acts[0].places[0].phases[1];
  fase.actions[0].condition = { flag_present: 'mai_impostato' };
  fase.actions[0].blocked_narration = 'no.';
  broken.acts[0].flags.push('mai_impostato');
  const msgs = lint(parseStory(JSON.stringify(broken)))
    .filter((x) => x.severity === 'errore')
    .map((x) => x.message);
  assert.ok(msgs.some((m) => /non lo imposta niente/.test(m)), msgs.join('\n'));
});

test('il linter vede un flag di un altro atto', () => {
  const broken = JSON.parse(RAW);
  broken.acts[1].places[0].phases[1].actions[0].condition = { flag_present: 'oste_diffidente' };
  broken.acts[1].places[0].phases[1].actions[0].blocked_narration = 'no.';
  const msgs = lint(parseStory(JSON.stringify(broken)))
    .filter((x) => x.severity === 'errore')
    .map((x) => x.message);
  assert.ok(msgs.some((m) => /i flag sono locali all'atto/.test(m)), msgs.join('\n'));
});

test('il linter vede un carry flag che nessuno legge', () => {
  const broken = JSON.parse(RAW);
  broken.acts[1].reads_carry_flags = [];
  broken.acts[1].places[0].phases[1].look_variants = [];
  const msgs = lint(parseStory(JSON.stringify(broken)))
    .filter((x) => x.severity === 'errore')
    .map((x) => x.message);
  assert.ok(msgs.some((m) => /memoria morta/.test(m)), msgs.join('\n'));
});

test('il linter vede un finale prematuro dove non si può perdere', () => {
  const broken = JSON.parse(RAW);
  broken.acts[1].places[0].phases[0].ending = { kind: 'premature' };
  const msgs = lint(parseStory(JSON.stringify(broken)))
    .filter((x) => x.severity === 'errore')
    .map((x) => x.message);
  assert.ok(msgs.some((m) => /qui non si perde/.test(m)), msgs.join('\n'));
});

test("il linter vede un'azione il cui bersaglio non è osservabile", () => {
  const broken = JSON.parse(RAW);
  delete broken.acts[0].places[0].objects[0].description;
  const msgs = lint(parseStory(JSON.stringify(broken)))
    .filter((x) => x.severity === 'errore')
    .map((x) => x.message);
  assert.ok(msgs.some((m) => /deve essere osservabile/.test(m)), msgs.join('\n'));
});

// ------------------------------------------------------------- copertura

test('la copertura misura, e nessuna frase fa partire l\'azione sbagliata', () => {
  const r = coverage(parseStory(RAW));
  assert.ok(r.total > 0);
  assert.equal(r.wrong, 0, r.misses.filter((m) => m.kind === 'sbagliata').map((m) => m.phrase).join('\n'));
  assert.ok(r.hit / r.total > 0.6, `copertura troppo bassa: ${r.hit}/${r.total}`);
});

test("un'azione del luogo si misura una volta sola", () => {
  const r = coverage(parseStory(RAW));
  const perAction = r.misses.filter((m) => m.action === 'accendi_lanterna').length;
  assert.ok(perAction <= 2, 'le frasi di un\'azione di luogo non vanno contate una volta per fase');
});

// ------------------------------------------------- bersagli che non ci sono

test("un'azione il cui bersaglio non c'è più non è disponibile", () => {
  const s = fresh();
  s.input('do fuoco alla lanterna con le braci del camino');
  assert.ok(s.state.hasItem('lanterna_accesa'));

  // «accendi la lanterna» aveva per bersaglio la lanterna SPENTA, che adesso
  // non è più in mano: accenderla l'ha sostituita con un altro oggetto.
  const aiuto = texts(s.input('cosa posso fare'));
  assert.doesNotMatch(aiuto, /lanterna spenta/, 'un oggetto che non si ha più non è un bersaglio');

  // E riprovarci non riesegue l'azione: risponde la cosa che si ha in mano.
  const ritenta = texts(s.input('accendo la lanterna al camino'));
  assert.match(ritenta, /fiamma è bassa|non/i);
});

test("un oggetto d'ambiente assente non è un bersaglio", () => {
  const s = fresh();
  s.input("do un'occhiata al bancone");
  s.input('afferro il luccichio sotto il banco');
  // Il prop sparisce con `present_when`, e con lui l'azione che lo prendeva.
  const aiuto = texts(s.input('cosa posso fare'));
  assert.doesNotMatch(aiuto, /qualcosa di lucido/);
});

// ------------------------------------------------- condizioni composte

test('all_of chiede tutto, any_of basta una', () => {
  const st = new GameState();
  st.flags.add('acceso');
  st.inventory.push('chiave');

  // Il caso per cui all_of esiste: due oggetti sulla stessa porta.
  assert.equal(st.meets({ all_of: [{ has_item: 'chiave' }, { flag_present: 'acceso' }] }).ok, true);
  assert.equal(st.meets({ all_of: [{ has_item: 'chiave' }, { has_item: 'lampada' }] }).ok, false);

  // Il caso per cui any_of esiste: l'oggetto in una qualunque delle sue forme.
  assert.equal(st.meets({ any_of: [{ has_item: 'lampada' }, { has_item: 'chiave' }] }).ok, true);
  assert.equal(st.meets({ any_of: [{ has_item: 'lampada' }, { has_item: 'corda' }] }).ok, false);

  // Composte, e mescolate con i campi semplici (che valgono in AND).
  assert.equal(
    st.meets({ flag_present: 'acceso', any_of: [{ has_item: 'chiave' }, { has_item: 'corda' }] }).ok,
    true,
  );
  assert.equal(st.meets({ all_of: [{ any_of: [{ has_item: 'corda' }, { flag_present: 'acceso' }] }] }).ok, true);
});

test('una porta che chiede due oggetti si comporta come deve', () => {
  const broken = JSON.parse(RAW);
  const uscita = broken.acts[0].places[1].exits.find((e: { to: string }) => e.to === 'cortile');
  uscita.condition = { all_of: [{ has_item: 'lanterna_accesa' }, { has_item: 'chiave' }] };
  const s = new Session(parseStory(JSON.stringify(broken)));
  s.begin();
  s.input('do fuoco alla lanterna con le braci del camino');
  // Con la sola lanterna non basta più: manca la chiave.
  s.input('esco sulla strada');
  assert.equal(s.state.place, 'taverna', 'senza la chiave non si esce nemmeno dalla taverna');
});

test('un campo inventato dentro un ramo composto non passa il caricamento', () => {
  const broken = JSON.parse(RAW);
  broken.acts[0].places[0].phases[1].actions[0].condition = {
    all_of: [{ flag_present: 'oste_diffidente', colore: 'blu' }],
  };
  assert.throws(() => parseStory(JSON.stringify(broken)), /campo non previsto/);
});

// ------------------------------------------------- il secondo interprete

/**
 * Un finto embedder: nessun modello, nessuna rete. Trasforma una frase nel
 * vettore delle sue parole, così il coseno misura quante parole si dividono —
 * abbastanza per verificare *dove* i vettori intervengono, che è la cosa che
 * questi test devono proteggere. Quanto siano bravi a capire l'italiano è
 * un'altra domanda, e non si risponde con un test.
 */
function finteParole(vocabolario: string[]) {
  return async (testi: string[]): Promise<number[][]> =>
    testi.map((t) => {
      const parole = new Set(t.toLowerCase().split(/[^a-zà-ù]+/).filter(Boolean));
      return vocabolario.map((v) => (parole.has(v) ? 1 : 0));
    });
}

test('preview dice dove il lessicale è muto, e non tocca niente', () => {
  const s = fresh();
  const prima = s.state.turn;
  assert.equal(s.preview('guardati intorno'), 'sistema');
  assert.equal(s.preview('parlo con l’oste'), 'risolta');
  assert.equal(s.preview('faccio la ruota sul tavolo'), 'muto');
  assert.equal(s.state.turn, prima, 'guardare cosa succederebbe non è un turno');
  assert.equal(s.snapshot().phase?.id, fresh().snapshot().phase?.id);
});

test('i vettori decidono solo dove il lessicale tace', async () => {
  const s = fresh();
  const { actions, exits } = s.candidates();
  const v = new VectorResolver(finteParole(['raccolgo', 'brilla']), 'ibrido');

  // La frase non nomina nessun bersaglio con le parole che il compilatore ha
  // scritto negli alias — «brilla» non è un alias, «luccichio» sì — e il parser
  // resta muto. Le frasi di prova invece quelle parole ce le hanno, ed è lì che
  // i vettori arrivano dove il lessicale non arriva.
  const frase = 'raccolgo quello che brilla';
  assert.equal(s.preview(frase), 'muto');
  const vicina = await v.vicina(s.idx, frase, actions, exits);
  assert.ok(vicina, 'i vettori avrebbero dovuto trovare qualcosa');
  assert.equal(vicina!.res.kind, 'action');
  // E arrivandoci non scavalcano niente: qui l'azione c'è ma la sua condizione
  // non è ancora vera, e la risposta è il rifiuto d'autore, senza effetti.
  const r = s.takeResolution(vicina!.res);
  assert.match(texts(r), /allungare una mano/);
  assert.equal(s.state.inventory.includes('chiave'), false);
});

test('il fallback scelto dai vettori resta testo d’autore', async () => {
  const s = fresh();
  const pool = s.fallbackPool();
  assert.ok(pool.length > 1, 'la fixture deve avere più di un fallback');
  const v = new VectorResolver(finteParole(['tocco', 'guardo', 'parlo', 'vado']), 'ibrido');
  const scelto = await v.fallback('tocco tutto quello che vedo', pool);
  assert.ok(
    pool.some((n) => n.text === scelto),
    'il fallback deve essere uno di quelli scritti nella storia, non uno nuovo',
  );
  const r = s.input('tocco tutto quello che vedo', { chooseFallback: () => scelto });
  assert.match(texts(r), new RegExp(scelto!.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
