/**
 * Test dell'engine, portati uno a uno da quelli del player Go: se il
 * comportamento fosse cambiato nella migrazione, e' qui che si vede.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  Engine,
  GameState,
  ScriptEndedError,
  parseStory,
  type ActionPrompt,
  type ChoicePrompt,
  type Command,
  type DialogueNode,
  type NarrationBeat,
  type Outcome,
  type PlayerUI,
  type Scene,
  type Story,
} from '../src/core/index.js';

function fixture(name: string): Story {
  const path = fileURLToPath(new URL(`../../testdata/${name}`, import.meta.url));
  return parseStory(readFileSync(path, 'utf8'));
}

/**
 * UI finta che gioca una sequenza di token predefinita e registra quello che
 * vede. E' la stessa idea dello script di playthrough, ridotta al minimo.
 */
class FakeUI implements PlayerUI {
  pos = 0;
  problems: string[] = [];
  log: string[] = [];
  hidden = new Map<string, string>();

  constructor(private toks: string[] = []) {}

  private next(): string {
    if (this.pos >= this.toks.length) throw new ScriptEndedError();
    return this.toks[this.pos++];
  }

  sceneEnter(_st: GameState, sc: Scene): void {
    this.log.push('scena:' + sc.id);
  }
  beat(sc: Scene, _b: NarrationBeat, _i: number, _n: number): void {
    this.log.push('beat:' + sc.id);
  }
  line(_sc: Scene, nodeId: string, _n: DialogueNode): void {
    this.log.push('nodo:' + nodeId);
  }
  narration(): void {
    this.log.push('narr');
  }
  sound(): void {}
  stateChange(desc: string): void {
    this.log.push('stato:' + desc);
  }
  notice(): void {}
  problem(text: string): void {
    this.problems.push(text);
  }
  finish(_o: Outcome): void {}

  async chooseAction(p: ActionPrompt): Promise<Command> {
    for (const h of p.hidden) this.hidden.set(h.action.id, h.reason);
    const want = this.next().replace(/^a:/, '');
    const a = p.available.find((x) => x.id === want);
    if (a) return { actionId: a.id };
    this.problems.push(`test: azione ${want} non disponibile in ${p.scene.id}`);
    return { quit: true };
  }

  async chooseChoice(p: ChoicePrompt): Promise<Command> {
    const want = this.next().replace(/^c:/, '');
    const i = p.available.findIndex((c) => c.goto === want);
    if (i >= 0) return { choiceIndex: i };
    this.problems.push(`test: scelta ${want} non disponibile nel nodo ${p.nodeId}`);
    return { quit: true };
  }
}

test('una partita completa arriva al finale senza problemi', async () => {
  const story = fixture('mini.ir.json');
  const ui = new FakeUI(['a:continua', 'a:parla_oste', 'c:d_chiave', 'a:prendi_chiave', 'a:esci']);
  const e = new Engine(story, ui);
  const out = await e.run();

  assert.deepEqual(out.problems, [], 'nessun problema atteso');
  assert.ok(out.ended, `la storia doveva arrivare a un finale, invece: ${out.reason}`);
  assert.equal(out.scene, 'finale');
  assert.ok(e.state.hasItem('chiave'), `la chiave doveva essere in inventario: ${e.state.inventory}`);
  assert.ok(e.state.flags.has('oste_parlato') && e.state.flags.has('prologo_visto'));
  assert.deepEqual(e.state.history, ['prologo', 'taverna', 'finale']);
  // La traccia deve essere rigiocabile tale e quale.
  assert.deepEqual(out.trace, ['a:continua', 'a:parla_oste', 'c:d_chiave', 'a:prendi_chiave', 'a:esci']);
});

test("un'azione condizionata resta nascosta finche' manca il flag", async () => {
  const story = fixture('mini.ir.json');
  // Si tenta di prendere la chiave prima di parlare con l'oste.
  const ui = new FakeUI(['a:continua', 'a:prendi_chiave']);
  await new Engine(story, ui).run();

  const reason = ui.hidden.get('prendi_chiave');
  assert.ok(reason, `prendi_chiave doveva risultare nascosta, nascoste: ${[...ui.hidden.keys()]}`);
  assert.match(reason, /oste_parlato/, 'il motivo doveva citare il flag mancante');
  assert.ok(ui.problems.length > 0, "il tentativo su un'azione non disponibile doveva essere segnalato");
});

test("un'azione non ripetibile si consuma dopo il primo uso", async () => {
  const story = fixture('mini.ir.json');
  const ui = new FakeUI(['a:continua', 'a:parla_oste', 'c:d_chiave', 'a:prendi_chiave', 'a:prendi_chiave']);
  await new Engine(story, ui).run();

  assert.match(ui.hidden.get('prendi_chiave') ?? '', /repeatable/);
});

test('una scena terminale chiude la partita anche se lo script finisce', async () => {
  const story = fixture('mini.ir.json');
  const ui = new FakeUI(['a:continua', 'a:parla_oste', 'c:d_chiave', 'a:prendi_chiave', 'a:esci']);
  const out = await new Engine(story, ui).run();
  assert.ok(out.ended && !out.quit, `il finale doveva chiudere la partita: ${JSON.stringify(out)}`);
});

test("gli effetti si applicano nell'ordine dello schema", () => {
  const st = new GameState();
  const ui = new FakeUI();
  const tr = st.apply(
    { narration: 'testo', set_flag: 'a', add_inventory: 'oggetto', goto_scene: 'altrove' },
    ui,
  );

  assert.deepEqual(tr, { kind: 'scene', target: 'altrove' });
  assert.ok(st.flags.has('a') && st.hasItem('oggetto'));
  assert.equal(ui.log[0], 'narr', 'la narrazione doveva precedere i cambi di stato');
});

test('un goto verso una scena inesistente e\' un problema segnalato', async () => {
  const story = fixture('rotta.ir.json');
  const ui = new FakeUI(['a:porta_rotta']);
  const out = await new Engine(story, ui).run();

  assert.ok(out.problems.length > 0, 'un goto verso una scena inesistente doveva essere segnalato');
  assert.match(out.problems[0], /scena_inesistente/);
});

test('initial_inventory e\' gia\' in inventario prima della prima scena', async () => {
  // Un oggetto che il personaggio si porta dietro da prima della storia: la
  // sua unica azione lo richiede, e deve essere disponibile subito.
  const story: Story = {
    ir_version: '1.5.0',
    id: 'zaino',
    title: 'Con qualcosa nello zaino',
    start_scene: 'unica',
    items: [{ id: 'walkie_talkie', name: 'walkie talkie', aliases: ['radio', 'ricetrasmittente'] }],
    initial_inventory: ['walkie_talkie'],
    scenes: [
      {
        id: 'unica',
        background: { image_prompt: 'una stanza' },
        actions: [
          {
            id: 'usa_radio',
            label: 'Accendi la radio',
            condition: { has_item: 'walkie_talkie' },
            effect: { narration: 'Statica.' },
          },
        ],
      },
    ],
  };

  const ui = new FakeUI(['a:usa_radio']);
  const e = new Engine(story, ui);
  await e.run();

  assert.ok(e.state.hasItem('walkie_talkie'), 'la radio doveva essere in inventario dall\'inizio');
  assert.equal(ui.hidden.size, 0, "l'azione condizionata all'oggetto non doveva risultare nascosta");
});

// --------------------------------------------------------------------------
// Le uscite che si mostrano quando la scena e' finita.
//
// La regola scatta solo quando non resta piu' niente da fare, e "niente da
// fare" ha una definizione precisa: ogni azione disponibile che non sia
// un'uscita e' gia' stata eseguita, oppure e' pura osservazione. Senza la
// prima meta' non scatterebbe mai dove serve — un'azione che apre un dialogo
// resta disponibile anche dopo averlo ascoltato.

const STORIA_USCITE: Story = parseStory(
  JSON.stringify({
    ir_version: '1.8.0',
    id: 'u',
    title: 'Uscite',
    start_scene: 's0',
    scenes: [
      {
        id: 's0',
        look: 'Una stanza.',
        background: { image_prompt: 'una stanza' },
        actions: [
          // Fa avanzare: finche' non e' stata fatta, la scena non e' finita.
          { id: 'accendi', label: 'Accendere', aliases: ['accendi'], effect: { set_flag: 'acceso' } },
          // Pura osservazione: rileggibile per sempre, non tiene aperta la scena.
          { id: 'guarda', label: 'Guardare il muro', aliases: ['guarda il muro'], effect: { narration: 'Un muro.' } },
          { id: 'esci', label: 'Uscire', aliases: ['esci'], effect: { goto_scene: 's1' } },
        ],
      },
      {
        id: 's1',
        look: 'Fuori.',
        background: { image_prompt: 'fuori' },
        actions: [],
      },
    ],
  }),
);

/** Come `FakeUI`, ma tiene da parte i prompt per poterli guardare dopo. */
class UISpia extends FakeUI {
  constructor(
    private visti: ActionPrompt[],
    toks: string[],
  ) {
    super(toks);
  }
  override async chooseAction(p: ActionPrompt): Promise<Command> {
    this.visti.push(p);
    return super.chooseAction(p);
  }
}

test('le uscite restano nascoste finche resta qualcosa da fare', async () => {
  const prompts: ActionPrompt[] = [];
  await new Engine(STORIA_USCITE, new UISpia(prompts, ['accendi', 'esci'])).run();

  // Primo turno: c'e' ancora "accendi" da fare, quindi niente uscite.
  assert.deepEqual(prompts[0].uscite.map((u) => u.id), []);
  // Secondo turno: "accendi" e' stata fatta e "guarda" e' pura osservazione,
  // quindi non resta niente e l'uscita si mostra.
  assert.deepEqual(prompts[1].uscite.map((u) => u.id), ['esci']);
});

test('un osservazione non tiene aperta la scena', async () => {
  const prompts: ActionPrompt[] = [];
  // Si guarda il muro all'infinito: la scena resta finita lo stesso.
  await new Engine(STORIA_USCITE, new UISpia(prompts, ['accendi', 'guarda', 'guarda', 'esci'])).run();
  assert.deepEqual(prompts[3].uscite.map((u) => u.id), ['esci']);
});

test('una scena che e solo un bivio non mostra niente', () => {
  // Il caso vero: la cabina del furgone in "Metal Head" ha quattro azioni e
  // tutte e quattro portano fuori. Li' non resta niente da fare fin dal primo
  // istante — non perche' la scena sia esaurita, ma perche' non ha mai avuto
  // altro — e mostrarle tutte significa stampare il menu delle scelte.
  const bivio: Story = parseStory(
    JSON.stringify({
      ir_version: '1.8.0',
      id: 'b',
      title: 'Bivio',
      start_scene: 's0',
      scenes: [
        {
          id: 's0',
          look: 'Una cabina che sbanda.',
          background: { image_prompt: 'una cabina' },
          actions: [
            { id: 'urla', label: 'Urlare', aliases: ['urla'], effect: { goto_scene: 's1' } },
            { id: 'afferra', label: 'Afferrare il volante', aliases: ['afferra'], effect: { goto_scene: 's1' } },
            { id: 'batti', label: 'Battere sul tetto', aliases: ['batti'], effect: { goto_scene: 's1' } },
          ],
        },
        { id: 's1', look: 'Dopo.', background: { image_prompt: 'dopo' }, actions: [] },
      ],
    }),
  );
  const prompts: ActionPrompt[] = [];
  return new Engine(bivio, new UISpia(prompts, ['urla'])).run().then(() => {
    assert.deepEqual(prompts[0].uscite, [], 'con piu di un uscita non si mostra niente');
  });
});
