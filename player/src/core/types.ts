/**
 * I tipi del formato zaistory, più i piccoli aiuti di lettura che tutti usano.
 *
 * Sono il riflesso in TypeScript di `zaistory.schema.json`: quando lo schema
 * cambia, cambia anche questo file — e insieme a loro `load.ts`, dove
 * `additionalProperties: false` diventa codice eseguibile. Un campo aggiunto
 * qui e non là non verrà mai letto; uno aggiunto là e non qui non compila.
 */

// ------------------------------------------------------------------ base

export type ImageRef = string;

export interface Provenance {
  compiler: string;
  compiler_version: string;
  model?: string;
}

export interface VoiceSpec {
  style_prompt?: string;
}

export interface GlobalStyle {
  image_style_suffix?: string;
  image_style_suffix_en?: string;
  anchor_framing?: string;
  narrator_voice?: VoiceSpec;
  default_tone?: string;
  ambient_music_tags?: string[];
}

export interface Condition {
  flag_present?: string;
  flag_absent?: string;
  has_item?: string;
  /** Tutte. Serve dove i campi semplici non bastano — due oggetti sulla stessa
   * porta è il caso tipico. */
  all_of?: Condition[];
  /** Almeno una. Il caso per cui esiste è l'oggetto in una qualunque delle sue
   * forme: siccome un oggetto che cambia stato è un altro oggetto, una porta
   * che va bene con il walkie scarico come con quello carico li elenca
   * entrambi. */
  any_of?: Condition[];
}

export interface ConditionalText {
  condition: Condition;
  text: string;
}

export interface Effect {
  narration?: string;
  narration_voice?: VoiceSpec;
  set_flag?: string;
  unset_flag?: string;
  add_inventory?: string;
  remove_inventory?: string;
  play_sound_prompt?: string;
  goto_dialogue?: string;
  goto_place?: string;
}

// -------------------------------------------------------------- entità

/** Le quattro famiglie di gesto più il generico. Sono vocabolario italiano,
 * non narrativa: valgono identiche per ogni storia. */
export type Intent = 'perception' | 'manipulation' | 'communication' | 'movement' | 'generic';

/** I verbi del giocatore sono quattro; questi sono i tre che agiscono DENTRO il
 * luogo. Il quarto — andare — non manca: si scrive altrove, in un'`Exit`, come
 * `guarda` da solo si scrive nel `look` della fase. Cambia il nodo invece del
 * suo contenuto, ed è per questo che il grafo si legge in un posto solo. */
export type Verb = 'look' | 'use' | 'talk';

export interface Character {
  id: string;
  name?: string;
  aliases?: string[];
  description?: string;
  description_variants?: ConditionalText[];
  visual_prompt?: string;
  visual_prompt_en?: string;
  anchor_framing?: string;
  image?: ImageRef;
  voice?: VoiceSpec;
}

export interface Item {
  id: string;
  name: string;
  aliases?: string[];
  description?: string;
  description_variants?: ConditionalText[];
  visual_prompt?: string;
  visual_prompt_en?: string;
  image?: ImageRef;
}

/** Un oggetto d'ambiente: sta nel luogo, non nello zaino. */
export interface Prop {
  id: string;
  name: string;
  aliases?: string[];
  description?: string;
  description_variants?: ConditionalText[];
  present_when?: Condition;
  visual_prompt?: string;
  visual_prompt_en?: string;
  image?: ImageRef;
}

export interface CarryFlag {
  id: string;
  description?: string;
}

export interface NoMatch {
  intent: Intent;
  text: string;
}

export interface PlayerVoice {
  inventory_intro?: string[];
  inventory_empty?: string[];
  presence_intro?: string[];
  presence_alone?: string[];
  exits_intro?: string[];
  exits_none?: string[];
  no_match_narration?: NoMatch[];
}

export interface Background {
  image_prompt: string;
  image_prompt_en?: string;
  image?: ImageRef;
  ambient_sound_prompt?: string;
  place?: string;
  characters_in_frame?: string[];
}

export interface NarrationBeat {
  text: string;
  voice?: VoiceSpec;
  image_prompt?: string;
  image_prompt_en?: string;
  image?: ImageRef;
  sound_effect_prompt?: string;
  characters_in_frame?: string[];
}

// ------------------------------------------------------------- struttura

export interface Action {
  id: string;
  verb: Verb;
  target?: string;
  second_target?: string;
  test_phrases?: string[];
  condition?: Condition;
  blocked_narration?: string;
  effect: Effect;
  repeatable?: boolean;
}

export interface DialogueChoice {
  text: string;
  goto: string;
  condition?: Condition;
  effect?: Effect;
}

export interface DialogueNode {
  speaker: string;
  text: string;
  text_variants?: string[];
  voice_override?: VoiceSpec;
  effect?: Effect;
  choices?: DialogueChoice[];
  next?: string;
  end?: boolean;
}

export interface DialogueTree {
  start: string;
  nodes: Record<string, DialogueNode>;
}

export interface PhaseCharacter {
  id: string;
  visual_prompt?: string;
  visual_prompt_en?: string;
  image?: ImageRef;
  voice?: VoiceSpec;
}

export interface Ending {
  kind: 'natural' | 'premature';
  label?: string;
}

export interface Phase {
  id: string;
  title?: string;
  condition?: Condition;
  kind?: 'interactive' | 'cutscene';
  background?: Background;
  look?: string;
  look_variants?: ConditionalText[];
  tone?: string;
  characters?: PhaseCharacter[];
  narration?: NarrationBeat[];
  actions?: Action[];
  dialogue?: DialogueTree;
  no_match_narration?: NoMatch[];
  on_enter_flags_set?: string[];
  ending?: Ending;
}

export interface Transition {
  condition?: Condition;
  narration: NarrationBeat[];
  replay?: boolean;
}

export interface Exit {
  to: string;
  label?: string;
  aliases?: string[];
  known_when?: Condition;
  condition?: Condition;
  blocked_narration?: string;
  transitions?: Transition[];
}

export interface Place {
  id: string;
  name: string;
  aliases?: string[];
  /** id di un luogo, in un altro atto, che è fisicamente lo stesso posto. I
   * luoghi vivono dentro gli atti, le stanze no: due nodi di due grafi diversi
   * possono essere la stessa stanza, e questo campo tiene separata l'identità
   * di gioco — per atto — dall'identità visiva, che è del posto. */
  same_as?: string;
  visual_prompt?: string;
  visual_prompt_en?: string;
  image?: ImageRef;
  completed_when?: Condition;
  exits?: Exit[];
  objects?: Prop[];
  /** Le azioni valide in qualunque fase di questo luogo: si sommano a quelle
   * della fase. Stessa scelta già fatta per gli oggetti d'ambiente, e per la
   * stessa ragione — le fasi cambiano cosa si può fare, non cosa esiste. */
  actions?: Action[];
  phases: Phase[];
}

export interface Act {
  id: string;
  title?: string;
  start_place: string;
  flags?: string[];
  reads_carry_flags?: string[];
  writes_carry_flags?: string[];
  places: Place[];
}

export interface Story {
  zaistory_version: string;
  generated_by?: Provenance;
  id: string;
  title: string;
  description?: string;
  language?: string;
  cover?: Background;
  failure_mode?: 'none' | 'alternate_endings';
  global_style?: GlobalStyle;
  player_voice?: PlayerVoice;
  protagonist?: string;
  characters?: Character[];
  items?: Item[];
  initial_inventory?: string[];
  carry_flags?: CarryFlag[];
  start_act: string;
  acts: Act[];
}

// ------------------------------------------------------------- indice

/**
 * Un indice piatto della storia, costruito una volta al caricamento.
 *
 * La gerarchia è comoda da scrivere e scomoda da attraversare: quasi ogni
 * domanda del player («dov'è il luogo X», «di quale atto fa parte») sarebbe
 * altrimenti una scansione annidata. Gli id dei luoghi sono unici su tutta la
 * storia, ed è il linter a garantirlo.
 */
export interface StoryIndex {
  story: Story;
  acts: Map<string, Act>;
  places: Map<string, Place>;
  /** id del luogo -> id dell'atto che lo contiene. */
  actOfPlace: Map<string, string>;
  characters: Map<string, Character>;
  items: Map<string, Item>;
  /** Tutti i prop di tutti i luoghi, per id. */
  props: Map<string, Prop>;
  /** id del prop -> id del luogo in cui sta. */
  placeOfProp: Map<string, string>;
}

export function buildIndex(story: Story): StoryIndex {
  const idx: StoryIndex = {
    story,
    acts: new Map(),
    places: new Map(),
    actOfPlace: new Map(),
    characters: new Map(),
    items: new Map(),
    props: new Map(),
    placeOfProp: new Map(),
  };
  for (const c of story.characters ?? []) idx.characters.set(c.id, c);
  for (const i of story.items ?? []) idx.items.set(i.id, i);
  for (const act of story.acts) {
    idx.acts.set(act.id, act);
    for (const place of act.places) {
      idx.places.set(place.id, place);
      idx.actOfPlace.set(place.id, act.id);
      for (const prop of place.objects ?? []) {
        idx.props.set(prop.id, prop);
        idx.placeOfProp.set(prop.id, place.id);
      }
    }
  }
  return idx;
}

// --------------------------------------------------------------- aiuti

/** Il nome da mostrare a chi gioca. Mai un id: un id buttato in faccia al
 * giocatore non è una risposta. */
export function displayName(e: { id: string; name?: string } | undefined): string {
  if (!e) return '';
  return e.name && e.name.trim() ? e.name : e.id;
}

/** Le superfici lessicali di un'entità: il nome più gli alias. È su queste che
 * il parser aggancia il complemento della frase. */
export function surfaces(e: { name?: string; aliases?: string[] } | undefined): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (e.name) out.push(e.name);
  for (const a of e.aliases ?? []) out.push(a);
  return out;
}

/** Il primo testo condizionale valido, o quello di base. L'ordine conta: vince
 * il primo che matcha, quindi le varianti specifiche stanno prima. */
export function textNow(
  base: string | undefined,
  variants: ConditionalText[] | undefined,
  meets: (c?: Condition) => boolean,
): string | undefined {
  for (const v of variants ?? []) {
    if (meets(v.condition)) return v.text;
  }
  return base;
}

/** Sceglie a rotazione fra più frasi d'autore. Il giocatore non distingue
 * questo da un modello: distingue solo quando il ciclo è corto. */
export function pick(list: string[] | undefined, turn: number): string | undefined {
  if (!list || list.length === 0) return undefined;
  return list[turn % list.length];
}
