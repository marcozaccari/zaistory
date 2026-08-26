package ui

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"

	"zaistory/player-cli/internal/engine"
	"zaistory/player-cli/internal/ir"
	"zaistory/player-cli/internal/resolver"
)

// Script rigioca una partita descritta da una sequenza di id, senza alcun
// input umano.
//
// Poiche' il resolver puo' solo scegliere tra azioni gia' definite, una
// partita e' interamente descritta dalla sequenza di id di azione/scelta: e'
// questo che rende possibile usare un playthrough come test di regressione su
// una storia.
//
// Formato del file (una voce per riga, righe vuote e '#' ignorati):
//
//	a:prendi_chiave   azione per id
//	c:nodo_risposta   scelta di dialogo, per id del nodo di destinazione
//	3                 la terza voce dell'elenco corrente
//	prendi_chiave     forma abbreviata, equivale a a:prendi_chiave
type Script struct {
	*Term
	tokens []string
	pos    int
	Strict bool
}

// NewScript costruisce l'esecutore di script. Riusa il rendering del player
// interattivo: il transcript prodotto e' identico a una partita giocata a
// mano, il che lo rende leggibile in una diff.
func NewScript(story *ir.Story, tokens []string, debug, color bool, width int) *Script {
	t := NewTerm(story, resolver.NewMenu(), debug, color, width)
	t.auto = true
	return &Script{Term: t, tokens: tokens, Strict: true}
}

// LoadScript legge un file di playthrough.
func LoadScript(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var toks []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if i := strings.Index(line, "#"); i >= 0 {
			line = strings.TrimSpace(line[:i])
		}
		if line == "" {
			continue
		}
		toks = append(toks, line)
	}
	return toks, sc.Err()
}

func (s *Script) next() (string, bool) {
	if s.pos >= len(s.tokens) {
		return "", false
	}
	tok := s.tokens[s.pos]
	s.pos++
	return tok, true
}

// ChooseAction consuma il prossimo token dello script come azione.
func (s *Script) ChooseAction(p engine.ActionPrompt) (engine.Command, error) {
	tok, ok := s.next()
	if !ok {
		return engine.Command{}, engine.ErrScriptEnded
	}
	want := strings.TrimPrefix(tok, "a:")
	if strings.HasPrefix(tok, "c:") {
		return engine.Command{}, fmt.Errorf("passo %d: lo script chiede la scelta di dialogo %q ma il gioco chiede un'azione di scena (scena %s)", s.pos, want, p.Scene.ID)
	}

	if n, err := strconv.Atoi(want); err == nil {
		if n >= 1 && n <= len(p.Available) {
			s.echo(fmt.Sprintf("%d) %s [%s]", n, p.Available[n-1].Label, p.Available[n-1].ID))
			return engine.Command{ActionID: p.Available[n-1].ID}, nil
		}
		return engine.Command{}, fmt.Errorf("passo %d: indice %d fuori dalle %d azioni disponibili nella scena %s", s.pos, n, len(p.Available), p.Scene.ID)
	}

	for i, a := range p.Available {
		if a.ID == want {
			s.echo(fmt.Sprintf("%d) %s [%s]", i+1, a.Label, a.ID))
			return engine.Command{ActionID: a.ID}, nil
		}
	}

	// Distinguere "azione inesistente" da "azione esistente ma nascosta" e' la
	// differenza tra un refuso nello script e una regressione nella storia.
	if a, exists := p.Scene.Action(want); exists {
		why := "condizione non soddisfatta"
		for _, h := range p.Hidden {
			if h.Action.ID == want {
				why = h.Reason
			}
		}
		return engine.Command{}, fmt.Errorf("passo %d: l'azione %q esiste nella scena %s ma non e' disponibile: %s (label: %q)", s.pos, want, p.Scene.ID, why, a.Label)
	}
	return engine.Command{}, fmt.Errorf("passo %d: nessuna azione %q nella scena %s (disponibili: %s)", s.pos, want, p.Scene.ID, idsOf(p.Available))
}

// ChooseChoice consuma il prossimo token dello script come scelta di dialogo.
func (s *Script) ChooseChoice(p engine.ChoicePrompt) (engine.Command, error) {
	tok, ok := s.next()
	if !ok {
		return engine.Command{}, engine.ErrScriptEnded
	}
	want := strings.TrimPrefix(strings.TrimPrefix(tok, "c:"), "a:")

	if n, err := strconv.Atoi(want); err == nil {
		if n >= 1 && n <= len(p.Available) {
			s.echo(fmt.Sprintf("%d) %s", n, p.Available[n-1].Text))
			return engine.Command{ChoiceIndex: n - 1}, nil
		}
		return engine.Command{}, fmt.Errorf("passo %d: indice %d fuori dalle %d scelte disponibili nel nodo %s", s.pos, n, len(p.Available), p.NodeID)
	}

	for i, c := range p.Available {
		if c.Goto == want {
			s.echo(fmt.Sprintf("%d) %s", i+1, c.Text))
			return engine.Command{ChoiceIndex: i}, nil
		}
	}
	var gotos []string
	for _, c := range p.Available {
		gotos = append(gotos, c.Goto)
	}
	return engine.Command{}, fmt.Errorf("passo %d: nessuna scelta verso %q nel nodo %s (disponibili: %s)", s.pos, want, p.NodeID, strings.Join(gotos, ", "))
}

// Finish stampa il riepilogo e segnala i token non consumati.
func (s *Script) Finish(o engine.Outcome) {
	s.Term.Finish(o)
	if s.pos < len(s.tokens) {
		s.line(s.T.Yellow(fmt.Sprintf("  attenzione: %d passi dello script non sono stati usati (la storia e' finita prima)", len(s.tokens)-s.pos)))
	}
}

func (s *Script) echo(what string) {
	s.line(s.T.Green("> " + what))
}

func idsOf(as []*ir.Action) string {
	var ids []string
	for _, a := range as {
		ids = append(ids, a.ID)
	}
	if len(ids) == 0 {
		return "nessuna"
	}
	return strings.Join(ids, ", ")
}
