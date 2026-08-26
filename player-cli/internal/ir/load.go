package ir

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// Load legge un file story.ir.json.
//
// La lettura e' volutamente severa: qualunque campo non previsto dallo schema
// fa fallire il caricamento. E' la stessa rete di sicurezza di
// `additionalProperties: false` lato JSON Schema, e serve allo stesso scopo -
// un campo plausibile ma inventato dal compilatore va scartato, non accettato
// in silenzio.
func Load(path string) (*Story, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(raw)
}

// Parse legge un IR da byte gia' in memoria.
func Parse(raw []byte) (*Story, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()

	var s Story
	if err := dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("IR non conforme allo schema: %w", err)
	}

	if err := s.check(); err != nil {
		return nil, err
	}
	return &s, nil
}

// check verifica i vincoli strutturali minimi senza i quali il player non puo'
// nemmeno partire. Non e' il linter di giocabilita': quello sta in un package
// separato e va molto piu' a fondo.
func (s *Story) check() error {
	if s.IRVersion == "" {
		return fmt.Errorf("manca ir_version")
	}
	if s.StartScene == "" {
		return fmt.Errorf("manca start_scene")
	}
	if len(s.Scenes) == 0 {
		return fmt.Errorf("la storia non ha scene")
	}

	seen := map[string]bool{}
	for i, sc := range s.Scenes {
		if sc.IsRef() {
			return fmt.Errorf("scenes[%d]: le scene su file esterno (\"ref\": %q) non sono supportate dal player CLI; oggi si lavora con IR a scene inline", i, sc.Ref)
		}
		if sc.ID == "" {
			return fmt.Errorf("scenes[%d]: manca id", i)
		}
		if seen[sc.ID] {
			return fmt.Errorf("id di scena duplicato: %q", sc.ID)
		}
		seen[sc.ID] = true
	}
	if _, ok := s.Scene(s.StartScene); !ok {
		return fmt.Errorf("start_scene %q non corrisponde a nessuna scena", s.StartScene)
	}
	return nil
}

// Scene ritorna la scena con l'id dato.
func (s *Story) Scene(id string) (*Scene, bool) {
	for i := range s.Scenes {
		if s.Scenes[i].ID == id {
			return &s.Scenes[i], true
		}
	}
	return nil, false
}

// Character ritorna il personaggio globale con l'id dato.
//
// Un id assente non e' un errore: per scelta architetturale i personaggi
// occasionali (voci fuori campo, comparse) non stanno nella roster globale e
// compaiono solo come stringa nel campo speaker.
func (s *Story) Character(id string) (*Character, bool) {
	for i := range s.Characters {
		if s.Characters[i].ID == id {
			return &s.Characters[i], true
		}
	}
	return nil, false
}

// SpeakerName ritorna l'etichetta da mostrare per uno speaker di dialogo.
func (s *Story) SpeakerName(speaker string) string {
	if speaker == "narrator" {
		return "Narratore"
	}
	if c, ok := s.Character(speaker); ok {
		return c.DisplayName()
	}
	return speaker
}

// Tone ritorna il tono da passare al resolver per una scena: quello locale se
// c'e', altrimenti il default globale.
func (s *Story) Tone(sc *Scene) string {
	if sc != nil && sc.SceneTone != "" {
		return sc.SceneTone
	}
	if s.GlobalStyle != nil {
		return s.GlobalStyle.DefaultTone
	}
	return ""
}

// Action ritorna l'azione con l'id dato dentro una scena.
func (sc *Scene) Action(id string) (*Action, bool) {
	for i := range sc.Actions {
		if sc.Actions[i].ID == id {
			return &sc.Actions[i], true
		}
	}
	return nil, false
}

// Node ritorna un nodo del dialogue tree della scena.
func (sc *Scene) Node(id string) (*DialogueNode, bool) {
	if sc.DialogueTree == nil {
		return nil, false
	}
	n, ok := sc.DialogueTree.Nodes[id]
	if !ok {
		return nil, false
	}
	return &n, true
}

// NodeIDs ritorna gli id dei nodi di dialogo in ordine stabile (per il debug).
func (sc *Scene) NodeIDs() []string {
	if sc.DialogueTree == nil {
		return nil
	}
	ids := make([]string, 0, len(sc.DialogueTree.Nodes))
	for id := range sc.DialogueTree.Nodes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Label ritorna l'etichetta di scena da mostrare in debug.
func (sc *Scene) Label() string {
	if sc.Title != "" {
		return fmt.Sprintf("%s (%s)", sc.Title, sc.ID)
	}
	return sc.ID
}
