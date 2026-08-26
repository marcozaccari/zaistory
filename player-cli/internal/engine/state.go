// Package engine contiene lo stato di gioco e il loop che lo fa avanzare.
//
// Vincolo architetturale di tutto il package: qui non c'e' logica narrativa.
// L'engine non inventa azioni, non genera testo, non modifica lo stato se non
// applicando Effect gia' presenti nell'IR. Se qualcosa non si puo' fare e'
// perche' l'IR non lo prevede - ed e' esattamente l'informazione che il player
// CLI serve a far emergere.
package engine

import (
	"fmt"
	"sort"

	"zaistory/player-cli/internal/ir"
)

// State e' l'intero stato di gioco. E' piccolo e interamente derivabile dagli
// Effect applicati: per questo mostrarlo rende ovvia la diagnosi dei bug.
type State struct {
	Flags     map[string]bool
	Inventory []string
	Scene     string
	History   []string

	// consumed tiene le azioni con repeatable:false gia' usate, per chiave
	// "scena/azione". La consumazione e' permanente anche se si torna nella
	// scena: "prendi la chiave" non deve poter essere ripetuta.
	consumed map[string]bool
}

// NewState crea uno stato vuoto.
func NewState() *State {
	return &State{
		Flags:    map[string]bool{},
		consumed: map[string]bool{},
	}
}

// HasItem dice se un oggetto e' in inventario.
func (s *State) HasItem(item string) bool {
	for _, it := range s.Inventory {
		if it == item {
			return true
		}
	}
	return false
}

// SortedFlags ritorna i flag attivi in ordine alfabetico.
func (s *State) SortedFlags() []string {
	out := make([]string, 0, len(s.Flags))
	for f, on := range s.Flags {
		if on {
			out = append(out, f)
		}
	}
	sort.Strings(out)
	return out
}

func consumeKey(sceneID, actionID string) string { return sceneID + "/" + actionID }

// Consumed dice se un'azione non ripetibile e' gia' stata usata.
func (s *State) Consumed(sceneID, actionID string) bool {
	return s.consumed[consumeKey(sceneID, actionID)]
}

// Consume segna un'azione non ripetibile come usata.
func (s *State) Consume(sceneID, actionID string) {
	s.consumed[consumeKey(sceneID, actionID)] = true
}

// Meets valuta una Condition sullo stato corrente. Il secondo valore e' il
// motivo per cui la condizione non e' soddisfatta, in italiano leggibile: e'
// quello che la modalita' debug mostra accanto alle azioni nascoste, perche'
// "perche' questa azione non compare?" e' la domanda che ci si pone il 90%
// delle volte quando si testa una storia.
func (s *State) Meets(c *ir.Condition) (bool, string) {
	if c == nil {
		return true, ""
	}
	if c.FlagPresent != "" && !s.Flags[c.FlagPresent] {
		return false, fmt.Sprintf("richiede il flag %q, non impostato", c.FlagPresent)
	}
	if c.FlagAbsent != "" && s.Flags[c.FlagAbsent] {
		return false, fmt.Sprintf("richiede l'assenza del flag %q, che invece e' impostato", c.FlagAbsent)
	}
	if c.HasItem != "" && !s.HasItem(c.HasItem) {
		return false, fmt.Sprintf("richiede l'oggetto %q, non in inventario", c.HasItem)
	}
	return true, ""
}

// DescribeCondition rende leggibile una condizione (per il debug).
func DescribeCondition(c *ir.Condition) string {
	if c == nil {
		return "nessuna"
	}
	var parts []string
	if c.FlagPresent != "" {
		parts = append(parts, "flag "+c.FlagPresent)
	}
	if c.FlagAbsent != "" {
		parts = append(parts, "NON flag "+c.FlagAbsent)
	}
	if c.HasItem != "" {
		parts = append(parts, "oggetto "+c.HasItem)
	}
	if len(parts) == 0 {
		return "nessuna"
	}
	out := parts[0]
	for _, p := range parts[1:] {
		out += " e " + p
	}
	return out
}

// DescribeEffect rende leggibile un effetto (per il debug).
func DescribeEffect(e *ir.Effect) string {
	if e == nil {
		return "nessuno"
	}
	var parts []string
	if e.Narration != "" {
		parts = append(parts, "narrazione")
	}
	if e.SetFlag != "" {
		parts = append(parts, "+flag "+e.SetFlag)
	}
	if e.UnsetFlag != "" {
		parts = append(parts, "-flag "+e.UnsetFlag)
	}
	if e.AddInventory != "" {
		parts = append(parts, "+oggetto "+e.AddInventory)
	}
	if e.RemoveInventory != "" {
		parts = append(parts, "-oggetto "+e.RemoveInventory)
	}
	if e.PlaySoundPrompt != "" {
		parts = append(parts, "suono")
	}
	if e.GotoDialogue != "" {
		parts = append(parts, "-> dialogo "+e.GotoDialogue)
	}
	if e.GotoScene != "" {
		parts = append(parts, "-> scena "+e.GotoScene)
	}
	if len(parts) == 0 {
		return "nessuno"
	}
	out := parts[0]
	for _, p := range parts[1:] {
		out += ", " + p
	}
	return out
}

// TransitionKind e' l'esito di un Effect dal punto di vista del flusso.
type TransitionKind int

const (
	// TransNone: nessun salto, si resta dove si e'.
	TransNone TransitionKind = iota
	// TransDialogue: salto a un nodo del dialogue tree della scena corrente.
	TransDialogue
	// TransScene: transizione a un'altra scena.
	TransScene
)

// Transition e' il salto richiesto da un Effect.
type Transition struct {
	Kind   TransitionKind
	Target string
}

// Apply applica un Effect allo stato, nell'ordine fissato dallo schema:
// narration -> set/unset_flag -> add/remove_inventory -> play_sound ->
// goto_dialogue/goto_scene. L'ordine non e' un dettaglio: una narrazione deve
// poter parlare dello stato *prima* del cambiamento, e il salto avviene sempre
// per ultimo.
func (s *State) Apply(e *ir.Effect, ui UI) Transition {
	if e == nil {
		return Transition{}
	}

	if e.Narration != "" {
		ui.Narration(e.Narration, e.NarrationVoice)
	}
	if e.SetFlag != "" {
		s.Flags[e.SetFlag] = true
		ui.StateChange("flag impostato: " + e.SetFlag)
	}
	if e.UnsetFlag != "" {
		delete(s.Flags, e.UnsetFlag)
		ui.StateChange("flag rimosso: " + e.UnsetFlag)
	}
	if e.AddInventory != "" {
		if !s.HasItem(e.AddInventory) {
			s.Inventory = append(s.Inventory, e.AddInventory)
		}
		ui.StateChange("in inventario: " + e.AddInventory)
	}
	if e.RemoveInventory != "" {
		for i, it := range s.Inventory {
			if it == e.RemoveInventory {
				s.Inventory = append(s.Inventory[:i], s.Inventory[i+1:]...)
				break
			}
		}
		ui.StateChange("rimosso dall'inventario: " + e.RemoveInventory)
	}
	if e.PlaySoundPrompt != "" {
		ui.Sound(e.PlaySoundPrompt)
	}

	// goto_scene e goto_dialogue sono mutuamente esclusivi in pratica; se
	// entrambi presenti vince la transizione di scena, che e' la piu' forte,
	// e il linter segnala l'ambiguita'.
	if e.GotoScene != "" {
		return Transition{Kind: TransScene, Target: e.GotoScene}
	}
	if e.GotoDialogue != "" {
		return Transition{Kind: TransDialogue, Target: e.GotoDialogue}
	}
	return Transition{}
}
