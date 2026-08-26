// Package resolver definisce l'interfaccia del resolver e i suoi backend.
//
// L'interfaccia e' fissata dall'architettura: riceve le azioni disponibili
// nella scena, il testo libero del giocatore e il tono della scena, e ritorna
// l'id di un'azione *gia' esistente* oppure nessun match con una narrazione di
// fallback in-character.
//
// Vincolo non negoziabile: un resolver non genera mai un effetto di sua
// iniziativa, sceglie solo quale azione gia' definita eseguire. E' l'
// equivalente moderno del "Non puoi farlo" dei punta-e-clicca: coerente col
// tono della scena, ma senza alcun potere sullo stato del gioco.
package resolver

import "context"

// Candidate e' un'azione tra cui il resolver puo' scegliere.
type Candidate struct {
	ID      string
	Label   string
	Target  string
	Aliases []string
}

// Request e' l'input del resolver.
type Request struct {
	Candidates []Candidate
	Input      string
	Tone       string
}

// Result e' l'output del resolver: o un id di azione esistente, o niente.
type Result struct {
	ActionID string // "" = nessun match
	Fallback string // narrazione in-character da mostrare quando ActionID e' vuoto
}

// Matched dice se il resolver ha trovato un'azione.
func (r Result) Matched() bool { return r.ActionID != "" }

// Resolver e' il contratto comune ai tre backend previsti (menu, Claude,
// modello locale offline). Il resto del player non cambia al variare del
// backend: si sceglie all'avvio e basta.
type Resolver interface {
	// Name e' il nome mostrato all'avvio.
	Name() string
	// AcceptsFreeText dice se il backend sa interpretare frasi libere.
	// Il backend a menu risponde false: accetta solo numeri ed etichette.
	AcceptsFreeText() bool
	// Resolve sceglie un'azione tra i candidati.
	Resolve(ctx context.Context, req Request) (Result, error)
}
