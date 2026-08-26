// Package lint cerca nell'IR i bug di giocabilita' che la validazione di
// schema non puo' vedere.
//
// La distinzione e' quella dell'architettura del progetto: la validazione di
// schema dice che l'IR e' *ben formato*, il linter e la partita dicono se e'
// *giocabile*. Qui stanno i controlli statici (goto rotti, scene senza
// uscita, flag mai impostati, rami di dialogo irraggiungibili); quelli che
// richiedono di giocare davvero restano al player.
package lint

import (
	"fmt"
	"sort"

	"zaistory/player-cli/internal/engine"
	"zaistory/player-cli/internal/ir"
)

// Level e' la gravita' di una segnalazione.
type Level int

const (
	// Info: informazione utile, non un difetto.
	Info Level = iota
	// Warn: sospetto, da guardare.
	Warn
	// Error: la storia e' rotta.
	Error
)

func (l Level) String() string {
	switch l {
	case Error:
		return "ERRORE"
	case Warn:
		return "avviso"
	default:
		return "info"
	}
}

// Finding e' una segnalazione del linter.
type Finding struct {
	Level Level
	Where string
	Msg   string
}

func (f Finding) String() string {
	if f.Where == "" {
		return fmt.Sprintf("%-7s %s", f.Level, f.Msg)
	}
	return fmt.Sprintf("%-7s [%s] %s", f.Level, f.Where, f.Msg)
}

type linter struct {
	story    *ir.Story
	findings []Finding
}

func (l *linter) add(lv Level, where, format string, args ...any) {
	l.findings = append(l.findings, Finding{Level: lv, Where: where, Msg: fmt.Sprintf(format, args...)})
}

// Run esegue tutti i controlli statici sull'IR.
func Run(story *ir.Story) []Finding {
	l := &linter{story: story}
	l.checkScenes()
	l.checkReachability()
	l.checkFlagsAndItems()
	l.checkCharacters()
	return l.findings
}

// Counts riassume le segnalazioni per gravita'.
func Counts(fs []Finding) (errors, warnings, infos int) {
	for _, f := range fs {
		switch f.Level {
		case Error:
			errors++
		case Warn:
			warnings++
		default:
			infos++
		}
	}
	return
}

// ------------------------------------------------------------------- scene

func (l *linter) checkScenes() {
	for i := range l.story.Scenes {
		sc := &l.story.Scenes[i]
		where := sc.ID

		if sc.Background == nil || sc.Background.ImagePrompt == "" {
			l.add(Error, where, "manca background.image_prompt (richiesto dallo schema)")
		}
		if len(sc.Actions) == 0 {
			// Una scena senza azioni e' un bug solo se la storia dovrebbe
			// proseguire: se da qui non esce nessun goto_scene, e' un finale.
			if engine.SceneHasExit(sc) {
				l.add(Error, where, "nessuna azione: la scena non ha alcun modo di proseguire")
			} else {
				l.add(Info, where, "scena senza azioni: e' un finale della storia")
			}
		}
		if sc.Type() == ir.SceneCutscene {
			if sc.DialogueTree != nil {
				l.add(Warn, where, "cutscene con dialogue_tree: per convenzione una cutscene non ha dialoghi")
			}
			if len(sc.Actions) > 1 {
				l.add(Warn, where, "cutscene con %d azioni: per convenzione ne ha una sola (\"continua\")", len(sc.Actions))
			}
			if len(sc.Narration) == 0 {
				l.add(Warn, where, "cutscene senza narration[]: non ha nulla da raccontare")
			}
		}

		seen := map[string]bool{}
		for j := range sc.Actions {
			a := &sc.Actions[j]
			aw := where + " / " + a.ID
			if a.ID == "" {
				l.add(Error, where, "azione %d senza id", j)
			}
			if seen[a.ID] {
				l.add(Error, aw, "id di azione duplicato nella stessa scena")
			}
			seen[a.ID] = true
			if a.Label == "" {
				l.add(Error, aw, "azione senza label")
			}
			if a.Effect == nil {
				l.add(Error, aw, "azione senza effect (richiesto dallo schema): selezionarla non farebbe nulla")
				continue
			}
			l.checkEffect(sc, aw, a.Effect)
		}

		l.checkDialogue(sc)
	}
}

func (l *linter) checkEffect(sc *ir.Scene, where string, e *ir.Effect) {
	if e == nil {
		return
	}
	if e.GotoScene != "" {
		if _, ok := l.story.Scene(e.GotoScene); !ok {
			l.add(Error, where, "goto_scene punta alla scena inesistente %q", e.GotoScene)
		}
	}
	if e.GotoDialogue != "" {
		switch {
		case sc.DialogueTree == nil:
			l.add(Error, where, "goto_dialogue %q ma la scena non ha dialogue_tree", e.GotoDialogue)
		default:
			if _, ok := sc.DialogueTree.Nodes[e.GotoDialogue]; !ok {
				l.add(Error, where, "goto_dialogue punta al nodo inesistente %q", e.GotoDialogue)
			}
		}
	}
	if e.GotoScene != "" && e.GotoDialogue != "" {
		l.add(Warn, where, "goto_scene e goto_dialogue insieme: il player esegue la transizione di scena e ignora il dialogo")
	}
	if e.SetFlag != "" && e.SetFlag == e.UnsetFlag {
		l.add(Warn, where, "set_flag e unset_flag sullo stesso flag %q", e.SetFlag)
	}
}

func (l *linter) checkDialogue(sc *ir.Scene) {
	dt := sc.DialogueTree
	if dt == nil {
		return
	}
	where := sc.ID + " / dialogue_tree"

	if _, ok := dt.Nodes[dt.Start]; !ok {
		l.add(Error, where, "start punta al nodo inesistente %q", dt.Start)
	}

	// Punti di ingresso: lo start piu' ogni goto_dialogue che arriva dalle
	// azioni della scena.
	entries := map[string]bool{}
	entryFromAction := false
	for _, a := range sc.Actions {
		if a.Effect != nil && a.Effect.GotoDialogue != "" {
			entries[a.Effect.GotoDialogue] = true
			entryFromAction = true
		}
	}
	if !entryFromAction {
		l.add(Warn, where, "nessuna azione della scena porta al dialogo (goto_dialogue): l'albero e' irraggiungibile")
		entries[dt.Start] = true
	}

	ids := make([]string, 0, len(dt.Nodes))
	for id := range dt.Nodes {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	for _, id := range ids {
		n := dt.Nodes[id]
		nw := sc.ID + " / nodo " + id
		if n.Speaker == "" {
			l.add(Error, nw, "nodo senza speaker")
		}
		l.checkEffect(sc, nw, n.Effect)

		for k, c := range n.Choices {
			cw := fmt.Sprintf("%s / scelta %d", nw, k+1)
			if c.Goto == "" {
				l.add(Error, cw, "scelta senza goto")
			} else if _, ok := dt.Nodes[c.Goto]; !ok {
				l.add(Error, cw, "goto punta al nodo inesistente %q", c.Goto)
			}
			l.checkEffect(sc, cw, c.Effect)
		}

		if n.Next != "" {
			if _, ok := dt.Nodes[n.Next]; !ok {
				l.add(Error, nw, "next punta al nodo inesistente %q", n.Next)
			}
			if len(n.Choices) > 0 {
				l.add(Warn, nw, "ha sia choices sia next: il player usa le scelte e ignora next")
			}
		}

		leadsOut := n.Effect != nil && (n.Effect.GotoScene != "" || n.Effect.GotoDialogue != "")
		if !n.End && n.Next == "" && len(n.Choices) == 0 && !leadsOut {
			l.add(Error, nw, "nodo monco: nessuna scelta, nessun next, nessun end - il dialogo si interrompe qui")
		}
	}

	// Raggiungibilita' dei nodi a partire dagli ingressi.
	seen := map[string]bool{}
	var visit func(string)
	visit = func(id string) {
		if seen[id] {
			return
		}
		n, ok := dt.Nodes[id]
		if !ok {
			return
		}
		seen[id] = true
		if n.Effect != nil && n.Effect.GotoDialogue != "" {
			visit(n.Effect.GotoDialogue)
		}
		for _, c := range n.Choices {
			if c.Effect != nil && c.Effect.GotoDialogue != "" {
				visit(c.Effect.GotoDialogue)
			}
			visit(c.Goto)
		}
		if n.Next != "" {
			visit(n.Next)
		}
	}
	for id := range entries {
		visit(id)
	}
	for _, id := range ids {
		if !seen[id] {
			l.add(Warn, sc.ID+" / nodo "+id, "nodo di dialogo irraggiungibile")
		}
	}
}

// ---------------------------------------------------------- raggiungibilita'

func (l *linter) checkReachability() {
	seen := map[string]bool{}
	var visit func(string)
	visit = func(id string) {
		if seen[id] {
			return
		}
		sc, ok := l.story.Scene(id)
		if !ok {
			return
		}
		seen[id] = true
		for _, e := range allEffects(sc) {
			if e.eff.GotoScene != "" {
				visit(e.eff.GotoScene)
			}
		}
	}
	visit(l.story.StartScene)

	terminals := 0
	for i := range l.story.Scenes {
		sc := &l.story.Scenes[i]
		if !seen[sc.ID] {
			l.add(Warn, sc.ID, "scena irraggiungibile da start_scene")
		}
		if !engine.SceneHasExit(sc) {
			terminals++
			l.add(Info, sc.ID, "scena terminale: nessun goto_scene esce da qui (finale della storia?)")
		}
	}
	if terminals == 0 {
		l.add(Warn, "", "nessuna scena terminale: la storia non ha un finale raggiungibile")
	}
}

// ------------------------------------------------------------ flag e oggetti

type effLoc struct {
	eff   *ir.Effect
	where string
}

type condLoc struct {
	cond  *ir.Condition
	where string
}

func allEffects(sc *ir.Scene) []effLoc {
	var out []effLoc
	for i := range sc.Actions {
		a := &sc.Actions[i]
		if a.Effect != nil {
			out = append(out, effLoc{a.Effect, sc.ID + " / " + a.ID})
		}
	}
	if sc.DialogueTree != nil {
		for id, n := range sc.DialogueTree.Nodes {
			if n.Effect != nil {
				out = append(out, effLoc{n.Effect, sc.ID + " / nodo " + id})
			}
			for k := range n.Choices {
				if n.Choices[k].Effect != nil {
					out = append(out, effLoc{n.Choices[k].Effect, fmt.Sprintf("%s / nodo %s / scelta %d", sc.ID, id, k+1)})
				}
			}
		}
	}
	return out
}

func allConditions(sc *ir.Scene) []condLoc {
	var out []condLoc
	for i := range sc.Actions {
		a := &sc.Actions[i]
		if a.Condition != nil {
			out = append(out, condLoc{a.Condition, sc.ID + " / " + a.ID})
		}
	}
	if sc.DialogueTree != nil {
		for id, n := range sc.DialogueTree.Nodes {
			for k := range n.Choices {
				if n.Choices[k].Condition != nil {
					out = append(out, condLoc{n.Choices[k].Condition, fmt.Sprintf("%s / nodo %s / scelta %d", sc.ID, id, k+1)})
				}
			}
		}
	}
	return out
}

func (l *linter) checkFlagsAndItems() {
	setFlags := map[string]bool{}
	unsetFlags := map[string]bool{}
	addItems := map[string]bool{}
	readFlags := map[string][]string{}
	readItems := map[string][]string{}

	for i := range l.story.Scenes {
		sc := &l.story.Scenes[i]
		for _, f := range sc.OnEnterFlagsSet {
			setFlags[f] = true
		}
		for _, e := range allEffects(sc) {
			if e.eff.SetFlag != "" {
				setFlags[e.eff.SetFlag] = true
			}
			if e.eff.UnsetFlag != "" {
				unsetFlags[e.eff.UnsetFlag] = true
			}
			if e.eff.AddInventory != "" {
				addItems[e.eff.AddInventory] = true
			}
			if e.eff.RemoveInventory != "" && !addItems[e.eff.RemoveInventory] {
				readItems[e.eff.RemoveInventory] = append(readItems[e.eff.RemoveInventory], e.where)
			}
		}
		for _, c := range allConditions(sc) {
			if c.cond.FlagPresent != "" {
				readFlags[c.cond.FlagPresent] = append(readFlags[c.cond.FlagPresent], c.where)
			}
			if c.cond.FlagAbsent != "" {
				readFlags[c.cond.FlagAbsent] = append(readFlags[c.cond.FlagAbsent], c.where)
			}
			if c.cond.HasItem != "" {
				readItems[c.cond.HasItem] = append(readItems[c.cond.HasItem], c.where)
			}
		}
	}

	// Un flag richiesto con flag_present e mai impostato da nessuna parte e'
	// una porta chiusa a chiave che non ha una chiave.
	for _, sc := range l.story.Scenes {
		for _, c := range allConditions(&sc) {
			if c.cond.FlagPresent != "" && !setFlags[c.cond.FlagPresent] {
				l.add(Error, c.where, "richiede il flag %q, che nessuna azione imposta mai: la condizione non sara' mai vera", c.cond.FlagPresent)
			}
			if c.cond.HasItem != "" && !addItems[c.cond.HasItem] {
				l.add(Error, c.where, "richiede l'oggetto %q, che nessuna azione mette mai in inventario", c.cond.HasItem)
			}
		}
	}
	for f := range setFlags {
		if len(readFlags[f]) == 0 {
			l.add(Info, "", "flag %q impostato ma mai letto da nessuna condizione", f)
		}
	}
	for f := range unsetFlags {
		if !setFlags[f] {
			l.add(Warn, "", "flag %q rimosso (unset_flag) ma mai impostato", f)
		}
	}
	for it := range addItems {
		if len(readItems[it]) == 0 {
			l.add(Info, "", "oggetto %q raccolto ma mai richiesto da nessuna condizione", it)
		}
	}

	// Confronto con gli elenchi documentali, se presenti.
	if len(l.story.StateFlagsSchema) > 0 {
		declared := map[string]bool{}
		for _, f := range l.story.StateFlagsSchema {
			declared[f] = true
		}
		for f := range setFlags {
			if !declared[f] {
				l.add(Info, "", "flag %q usato ma non elencato in state_flags_schema", f)
			}
		}
	}
	if len(l.story.InventorySchema) > 0 {
		declared := map[string]bool{}
		for _, it := range l.story.InventorySchema {
			declared[it] = true
		}
		for it := range addItems {
			if !declared[it] {
				l.add(Info, "", "oggetto %q usato ma non elencato in inventory_schema", it)
			}
		}
	}
}

// ------------------------------------------------------------- personaggi

func (l *linter) checkCharacters() {
	seen := map[string]bool{}
	for _, c := range l.story.Characters {
		if seen[c.ID] {
			l.add(Warn, "", "personaggio duplicato nella roster globale: %q", c.ID)
		}
		seen[c.ID] = true
	}
	// Nota: uno speaker fuori dalla roster NON e' un errore. I personaggi
	// occasionali (voci fuori campo, comparse) per scelta architetturale non
	// stanno nella roster globale.
	for i := range l.story.Scenes {
		sc := &l.story.Scenes[i]
		for _, c := range sc.Characters {
			if !seen[c.ID] && c.VisualPrompt == "" && c.Voice == nil {
				l.add(Warn, sc.ID, "personaggio %q in scena non e' nella roster globale e non ha override locali: non ha ne' aspetto ne' voce", c.ID)
			}
		}
	}
}
