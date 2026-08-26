/**
 * Script di playthrough: una partita descritta dalla sola sequenza di id.
 *
 * Poiche' il resolver puo' solo scegliere tra azioni gia' definite, una partita
 * e' interamente descritta dalla sequenza di id di azione/scelta. E' questo che
 * rende possibile usare un playthrough come test di regressione su una storia:
 * domani cambi una condizione nell'IR, rigiochi il file, e in due secondi sai
 * se la storia e' ancora percorribile fino in fondo.
 *
 * Formato del file (una voce per riga, righe vuote e `#` ignorati):
 *
 *     a:prendi_chiave   azione per id
 *     c:nodo_risposta   scelta di dialogo, per id del nodo di destinazione
 *     3                 la terza voce dell'elenco corrente
 *     prendi_chiave     forma abbreviata, equivale a a:prendi_chiave
 */

import type { ActionPrompt, ChoicePrompt, Command } from './engine.js';
import { ScriptEndedError } from './engine.js';
import { findAction } from './types.js';

/** Legge un file di playthrough in una lista di token. */
export function parseScript(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash).trim();
    if (line === '') continue;
    out.push(line);
  }
  return out;
}

/** Serializza una traccia nel formato dei file di playthrough. */
export function renderTrace(trace: string[]): string {
  return ['# playthrough registrato da zaiplay', '# rigiocalo con: zaiplay --script questo_file story.ir.json', ...trace, ''].join(
    '\n',
  );
}

/**
 * Consuma i token dello script rispondendo ai prompt dell'engine.
 *
 * Non e' una UI: e' il pezzo di UI che decide *cosa scegliere*, riusabile
 * identico dalla CLI e dal player web. Il rendering resta a chi lo ospita, cosi'
 * il transcript di una partita rigiocata e' uguale a quello di una giocata a
 * mano — il che lo rende leggibile in una diff.
 */
export class ScriptDriver {
  pos = 0;

  constructor(
    private tokens: string[],
    private echo: (what: string) => void = () => {},
  ) {}

  get remaining(): number {
    return Math.max(0, this.tokens.length - this.pos);
  }

  get total(): number {
    return this.tokens.length;
  }

  private next(): string {
    if (this.pos >= this.tokens.length) throw new ScriptEndedError();
    return this.tokens[this.pos++];
  }

  chooseAction(p: ActionPrompt): Command {
    const tok = this.next();
    const want = tok.replace(/^a:/, '');
    if (tok.startsWith('c:')) {
      throw new Error(
        `passo ${this.pos}: lo script chiede la scelta di dialogo "${want}" ma il gioco chiede un'azione di scena (scena ${p.scene.id})`,
      );
    }

    if (/^\d+$/.test(want)) {
      const n = Number(want);
      if (n >= 1 && n <= p.available.length) {
        const a = p.available[n - 1];
        this.echo(`${n}) ${a.label} [${a.id}]`);
        return { actionId: a.id };
      }
      throw new Error(
        `passo ${this.pos}: indice ${n} fuori dalle ${p.available.length} azioni disponibili nella scena ${p.scene.id}`,
      );
    }

    const i = p.available.findIndex((a) => a.id === want);
    if (i >= 0) {
      this.echo(`${i + 1}) ${p.available[i].label} [${p.available[i].id}]`);
      return { actionId: p.available[i].id };
    }

    // Distinguere "azione inesistente" da "azione esistente ma nascosta" e' la
    // differenza tra un refuso nello script e una regressione nella storia.
    const exists = findAction(p.scene, want);
    if (exists) {
      const why = p.hidden.find((h) => h.action.id === want)?.reason ?? 'condizione non soddisfatta';
      throw new Error(
        `passo ${this.pos}: l'azione "${want}" esiste nella scena ${p.scene.id} ma non e' disponibile: ${why} (label: "${exists.label}")`,
      );
    }
    const ids = p.available.map((a) => a.id).join(', ') || 'nessuna';
    throw new Error(`passo ${this.pos}: nessuna azione "${want}" nella scena ${p.scene.id} (disponibili: ${ids})`);
  }

  chooseChoice(p: ChoicePrompt): Command {
    const tok = this.next();
    const want = tok.replace(/^c:/, '').replace(/^a:/, '');

    if (/^\d+$/.test(want)) {
      const n = Number(want);
      if (n >= 1 && n <= p.available.length) {
        this.echo(`${n}) ${p.available[n - 1].text}`);
        return { choiceIndex: n - 1 };
      }
      throw new Error(`passo ${this.pos}: indice ${n} fuori dalle ${p.available.length} scelte disponibili nel nodo ${p.nodeId}`);
    }

    const i = p.available.findIndex((c) => c.goto === want);
    if (i >= 0) {
      this.echo(`${i + 1}) ${p.available[i].text}`);
      return { choiceIndex: i };
    }
    const gotos = p.available.map((c) => c.goto).join(', ');
    throw new Error(`passo ${this.pos}: nessuna scelta verso "${want}" nel nodo ${p.nodeId} (disponibili: ${gotos})`);
  }
}
