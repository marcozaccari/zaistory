/**
 * Rendering testuale per la CLI: colori ANSI, word-wrap e righe separatrici.
 * Nient'altro: qui non passa nessuna decisione di gioco.
 */

const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;

/** Colonne occupate da una stringa, ignorando i codici ANSI. */
export function visibleWidth(s: string): number {
  return [...s.replace(ANSI_RE, '')].length;
}

/**
 * Raccoglie i codici ANSI, spenti tutti insieme quando non si vuole colore
 * (pipe, NO_COLOR, flag esplicito).
 */
export class Theme {
  readonly enabled: boolean;

  constructor(color: boolean) {
    this.enabled = color && !process.env.NO_COLOR && !!process.stdout.isTTY;
  }

  private w(code: string, s: string): string {
    if (!this.enabled || !s) return s;
    return `\x1b[${code}m${s}\x1b[0m`;
  }

  bold = (s: string) => this.w('1', s);
  dim = (s: string) => this.w('2', s);
  italic = (s: string) => this.w('3', s);
  cyan = (s: string) => this.w('36', s);
  yellow = (s: string) => this.w('33', s);
  green = (s: string) => this.w('32', s);
  red = (s: string) => this.w('31', s);
  mag = (s: string) => this.w('35', s);
  blue = (s: string) => this.w('34', s);
  gray = (s: string) => this.w('90', s);
}

/**
 * Manda a capo un testo alla larghezza data preservando i codici ANSI: le
 * sequenze non consumano colonne e non vengono mai spezzate.
 */
export function wrap(text: string, width: number, indent = ''): string {
  if (width <= 0) width = 80;
  const limit = Math.max(20, width - visibleWidth(indent));
  const out: string[] = [];

  for (const para of text.split('\n')) {
    const words = para.split(/[ \t]+/).filter((w) => w !== '');
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    let lineWidth = 0;
    for (const word of words) {
      const w = visibleWidth(word);
      if (lineWidth > 0 && lineWidth + 1 + w > limit) {
        out.push(indent + line);
        line = '';
        lineWidth = 0;
      }
      if (lineWidth > 0) {
        line += ' ';
        lineWidth++;
      }
      line += word;
      lineWidth += w;
    }
    if (line) out.push(indent + line);
  }
  return out.join('\n');
}

/** Riga separatrice con un titolo opzionale. */
export function rule(title: string, width: number): string {
  if (width <= 0) width = 80;
  if (!title) return '─'.repeat(width);
  const head = `── ${title} `;
  return head + '─'.repeat(Math.max(0, width - visibleWidth(head)));
}

/** Larghezza del terminale, con default 80. */
export function termWidth(): number {
  const cols = process.stdout.columns;
  if (cols && cols > 40) return cols;
  const env = Number(process.env.COLUMNS);
  if (Number.isFinite(env) && env > 40) return env;
  return 80;
}
