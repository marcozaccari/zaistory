// Package ir contiene i tipi Go che rispecchiano engine-ir.schema.json.
//
// Regola di questo package: e' un rispecchiamento fedele dello schema, niente
// di piu'. Nessun campo di comodo, nessuna informazione derivata, nessun
// default "furbo" applicato in fase di lettura. L'IR e' il contratto del
// progetto: se un dato non c'e' qui, non deve esistere nemmeno nel player.
package ir

// Story e' il documento IR completo.
type Story struct {
	IRVersion        string       `json:"ir_version"`
	ID               string       `json:"id"`
	Title            string       `json:"title"`
	Description      string       `json:"description,omitempty"`
	Language         string       `json:"language,omitempty"`
	GlobalStyle      *GlobalStyle `json:"global_style,omitempty"`
	Characters       []Character  `json:"characters,omitempty"`
	StartScene       string       `json:"start_scene"`
	StateFlagsSchema []string     `json:"state_flags_schema,omitempty"`
	InventorySchema  []string     `json:"inventory_schema,omitempty"`
	Scenes           []Scene      `json:"scenes"`
}

// GlobalStyle e' lo stile globale applicato ai prompt di generazione asset.
// Il player CLI non genera nulla: in modalita' debug ne mostra i valori.
type GlobalStyle struct {
	ImageStyleSuffix string     `json:"image_style_suffix,omitempty"`
	NarratorVoice    *VoiceSpec `json:"narrator_voice,omitempty"`
	DefaultTone      string     `json:"default_tone,omitempty"`
	AmbientMusicTags []string   `json:"ambient_music_tags,omitempty"`
}

// VoiceSpec e' la descrizione testuale di una voce. Provider-agnostica per
// scelta architetturale: qui non c'e' e non deve arrivare nessun voice_id.
type VoiceSpec struct {
	StylePrompt string `json:"style_prompt,omitempty"`
}

// Character e' l'anagrafica globale di un personaggio.
type Character struct {
	ID           string     `json:"id"`
	Name         string     `json:"name,omitempty"`
	VisualPrompt string     `json:"visual_prompt,omitempty"`
	Voice        *VoiceSpec `json:"voice,omitempty"`
}

// DisplayName e' il nome da mostrare, con fallback sull'id.
func (c Character) DisplayName() string {
	if c.Name != "" {
		return c.Name
	}
	return c.ID
}

// Condition e' la condizione di visibilita' di un'azione o di una scelta.
// I campi presenti si sommano in AND.
type Condition struct {
	FlagPresent string `json:"flag_present,omitempty"`
	FlagAbsent  string `json:"flag_absent,omitempty"`
	HasItem     string `json:"has_item,omitempty"`
}

// Effect e' l'unico modo in cui lo stato di gioco puo' cambiare.
// Nessun player e nessun resolver puo' fabbricarne uno: puo' solo applicare
// quelli gia' presenti nell'IR.
type Effect struct {
	Narration       string     `json:"narration,omitempty"`
	NarrationVoice  *VoiceSpec `json:"narration_voice,omitempty"`
	SetFlag         string     `json:"set_flag,omitempty"`
	UnsetFlag       string     `json:"unset_flag,omitempty"`
	AddInventory    string     `json:"add_inventory,omitempty"`
	RemoveInventory string     `json:"remove_inventory,omitempty"`
	PlaySoundPrompt string     `json:"play_sound_prompt,omitempty"`
	GotoDialogue    string     `json:"goto_dialogue,omitempty"`
	GotoScene       string     `json:"goto_scene,omitempty"`
}

// DialogueChoice e' una scelta offerta al giocatore dentro un dialogo.
// Nota: lo schema non prevede un id per le scelte; il player le identifica
// con il nodo di destinazione (campo goto), che e' stabile.
type DialogueChoice struct {
	Text      string     `json:"text"`
	Goto      string     `json:"goto"`
	Condition *Condition `json:"condition,omitempty"`
	Effect    *Effect    `json:"effect,omitempty"`
}

// DialogueNode e' una battuta del dialogo, con le eventuali scelte che seguono.
type DialogueNode struct {
	Speaker       string           `json:"speaker"`
	Text          string           `json:"text"`
	VoiceOverride *VoiceSpec       `json:"voice_override,omitempty"`
	Effect        *Effect          `json:"effect,omitempty"`
	Choices       []DialogueChoice `json:"choices,omitempty"`
	Next          string           `json:"next,omitempty"`
	End           bool             `json:"end,omitempty"`
}

// DialogueTree e' l'albero di dialogo di una scena.
type DialogueTree struct {
	Start string                  `json:"start"`
	Nodes map[string]DialogueNode `json:"nodes"`
}

// Action e' un'azione contestuale di scena.
type Action struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Target     string     `json:"target,omitempty"`
	Aliases    []string   `json:"aliases,omitempty"`
	Condition  *Condition `json:"condition,omitempty"`
	Effect     *Effect    `json:"effect,omitempty"`
	Repeatable *bool      `json:"repeatable,omitempty"`
}

// IsRepeatable applica il default dello schema (true quando il campo e' assente).
func (a Action) IsRepeatable() bool {
	return a.Repeatable == nil || *a.Repeatable
}

// SceneCharacter e' la presenza di un personaggio in scena, con override locali.
type SceneCharacter struct {
	ID           string     `json:"id"`
	VisualPrompt string     `json:"visual_prompt,omitempty"`
	Voice        *VoiceSpec `json:"voice,omitempty"`
}

// NarrationBeat e' un singolo beat della narrazione di ingresso scena.
// Per le cutscene la lista di beat e' l'intera sequenza di montaggio.
type NarrationBeat struct {
	Text              string     `json:"text"`
	Voice             *VoiceSpec `json:"voice,omitempty"`
	ImagePrompt       string     `json:"image_prompt,omitempty"`
	SoundEffectPrompt string     `json:"sound_effect_prompt,omitempty"`
}

// Background e' l'inquadratura di base della scena.
type Background struct {
	ImagePrompt        string `json:"image_prompt"`
	AmbientSoundPrompt string `json:"ambient_sound_prompt,omitempty"`
}

// Tipi di scena previsti dallo schema.
const (
	SceneInteractive = "interactive"
	SceneCutscene    = "cutscene"
)

// Scene e' una scena inline dell'IR.
//
// Il campo Ref esiste perche' lo schema prevede anche entry `{"ref": "..."}`
// verso scene su file esterni: non e' ancora supportato, ma va riconosciuto
// per poter dare un errore chiaro invece di una scena vuota e misteriosa.
type Scene struct {
	Ref string `json:"ref,omitempty"`

	ID              string           `json:"id,omitempty"`
	Title           string           `json:"title,omitempty"`
	Background      *Background      `json:"background,omitempty"`
	SceneTone       string           `json:"scene_tone,omitempty"`
	SceneType       string           `json:"scene_type,omitempty"`
	Characters      []SceneCharacter `json:"characters,omitempty"`
	Narration       []NarrationBeat  `json:"narration,omitempty"`
	DialogueTree    *DialogueTree    `json:"dialogue_tree,omitempty"`
	Actions         []Action         `json:"actions,omitempty"`
	OnEnterFlagsSet []string         `json:"on_enter_flags_set,omitempty"`
}

// Type applica il default dello schema per scene_type.
func (s Scene) Type() string {
	if s.SceneType == "" {
		return SceneInteractive
	}
	return s.SceneType
}

// IsRef dice se questa entry e' un riferimento a una scena su file esterno.
func (s Scene) IsRef() bool { return s.Ref != "" }
