/**
 * La copertura del parser: quante frasi di prova arrivano dove devono.
 *
 * Serve a togliere dal fiuto una domanda che altrimenti resta un'opinione —
 * «questa storia si lascia giocare a parole?» — e a misurare se un backend più
 * costoso valga il suo prezzo su *questa* storia invece che in astratto.
 *
 * La distinzione che conta non è quante ne prende, è **come sbaglia**:
 *
 * - **persa**: nessun match. Costa al giocatore una frase riscritta.
 * - **sbagliata**: parte un'altra azione. Applica un effetto che nessuno ha
 *   chiesto, alza un flag, brucia un enigma.
 *
 * Un backend che alza il richiamo aggiungendo errori del secondo tipo sta
 * peggiorando la storia, e il totale da solo non lo direbbe. Per questo la
 * misura esce con codice diverso da zero solo sulle sbagliate.
 */

import type { Action, Condition, Place, StoryIndex } from './types.js';
import { GameState } from './state.js';
import { candidateActions, knownExits } from './engine.js';
import { parse } from './parser.js';

export interface CoverageMiss {
  action: string;
  phrase: string;
  /** L'id che è stato scelto al posto di quello giusto, se ne è stato scelto uno. */
  got?: string;
  kind: 'persa' | 'sbagliata';
}

export interface CoverageReport {
  total: number;
  hit: number;
  lost: number;
  wrong: number;
  misses: CoverageMiss[];
}

/**
 * Misura la copertura su tutta la storia.
 *
 * Ogni frase si prova **nel contesto in cui vive**: le candidate sono le azioni
 * del luogo più quelle della sua fase, e le uscite conosciute. Provarla contro
 * l'intera storia misurerebbe un gioco che nessuno gioca — in una stanza le
 * candidate sono cinque o quindici, non trecento, ed è quella la difficoltà
 * vera del parser.
 *
 * Lo stato usato è **permissivo**: tutti i flag alzati e tutti gli oggetti in
 * mano. Non è realismo, è isolamento — qui si misura la comprensione, non la
 * raggiungibilità, che è mestiere del linter.
 */
export function coverage(idx: StoryIndex): CoverageReport {
  const st = permissiveState(idx);
  const report: CoverageReport = { total: 0, hit: 0, lost: 0, wrong: 0, misses: [] };
  // Un'azione del luogo vale in ogni fase: senza questo la si misurerebbe una
  // volta per fase, e il totale direbbe una difficoltà che non esiste.
  const done = new Set<string>();

  for (const act of idx.story.acts) {
    for (const pl of act.places) {
      for (const ph of pl.phases) {
        const withTests = [...(pl.actions ?? []), ...(ph.actions ?? [])].filter((a) => a.test_phrases?.length);
        for (const a of withTests) {
          if (done.has(a.id)) continue;
          done.add(a.id);
          // Lo stato si piega sull'azione che si sta misurando: i flag che lei
          // vuole ASSENTI si tolgono. Senza, la stessa cosa scritta per due
          // stati diversi — stesso verbo, stesso bersaglio, condizioni
          // disgiunte — si misurerebbe sempre nello stato dell'altra, e le
          // frasi giuste risulterebbero perse per un motivo che non ha niente
          // a che vedere con quanto si capiscono.
          const suo = relaxedFor(idx, st, a);
          // Le candidate si calcolano NELLO STATO DELL'AZIONE, non in quello
          // permissivo: è lì che il suo bersaglio esiste, e un'azione che nello
          // stato permissivo non è nemmeno candidata non si può misurare.
          const actions = candidateActions(idx, pl, ph, suo);
          const exits = knownExits(pl, suo);
          for (const phrase of a.test_phrases ?? []) {
            report.total++;
            const res = parse({ idx, phrase, actions, exits, ok: suo.ok });
            const got = idOf(res, idx, pl);
            if (got === a.id) {
              report.hit++;
            } else if (got === undefined) {
              report.lost++;
              report.misses.push({ action: a.id, phrase, kind: 'persa' });
            } else {
              report.wrong++;
              report.misses.push({ action: a.id, phrase, got, kind: 'sbagliata' });
            }
          }
        }
      }
    }
  }
  return report;
}

function idOf(res: ReturnType<typeof parse>, _idx: StoryIndex, _pl: Place): string | undefined {
  if (res.kind === 'action') return res.action.id;
  if (res.kind === 'exit') return `→${res.exit.to}`;
  return undefined;
}

/** Uno stato in cui tutto è vero: serve a misurare la comprensione senza che la
 * raggiungibilità si metta in mezzo. */
function permissiveState(idx: StoryIndex): GameState {
  const st = new GameState(new Set((idx.story.carry_flags ?? []).map((c) => c.id)));
  for (const act of idx.story.acts) {
    for (const fl of act.flags ?? []) st.flags.add(fl);
    for (const fl of act.reads_carry_flags ?? []) st.flags.add(fl);
  }
  for (const it of idx.items.keys()) st.inventory.push(it);
  return st;
}

/**
 * Lo stato permissivo meno i flag che impediscono a QUESTA azione di esistere:
 * è lo stato in cui la si può davvero chiedere.
 *
 * Sono due cose, e la seconda si scopre solo misurando: i flag che la sua
 * condizione vuole assenti, e quelli che farebbero sparire il suo **bersaglio**.
 * Un oggetto d'ambiente che si raccoglie ha un `present_when` che lo toglie di
 * mezzo una volta preso, e in uno stato in cui è vero tutto quell'oggetto non
 * c'è: l'azione per raccoglierlo non è nemmeno una candidata, e tutte le sue
 * frasi di prova risultano perse per un motivo che non ha niente a che vedere
 * con quanto si capiscono.
 */
function relaxedFor(idx: StoryIndex, st: GameState, a: Action): GameState {
  const assenti: string[] = [];
  const scan = (c?: Condition): void => {
    if (!c) return;
    if (c.flag_absent) assenti.push(c.flag_absent);
    for (const sub of c.all_of ?? []) scan(sub);
    for (const sub of c.any_of ?? []) scan(sub);
  };
  scan(a.condition);
  for (const t of [a.target, a.second_target]) {
    if (t) scan(idx.props.get(t)?.present_when);
  }
  if (!assenti.length) return st;

  const copia = new GameState();
  copia.flags = new Set([...st.flags].filter((fl) => !assenti.includes(fl)));
  copia.inventory = [...st.inventory];
  return copia;
}

/** Le frasi di prova che una singola azione porta con sé, per un rapporto per
 * azione invece che per storia. */
export function testPhrasesOf(a: Action): string[] {
  return a.test_phrases ?? [];
}
