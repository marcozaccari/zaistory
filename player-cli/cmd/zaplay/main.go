// Comando zaplay: player CLI di test per story.ir.json.
//
// Input unico: l'IR. Nessun manifest asset, nessuna immagine, nessuna voce.
// Se una storia arriva dall'inizio alla fine con questo player, il contratto
// tra compilatore e player regge.
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"zaistory/player-cli/internal/engine"
	"zaistory/player-cli/internal/ir"
	"zaistory/player-cli/internal/lint"
	"zaistory/player-cli/internal/resolver"
	"zaistory/player-cli/internal/ui"
)

const usage = `zaplay - player CLI di test per il motore narrativo ZAiStory

  zaplay [opzioni] story.ir.json

Opzioni:
  -debug            parte in modalita' debug (parametri di scena e azioni nascoste)
  -lint             esegue solo l'analisi statica di giocabilita' e esce
  -script FILE      rigioca una sequenza di id senza input umano (test di regressione)
  -record FILE      salva la sequenza di id giocata, rigiocabile con -script
  -resolver NOME    backend del resolver: menu (default), claude, locale
  -no-color         niente colori ANSI
  -width N          larghezza di riga (default: $COLUMNS o 80)

Comandi in gioco: :aiuto, :debug, :stato, :flag, :inv, :scena, :storico,
:azioni, :traccia, :esci

Codici di uscita: 0 tutto bene · 1 problemi di giocabilita' · 2 errore d'uso
`

func main() {
	os.Exit(run())
}

func run() int {
	var (
		debug   = flag.Bool("debug", false, "parte in modalita' debug")
		doLint  = flag.Bool("lint", false, "solo analisi statica")
		script  = flag.String("script", "", "file di playthrough da rigiocare")
		record  = flag.String("record", "", "file su cui salvare la traccia")
		resName = flag.String("resolver", "menu", "backend del resolver")
		noColor = flag.Bool("no-color", false, "niente colori")
		width   = flag.Int("width", 0, "larghezza di riga")
	)
	flag.Usage = func() { fmt.Fprint(os.Stderr, usage) }
	flag.Parse()

	if flag.NArg() != 1 {
		flag.Usage()
		return 2
	}
	path := flag.Arg(0)

	story, err := ir.Load(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "impossibile caricare %s: %v\n", path, err)
		return 2
	}

	w := *width
	if w == 0 {
		w = ui.TermWidth()
	}
	theme := ui.NewTheme(!*noColor)

	findings := lint.Run(story)
	errs, warns, infos := lint.Counts(findings)

	if *doLint {
		printLint(theme, findings, errs, warns, infos)
		if errs > 0 {
			return 1
		}
		return 0
	}

	res, err := makeResolver(*resName)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}

	var (
		term *ui.Term
		e    *engine.Engine
	)
	if *script != "" {
		toks, err := ui.LoadScript(*script)
		if err != nil {
			fmt.Fprintf(os.Stderr, "impossibile leggere lo script %s: %v\n", *script, err)
			return 2
		}
		s := ui.NewScript(story, toks, *debug, !*noColor, w)
		term = s.Term
		e = engine.New(story, s)
	} else {
		term = ui.NewTerm(story, res, *debug, !*noColor, w)
		e = engine.New(story, term)
	}
	term.Trace = func() []string { return traceOf(e) }

	term.Intro()
	if errs > 0 || warns > 0 {
		fmt.Println(theme.Yellow(fmt.Sprintf("linter: %d errori, %d avvisi (dettagli con -lint)", errs, warns)))
	}

	out := e.Run()

	if *record != "" {
		if err := os.WriteFile(*record, []byte(renderTrace(out.Trace)), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "impossibile salvare la traccia: %v\n", err)
			return 2
		}
		fmt.Println(theme.Dim("traccia salvata in " + *record))
	}

	if len(out.Problems) > 0 {
		return 1
	}
	if *script != "" && !out.Ended && !out.Quit {
		// In modalita' non interattiva un playthrough che non arriva a un
		// finale e' un fallimento del test, non una partita interrotta.
		return 1
	}
	return 0
}

func makeResolver(name string) (resolver.Resolver, error) {
	switch strings.ToLower(name) {
	case "menu", "":
		return resolver.NewMenu(), nil
	case "claude":
		return nil, fmt.Errorf("il backend resolver %q e' previsto dall'architettura ma non ancora implementato: per ora usa -resolver menu", name)
	case "locale", "local", "slm":
		return nil, fmt.Errorf("il backend resolver %q (modello locale offline) e' previsto dall'architettura ma non ancora implementato: per ora usa -resolver menu", name)
	default:
		return nil, fmt.Errorf("resolver sconosciuto %q (menu, claude, locale)", name)
	}
}

func traceOf(e *engine.Engine) []string {
	if e == nil {
		return nil
	}
	return e.Trace()
}

func renderTrace(trace []string) string {
	var b strings.Builder
	b.WriteString("# playthrough registrato da zaplay\n")
	b.WriteString("# rigiocalo con: zaplay -script questo_file story.ir.json\n")
	for _, t := range trace {
		b.WriteString(t)
		b.WriteString("\n")
	}
	return b.String()
}

func printLint(t *ui.Theme, fs []lint.Finding, errs, warns, infos int) {
	if len(fs) == 0 {
		fmt.Println(t.Green("nessuna segnalazione: la storia e' staticamente sana"))
		return
	}
	for _, f := range fs {
		line := f.String()
		switch f.Level {
		case lint.Error:
			fmt.Println(t.Red(line))
		case lint.Warn:
			fmt.Println(t.Yellow(line))
		default:
			fmt.Println(t.Dim(line))
		}
	}
	fmt.Println()
	fmt.Printf("%d errori, %d avvisi, %d info\n", errs, warns, infos)
	fmt.Println(t.Dim("nota: il linter e' statico. Solo giocare la storia dice se e' davvero giocabile."))
}
