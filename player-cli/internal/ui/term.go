package ui

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"zaistory/player-cli/internal/engine"
	"zaistory/player-cli/internal/ir"
	"zaistory/player-cli/internal/resolver"
)

// Term e' il player interattivo su terminale.
//
// Non contiene logica narrativa: mostra quello che l'engine gli passa e
// raccoglie input. Tutti i campi destinati alla generazione asset
// (image_prompt, ambient_sound_prompt, sound_effect_prompt, style_prompt,
// ambient_music_tags) sono ignorati in modalita' normale e mostrati come
// testo in modalita' debug.
type Term struct {
	Story *ir.Story
	Res   resolver.Resolver
	Debug bool
	Width int
	T     *Theme
	Trace func() []string

	in  *bufio.Scanner
	out io.Writer

	// auto disattiva le pause tap-to-continue: lo usa l'esecutore di script
	// di playthrough, che non ha nessuno da aspettare.
	auto bool

	lastPrompt *engine.ActionPrompt
	// lastState tiene l'ultimo stato visto, cosi' i comandi meta funzionano
	// anche durante il tap-to-continue, dove l'engine non passa lo stato.
	lastState *engine.State
}

// NewTerm costruisce il player interattivo.
func NewTerm(story *ir.Story, res resolver.Resolver, debug, color bool, width int) *Term {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	return &Term{
		Story: story,
		Res:   res,
		Debug: debug,
		Width: width,
		T:     NewTheme(color),
		in:    sc,
		out:   os.Stdout,
	}
}

func (t *Term) printf(format string, args ...any) {
	fmt.Fprintf(t.out, format, args...)
}

func (t *Term) line(s string) { fmt.Fprintln(t.out, s) }

func (t *Term) para(s, indent string) {
	t.line(Wrap(s, t.Width, indent))
}

func (t *Term) dbg(format string, args ...any) {
	if !t.Debug {
		return
	}
	t.line(t.T.Mag(Wrap(fmt.Sprintf(format, args...), t.Width, "  · ")))
}

// Intro stampa l'intestazione della partita.
func (t *Term) Intro() {
	t.line("")
	t.line(t.T.Bold(t.Story.Title))
	if t.Story.Description != "" {
		t.para(t.T.Dim(t.Story.Description), "")
	}
	t.line(t.T.Dim(fmt.Sprintf("IR %s · resolver: %s · :aiuto per i comandi", t.Story.IRVersion, t.Res.Name())))
	if t.Debug {
		t.line(t.T.Mag("modalita' debug attiva"))
	}
	t.line("")
}

// ---------------------------------------------------------------- engine.UI

// SceneEnter stampa l'intestazione di scena e, in debug, tutti i suoi parametri.
func (t *Term) SceneEnter(st *engine.State, sc *ir.Scene) {
	t.lastState = st
	t.line("")
	t.line(t.T.Cyan(Rule(sc.Label(), t.Width)))
	if t.Debug {
		t.dumpScene(st, sc)
	}
	t.line("")
}

// Beat mostra un beat di narrazione, con tap-to-continue.
func (t *Term) Beat(sc *ir.Scene, b ir.NarrationBeat, index, total int) error {
	if t.Debug {
		t.dbg("beat %d/%d", index+1, total)
		if b.ImagePrompt != "" {
			t.dbg("image_prompt: %s", b.ImagePrompt)
		}
		if b.SoundEffectPrompt != "" {
			t.dbg("sound_effect_prompt: %s", b.SoundEffectPrompt)
		}
		if b.Voice != nil && b.Voice.StylePrompt != "" {
			t.dbg("voce: %s", b.Voice.StylePrompt)
		}
	}
	t.para(t.T.Italic(b.Text), "  ")
	t.line("")
	return t.pause(sc)
}

// Line mostra una battuta di dialogo.
func (t *Term) Line(sc *ir.Scene, nodeID string, n *ir.DialogueNode) error {
	if t.Debug {
		t.dbg("nodo %s", nodeID)
		if n.VoiceOverride != nil && n.VoiceOverride.StylePrompt != "" {
			t.dbg("voice_override: %s", n.VoiceOverride.StylePrompt)
		}
	}
	name := t.Story.SpeakerName(n.Speaker)
	t.line(t.T.Bold(name + ":"))
	t.para(n.Text, "  ")
	t.line("")
	if len(n.Choices) == 0 {
		return t.pause(sc)
	}
	return nil
}

// Narration mostra la narrazione prodotta da un Effect.
func (t *Term) Narration(text string, v *ir.VoiceSpec) {
	if t.Debug && v != nil && v.StylePrompt != "" {
		t.dbg("voce narrazione: %s", v.StylePrompt)
	}
	t.para(t.T.Italic(text), "  ")
	t.line("")
}

// Sound non riproduce nulla: il player CLI e' puramente testuale.
func (t *Term) Sound(prompt string) { t.dbg("play_sound_prompt: %s", prompt) }

// StateChange annota un cambiamento di stato (solo in debug).
func (t *Term) StateChange(desc string) { t.dbg("stato: %s", desc) }

// Notice e' un messaggio di servizio del player.
func (t *Term) Notice(text string) { t.line(t.T.Dim(Wrap(text, t.Width, "  "))) }

// Problem segnala un bug di giocabilita' dell'IR. Si vede sempre, anche fuori
// dal debug: e' l'informazione per cui questo player esiste.
func (t *Term) Problem(text string) {
	t.line(t.T.Red(Wrap("[! IR] "+text, t.Width, "")))
}

// ChooseAction mostra le azioni contestuali e raccoglie la scelta.
func (t *Term) ChooseAction(p engine.ActionPrompt) (engine.Command, error) {
	t.lastPrompt = &p
	t.lastState = p.State
	for {
		t.line(t.T.Dim(Rule("", t.Width)))
		for i, a := range p.Available {
			t.line(fmt.Sprintf("  %s %s", t.T.Green(fmt.Sprintf("%d)", i+1)), a.Label))
			if t.Debug {
				t.dbg("id: %s · condizione: %s · effetto: %s · repeatable: %v",
					a.ID, engine.DescribeCondition(a.Condition), engine.DescribeEffect(a.Effect), a.IsRepeatable())
			}
		}
		if t.Debug && len(p.Hidden) > 0 {
			t.line(t.T.Mag("  azioni nascoste:"))
			for _, h := range p.Hidden {
				t.line(t.T.Mag(fmt.Sprintf("    × %s [%s]", h.Action.Label, h.Action.ID)))
				t.dbg("  nascosta perche': %s", h.Reason)
				t.dbg("  effetto: %s", engine.DescribeEffect(h.Action.Effect))
			}
		}
		if p.Terminal {
			t.line(t.T.Dim("  (scena finale: da qui non esce nessuna transizione — :esci per chiudere)"))
		}

		input, err := t.read("> ")
		if err != nil {
			return engine.Command{}, err
		}
		if handled, cmd := t.meta(input, p.State, p.Scene); handled {
			if cmd.Quit {
				return cmd, nil
			}
			continue
		}

		cands := make([]resolver.Candidate, 0, len(p.Available))
		for _, a := range p.Available {
			cands = append(cands, resolver.Candidate{ID: a.ID, Label: a.Label, Target: a.Target, Aliases: a.Aliases})
		}
		res, err := t.Res.Resolve(context.Background(), resolver.Request{
			Candidates: cands,
			Input:      input,
			Tone:       t.Story.Tone(p.Scene),
		})
		if err != nil {
			t.Notice("resolver: " + err.Error())
			continue
		}
		if res.Matched() {
			return engine.Command{ActionID: res.ActionID}, nil
		}
		if res.Fallback != "" {
			t.para(t.T.Italic(res.Fallback), "  ")
		}
	}
}

// ChooseChoice mostra le scelte di dialogo disponibili.
func (t *Term) ChooseChoice(p engine.ChoicePrompt) (engine.Command, error) {
	t.lastState = p.State
	for {
		for i, c := range p.Available {
			t.line(fmt.Sprintf("  %s %s", t.T.Green(fmt.Sprintf("%d)", i+1)), c.Text))
			if t.Debug {
				t.dbg("-> nodo %s · condizione: %s · effetto: %s",
					c.Goto, engine.DescribeCondition(c.Condition), engine.DescribeEffect(c.Effect))
			}
		}
		if t.Debug && len(p.Hidden) > 0 {
			t.line(t.T.Mag("  scelte nascoste:"))
			for _, h := range p.Hidden {
				t.line(t.T.Mag("    × " + h.Choice.Text))
				t.dbg("  nascosta perche': %s", h.Reason)
			}
		}

		input, err := t.read("> ")
		if err != nil {
			return engine.Command{}, err
		}
		if handled, cmd := t.meta(input, p.State, p.Scene); handled {
			if cmd.Quit {
				return cmd, nil
			}
			continue
		}
		if n, err := strconv.Atoi(strings.TrimSpace(input)); err == nil && n >= 1 && n <= len(p.Available) {
			return engine.Command{ChoiceIndex: n - 1}, nil
		}
		t.Notice("Scegli il numero di una delle battute elencate.")
	}
}

// Finish stampa il riepilogo di fine partita.
func (t *Term) Finish(o engine.Outcome) {
	t.line("")
	t.line(t.T.Cyan(Rule("fine", t.Width)))
	t.line("  " + o.Reason)
	t.line(t.T.Dim(fmt.Sprintf("  scena finale: %s · passi: %d", o.Scene, o.Steps)))
	if len(o.Problems) > 0 {
		t.line(t.T.Red(fmt.Sprintf("  problemi di giocabilita' incontrati: %d", len(o.Problems))))
		for _, p := range o.Problems {
			t.line(t.T.Red("   - " + p))
		}
	}
	t.line("")
}

// ------------------------------------------------------------------ interni

func (t *Term) read(prompt string) (string, error) {
	t.printf("%s", t.T.Bold(prompt))
	if !t.in.Scan() {
		if err := t.in.Err(); err != nil {
			return "", err
		}
		t.line("")
		return "", engine.ErrQuit
	}
	return t.in.Text(), nil
}

// pause e' il tap-to-continue. Anche qui i comandi meta funzionano: capita
// sempre di volere il debug proprio mentre scorre la narrazione.
func (t *Term) pause(sc *ir.Scene) error {
	if t.auto {
		return nil
	}
	for {
		input, err := t.read(t.T.Dim("[invio] "))
		if err != nil {
			return err
		}
		if strings.TrimSpace(input) == "" {
			return nil
		}
		if handled, cmd := t.meta(input, nil, sc); handled {
			if cmd.Quit {
				return engine.ErrQuit
			}
			continue
		}
		return nil
	}
}

// meta gestisce i comandi che iniziano con ':'. Ritorna (gestito, comando).
func (t *Term) meta(input string, st *engine.State, sc *ir.Scene) (bool, engine.Command) {
	s := strings.TrimSpace(input)
	if !strings.HasPrefix(s, ":") {
		return false, engine.Command{}
	}
	if st == nil {
		st = t.lastState
	}
	switch strings.ToLower(strings.Fields(s)[0]) {
	case ":aiuto", ":help", ":?":
		t.help()
	case ":debug":
		t.Debug = !t.Debug
		if t.Debug {
			t.line(t.T.Mag("debug ON"))
			if sc != nil && st != nil {
				t.dumpScene(st, sc)
			}
		} else {
			t.line(t.T.Mag("debug OFF"))
		}
	case ":stato":
		t.dumpState(st)
	case ":flag", ":flags":
		t.dumpFlags(st)
	case ":inv", ":inventario":
		t.dumpInventory(st)
	case ":scena":
		if sc != nil {
			t.dumpScene(st, sc)
		}
	case ":storico":
		t.dumpHistory(st)
	case ":azioni":
		t.dumpActions(st, sc)
	case ":traccia":
		t.dumpTrace()
	case ":esci", ":quit", ":q":
		return true, engine.Command{Quit: true}
	default:
		t.Notice("comando sconosciuto: " + s + " (:aiuto per l'elenco)")
	}
	return true, engine.Command{}
}

func (t *Term) help() {
	t.line(t.T.Dim(`  comandi:
    :debug      mostra/nasconde i parametri di scena e le azioni nascoste
    :stato      flag, inventario, scena corrente, storico
    :flag       solo i flag attivi
    :inv        solo l'inventario
    :scena      i parametri della scena corrente
    :storico    le scene visitate in ordine
    :azioni     TUTTE le azioni della scena, comprese quelle filtrate
    :traccia    la sequenza di id giocata finora (rigiocabile con --script)
    :esci       abbandona la partita`))
}

func (t *Term) dumpState(st *engine.State) {
	if st == nil {
		return
	}
	t.line(t.T.Yellow("  stato:"))
	t.line(fmt.Sprintf("    scena corrente: %s", st.Scene))
	t.dumpFlags(st)
	t.dumpInventory(st)
	t.dumpHistory(st)
}

func (t *Term) dumpFlags(st *engine.State) {
	if st == nil {
		return
	}
	f := st.SortedFlags()
	if len(f) == 0 {
		t.line(t.T.Yellow("    flag: nessuno"))
		return
	}
	t.line(t.T.Yellow("    flag: ") + strings.Join(f, ", "))
}

func (t *Term) dumpInventory(st *engine.State) {
	if st == nil {
		return
	}
	if len(st.Inventory) == 0 {
		t.line(t.T.Yellow("    inventario: vuoto"))
		return
	}
	t.line(t.T.Yellow("    inventario: ") + strings.Join(st.Inventory, ", "))
}

func (t *Term) dumpHistory(st *engine.State) {
	if st == nil || len(st.History) == 0 {
		return
	}
	t.line(t.T.Yellow("    scene visitate: ") + strings.Join(st.History, " → "))
}

func (t *Term) dumpTrace() {
	if t.Trace == nil {
		return
	}
	tr := t.Trace()
	if len(tr) == 0 {
		t.line(t.T.Yellow("    traccia: vuota"))
		return
	}
	t.line(t.T.Yellow("    traccia (una riga per passo):"))
	for _, tok := range tr {
		t.line("      " + tok)
	}
}

// dumpScene stampa i parametri della scena: e' il cuore della modalita' debug.
func (t *Term) dumpScene(st *engine.State, sc *ir.Scene) {
	if sc == nil {
		return
	}
	p := func(k, v string) {
		if v == "" {
			return
		}
		t.line(t.T.Mag(Wrap(k+": "+v, t.Width, "  ")))
	}
	p("id", sc.ID)
	p("title", sc.Title)
	p("scene_type", sc.Type())
	tone := sc.SceneTone
	if tone == "" {
		tone = t.Story.Tone(sc) + " (default globale)"
	}
	p("scene_tone", tone)
	if sc.Background != nil {
		p("background.image_prompt", sc.Background.ImagePrompt)
		p("background.ambient_sound_prompt", sc.Background.AmbientSoundPrompt)
	}
	if len(sc.Characters) > 0 {
		var names []string
		for _, c := range sc.Characters {
			n := c.ID
			if g, ok := t.Story.Character(c.ID); ok && g.Name != "" {
				n = fmt.Sprintf("%s (%s)", g.Name, c.ID)
			} else {
				n = c.ID + " [non nella roster globale]"
			}
			names = append(names, n)
		}
		p("personaggi in scena", strings.Join(names, ", "))
	}
	if len(sc.OnEnterFlagsSet) > 0 {
		p("on_enter_flags_set", strings.Join(sc.OnEnterFlagsSet, ", "))
	}
	if sc.DialogueTree != nil {
		p("dialogue_tree", fmt.Sprintf("start=%s, %d nodi", sc.DialogueTree.Start, len(sc.DialogueTree.Nodes)))
	}
	p("narrazione", fmt.Sprintf("%d beat", len(sc.Narration)))
	t.dumpActions(st, sc)
}

// dumpActions elenca TUTTE le azioni della scena, comprese quelle attualmente
// filtrate, con id, condizione, effetto e motivo dell'esclusione.
func (t *Term) dumpActions(st *engine.State, sc *ir.Scene) {
	if sc == nil {
		return
	}
	t.line(t.T.Mag(fmt.Sprintf("  azioni della scena (%d):", len(sc.Actions))))
	for i := range sc.Actions {
		a := &sc.Actions[i]
		mark := t.T.Green("✓")
		why := ""
		if st != nil {
			if !a.IsRepeatable() && st.Consumed(sc.ID, a.ID) {
				mark = t.T.Red("×")
				why = " — gia' usata (repeatable: false)"
			} else if ok, reason := st.Meets(a.Condition); !ok {
				mark = t.T.Red("×")
				why = " — " + reason
			}
		}
		t.line(fmt.Sprintf("   %s [%s] %s%s", mark, a.ID, a.Label, t.T.Dim(why)))
		t.line(t.T.Mag(fmt.Sprintf("       condizione: %s · effetto: %s",
			engine.DescribeCondition(a.Condition), engine.DescribeEffect(a.Effect))))
	}
}
