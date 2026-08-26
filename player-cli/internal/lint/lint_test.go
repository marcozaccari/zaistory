package lint_test

import (
	"strings"
	"testing"

	"zaistory/player-cli/internal/ir"
	"zaistory/player-cli/internal/lint"
)

func run(t *testing.T, path string) []lint.Finding {
	t.Helper()
	story, err := ir.Load(path)
	if err != nil {
		t.Fatalf("caricamento %s: %v", path, err)
	}
	return lint.Run(story)
}

func contains(fs []lint.Finding, lv lint.Level, frag string) bool {
	for _, f := range fs {
		if f.Level == lv && strings.Contains(f.Msg+" "+f.Where, frag) {
			return true
		}
	}
	return false
}

func TestStoriaSanaNonHaErrori(t *testing.T) {
	fs := run(t, "../../testdata/mini.ir.json")
	errs, _, _ := lint.Counts(fs)
	if errs != 0 {
		for _, f := range fs {
			if f.Level == lint.Error {
				t.Errorf("errore inatteso: %s", f)
			}
		}
	}
}

func TestStoriaRottaTrovaTuttiIDifetti(t *testing.T) {
	fs := run(t, "../../testdata/rotta.ir.json")

	casi := []struct {
		nome  string
		level lint.Level
		frag  string
	}{
		{"goto_scene verso scena inesistente", lint.Error, "scena_inesistente"},
		{"oggetto mai dato", lint.Error, "chiave_mai_data"},
		{"flag mai impostato", lint.Error, "flag_mai_impostato"},
		{"scelta verso nodo inesistente", lint.Error, "d_inesistente"},
		{"nodo monco", lint.Error, "nodo monco"},
		{"nodo irraggiungibile", lint.Warn, "irraggiungibile"},
		{"dialogo senza ingresso", lint.Warn, "goto_dialogue"},
	}
	for _, c := range casi {
		if !contains(fs, c.level, c.frag) {
			t.Errorf("il linter non ha trovato: %s (cercavo %q come %s)", c.nome, c.frag, c.level)
		}
	}

	errs, _, _ := lint.Counts(fs)
	if errs == 0 {
		t.Errorf("una storia rotta deve produrre errori")
	}
}
