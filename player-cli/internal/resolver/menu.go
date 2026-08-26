package resolver

import (
	"context"
	"strconv"
	"strings"
)

// Menu e' il backend 1: selezione a menu numerato.
//
// Deterministico, zero dipendenze, nessuna rete: e' la modalita' da usare per
// i test di regressione e l'unica su cui si possa fondare uno script di
// playthrough rigiocabile.
type Menu struct{}

// NewMenu costruisce il resolver a menu.
func NewMenu() *Menu { return &Menu{} }

// Name implementa Resolver.
func (m *Menu) Name() string { return "menu (deterministico, nessun LLM)" }

// AcceptsFreeText implementa Resolver.
func (m *Menu) AcceptsFreeText() bool { return false }

// Resolve accetta il numero della voce, l'id dell'azione o la sua etichetta
// esatta (senza distinzione di maiuscole). Qualunque altra cosa non e' un
// match: nessun tentativo di indovinare, che e' esattamente il compito degli
// altri backend.
func (m *Menu) Resolve(_ context.Context, req Request) (Result, error) {
	in := strings.TrimSpace(req.Input)
	if in == "" {
		return Result{}, nil
	}

	if n, err := strconv.Atoi(in); err == nil {
		if n >= 1 && n <= len(req.Candidates) {
			return Result{ActionID: req.Candidates[n-1].ID}, nil
		}
		return Result{Fallback: "Non c'e' nessuna voce con quel numero."}, nil
	}

	low := strings.ToLower(in)
	for _, c := range req.Candidates {
		if strings.ToLower(c.ID) == low || strings.ToLower(c.Label) == low {
			return Result{ActionID: c.ID}, nil
		}
	}
	return Result{Fallback: "Scegli il numero di una delle azioni elencate (oppure :aiuto)."}, nil
}
