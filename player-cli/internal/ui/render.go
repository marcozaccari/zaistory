// Package ui contiene le due implementazioni di engine.UI: il terminale
// interattivo e l'esecutore di script di playthrough.
package ui

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/mattn/go-runewidth"
)

// Theme raccoglie i codici ANSI, spenti tutti insieme quando non si vuole
// colore (pipe, NO_COLOR, flag esplicito).
type Theme struct {
	enabled bool
}

// NewTheme decide se colorare: mai se color è false, mai se NO_COLOR è
// impostato, mai se lo stdout non è un terminale.
func NewTheme(color bool) *Theme {
	t := Theme{}

	if !color {
		return &t
	}
	if os.Getenv("NO_COLOR") != "" {
		return &t
	}
	if fi, err := os.Stdout.Stat(); err == nil && (fi.Mode()&os.ModeCharDevice) == 0 {
		return &t
	}

	t.enabled = true
	return &t
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
func (t *Theme) Blue(s string) string   { return t.wrap("34", s) }
func (t *Theme) White(s string) string  { return t.wrap("37", s) }

// Bright
func (t *Theme) Gray(s string) string         { return t.wrap("90", s) }
func (t *Theme) BrightRed(s string) string    { return t.wrap("91", s) }
func (t *Theme) BrightGreen(s string) string  { return t.wrap("92", s) }
func (t *Theme) BrightYellow(s string) string { return t.wrap("93", s) }
func (t *Theme) BrightBlue(s string) string   { return t.wrap("94", s) }
func (t *Theme) BrightMag(s string) string    { return t.wrap("95", s) }
func (t *Theme) BrightCyan(s string) string   { return t.wrap("96", s) }
func (t *Theme) BrightWhite(s string) string  { return t.wrap("97", s) }

var ansiRE = regexp.MustCompile(
	`\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))`,
)

// VisibleWidth restituisce il numero di colonne occupate da una stringa
// nel terminale, ignorando i codici ANSI.
func VisibleWidth(s string) int {
	s = ansiRE.ReplaceAllString(s, "")
	return runewidth.StringWidth(s)
}

// Wrap manda a capo un testo alla larghezza data, preservando i codici ANSI,
// i caratteri Unicode e i paragrafi. Gli ANSI non consumano colonne e non
// vengono mai spezzati.
//
// Il wrap avviene sugli spazi, come strings.Fields, ma senza perdere le
// sequenze ANSI presenti nel testo.
func Wrap(text string, width int, indent string) string {
	if width <= 0 {
		width = 80
	}

	limit := width - VisibleWidth(indent)
	if limit < 20 {
		limit = 20
	}

	var out []string

	for _, para := range strings.Split(text, "\n") {
		lines := wrapTokens(para, limit)

		if len(lines) == 0 {
			out = append(out, "")
			continue
		}

		for _, line := range lines {
			out = append(out, indent+line)
		}
	}

	return strings.Join(out, "\n")
}

// wrapTokens esegue il word-wrap preservando integralmente le sequenze ANSI.
// Le sequenze ANSI hanno larghezza zero e possono attraversare un cambio riga.
func wrapTokens(text string, limit int) []string {
	var lines []string
	var line strings.Builder
	lineWidth := 0

	// pending contiene ANSI incontrati dopo l'ultimo spazio.
	// Vengono mantenuti insieme alla parola successiva.
	var pending strings.Builder

	flush := func() {
		if line.Len() > 0 {
			lines = append(lines, line.String())
			line.Reset()
			lineWidth = 0
		}
	}

	// Aggiunge una parola completa alla riga corrente.
	addWord := func(word string, wordWidth int) {
		if lineWidth > 0 && lineWidth+1+wordWidth > limit {
			flush()
		}

		if lineWidth > 0 {
			line.WriteByte(' ')
			lineWidth++
		}

		line.WriteString(word)
		lineWidth += wordWidth
	}

	var word strings.Builder
	wordWidth := 0

	flushWord := func() {
		if word.Len() == 0 {
			return
		}

		if pending.Len() > 0 {
			wordStr := pending.String() + word.String()
			pending.Reset()
			addWord(wordStr, wordWidth)
		} else {
			addWord(word.String(), wordWidth)
		}

		word.Reset()
		wordWidth = 0
	}

	// Scansiona il testo separando ANSI, whitespace e testo.
	for len(text) > 0 {
		loc := ansiRE.FindStringIndex(text)

		// Nessun ANSI restante: il resto è testo normale.
		if loc == nil {
			for len(text) > 0 {
				r, size := utf8.DecodeRuneInString(text)

				if r == ' ' || r == '\t' {
					flushWord()
					text = text[size:]
					continue
				}

				word.WriteString(text[:size])
				wordWidth += runewidth.RuneWidth(r)
				text = text[size:]
			}
			break
		}

		// Testo prima dell'ANSI.
		if loc[0] > 0 {
			part := text[:loc[0]]

			for len(part) > 0 {
				r, size := utf8.DecodeRuneInString(part)

				if r == ' ' || r == '\t' {
					flushWord()
					part = part[size:]
					continue
				}

				word.WriteString(part[:size])
				wordWidth += runewidth.RuneWidth(r)
				part = part[size:]
			}
		}

		// ANSI: atomico e zero-width.
		seq := text[loc[0]:loc[1]]

		if word.Len() == 0 {
			pending.WriteString(seq)
		} else {
			word.WriteString(seq)
		}

		text = text[loc[1]:]
	}

	flushWord()
	flush()

	return lines
}

// Rule disegna una riga separatrice con un titolo opzionale.
// La larghezza del titolo tiene conto sia dei codici ANSI sia della
// larghezza reale dei caratteri Unicode nel terminale.
func Rule(title string, width int) string {
	if width <= 0 {
		width = 80
	}

	if title == "" {
		return strings.Repeat("─", width)
	}

	head := "── " + title + " "
	n := width - VisibleWidth(head)

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
