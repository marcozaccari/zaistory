// Package ui contiene le due implementazioni di engine.UI: il terminale
// interattivo e l'esecutore di script di playthrough.
package ui

import (
	"os"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Theme raccoglie i codici ANSI, spenti tutti insieme quando non si vuole
// colore (pipe, NO_COLOR, flag esplicito).
type Theme struct {
	enabled bool
}

// NewTheme decide se colorare: mai se color e' false, mai se NO_COLOR e'
// impostato, mai se lo stdout non e' un terminale.
func NewTheme(color bool) *Theme {
	if !color {
		return &Theme{}
	}
	if os.Getenv("NO_COLOR") != "" {
		return &Theme{}
	}
	if fi, err := os.Stdout.Stat(); err == nil && (fi.Mode()&os.ModeCharDevice) == 0 {
		return &Theme{}
	}
	return &Theme{enabled: true}
}

func (t *Theme) wrap(code, s string) string {
	if !t.enabled || s == "" {
		return s
	}
	return "\x1b[" + code + "m" + s + "\x1b[0m"
}

func (t *Theme) Bold(s string) string   { return t.wrap("1", s) }
func (t *Theme) Dim(s string) string    { return t.wrap("2", s) }
func (t *Theme) Italic(s string) string { return t.wrap("3", s) }
func (t *Theme) Cyan(s string) string   { return t.wrap("36", s) }
func (t *Theme) Yellow(s string) string { return t.wrap("33", s) }
func (t *Theme) Green(s string) string  { return t.wrap("32", s) }
func (t *Theme) Red(s string) string    { return t.wrap("31", s) }
func (t *Theme) Mag(s string) string    { return t.wrap("35", s) }

// Wrap manda a capo un testo alla larghezza data, preservando i paragrafi e
// applicando un rientro a ogni riga.
func Wrap(text string, width int, indent string) string {
	if width <= 0 {
		width = 80
	}
	limit := width - utf8.RuneCountInString(indent)
	if limit < 20 {
		limit = 20
	}

	var out []string
	for _, para := range strings.Split(text, "\n") {
		words := strings.Fields(para)
		if len(words) == 0 {
			out = append(out, "")
			continue
		}
		line := words[0]
		for _, w := range words[1:] {
			if utf8.RuneCountInString(line)+1+utf8.RuneCountInString(w) > limit {
				out = append(out, indent+line)
				line = w
				continue
			}
			line += " " + w
		}
		out = append(out, indent+line)
	}
	return strings.Join(out, "\n")
}

// Rule disegna una riga separatrice con un titolo opzionale.
func Rule(title string, width int) string {
	if width <= 0 {
		width = 80
	}
	if title == "" {
		return strings.Repeat("─", width)
	}
	head := "── " + title + " "
	n := width - utf8.RuneCountInString(head)
	if n < 0 {
		n = 0
	}
	return head + strings.Repeat("─", n)
}

// TermWidth legge la larghezza dal terminale, con default 80.
func TermWidth() int {
	if c := os.Getenv("COLUMNS"); c != "" {
		if n, err := strconv.Atoi(c); err == nil && n > 40 {
			return n
		}
	}
	return 80
}
