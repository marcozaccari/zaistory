/**
 * Tipi che rispecchiano `engine-ir.schema.json`.
 *
 * Regola di questo modulo: e' un rispecchiamento fedele dello schema, niente di
 * piu'. Nessun campo di comodo, nessuna informazione derivata, nessun default
 * "furbo" applicato in fase di lettura. L'IR e' il contratto del progetto: se
 * un dato non c'e' qui, non deve esistere nemmeno nel player.
 *
 * I nomi dei campi restano quelli dell'IR (snake_case): il player non traduce
 * il contratto in un dialetto suo.
 */

/** Descrizione puramente testuale di una voce. Provider-agnostica per scelta
 * architetturale: qui non c'e' e non deve arrivare nessun voice_id. */
export interface VoiceSpec {
  style_prompt?: string;
}

export interface GlobalStyle {
  image_style_suffix?: string;
  narrator_voice?: VoiceSpec;
  default_tone?: string;
  ambient_music_tags?: string[];
}

export interface Character {
  id: string;
  name?: string;
  visual_prompt?: string;
  voice?: VoiceSpec;
}

/** Condizione di visibilita' di un'azione o di una scelta.
 * I campi presenti si sommano in AND. */
export interface Condition {
  flag_present?: string;
  flag_absent?: string;
  has_item?: string;
}

/** L'unico modo in cui lo stato di gioco puo' cambiare. Nessun player e nessun
 * resolver puo' fabbricarne uno: puo' solo applicare quelli gia' nell'IR. */
export interface Effect {
  narration?: string;
  narration_voice?: VoiceSpec;
  set_flag?: string;
  unset_flag?: string;
  add_inventory?: string;
  remove_inventory?: string;
  play_sound_prompt?: string;
  goto_dialogue?: string;
  goto_scene?: string;
}

/** Scelta offerta al giocatore dentro un dialogo.
 * Nota: lo schema non prevede un id per le scelte; il player le identifica con
 * il nodo di destinazione (campo `goto`), che e' stabile. */
export interface DialogueChoice {
  text: string;
  goto: string;
  condition?: Condition;
  effect?: Effect;
}

export interface DialogueNode {
  speaker: string;
  text: string;
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

export interface Action {
  id: string;
  label: string;
  target?: string;
  aliases?: string[];
  condition?: Condition;
  effect?: Effect;
  repeatable?: boolean;
}

export interface SceneCharacter {
  id: string;
  visual_prompt?: string;
  voice?: VoiceSpec;
}

/** Beat della narrazione di ingresso scena. Per le cutscene la lista di beat
 * e' l'intera sequenza di montaggio. */
export interface NarrationBeat {
  text: string;
  voice?: VoiceSpec;
  image_prompt?: string;
  sound_effect_prompt?: string;
}

export interface Background {
  image_prompt: string;
  ambient_sound_prompt?: string;
}

export const SCENE_INTERACTIVE = 'interactive';
export const SCENE_CUTSCENE = 'cutscene';
export type SceneType = typeof SCENE_INTERACTIVE | typeof SCENE_CUTSCENE;

export interface Scene {
  id: string;
  title?: string;
  background?: Background;
  scene_tone?: string;
  scene_type?: SceneType;
  characters?: SceneCharacter[];
  narration?: NarrationBeat[];
  dialogue_tree?: DialogueTree;
  actions: Action[];
  on_enter_flags_set?: string[];
}

export interface Story {
  ir_version: string;
  id: string;
  title: string;
  description?: string;
  language?: string;
  global_style?: GlobalStyle;
  characters?: Character[];
  start_scene: string;
  state_flags_schema?: string[];
  inventory_schema?: string[];
  scenes: Scene[];
}

// ------------------------------------------------------------------ helper
//
// Funzioni pure sui tipi dell'IR: applicano i default dello schema e le
// convenzioni di lettura, senza aggiungere niente al contratto.

/** Applica il default dello schema per `scene_type`. */
export function sceneType(sc: Scene): SceneType {
  return sc.scene_type ?? SCENE_INTERACTIVE;
}

/** Applica il default dello schema per `repeatable` (true se assente). */
export function isRepeatable(a: Action): boolean {
  return a.repeatable === undefined || a.repeatable;
}

/** Nome da mostrare per un personaggio, con fallback sull'id. */
export function displayName(c: Character): string {
  return c.name && c.name !== '' ? c.name : c.id;
}

export function findScene(story: Story, id: string): Scene | undefined {
  return story.scenes.find((s) => s.id === id);
}

/** Un id assente non e' un errore: per scelta architetturale i personaggi
 * occasionali (voci fuori campo, comparse) non stanno nella roster globale e
 * compaiono solo come stringa nel campo `speaker`. */
export function findCharacter(story: Story, id: string): Character | undefined {
  return story.characters?.find((c) => c.id === id);
}

/** Etichetta da mostrare per uno speaker di dialogo. */
export function speakerName(story: Story, speaker: string): string {
  if (speaker === 'narrator') return 'Narratore';
  const c = findCharacter(story, speaker);
  return c ? displayName(c) : speaker;
}

/** Tono da passare al resolver: quello locale se c'e', altrimenti il globale. */
export function toneOf(story: Story, sc?: Scene): string {
  if (sc?.scene_tone) return sc.scene_tone;
  return story.global_style?.default_tone ?? '';
}

export function findAction(sc: Scene, id: string): Action | undefined {
  return sc.actions.find((a) => a.id === id);
}

export function findNode(sc: Scene, id: string): DialogueNode | undefined {
  return sc.dialogue_tree?.nodes[id];
}

/** Id dei nodi di dialogo in ordine stabile (per il debug). */
export function nodeIds(sc: Scene): string[] {
  if (!sc.dialogue_tree) return [];
  return Object.keys(sc.dialogue_tree.nodes).sort();
}

/** Etichetta di scena da mostrare in debug. */
export function sceneLabel(sc: Scene): string {
  return sc.title ? `${sc.title} (${sc.id})` : sc.id;
}

/**
 * Dice se dalla scena esiste, staticamente, almeno una transizione verso
 * un'altra scena. Serve a distinguere un finale legittimo da un vicolo cieco:
 * e' la sola regola di flusso che il player aggiunge allo schema, che non ha
 * un marcatore esplicito di finale.
 */
export function sceneHasExit(sc: Scene): boolean {
  const has = (e?: Effect) => !!e?.goto_scene;
  if (sc.actions.some((a) => has(a.effect))) return true;
  if (sc.dialogue_tree) {
    for (const n of Object.values(sc.dialogue_tree.nodes)) {
      if (has(n.effect)) return true;
      if (n.choices?.some((c) => has(c.effect))) return true;
    }
  }
  return false;
}
