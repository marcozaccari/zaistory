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

/**
 * Chi ha prodotto questo IR.
 *
 * E' tracciabilita' e basta: serve a sapere, riaprendo un file mesi dopo, con
 * quale compilatore e con quale modello e' stato ottenuto — domanda tutt'altro
 * che oziosa, visto che il compilatore non e' deterministico fra sessioni.
 *
 * Non e' il binding a un generatore, che resta fuori dall'IR: nessun
 * consumatore deve cambiare comportamento leggendo questi campi. Il player,
 * infatti, li mostra e nient'altro.
 */
export interface Provenance {
  compiler: string;
  compiler_version: string;
  model?: string;
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
  /** Come il giocatore lo chiamera' scrivendo: "il ragazzo", "quello con la
   * barba". Entrare in un dialogo e' un'azione a input libero, anche se la
   * conversazione poi si gioca a scelte. */
  aliases?: string[];
  visual_prompt?: string;
  voice?: VoiceSpec;
}

/**
 * Un luogo con un'identita' stabile lungo la storia.
 *
 * `visual_prompt` descrive il POSTO, non una singola inquadratura: e' il
 * riferimento che tiene uguale la casa di Yacob nelle tre scene in cui si
 * torna. E' per i luoghi quello che `Character` e' per le persone.
 */
export interface Place {
  id: string;
  name?: string;
  visual_prompt: string;
}

/** Anagrafica di un oggetto di inventario. Esiste perche' il player definitivo
 * si comanda a parole: un id non e' una risposta a "cosa ho nello zaino", e
 * "usa il coltellino" ha bisogno di qualcosa a cui agganciarsi. */
export interface Item {
  id: string;
  name: string;
  aliases?: string[];
  /** La risposta a «guarda il coltello». E' un verbo del player, non
   * un'azione: non consuma un turno e non pesa sul budget della scena. */
  description?: string;
  description_variants?: ConditionalText[];
  visual_prompt?: string;
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
/** Una scelta di dialogo si tocca, non si scrive: il parlato resta a scelte
 * esplicite, e l'input libero non entra mai in un dialogue_tree. Per questo qui
 * non ci sono `aliases` — c'erano in 1.6.0 e sono stati tolti in 1.7.0. */
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
  /** I modi in cui il giocatore puo' chiedere questa azione scrivendo. Sono la
   * conoscenza semantica dell'azione, scritta in compilazione perche' il player
   * non debba dedurla a runtime: la lista *e'* la copertura del resolver
   * lessicale. */
  aliases?: string[];
  /** Parafrasi tenute deliberatamente fuori da `aliases`: non servono a
   * giocare, servono a misurare. Il linter le passa al resolver e conta quante
   * arrivano all'id giusto — e' cosi' che si sa se un backend piu' costoso vale
   * il suo prezzo su questa storia, invece che a naso. */
  test_phrases?: string[];
  condition?: Condition;
  /** Cosa si vede se il giocatore chiede l'azione ma la condition non e'
   * soddisfatta. Testo d'autore, nessun effetto: un'azione filtrata in un menu
   * spariva, a parole viene chiesta lo stesso e merita una risposta. */
  blocked_narration?: string;
  effect?: Effect;
  repeatable?: boolean;
}

/**
 * Le sei famiglie in cui ricade praticamente tutto quello che si scrive a
 * un'avventura. Sono indipendenti dalla storia — le stesse in ogni IR — ed e'
 * la ragione per cui un fallback puo' essere pertinente senza essere generato:
 * si classifica il *tipo* di tentativo, e si pesca il testo che l'autore ha
 * gia' scritto per quel tipo.
 */
export const INTENTS = ['percezione', 'manipolazione', 'movimento', 'sociale', 'forza', 'generico'] as const;
export type Intent = (typeof INTENTS)[number];

/** Una risposta d'autore a un tentativo che non corrisponde a nessuna azione,
 * agganciata al tipo di tentativo invece che al suo contenuto. */
export interface NoMatch {
  intent: Intent;
  text: string;
}

/**
 * Un testo d'autore che vale solo in un certo stato: prima variante
 * soddisfatta, prima servita, altrimenti vale il testo di base.
 *
 * Serve alle descrizioni rileggibili — la stanza, un oggetto in mano — che
 * sarebbero una bugia se non cambiassero mai: un walkie messo in carica e' un
 * altro oggetto da guardare rispetto a quello scarico.
 */
export interface ConditionalText {
  condition: Condition;
  text: string;
}

/**
 * La prosa dei verbi del player — guardarsi intorno, guardare nello zaino,
 * chiedere chi c'e'.
 *
 * Non sono azioni della scena: non stanno in `actions[]`, non consumano un
 * turno, non cambiano niente. Ma sono le tre cose che il giocatore fa piu'
 * spesso di tutte, e senza testo d'autore un player a input libero risponde
 * con un elenco di slug.
 */
export interface PlayerVoice {
  inventory_intro?: string[];
  inventory_empty?: string[];
  presence_intro?: string[];
  presence_alone?: string[];
  no_match_narration?: NoMatch[];
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
  place?: string;
  characters_in_frame?: string[];
  sound_effect_prompt?: string;
}

export interface Background {
  image_prompt: string;
  ambient_sound_prompt?: string;
  place?: string;
  characters_in_frame?: string[];
}

export const SCENE_INTERACTIVE = 'interactive';
export const SCENE_CUTSCENE = 'cutscene';
export type SceneType = typeof SCENE_INTERACTIVE | typeof SCENE_CUTSCENE;

export interface Scene {
  id: string;
  title?: string;
  /** La stanza com'e' adesso: la risposta a "guardati intorno" / "dove mi
   * trovo". Rileggibile, non fa avanzare niente, non e' un'azione. */
  look?: string;
  /** Varianti di `look` legate allo stato: una stanza dopo che ci si e' fatto
   * qualcosa non e' la stessa stanza. */
  look_variants?: ConditionalText[];
  /** Le risposte d'autore a una frase che non corrisponde a niente, una per
   * intenzione. Scritte in compilazione e non generate a runtime: un testo
   * generato inventa scenario che nel gioco non esiste, e nessun linter puo'
   * controllarlo. */
  no_match_narration?: NoMatch[];
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
  generated_by?: Provenance;
  id: string;
  title: string;
  description?: string;
  language?: string;
  global_style?: GlobalStyle;
  /** La prosa dei verbi del player, valida per tutta la storia. */
  player_voice?: PlayerVoice;
  characters?: Character[];
  places?: Place[];
  /** Chi il giocatore *e'*. Sta nella roster come gli altri, ma a «chi c'e'
   * qui» non va elencato: e' chi sta chiedendo. */
  protagonist?: string;
  start_scene: string;
  state_flags_schema?: string[];
  items?: Item[];
  /** Oggetti gia' in inventario quando la partita comincia, prima della
   * start_scene: quello che il personaggio si porta dietro da prima che la
   * storia inizi. */
  initial_inventory?: string[];
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

/** Un id assente non fa fallire niente qui — lo `speaker` di un nodo resta una
 * stringa libera per lo schema — ma e' un difetto: chi parla deve stare nella
 * roster globale, anche con una sola battuta, altrimenti non ha voce
 * assegnabile. E' il linter a segnalarlo. */
export function findCharacter(story: Story, id: string): Character | undefined {
  return story.characters?.find((c) => c.id === id);
}

/** Etichetta da mostrare per uno speaker di dialogo. */
export function speakerName(story: Story, speaker: string): string {
  if (speaker === 'narrator') return 'Narratore';
  const c = findCharacter(story, speaker);
  return c ? displayName(c) : speaker;
}

export function findPlace(story: Story, id: string): Place | undefined {
  return story.places?.find((p) => p.id === id);
}

/**
 * Le inquadrature di una scena: lo sfondo piu' ogni beat che cambia
 * inquadratura. Sono i punti in cui si genera un'immagine, e quindi i punti in
 * cui servono un luogo e un cast dichiarati.
 */
export interface Shot {
  where: string;
  image_prompt: string;
  place?: string;
  characters_in_frame?: string[];
}

export function shotsOf(sc: Scene): Shot[] {
  const out: Shot[] = [];
  if (sc.background?.image_prompt) {
    out.push({
      where: `${sc.id} / background`,
      image_prompt: sc.background.image_prompt,
      place: sc.background.place,
      characters_in_frame: sc.background.characters_in_frame,
    });
  }
  (sc.narration ?? []).forEach((b, i) => {
    if (!b.image_prompt) return;
    out.push({
      where: `${sc.id} / beat ${i + 1}`,
      image_prompt: b.image_prompt,
      place: b.place,
      characters_in_frame: b.characters_in_frame,
    });
  });
  return out;
}

/** Tono da passare al resolver: quello locale se c'e', altrimenti il globale. */
export function toneOf(story: Story, sc?: Scene): string {
  if (sc?.scene_tone) return sc.scene_tone;
  return story.global_style?.default_tone ?? '';
}

/**
 * Il testo di `look` che vale adesso: la prima variante la cui condizione e'
 * soddisfatta, altrimenti il `look` di base.
 *
 * `meets` arriva da fuori invece di importare `GameState`: i tipi non devono
 * sapere niente dello stato, e cosi' questa resta una funzione pura sull'IR.
 */
export function lookNow(sc: Scene, meets: (c?: Condition) => boolean): string | undefined {
  return oraVale(sc.look_variants, sc.look, meets);
}

/** La descrizione di un oggetto com'e' adesso. */
export function descrizioneOra(it: Item, meets: (c?: Condition) => boolean): string | undefined {
  return oraVale(it.description_variants, it.description, meets);
}

/** Prima variante soddisfatta, altrimenti il testo di base. */
function oraVale(varianti: ConditionalText[] | undefined, base: string | undefined, meets: (c?: Condition) => boolean): string | undefined {
  for (const v of varianti ?? []) {
    if (meets(v.condition)) return v.text;
  }
  return base;
}

/**
 * I fallback disponibili per una scena: quelli suoi, poi quelli globali.
 *
 * L'ordine e' la precedenza — chi cerca per intenzione trova prima il testo
 * scritto per *questa* stanza, e ripiega su quello che vale ovunque solo se
 * qui non c'era niente.
 */
export function noMatchPool(story: Story, sc?: Scene): NoMatch[] {
  return [...(sc?.no_match_narration ?? []), ...(story.player_voice?.no_match_narration ?? [])];
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
