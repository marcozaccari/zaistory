/**
 * La lettura severa di un file zaistory.
 *
 * Qui `additionalProperties: false` smette di essere una riga di schema e
 * diventa codice: un campo non previsto fa fallire il caricamento, esattamente
 * come farebbe la validazione. È voluto, ed è una rete di sicurezza contro le
 * allucinazioni del compilatore — un campo plausibile ma non previsto va
 * scartato e corretto, non accettato in silenzio.
 *
 * Il player è anche, per questa ragione, un test di conformità: se riesce a
 * caricare e portare una storia dall'inizio alla fine, il contratto regge.
 */

import type { Story } from './types.js';
import { buildIndex } from './types.js';
import type { StoryIndex } from './types.js';

export class LoadError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'LoadError';
  }
}

type Shape = { required?: string[]; optional?: string[] };

/** I campi ammessi per ogni oggetto del formato. È il riflesso dello schema, e
 * va tenuto allineato a mano: sono le due metà dello stesso contratto. */
const SHAPES: Record<string, Shape> = {
  Story: {
    required: ['zaistory_version', 'id', 'title', 'start_act', 'acts'],
    optional: [
      'generated_by', 'description', 'language', 'cover', 'failure_mode', 'global_style',
      'player_voice', 'protagonist', 'characters', 'items', 'initial_inventory', 'carry_flags',
    ],
  },
  Provenance: { required: ['compiler', 'compiler_version'], optional: ['model'] },
  VoiceSpec: { optional: ['style_prompt'] },
  GlobalStyle: {
    optional: [
      'image_style_suffix', 'image_style_suffix_en', 'anchor_framing', 'narrator_voice',
      'default_tone', 'ambient_music_tags',
    ],
  },
  Condition: { optional: ['flag_present', 'flag_absent', 'has_item', 'all_of', 'any_of'] },
  ConditionalText: { required: ['condition', 'text'] },
  Effect: {
    optional: [
      'narration', 'narration_voice', 'set_flag', 'unset_flag', 'add_inventory',
      'remove_inventory', 'play_sound_prompt', 'goto_dialogue', 'goto_place',
    ],
  },
  CarryFlag: { required: ['id'], optional: ['description'] },
  Character: {
    required: ['id'],
    optional: [
      'name', 'aliases', 'description', 'description_variants', 'visual_prompt',
      'visual_prompt_en', 'anchor_framing', 'image', 'voice',
    ],
  },
  Item: {
    required: ['id', 'name'],
    optional: ['aliases', 'description', 'description_variants', 'visual_prompt', 'visual_prompt_en', 'image'],
  },
  Prop: {
    required: ['id', 'name'],
    optional: [
      'aliases', 'description', 'description_variants', 'present_when',
      'visual_prompt', 'visual_prompt_en', 'image',
    ],
  },
  NoMatch: { required: ['intent', 'text'] },
  PlayerVoice: {
    optional: [
      'inventory_intro', 'inventory_empty', 'presence_intro', 'presence_alone',
      'exits_intro', 'exits_none', 'no_match_narration',
    ],
  },
  Background: {
    required: ['image_prompt'],
    optional: ['image_prompt_en', 'image', 'ambient_sound_prompt', 'place', 'characters_in_frame'],
  },
  NarrationBeat: {
    required: ['text'],
    optional: ['voice', 'image_prompt', 'image_prompt_en', 'image', 'sound_effect_prompt', 'characters_in_frame'],
  },
  Act: {
    required: ['id', 'start_place', 'places'],
    optional: ['title', 'flags', 'reads_carry_flags', 'writes_carry_flags'],
  },
  Place: {
    required: ['id', 'name', 'phases'],
    optional: ['aliases', 'same_as', 'visual_prompt', 'visual_prompt_en', 'image', 'completed_when', 'exits', 'objects', 'actions'],
  },
  Exit: {
    required: ['to'],
    optional: ['label', 'aliases', 'known_when', 'condition', 'blocked_narration', 'transitions'],
  },
  Transition: { required: ['narration'], optional: ['condition', 'replay'] },
  Phase: {
    required: ['id'],
    optional: [
      'title', 'condition', 'kind', 'background', 'look', 'look_variants', 'tone', 'characters',
      'narration', 'actions', 'dialogue', 'no_match_narration', 'on_enter_flags_set', 'ending',
    ],
  },
  PhaseCharacter: { required: ['id'], optional: ['visual_prompt', 'visual_prompt_en', 'image', 'voice'] },
  Ending: { required: ['kind'], optional: ['label'] },
  Action: {
    required: ['id', 'verb', 'effect'],
    optional: ['target', 'second_target', 'test_phrases', 'condition', 'blocked_narration', 'repeatable'],
  },
  DialogueTree: { required: ['start', 'nodes'] },
  DialogueNode: {
    required: ['speaker', 'text'],
    optional: ['text_variants', 'voice_override', 'effect', 'choices', 'next', 'end'],
  },
  DialogueChoice: { required: ['text', 'goto'], optional: ['condition', 'effect'] },
};

const VERBS = new Set(['look', 'use', 'talk']);
const INTENTS = new Set(['perception', 'manipulation', 'communication', 'movement', 'generic']);

class Checker {
  problems: string[] = [];

  private fail(where: string, msg: string): void {
    this.problems.push(`${where}: ${msg}`);
  }

  /** Verifica che l'oggetto abbia solo i campi previsti e tutti quelli
   * obbligatori. Restituisce false se non è nemmeno un oggetto. */
  shape(where: string, value: unknown, type: string): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(where, `atteso un oggetto ${type}`);
      return false;
    }
    const spec = SHAPES[type];
    const allowed = new Set([...(spec.required ?? []), ...(spec.optional ?? [])]);
    for (const k of Object.keys(value)) {
      if (!allowed.has(k)) this.fail(`${where}.${k}`, `campo non previsto in ${type}`);
    }
    for (const k of spec.required ?? []) {
      if ((value as Record<string, unknown>)[k] === undefined) {
        this.fail(where, `manca il campo obbligatorio "${k}"`);
      }
    }
    return true;
  }

  array(where: string, value: unknown, type: string, each: (w: string, v: unknown) => void): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      this.fail(where, `atteso un elenco di ${type}`);
      return;
    }
    value.forEach((v, i) => each(`${where}[${i}]`, v));
  }

  simple(where: string, value: unknown, type: string): void {
    if (value === undefined) return;
    if (!this.shape(where, value, type)) return;
    // Una condizione può contenerne altre: il controllo dei campi previsti
    // deve scendere, o un campo inventato dentro un `all_of` passerebbe.
    if (type === 'Condition') {
      const c = value as { all_of?: unknown; any_of?: unknown };
      this.array(`${where}.all_of`, c.all_of, 'Condition', (w, v) => this.simple(w, v, 'Condition'));
      this.array(`${where}.any_of`, c.any_of, 'Condition', (w, v) => this.simple(w, v, 'Condition'));
    }
  }
}

/** Legge una storia da un oggetto già decodificato da JSON. */
export function loadStory(raw: unknown): StoryIndex {
  const c = new Checker();

  if (!c.shape('story', raw, 'Story')) throw new LoadError(c.problems);
  const s = raw as unknown as Story;

  c.simple('story.generated_by', s.generated_by, 'Provenance');
  c.simple('story.global_style', s.global_style, 'GlobalStyle');
  if (s.global_style?.narrator_voice) c.simple('story.global_style.narrator_voice', s.global_style.narrator_voice, 'VoiceSpec');
  c.simple('story.cover', s.cover, 'Background');
  if (s.player_voice) {
    c.simple('story.player_voice', s.player_voice, 'PlayerVoice');
    c.array('story.player_voice.no_match_narration', s.player_voice.no_match_narration, 'NoMatch', (w, v) => {
      if (c.shape(w, v, 'NoMatch') && !INTENTS.has(String((v as Record<string, unknown>).intent))) {
        c.problems.push(`${w}.intent: intenzione sconosciuta "${(v as Record<string, unknown>).intent}"`);
      }
    });
  }
  c.array('story.characters', s.characters, 'Character', (w, v) => {
    if (!c.shape(w, v, 'Character')) return;
    const ch = v as Record<string, unknown>;
    if (ch.voice) c.simple(`${w}.voice`, ch.voice, 'VoiceSpec');
    c.array(`${w}.description_variants`, ch.description_variants, 'ConditionalText', (w2, v2) => c.shape(w2, v2, 'ConditionalText'));
  });
  c.array('story.items', s.items, 'Item', (w, v) => {
    if (!c.shape(w, v, 'Item')) return;
    c.array(`${w}.description_variants`, (v as Record<string, unknown>).description_variants, 'ConditionalText', (w2, v2) =>
      c.shape(w2, v2, 'ConditionalText'),
    );
  });
  c.array('story.carry_flags', s.carry_flags, 'CarryFlag', (w, v) => c.shape(w, v, 'CarryFlag'));
  if ((s.carry_flags?.length ?? 0) > 3) {
    c.problems.push('story.carry_flags: al massimo tre, e sono già troppi se sono tre');
  }

  c.array('story.acts', s.acts, 'Act', (wa, va) => {
    if (!c.shape(wa, va, 'Act')) return;
    const act = va as unknown as import('./types.js').Act;
    c.array(`${wa}.places`, act.places, 'Place', (wp, vp) => {
      if (!c.shape(wp, vp, 'Place')) return;
      const pl = vp as unknown as import('./types.js').Place;
      c.simple(`${wp}.completed_when`, pl.completed_when, 'Condition');
      c.array(`${wp}.objects`, pl.objects, 'Prop', (wo, vo) => {
        if (!c.shape(wo, vo, 'Prop')) return;
        const pr = vo as unknown as import('./types.js').Prop;
        c.simple(`${wo}.present_when`, pr.present_when, 'Condition');
        c.array(`${wo}.description_variants`, pr.description_variants, 'ConditionalText', (w2, v2) =>
          c.shape(w2, v2, 'ConditionalText'),
        );
      });
      c.array(`${wp}.exits`, pl.exits, 'Exit', (we, ve) => {
        if (!c.shape(we, ve, 'Exit')) return;
        const ex = ve as unknown as import('./types.js').Exit;
        c.simple(`${we}.known_when`, ex.known_when, 'Condition');
        c.simple(`${we}.condition`, ex.condition, 'Condition');
        c.array(`${we}.transitions`, ex.transitions, 'Transition', (wt, vt) => {
          if (!c.shape(wt, vt, 'Transition')) return;
          const tr = vt as unknown as import('./types.js').Transition;
          c.simple(`${wt}.condition`, tr.condition, 'Condition');
          c.array(`${wt}.narration`, tr.narration, 'NarrationBeat', (wb, vb) => c.shape(wb, vb, 'NarrationBeat'));
        });
      });
      c.array(`${wp}.actions`, pl.actions, 'Action', (wa2, va2) => checkAction(c, wa2, va2));
      c.array(`${wp}.phases`, pl.phases, 'Phase', (wf, vf) => checkPhase(c, wf, vf));
    });
  });

  if (c.problems.length) throw new LoadError(c.problems);

  const idx = buildIndex(s);
  const structural = checkReferences(idx);
  if (structural.length) throw new LoadError(structural);
  return idx;
}

function checkAction(c: Checker, where: string, value: unknown): void {
  if (!c.shape(where, value, 'Action')) return;
  const a = value as unknown as import('./types.js').Action;
  if (!VERBS.has(a.verb)) c.problems.push(`${where}.verb: "${a.verb}" non è look, use o talk`);
  if (a.verb === 'use' && !a.target) {
    // «usa» non può stare senza complemento: è una regola di gioco, non di
    // schema, e qui è dove si vede.
    c.problems.push(`${where}: un'azione "use" senza target non è raggiungibile a parole`);
  }
  c.simple(`${where}.condition`, a.condition, 'Condition');
  c.simple(`${where}.effect`, a.effect, 'Effect');
}

function checkPhase(c: Checker, where: string, value: unknown): void {
  if (!c.shape(where, value, 'Phase')) return;
  const ph = value as unknown as import('./types.js').Phase;

  if (ph.kind && ph.kind !== 'interactive' && ph.kind !== 'cutscene') {
    c.problems.push(`${where}.kind: "${ph.kind}" non è né interactive né cutscene`);
  }
  c.simple(`${where}.condition`, ph.condition, 'Condition');
  c.simple(`${where}.background`, ph.background, 'Background');
  c.simple(`${where}.ending`, ph.ending, 'Ending');
  if (ph.ending && ph.ending.kind !== 'natural' && ph.ending.kind !== 'premature') {
    c.problems.push(`${where}.ending.kind: "${ph.ending.kind}" sconosciuto`);
  }
  c.array(`${where}.look_variants`, ph.look_variants, 'ConditionalText', (w, v) => c.shape(w, v, 'ConditionalText'));
  c.array(`${where}.characters`, ph.characters, 'PhaseCharacter', (w, v) => c.shape(w, v, 'PhaseCharacter'));
  c.array(`${where}.narration`, ph.narration, 'NarrationBeat', (w, v) => c.shape(w, v, 'NarrationBeat'));
  c.array(`${where}.no_match_narration`, ph.no_match_narration, 'NoMatch', (w, v) => {
    if (c.shape(w, v, 'NoMatch') && !INTENTS.has(String((v as Record<string, unknown>).intent))) {
      c.problems.push(`${w}.intent: intenzione sconosciuta`);
    }
  });
  c.array(`${where}.actions`, ph.actions, 'Action', (w, v) => checkAction(c, w, v));

  if (ph.dialogue) {
    if (c.shape(`${where}.dialogue`, ph.dialogue, 'DialogueTree')) {
      const nodes = ph.dialogue.nodes ?? {};
      for (const [id, n] of Object.entries(nodes)) {
        const w = `${where}.dialogue.nodes.${id}`;
        if (!c.shape(w, n, 'DialogueNode')) continue;
        c.simple(`${w}.effect`, n.effect, 'Effect');
        c.array(`${w}.choices`, n.choices, 'DialogueChoice', (wc, vc) => {
          if (!c.shape(wc, vc, 'DialogueChoice')) return;
          const ch = vc as unknown as import('./types.js').DialogueChoice;
          c.simple(`${wc}.condition`, ch.condition, 'Condition');
          c.simple(`${wc}.effect`, ch.effect, 'Effect');
        });
      }
    }
  }
}

/**
 * I riferimenti che devono esistere perché la storia sia caricabile.
 *
 * Non è il linter: qui si controlla solo ciò senza cui il player non può
 * nemmeno partire. Le porte chiuse a chiave le trova `--lint`.
 */
function checkReferences(idx: StoryIndex): string[] {
  const bad: string[] = [];
  const s = idx.story;

  if (!idx.acts.has(s.start_act)) bad.push(`start_act: l'atto "${s.start_act}" non esiste`);
  for (const act of s.acts) {
    if (!act.places.some((p) => p.id === act.start_place)) {
      bad.push(`acts.${act.id}.start_place: "${act.start_place}" non è un luogo di questo atto`);
    }
    for (const pl of act.places) {
      if (pl.phases.length === 0) bad.push(`places.${pl.id}: nessuna fase`);
      for (const ex of pl.exits ?? []) {
        if (!idx.places.has(ex.to)) bad.push(`places.${pl.id}: uscita verso "${ex.to}", che non esiste`);
      }
    }
  }
  const seen = new Set<string>();
  for (const id of idx.places.keys()) {
    if (seen.has(id)) bad.push(`places: id duplicato "${id}"`);
    seen.add(id);
  }
  return bad;
}

/** Legge una storia da testo JSON. */
export function parseStory(text: string): StoryIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new LoadError([`JSON non valido: ${(e as Error).message}`]);
  }
  return loadStory(raw);
}
