package engine

import (
	"errors"
	"fmt"

	"zaistory/player-cli/internal/ir"
)

// ErrQuit e' l'uscita volontaria dal player.
var ErrQuit = errors.New("uscita richiesta")

// ErrScriptEnded segnala che uno script di playthrough e' finito mentre il
// gioco chiedeva ancora un input.
var ErrScriptEnded = errors.New("script di playthrough esaurito")

// UI e' tutto cio' che l'engine sa del mondo esterno. Due implementazioni la
// soddisfano: il terminale interattivo e l'esecutore di script di playthrough.
// L'engine non sa quale delle due sta guidando la partita.
type UI interface {
	SceneEnter(st *State, sc *ir.Scene)
	Beat(sc *ir.Scene, b ir.NarrationBeat, index, total int) error
	Line(sc *ir.Scene, nodeID string, n *ir.DialogueNode) error
	Narration(text string, v *ir.VoiceSpec)
	Sound(prompt string)
	StateChange(desc string)
	Notice(text string)
	Problem(text string)
	ChooseAction(p ActionPrompt) (Command, error)
	ChooseChoice(p ChoicePrompt) (Command, error)
	Finish(o Outcome)
}

// HiddenAction e' un'azione filtrata da una condizione, con il motivo.
type HiddenAction struct {
	Action *ir.Action
	Reason string
}

// HiddenChoice e' una scelta di dialogo filtrata da una condizione.
type HiddenChoice struct {
	Choice ir.DialogueChoice
	Reason string
}

// ActionPrompt e' la richiesta di scegliere un'azione contestuale.
type ActionPrompt struct {
	Story     *ir.Story
	Scene     *ir.Scene
	State     *State
	Available []*ir.Action
	Hidden    []HiddenAction
	// Terminal e' vero se dalla scena non esce nessun goto_scene: e' un
	// finale della storia, non un vicolo cieco.
	Terminal bool
}

// ChoicePrompt e' la richiesta di scegliere una battuta di dialogo.
type ChoicePrompt struct {
	Story     *ir.Story
	Scene     *ir.Scene
	State     *State
	NodeID    string
	Node      *ir.DialogueNode
	Available []ir.DialogueChoice
	Hidden    []HiddenChoice
}

// Command e' la risposta della UI a un prompt.
type Command struct {
	Quit        bool
	ActionID    string
	ChoiceIndex int
}

// Outcome e' l'esito della partita.
type Outcome struct {
	Reason   string   // testo leggibile
	Scene    string   // scena in cui ci si e' fermati
	Steps    int      // scelte effettuate
	Ended    bool     // true se la storia e' finita in modo previsto
	Quit     bool     // true se l'utente ha abbandonato
	Problems []string // bug di giocabilita' incontrati durante la partita
	Trace    []string // sequenza di token rigiocabile
}

// Engine fa avanzare una partita.
type Engine struct {
	Story    *ir.Story
	State    *State
	UI       UI
	MaxSteps int

	outcome Outcome
}

// New prepara una partita a partire dall'IR.
func New(story *ir.Story, ui UI) *Engine {
	return &Engine{
		Story:    story,
		State:    NewState(),
		UI:       ui,
		MaxSteps: 10000,
	}
}

func (e *Engine) problem(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	e.outcome.Problems = append(e.outcome.Problems, msg)
	e.UI.Problem(msg)
}

// Trace ritorna la sequenza di token giocata finora.
func (e *Engine) Trace() []string { return e.outcome.Trace }

func (e *Engine) record(tok string) {
	e.outcome.Trace = append(e.outcome.Trace, tok)
	e.outcome.Steps++
}

// Run gioca la storia dall'inizio fino a un finale, a un vicolo cieco o
// all'uscita del giocatore.
func (e *Engine) Run() Outcome {
	sceneID := e.Story.StartScene

	for {
		sc, ok := e.Story.Scene(sceneID)
		if !ok {
			e.problem("goto verso la scena inesistente %q", sceneID)
			e.outcome.Reason = "transizione verso una scena inesistente"
			break
		}

		e.enterScene(sc)
		if err := e.playNarration(sc); err != nil {
			e.finishErr(err, sc)
			break
		}

		next, err := e.playScene(sc)
		if err != nil {
			e.finishErr(err, sc)
			break
		}
		if next == "" {
			break
		}
		sceneID = next
	}

	e.outcome.Scene = e.State.Scene
	e.UI.Finish(e.outcome)
	return e.outcome
}

func (e *Engine) finishErr(err error, sc *ir.Scene) {
	e.outcome.Scene = sc.ID
	switch {
	case errors.Is(err, ErrQuit):
		e.outcome.Quit = true
		e.outcome.Reason = "partita abbandonata dal giocatore"
	case errors.Is(err, ErrScriptEnded):
		e.outcome.Reason = "script di playthrough esaurito prima della fine della storia"
	default:
		e.outcome.Reason = err.Error()
	}
}

func (e *Engine) enterScene(sc *ir.Scene) {
	e.State.Scene = sc.ID
	e.State.History = append(e.State.History, sc.ID)
	for _, f := range sc.OnEnterFlagsSet {
		e.State.Flags[f] = true
	}
	e.UI.SceneEnter(e.State, sc)
}

func (e *Engine) playNarration(sc *ir.Scene) error {
	for i, b := range sc.Narration {
		if err := e.UI.Beat(sc, b, i, len(sc.Narration)); err != nil {
			return err
		}
	}
	return nil
}

// playScene gestisce azioni e dialoghi di una scena. Ritorna l'id della scena
// successiva, oppure "" se la partita si ferma qui.
func (e *Engine) playScene(sc *ir.Scene) (string, error) {
	for {
		if e.outcome.Steps > e.MaxSteps {
			return "", fmt.Errorf("superati %d passi: la storia sembra in loop", e.MaxSteps)
		}

		avail, hidden := e.actions(sc)
		if len(avail) == 0 {
			// Nessuna azione disponibile. Se dalla scena non esce comunque
			// nessuna transizione, e' un finale della storia; altrimenti e'
			// il bug che questo player esiste per trovare.
			if !e.sceneHasExit(sc) {
				e.outcome.Ended = true
				e.outcome.Reason = "fine della storia"
				return "", nil
			}
			e.problem("scena %q: nessuna azione disponibile ma la scena avrebbe un'uscita (condizioni mai soddisfatte?)", sc.ID)
			e.outcome.Reason = "vicolo cieco: nessuna azione disponibile"
			return "", nil
		}

		cmd, err := e.UI.ChooseAction(ActionPrompt{
			Story: e.Story, Scene: sc, State: e.State,
			Available: avail, Hidden: hidden,
			Terminal: !e.sceneHasExit(sc),
		})
		if err != nil {
			// Uno script che finisce in una scena terminale non e' un test
			// fallito: e' una storia arrivata al suo finale.
			if errors.Is(err, ErrScriptEnded) && !e.sceneHasExit(sc) {
				e.outcome.Ended = true
				e.outcome.Reason = "fine della storia (scena terminale)"
				return "", nil
			}
			return "", err
		}
		if cmd.Quit {
			return "", ErrQuit
		}

		act, ok := sc.Action(cmd.ActionID)
		if !ok {
			e.problem("azione %q inesistente nella scena %q", cmd.ActionID, sc.ID)
			continue
		}
		e.record("a:" + act.ID)
		if !act.IsRepeatable() {
			e.State.Consume(sc.ID, act.ID)
		}

		tr := e.State.Apply(act.Effect, e.UI)
		next, done, err := e.follow(sc, tr)
		if err != nil {
			return "", err
		}
		if done {
			return next, nil
		}
	}
}

// follow esegue una transizione. Ritorna (scenaSuccessiva, sceneCambiata, err).
func (e *Engine) follow(sc *ir.Scene, tr Transition) (string, bool, error) {
	switch tr.Kind {
	case TransScene:
		return tr.Target, true, nil
	case TransDialogue:
		next, err := e.playDialogue(sc, tr.Target)
		if err != nil {
			return "", false, err
		}
		if next != "" {
			return next, true, nil
		}
		return "", false, nil
	default:
		return "", false, nil
	}
}

// playDialogue percorre il dialogue tree della scena a partire da un nodo.
// Ritorna l'id di una scena se il dialogo porta fuori, "" se si torna alle
// azioni di scena.
func (e *Engine) playDialogue(sc *ir.Scene, nodeID string) (string, error) {
	for {
		if e.outcome.Steps > e.MaxSteps {
			return "", fmt.Errorf("superati %d passi: il dialogo sembra in loop", e.MaxSteps)
		}
		if sc.DialogueTree == nil {
			e.problem("scena %q: goto_dialogue %q ma la scena non ha dialogue_tree", sc.ID, nodeID)
			return "", nil
		}
		node, ok := sc.Node(nodeID)
		if !ok {
			e.problem("scena %q: nodo di dialogo inesistente %q", sc.ID, nodeID)
			return "", nil
		}

		if err := e.UI.Line(sc, nodeID, node); err != nil {
			return "", err
		}

		tr := e.State.Apply(node.Effect, e.UI)
		if tr.Kind == TransScene {
			return tr.Target, nil
		}
		if tr.Kind == TransDialogue {
			nodeID = tr.Target
			continue
		}

		avail, hidden := e.choices(node)
		if len(avail) > 0 {
			cmd, err := e.UI.ChooseChoice(ChoicePrompt{
				Story: e.Story, Scene: sc, State: e.State,
				NodeID: nodeID, Node: node,
				Available: avail, Hidden: hidden,
			})
			if err != nil {
				return "", err
			}
			if cmd.Quit {
				return "", ErrQuit
			}
			if cmd.ChoiceIndex < 0 || cmd.ChoiceIndex >= len(avail) {
				e.problem("scelta fuori range nel nodo %q", nodeID)
				continue
			}
			ch := avail[cmd.ChoiceIndex]
			e.record("c:" + ch.Goto)

			tr := e.State.Apply(ch.Effect, e.UI)
			switch tr.Kind {
			case TransScene:
				return tr.Target, nil
			case TransDialogue:
				nodeID = tr.Target
			default:
				nodeID = ch.Goto
			}
			continue
		}

		if node.End {
			return "", nil
		}
		if node.Next != "" {
			nodeID = node.Next
			continue
		}

		// Nodo senza scelte disponibili, senza next e senza end: o le
		// condizioni hanno filtrato tutto, o il compilatore ha lasciato un
		// ramo monco. In entrambi i casi e' un bug da segnalare, non da
		// nascondere tornando in silenzio alle azioni.
		if len(node.Choices) > 0 {
			e.problem("scena %q, nodo %q: tutte le scelte sono filtrate da una condizione e non c'e' next/end", sc.ID, nodeID)
		} else {
			e.problem("scena %q, nodo %q: nessuna scelta, nessun next, nessun end", sc.ID, nodeID)
		}
		e.UI.Notice("(il dialogo si interrompe: si torna alle azioni della scena)")
		return "", nil
	}
}

// actions divide le azioni della scena tra disponibili e nascoste.
func (e *Engine) actions(sc *ir.Scene) ([]*ir.Action, []HiddenAction) {
	var avail []*ir.Action
	var hidden []HiddenAction
	for i := range sc.Actions {
		a := &sc.Actions[i]
		if !a.IsRepeatable() && e.State.Consumed(sc.ID, a.ID) {
			hidden = append(hidden, HiddenAction{Action: a, Reason: "gia' usata (repeatable: false)"})
			continue
		}
		if ok, why := e.State.Meets(a.Condition); !ok {
			hidden = append(hidden, HiddenAction{Action: a, Reason: why})
			continue
		}
		avail = append(avail, a)
	}
	return avail, hidden
}

func (e *Engine) choices(n *ir.DialogueNode) ([]ir.DialogueChoice, []HiddenChoice) {
	var avail []ir.DialogueChoice
	var hidden []HiddenChoice
	for _, c := range n.Choices {
		if ok, why := e.State.Meets(c.Condition); !ok {
			hidden = append(hidden, HiddenChoice{Choice: c, Reason: why})
			continue
		}
		avail = append(avail, c)
	}
	return avail, hidden
}

// sceneHasExit dice se dalla scena esiste, staticamente, almeno una
// transizione verso un'altra scena. Serve a distinguere un finale legittimo
// da un vicolo cieco.
func (e *Engine) sceneHasExit(sc *ir.Scene) bool { return SceneHasExit(sc) }

// SceneHasExit e' esportata perche' anche il linter ragiona su questo.
func SceneHasExit(sc *ir.Scene) bool {
	has := func(ef *ir.Effect) bool { return ef != nil && ef.GotoScene != "" }
	for _, a := range sc.Actions {
		if has(a.Effect) {
			return true
		}
	}
	if sc.DialogueTree != nil {
		for _, n := range sc.DialogueTree.Nodes {
			if has(n.Effect) {
				return true
			}
			for _, c := range n.Choices {
				if has(c.Effect) {
					return true
				}
			}
		}
	}
	return false
}
