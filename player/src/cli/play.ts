#!/usr/bin/env node
/**
 * La faccia da terminale del player.
 *
 * Non contiene nessuna regola: tutto quello che decide sta in `core/`. Qui si
 * legge una riga, si passa alla sessione, e si stampa quello che torna — più i
 * due modi senza mani che servono in CI: `--script`, che rigioca una traccia, e
 * l'uscita con codice diverso da zero quando la traccia non arriva in fondo.
 */

import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

import { LoadError, parseStory } from '../core/load.js';
import { countBySeverity, lint } from '../core/lint.js';
import { coverage } from '../core/coverage.js';
import { Session } from '../core/turn.js';
import type { TurnResult } from '../core/turn.js';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

interface Options {
  file: string;
  script?: string;
  debug: boolean;
  lint: boolean;
  coverage: boolean;
}

function usage(): never {
  console.error(
    'uso: play <storia.zaistory.json> [--lint] [--copertura] [--script traccia.txt] [--debug]',
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const o: Options = { file: '', debug: false, lint: false, coverage: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--debug' || a === '-debug') o.debug = true;
    else if (a === '--lint' || a === '-lint') o.lint = true;
    else if (a === '--copertura' || a === '-copertura') o.coverage = true;
    else if (a === '--script' || a === '-script') o.script = argv[++i];
    else if (a.startsWith('-')) usage();
    else o.file = a;
  }
  if (!o.file) usage();
  return o;
}

function render(r: TurnResult, debug: boolean): void {
  for (const e of r.events) {
    switch (e.kind) {
      case 'narration':
        console.log(wrap(e.text));
        break;
      case 'say':
        console.log(`${BOLD}${e.speaker}${OFF}: ${wrap(e.text, 2)}`);
        break;
      case 'system':
        console.log(wrap(e.text));
        break;
      case 'sound':
        if (debug) console.log(`${DIM}[suono] ${e.text}${OFF}`);
        break;
      case 'state':
        if (debug) console.log(`${DIM}[stato] ${e.text}${OFF}`);
        break;
      case 'note':
        // Una diagnostica: manca un testo che la storia dovrebbe avere. Chi
        // gioca non la vede mai.
        if (debug) console.log(`${DIM}(${e.text})${OFF}`);
        break;
      case 'problem':
        // Una storia rotta: qui non c'è niente da leggere al suo posto, e si
        // dice sempre.
        console.log(`${DIM}!! ${e.text}${OFF}`);
        break;
    }
  }
  if (r.choices) {
    console.log('');
    for (const c of r.choices) console.log(`  ${c.index + 1}) ${c.text}`);
  }
  if (r.suggestedExit) {
    console.log(`\n${DIM}→ ${r.suggestedExit.label}${OFF}`);
  }
  if (r.ended) {
    console.log(`\n${BOLD}— fine —${OFF}${r.ended.label ? ` ${r.ended.label}` : ''}`);
  }
}

/** Righe a settanta colonne: a centoventi caratteri l'occhio perde il capo
 * tornando a sinistra. */
function wrap(text: string, indent = 0): string {
  const width = 74 - indent;
  const pad = ' '.repeat(indent);
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line && line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out.join(`\n${pad}`);
}

function feed(s: Session, line: string): TurnResult {
  const n = Number(line);
  if (Number.isInteger(n) && n > 0 && s.inDialogue) return s.choose(n - 1);
  return s.input(line);
}

/** L'analisi statica. Esce con 1 se ci sono errori: gli avvisi non fanno
 * fallire niente, ma sono quelli che si è tentati di ignorare sbagliando. */
function runLint(idx: import('../core/types.js').StoryIndex): number {
  const findings = lint(idx);
  for (const x of findings) {
    const tag = x.severity === 'errore' ? 'ERRORE' : x.severity === 'avviso' ? 'avviso' : 'info  ';
    const color = x.severity === 'errore' ? BOLD : DIM;
    console.log(`${color}${tag}${OFF} ${x.where}\n       ${wrap(x.message, 7)}`);
  }
  const n = countBySeverity(findings);
  console.log(`\n${n.errore} errori · ${n.avviso} avvisi · ${n.info} info`);
  return n.errore > 0 ? 1 : 0;
}

/** La copertura del parser. Esce con 1 solo sulle frasi SBAGLIATE: una frase
 * persa costa una riscrittura, una sbagliata applica un effetto che nessuno ha
 * chiesto. */
function runCoverage(idx: import('../core/types.js').StoryIndex): number {
  const r = coverage(idx);
  if (r.total === 0) {
    console.log('nessuna test_phrases nella storia: non c\'è niente da misurare');
    return 0;
  }
  for (const m of r.misses) {
    const label = m.kind === 'sbagliata' ? `${BOLD}sbagliata${OFF}` : `${DIM}persa${OFF}`;
    console.log(`${label}  ${m.action}${m.got ? ` → ${m.got}` : ''}\n        "${m.phrase}"`);
  }
  const pct = Math.round((r.hit / r.total) * 100);
  console.log(`\n${r.hit}/${r.total} (${pct}%) · ${r.lost} perse · ${r.wrong} sbagliate`);
  return r.wrong > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const o = parseArgs(process.argv.slice(2));

  let session: Session;
  try {
    session = new Session(parseStory(readFileSync(o.file, 'utf8')));
  } catch (e) {
    if (e instanceof LoadError) {
      console.error(`${o.file} non è caricabile:`);
      for (const p of e.problems) console.error(`  ${p}`);
      return 1;
    }
    throw e;
  }

  if (o.lint) return runLint(session.idx);
  if (o.coverage) return runCoverage(session.idx);

  const story = session.idx.story;
  console.log(`${BOLD}${story.title}${OFF}${story.description ? `\n${wrap(story.description)}` : ''}\n`);
  render(session.begin(), o.debug);

  if (o.script) {
    // Una traccia che si esaurisce prima del finale è un test fallito: è il
    // segnale per cui i playthrough di riferimento esistono.
    const lines = readFileSync(o.script, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    for (const line of lines) {
      console.log(`\n${DIM}· ${line}${OFF}`);
      render(feed(session, line), o.debug);
      if (session.state.ended) break;
    }
    if (!session.state.ended) {
      console.error('\nla traccia si è esaurita senza arrivare a un finale');
      return 1;
    }
    return 0;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  for (;;) {
    if (session.state.ended) break;
    const line = (await rl.question('\n> ')).trim();
    if (!line) continue;
    if (line === ':esci') break;
    if (line === ':debug') {
      o.debug = !o.debug;
      console.log(`${DIM}debug ${o.debug ? 'acceso' : 'spento'}${OFF}`);
      continue;
    }
    if (line === ':stato') {
      const s = session.snapshot();
      console.log(`${DIM}atto ${s.act} · luogo ${s.place?.id} · fase ${s.phase?.id}`);
      console.log(`flag: ${s.flags.join(', ') || '—'}`);
      console.log(`inventario: ${session.state.inventory.join(', ') || '—'}`);
      console.log(`uscite: ${s.exits.map((e) => e.to).join(', ') || '—'}${OFF}`);
      continue;
    }
    render(feed(session, line), o.debug);
  }
  rl.close();
  return 0;
}

main().then((code) => process.exit(code));
