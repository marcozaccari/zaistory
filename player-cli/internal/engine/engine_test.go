package engine_test

import (
	"strings"
	"testing"

	"zaistory/player-cli/internal/engine"
	"zaistory/player-cli/internal/ir"
)

// fakeUI gioca una sequenza di token predefinita e registra quello che vede.
// Serve a testare l'engine senza terminale: e' la stessa idea dello script di
// playthrough, ridotta al minimo.
type fakeUI struct {
	toks     []string
	pos      int
	problems []string
	log      []string
	hidden   map[string]string // azione -> motivo per cui era nascosta
}

func newFake(toks ...string) *fakeUI {
	return &fakeUI{toks: toks, hidden: map[string]string{}}
}

func (f *fakeUI) next() (string, bool) {
	if f.pos >= len(f.toks) {
		return "", false
	}
	t := f.toks[f.pos]
	f.pos++
	return t, true
}

func (f *fakeUI) SceneEnter(st *engine.State, sc *ir.Scene) { f.log = append(f.log, "scena:"+sc.ID) }
func (f *fakeUI) Beat(sc *ir.Scene, b ir.NarrationBeat, i, n int) error {
	f.log = append(f.log, "beat:"+sc.ID)
	return nil
}
func (f *fakeUI) Line(sc *ir.Scene, nodeID string, n *ir.DialogueNode) error {
	f.log = append(f.log, "nodo:"+nodeID)
	return nil
}
func (f *fakeUI) Narration(text string, v *ir.VoiceSpec) { f.log = append(f.log, "narr") }
func (f *fakeUI) Sound(prompt string)                    {}
func (f *fakeUI) StateChange(desc string)                { f.log = append(f.log, "stato:"+desc) }
func (f *fakeUI) Notice(text string)                     {}
func (f *fakeUI) Problem(text string)                    { f.problems = append(f.problems, text) }
func (f *fakeUI) Finish(o engine.Outcome)                {}

func (f *fakeUI) ChooseAction(p engine.ActionPrompt) (engine.Command, error) {
	for _, h := range p.Hidden {
		f.hidden[h.Action.ID] = h.Reason
	}
	tok, ok := f.next()
	if !ok {
		return engine.Command{}, engine.ErrScriptEnded
	}
	want := strings.TrimPrefix(tok, "a:")
	for _, a := range p.Available {
		if a.ID == want {
			return engine.Command{ActionID: a.ID}, nil
		}
	}
	f.problems = append(f.problems, "test: azione "+want+" non disponibile in "+p.Scene.ID)
	return engine.Command{Quit: true}, nil
}

func (f *fakeUI) ChooseChoice(p engine.ChoicePrompt) (engine.Command, error) {
	tok, ok := f.next()
	if !ok {
		return engine.Command{}, engine.ErrScriptEnded
	}
	want := strings.TrimPrefix(tok, "c:")
	for i, c := range p.Available {
		if c.Goto == want {
			return engine.Command{ChoiceIndex: i}, nil
		}
	}
	f.problems = append(f.problems, "test: scelta "+want+" non disponibile nel nodo "+p.NodeID)
	return engine.Command{Quit: true}, nil
}

func load(t *testing.T, path string) *ir.Story {
	t.Helper()
	s, err := ir.Load(path)
	if err != nil {
		t.Fatalf("caricamento %s: %v", path, err)
	}
	return s
}

func TestPartitaCompleta(t *testing.T) {
	story := load(t, "../../testdata/mini.ir.json")
	ui := newFake("a:continua", "a:parla_oste", "c:d_chiave", "a:prendi_chiave", "a:esci")
	e := engine.New(story, ui)
	out := e.Run()

	if len(out.Problems) > 0 {
		t.Fatalf("nessun problema atteso, trovati: %v", out.Problems)
	}
	if !out.Ended {
		t.Fatalf("la storia doveva arrivare a un finale, invece: %s", out.Reason)
	}
	if out.Scene != "finale" {
		t.Errorf("scena finale attesa 'finale', trovata %q", out.Scene)
	}
	if !e.State.HasItem("chiave") {
		t.Errorf("la chiave doveva essere in inventario: %v", e.State.Inventory)
	}
	if !e.State.Flags["oste_parlato"] || !e.State.Flags["prologo_visto"] {
		t.Errorf("flag attesi mancanti: %v", e.State.SortedFlags())
	}
	want := []string{"prologo", "taverna", "finale"}
	if strings.Join(e.State.History, ",") != strings.Join(want, ",") {
		t.Errorf("storico atteso %v, trovato %v", want, e.State.History)
	}
	// La traccia deve essere rigiocabile tale e quale.
	wantTrace := "a:continua,a:parla_oste,c:d_chiave,a:prendi_chiave,a:esci"
	if got := strings.Join(out.Trace, ","); got != wantTrace {
		t.Errorf("traccia attesa %q, trovata %q", wantTrace, got)
	}
}

func TestAzioneNascostaFinoAlFlag(t *testing.T) {
	story := load(t, "../../testdata/mini.ir.json")
	// Si tenta di prendere la chiave prima di parlare con l'oste.
	ui := newFake("a:continua", "a:prendi_chiave")
	engine.New(story, ui).Run()

	reason, ok := ui.hidden["prendi_chiave"]
	if !ok {
		t.Fatalf("prendi_chiave doveva risultare nascosta, nascoste: %v", ui.hidden)
	}
	if !strings.Contains(reason, "oste_parlato") {
		t.Errorf("il motivo doveva citare il flag mancante, invece: %q", reason)
	}
	if len(ui.problems) == 0 {
		t.Errorf("il tentativo su un'azione non disponibile doveva essere segnalato")
	}
}

func TestAzioneNonRipetibileSiConsuma(t *testing.T) {
	story := load(t, "../../testdata/mini.ir.json")
	ui := newFake("a:continua", "a:parla_oste", "c:d_chiave", "a:prendi_chiave", "a:prendi_chiave")
	engine.New(story, ui).Run()

	if reason := ui.hidden["prendi_chiave"]; !strings.Contains(reason, "repeatable") {
		t.Errorf("dopo l'uso l'azione doveva essere consumata, motivo: %q", reason)
	}
}

func TestScenaTerminaleChiudeLoScript(t *testing.T) {
	story := load(t, "../../testdata/mini.ir.json")
	// Lo script si ferma appena entrati nel finale: non e' un fallimento.
	ui := newFake("a:continua", "a:parla_oste", "c:d_chiave", "a:prendi_chiave", "a:esci")
	out := engine.New(story, ui).Run()
	if !out.Ended || out.Quit {
		t.Errorf("il finale doveva chiudere la partita, invece: %+v", out)
	}
}

func TestEffettiApplicatiInOrdine(t *testing.T) {
	st := engine.NewState()
	ui := newFake()
	tr := st.Apply(&ir.Effect{
		Narration:    "testo",
		SetFlag:      "a",
		AddInventory: "oggetto",
		GotoScene:    "altrove",
	}, ui)

	if tr.Kind != engine.TransScene || tr.Target != "altrove" {
		t.Errorf("transizione di scena attesa, trovata %+v", tr)
	}
	if !st.Flags["a"] || !st.HasItem("oggetto") {
		t.Errorf("stato non aggiornato: %v %v", st.SortedFlags(), st.Inventory)
	}
	if len(ui.log) == 0 || ui.log[0] != "narr" {
		t.Errorf("la narrazione doveva precedere i cambi di stato, log: %v", ui.log)
	}
}

func TestGotoSceneInesistenteEUnProblema(t *testing.T) {
	story := load(t, "../../testdata/rotta.ir.json")
	ui := newFake("a:porta_rotta")
	out := engine.New(story, ui).Run()

	if len(out.Problems) == 0 {
		t.Fatalf("un goto verso una scena inesistente doveva essere segnalato")
	}
	if !strings.Contains(out.Problems[0], "scena_inesistente") {
		t.Errorf("il problema doveva citare la scena mancante: %q", out.Problems[0])
	}
}
