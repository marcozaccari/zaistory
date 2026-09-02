/**
 * Lettura di uno `story.ir.json`.
 *
 * La lettura e' volutamente severa: qualunque campo non previsto dallo schema
 * fa fallire il caricamento. E' la stessa rete di sicurezza di
 * `additionalProperties: false` lato JSON Schema, e serve allo stesso scopo —
 * un campo plausibile ma inventato dal compilatore va scartato, non accettato
 * in silenzio. Conseguenza voluta: il player e' anche un test di conformita'
 * dell'IR.
 *
 * Questo non sostituisce `scripts/validate.py`: li' c'e' lo schema vero
 * (pattern degli id compresi), qui c'e' il minimo che serve al player per
 * fidarsi di quello che ha in mano.
 */

import type { Story, Scene } from './types.js';
import { findScene } from './types.js';

export class IRError extends Error {}

// ------------------------------------------------------------------ schema
//
// Descrizione dichiarativa degli oggetti dell'IR: per ciascuno, i campi
// ammessi e quelli obbligatori. E' la trascrizione di engine-ir.schema.json e
// va tenuta allineata a quello — e' il posto dove `additionalProperties: false`
// diventa codice.

type FieldType =
  | 'string'
  | 'boolean'
  | 'string[]'
  | { obj: SpecName }
  | { arr: SpecName }
  | { map: SpecName }
  | { enum: readonly string[] };

type SpecName =
  | 'Story'
  | 'Provenance'
  | 'GlobalStyle'
  | 'VoiceSpec'
  | 'Character'
  | 'Place'
  | 'Item'
  | 'NoMatch'
  | 'ConditionalText'
  | 'PlayerVoice'
  | 'Condition'
  | 'Effect'
  | 'DialogueChoice'
  | 'DialogueNode'
  | 'DialogueTree'
  | 'Action'
  | 'SceneCharacter'
  | 'NarrationBeat'
  | 'Background'
  | 'Scene';

interface Spec {
  required: readonly string[];
  fields: Readonly<Record<string, FieldType>>;
}

const SPECS: Readonly<Record<SpecName, Spec>> = {
  Story: {
    required: ['ir_version', 'id', 'title', 'start_scene', 'scenes'],
    fields: {
      ir_version: 'string',
      generated_by: { obj: 'Provenance' },
      id: 'string',
      title: 'string',
      description: 'string',
      cover: { obj: 'Background' },
      language: 'string',
      global_style: { obj: 'GlobalStyle' },
      player_voice: { obj: 'PlayerVoice' },
      characters: { arr: 'Character' },
      places: { arr: 'Place' },
      protagonist: 'string',
      start_scene: 'string',
      state_flags_schema: 'string[]',
      items: { arr: 'Item' },
      initial_inventory: 'string[]',
      scenes: { arr: 'Scene' },
    },
  },
  Provenance: {
    required: ['compiler', 'compiler_version'],
    fields: { compiler: 'string', compiler_version: 'string', model: 'string' },
  },
  GlobalStyle: {
    required: [],
    fields: {
      image_style_suffix: 'string',
      image_style_suffix_en: 'string',
      anchor_framing: { enum: ['bust', 'waist-up', 'full-body'] },
      narrator_voice: { obj: 'VoiceSpec' },
      default_tone: 'string',
      ambient_music_tags: 'string[]',
    },
  },
  VoiceSpec: {
    required: [],
    fields: { style_prompt: 'string' },
  },
  Character: {
    required: ['id'],
    fields: {
      id: 'string',
      name: 'string',
      aliases: 'string[]',
      visual_prompt: 'string',
      visual_prompt_en: 'string',
      anchor_framing: { enum: ['bust', 'waist-up', 'full-body'] },
      image: 'string',
      voice: { obj: 'VoiceSpec' },
    },
  },
  Place: {
    required: ['id'],
    fields: {
      id: 'string',
      name: 'string',
      visual_prompt: 'string',
      visual_prompt_en: 'string',
      image: 'string',
    },
  },
  Item: {
    required: ['id', 'name'],
    fields: {
      id: 'string',
      name: 'string',
      aliases: 'string[]',
      description: 'string',
      description_variants: { arr: 'ConditionalText' },
      visual_prompt: 'string',
      visual_prompt_en: 'string',
      image: 'string',
    },
  },
  NoMatch: {
    required: ['intent', 'text'],
    fields: {
      intent: { enum: ['percezione', 'manipolazione', 'movimento', 'sociale', 'forza', 'generico'] },
      text: 'string',
    },
  },
  ConditionalText: {
    required: ['condition', 'text'],
    fields: { condition: { obj: 'Condition' }, text: 'string' },
  },
  PlayerVoice: {
    required: [],
    fields: {
      inventory_intro: 'string[]',
      inventory_empty: 'string[]',
      presence_intro: 'string[]',
      presence_alone: 'string[]',
      no_match_narration: { arr: 'NoMatch' },
    },
  },
  Condition: {
    required: [],
    fields: { flag_present: 'string', flag_absent: 'string', has_item: 'string' },
  },
  Effect: {
    required: [],
    fields: {
      narration: 'string',
      narration_voice: { obj: 'VoiceSpec' },
      set_flag: 'string',
      unset_flag: 'string',
      add_inventory: 'string',
      remove_inventory: 'string',
      play_sound_prompt: 'string',
      goto_dialogue: 'string',
      goto_scene: 'string',
    },
  },
  DialogueChoice: {
    required: ['text', 'goto'],
    fields: {
      text: 'string',
      goto: 'string',
      condition: { obj: 'Condition' },
      effect: { obj: 'Effect' },
    },
  },
  DialogueNode: {
    required: ['speaker', 'text'],
    fields: {
      speaker: 'string',
      text: 'string',
      voice_override: { obj: 'VoiceSpec' },
      effect: { obj: 'Effect' },
      choices: { arr: 'DialogueChoice' },
      next: 'string',
      end: 'boolean',
    },
  },
  DialogueTree: {
    required: ['start', 'nodes'],
    fields: { start: 'string', nodes: { map: 'DialogueNode' } },
  },
  // Nota: `label` ed `effect` sono obbligatori nello schema ma qui non lo
  // sono. Non e' una svista: se mancano, il linter lo dice con la posizione
  // esatta e un messaggio utile ("selezionarla non farebbe nulla"), mentre un
  // errore di caricamento fermerebbe tutto senza spiegare dove. Il vincolo che
  // il caricamento fa rispettare davvero e' l'altro, quello architetturale:
  // nessun campo fuori dallo schema.
  Action: {
    required: ['id'],
    fields: {
      id: 'string',
      label: 'string',
      target: 'string',
      aliases: 'string[]',
      test_phrases: 'string[]',
      condition: { obj: 'Condition' },
      blocked_narration: 'string',
      effect: { obj: 'Effect' },
      repeatable: 'boolean',
    },
  },
  SceneCharacter: {
    required: ['id'],
    fields: {
      id: 'string',
      visual_prompt: 'string',
      visual_prompt_en: 'string',
      image: 'string',
      voice: { obj: 'VoiceSpec' },
    },
  },
  NarrationBeat: {
    required: ['text'],
    fields: {
      text: 'string',
      voice: { obj: 'VoiceSpec' },
      image_prompt: 'string',
      image_prompt_en: 'string',
      image: 'string',
      place: 'string',
      characters_in_frame: 'string[]',
      sound_effect_prompt: 'string',
    },
  },
  Background: {
    required: ['image_prompt'],
    fields: {
      image_prompt: 'string',
      image_prompt_en: 'string',
      image: 'string',
      ambient_sound_prompt: 'string',
      place: 'string',
      characters_in_frame: 'string[]',
    },
  },
  // Stessa scelta di Action per `background` e `actions`: mancanti sono
  // segnalazioni del linter, non errori di caricamento.
  Scene: {
    required: ['id'],
    fields: {
      id: 'string',
      title: 'string',
      background: { obj: 'Background' },
      look: 'string',
      look_variants: { arr: 'ConditionalText' },
      no_match_narration: { arr: 'NoMatch' },
      scene_tone: 'string',
      scene_type: { enum: ['interactive', 'cutscene'] },
      characters: { arr: 'SceneCharacter' },
      narration: { arr: 'NarrationBeat' },
      dialogue_tree: { obj: 'DialogueTree' },
      actions: { arr: 'Action' },
      on_enter_flags_set: 'string[]',
    },
  },
};

// --------------------------------------------------------------- validatore

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkField(value: unknown, type: FieldType, path: string): void {
  if (typeof type === 'string') {
    switch (type) {
      case 'string':
        if (typeof value !== 'string') throw new IRError(`${path}: atteso un testo`);
        return;
      case 'boolean':
        if (typeof value !== 'boolean') throw new IRError(`${path}: atteso true/false`);
        return;
      case 'string[]':
        if (!Array.isArray(value)) throw new IRError(`${path}: attesa una lista di testi`);
        value.forEach((v, i) => {
          if (typeof v !== 'string') throw new IRError(`${path}[${i}]: atteso un testo`);
        });
        return;
    }
  }
  if ('enum' in type) {
    if (typeof value !== 'string' || !type.enum.includes(value)) {
      throw new IRError(`${path}: valore ${JSON.stringify(value)} non ammesso (${type.enum.join(', ')})`);
    }
    return;
  }
  if ('obj' in type) {
    checkObject(value, type.obj, path);
    return;
  }
  if ('arr' in type) {
    if (!Array.isArray(value)) throw new IRError(`${path}: attesa una lista`);
    value.forEach((v, i) => checkObject(v, type.arr, `${path}[${i}]`));
    return;
  }
  // map
  if (!isPlainObject(value)) throw new IRError(`${path}: atteso un oggetto id -> valore`);
  for (const [k, v] of Object.entries(value)) checkObject(v, type.map, `${path}.${k}`);
}

function checkObject(value: unknown, specName: SpecName, path: string): void {
  const spec = SPECS[specName] as Spec;
  if (!isPlainObject(value)) throw new IRError(`${path}: atteso un oggetto ${specName}`);

  // Una entry di scenes puo' essere un riferimento a file esterno. Lo schema lo
  // prevede, il player non lo supporta: meglio un errore chiaro che una scena
  // vuota e misteriosa.
  if (specName === 'Scene' && 'ref' in value) {
    throw new IRError(
      `${path}: le scene su file esterno ("ref": ${JSON.stringify(value.ref)}) non sono supportate; ` +
        `oggi si lavora con IR a scene inline`,
    );
  }

  for (const key of Object.keys(value)) {
    if (!(key in spec.fields)) {
      const ammessi = Object.keys(spec.fields).join(', ');
      throw new IRError(`${path}: campo non previsto dallo schema ${JSON.stringify(key)} (ammessi: ${ammessi})`);
    }
  }
  for (const key of spec.required) {
    if (value[key] === undefined) throw new IRError(`${path}: manca il campo obbligatorio ${JSON.stringify(key)}`);
  }
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    checkField(raw, spec.fields[key], `${path}.${key}`);
  }
}

// ------------------------------------------------------------------ lettura

/** Legge un IR da testo JSON. Lancia IRError con un messaggio leggibile. */
export function parseStory(raw: string): Story {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new IRError(`JSON non valido: ${(err as Error).message}`);
  }
  return validateStory(data);
}

/** Valida un oggetto gia' deserializzato e lo restituisce tipato. */
export function validateStory(data: unknown): Story {
  checkObject(data, 'Story', 'story');
  const story = data as Story;
  check(story);
  return story;
}

/**
 * Vincoli strutturali minimi senza i quali il player non puo' nemmeno partire.
 * Non e' il linter di giocabilita': quello sta in un modulo separato e va molto
 * piu' a fondo.
 */
function check(s: Story): void {
  if (s.scenes.length === 0) throw new IRError('la storia non ha scene');

  const seen = new Set<string>();
  s.scenes.forEach((sc: Scene, i: number) => {
    if (!sc.id) throw new IRError(`scenes[${i}]: manca id`);
    // Una scena senza `actions` e' un finale o un vicolo cieco: distinguerli e'
    // compito del linter, qui basta che la lista esista.
    if (sc.actions === undefined) sc.actions = [];
    if (seen.has(sc.id)) throw new IRError(`id di scena duplicato: ${JSON.stringify(sc.id)}`);
    seen.add(sc.id);
    if (sc.dialogue_tree && Object.keys(sc.dialogue_tree.nodes).length === 0) {
      throw new IRError(`scenes[${i}] (${sc.id}): dialogue_tree senza nodi`);
    }
  });

  if (!findScene(s, s.start_scene)) {
    throw new IRError(`start_scene ${JSON.stringify(s.start_scene)} non corrisponde a nessuna scena`);
  }
}
