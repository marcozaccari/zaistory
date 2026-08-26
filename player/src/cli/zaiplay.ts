#!/usr/bin/env node
/**
 * zaiplay — player CLI di test per story.ir.json.
 *
 * Input unico: l'IR. Nessun manifest asset, nessuna immagine, nessuna voce. Se
 * una storia arriva dall'inizio alla fine con questo player, il contratto tra
 * compilatore e player regge.
 *
 * Questa e' la faccia da terminale del core: quella da telefono e' il player
 * web, e giocano la stessa identica partita.
 */

import { readFile, writeFile } from 'node:fs/promises';
import {
  Engine,
  IRError,
  ScriptDriver,
  countFindings,
  formatFinding,
  lintStory,
  makeResolver,
  parseScript,
  parseStory,
  renderTrace,
  type Finding,
} from '../core/index.js';
import { Theme, termWidth } from './term.js';
import { playerVersion } from './version.js';
import { TermUI } from './ui.js';

const USAGE = `zaiplay - player CLI di test per il motore narrativo ZAiStory

  zaiplay [opzioni] story.ir.json

Opzioni:
  --debug            parte in modalita' debug (parametri di scena e azioni nascoste)
  --lint             esegue solo l'analisi statica di giocabilita' e esce
  --script FILE      rigioca una sequenza di id senza input umano (test di regressione)
  --record FILE      salva la sequenza di id giocata, rigiocabile con --script
  --resolver NOME    backend del resolver: menu (default), claude, locale
  --no-color         niente colori ANSI
  --version          stampa la versione del player e esce
  --width N          larghezza di riga (default: larghezza del terminale o 80)

Comandi in gioco: :aiuto, :debug, :stato, :flag, :inv, :scena, :storico,
:azioni, :traccia, :esci

Codici di uscita: 0 tutto bene · 1 problemi di giocabilita' · 2 errore d'uso
`;

interface Options {
  debug: boolean;
  lint: boolean;
  script: string;
  record: string;
  resolver: string;
  color: boolean;
  width: number;
  path: string;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    debug: false,
    lint: false,
    script: '',
    record: '',
    resolver: 'menu',
    color: true,
    width: 0,
    path: '',
  };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      rest.push(arg);
      continue;
    }
    // Si accettano sia -lint sia --lint: il player Go usava una sola linea, le
    // dita si ricordano quella.
    const [name, inline] = arg.replace(/^--?/, '').split('=', 2);
    const value = () => {
      if (inline !== undefined) return inline;
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`l'opzione --${name} vuole un valore`);
      return v;
    };
    switch (name) {
      case 'debug':
        o.debug = true;
        break;
      case 'lint':
        o.lint = true;
        break;
      case 'script':
        o.script = value();
        break;
      case 'record':
        o.record = value();
        break;
      case 'resolver':
        o.resolver = value();
        break;
      case 'no-color':
        o.color = false;
        break;
      case 'width':
        o.width = Number(value());
        break;
      case 'h':
      case 'help':
        throw new UsageError('');
      default:
        throw new UsageError(`opzione sconosciuta: ${arg}`);
    }
  }

  if (rest.length !== 1) throw new UsageError('serve esattamente un file story.ir.json');
  o.path = rest[0];
  return o;
}

function printLint(t: Theme, fs: Finding[]): void {
  if (fs.length === 0) {
    console.log(t.green("nessuna segnalazione: la storia e' staticamente sana"));
    return;
  }
  for (const f of fs) {
    const line = formatFinding(f);
    if (f.level === 'errore') console.log(t.red(line));
    else if (f.level === 'avviso') console.log(t.yellow(line));
    else console.log(t.dim(line));
  }
  const { errors, warnings, infos } = countFindings(fs);
  console.log();
  console.log(`${errors} errori, ${warnings} avvisi, ${infos} info`);
  console.log(t.dim("nota: il linter e' statico. Solo giocare la storia dice se e' davvero giocabile."));
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // Prima di parseArgs: `--version` non vuole un file da giocare.
  if (argv.some((a) => a === '--version' || a === '-version' || a === '-V')) {
    console.log(`zaiplay ${playerVersion()}`);
    return 0;
  }

  let o: Options;
  try {
    o = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.message) console.error(err.message);
      console.error(USAGE);
      return 2;
    }
    throw err;
  }

  const theme = new Theme(o.color);

  let story;
  try {
    story = parseStory(await readFile(o.path, 'utf8'));
  } catch (err) {
    const msg = err instanceof IRError ? `IR non conforme allo schema: ${err.message}` : (err as Error).message;
    console.error(`impossibile caricare ${o.path}: ${msg}`);
    return 2;
  }

  const findings = lintStory(story);
  const { errors, warnings } = countFindings(findings);

  if (o.lint) {
    printLint(theme, findings);
    return errors > 0 ? 1 : 0;
  }

  let resolver;
  try {
    resolver = makeResolver(o.resolver);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  let script: ScriptDriver | undefined;
  if (o.script) {
    try {
      script = new ScriptDriver(parseScript(await readFile(o.script, 'utf8')));
    } catch (err) {
      console.error(`impossibile leggere lo script ${o.script}: ${(err as Error).message}`);
      return 2;
    }
  }

  const ui = new TermUI({
    story,
    resolver,
    debug: o.debug,
    color: o.color,
    width: o.width || termWidth(),
    script,
  });
  const engine = new Engine(story, ui);
  ui.trace = () => engine.trace();

  ui.intro();
  if (errors > 0 || warnings > 0) {
    console.log(theme.yellow(`linter: ${errors} errori, ${warnings} avvisi (dettagli con --lint)`));
  }

  const out = await engine.run();
  ui.close();

  if (o.record) {
    try {
      await writeFile(o.record, renderTrace(out.trace));
    } catch (err) {
      console.error(`impossibile salvare la traccia: ${(err as Error).message}`);
      return 2;
    }
    console.log(theme.dim(`traccia salvata in ${o.record}`));
  }

  if (out.problems.length > 0) return 1;
  // In modalita' non interattiva un playthrough che non arriva a un finale e'
  // un fallimento del test, non una partita interrotta.
  if (o.script && !out.ended && !out.quit) return 1;
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  },
);
