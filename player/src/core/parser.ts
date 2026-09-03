/**
 * Il parser: da una frase libera a un'azione già scritta, o a un'uscita.
 *
 * Non genera niente. Riceve *(le azioni della fase, le uscite del luogo, la
 * frase)* e ritorna l'id di qualcosa che esiste già, oppure niente — e «niente»
 * è una risposta legittima, non un fallimento da aggirare.
 *
 * Come funziona, in tre righe: la frase si riduce a un **verbo** e a un
 * **complemento**; il verbo lo riconosce la tabella italiana di `verbs.ts`, il
 * complemento lo riconoscono gli alias che il compilatore ha scritto sulle
 * entità. Un'azione vale quanto il suo bersaglio somiglia a quello che il
 * giocatore ha nominato, moltiplicato per quanto il suo verbo somiglia a quello
 * che ha usato.
 *
 * La regola che tiene insieme movimento e manipolazione: **il complemento
 * decide, non il verbo.** «usa la porta» e «vai alla porta» convergono sulla
 * stessa uscita perché il bersaglio è un'uscita; «usa la chiave» resta
 * un'azione perché il bersaglio è un oggetto. Senza questa regola servirebbero
 * due elenchi di sinonimi che si contendono le stesse parole.
 */

import type { Action, Exit, Intent, StoryIndex } from './types.js';
import { surfaces } from './types.js';
import { bestAffinity, mentions, roots } from './lexical.js';
import { findVerbs, intentOfVerb } from './verbs.js';
import { exitSurfaces } from './engine.js';

/**
 * Quanto deve valere il migliore per essere eseguito. Sotto questa soglia si
 * risponde con un fallback: meglio far riscrivere una frase che applicare un
 * effetto che nessuno ha chiesto.
 */
export const ACCEPT = 0.55;

/**
 * Di quanto il migliore deve staccare il secondo.
 *
 * Un'azione non si esegue solo perché è la migliore: due candidate a pari
 * punteggio sono un'ambiguità vera, e a un'ambiguità vera si risponde con un
 * fallback. Tirare a indovinare qui significa cambiare lo stato al posto del
 * giocatore.
 */
export const MARGIN = 0.08;

/** Quanto deve valere ciascuno dei due complementi di «usa X con Y» perché la
 * coppia si consideri nominata davvero. */
const PAIR_FLOOR = 0.3;

export type Resolution =
  | { kind: 'action'; action: Action; score: number }
  | { kind: 'exit'; exit: Exit; score: number }
  | { kind: 'ambiguous'; intent: Intent }
  | { kind: 'none'; intent: Intent };

export interface ParseInput {
  idx: StoryIndex;
  phrase: string;
  actions: Action[];
  exits: Exit[];
  /**
   * Se una condizione è soddisfatta adesso. Non serve a filtrare — le candidate
   * arrivano qui apposta anche bloccate, o la loro `blocked_narration` non
   * verrebbe mai letta — ma a **spareggiare**: vedi `open` più sotto.
   */
  ok?: (c?: import('./types.js').Condition) => boolean;
  /**
   * Quale famiglia intendeva il verbo, quando ne ha più d'una.
   *
   * **Ascoltare** è percezione se l'oggetto è un rumore e comunicazione se è
   * una persona: «ascolto il motore» e «ascolto Tommy» sono lo stesso verbo e
   * due gesti diversi, e a deciderlo non è il verbo ma il complemento. Il
   * parser il complemento lo pesa, ma non sa **chi c'è in scena** — quello lo
   * sa il turno, che infatti è chi passa questo suggerimento. Vale solo per
   * scegliere fra le famiglie che il verbo ha davvero: non ne aggiunge una.
   */
  intentHint?: Intent;
}

/** Le superfici lessicali di un'entità qualunque, cercata per id fra oggetti
 * d'ambiente, personaggi e oggetti d'inventario. */
export function entitySurfaces(idx: StoryIndex, id: string | undefined): string[] {
  if (!id) return [];
  const e = idx.props.get(id) ?? idx.characters.get(id) ?? idx.items.get(id);
  return e ? surfaces(e) : [];
}

interface Scored {
  res: Resolution;
  score: number;
  /** La sua condizione è soddisfatta adesso: si può fare davvero. */
  open: boolean;
}

export function parse(input: ParseInput): Resolution {
  const { idx, phrase, actions, exits } = input;
  const ok = input.ok ?? (() => true);
  const all = roots(phrase);
  const verbi = findVerbs(all);
  let intents = new Set<Intent>(verbi.map((v) => v.intent));
  // L'intenzione con cui si risponde quando non si capisce è la prima: è il
  // verbo con cui il giocatore ha aperto la frase, ed è quello che il rifiuto
  // d'autore deve raccogliere.
  let intent: Intent = verbi[0]?.intent ?? 'generic';
  // Il complemento ha già deciso quale delle famiglie del verbo sia quella
  // giusta: le altre non sono più in gioco. Senza restringere non basterebbe —
  // dove esistono due azioni sullo stesso personaggio, una da guardare e una da
  // sentire, resterebbero pari e la frase finirebbe in un «non ho capito».
  if (input.intentHint && intents.has(input.intentHint)) {
    intents = new Set<Intent>([input.intentHint]);
    intent = input.intentHint;
  }

  // Il complemento è la frase meno TUTTI i verbi. Toglierli evita che un verbo
  // faccia punteggio contro il nome di un'entità che gli somiglia.
  const posizioni = new Set(verbi.map((v) => v.at));
  const rest = all.filter((_, i) => !posizioni.has(i));
  const probe = rest.length ? rest : all;

  const scored: Scored[] = [];

  // Le uscite si pesano PER PRIME, e non è un dettaglio d'ordine: sapere se
  // qualche passaggio risponde a questo complemento è quello che dice se la
  // frase è davvero un movimento. Vedi `verbFactor`.
  for (const e of exits) {
    const s = scoreExit(idx, probe, intents, e);
    if (s > 0) scored.push({ res: { kind: 'exit', exit: e, score: s }, score: s, open: ok(e.condition) });
  }
  const nessunPassaggio = scored.length === 0;

  for (const a of actions) {
    const s = scoreAction(idx, probe, intents, a, nessunPassaggio);
    if (s > 0) scored.push({ res: { kind: 'action', action: a, score: s }, score: s, open: ok(a.condition) });
  }

  if (scored.length === 0) return { kind: 'none', intent };
  // A parità di punteggio vince quella che si può fare adesso. È il caso
  // normale, non un'eccezione: la stessa cosa in stati diversi si scrive come
  // due azioni con lo stesso verbo e lo stesso bersaglio e condizioni disgiunte
  // — «parla a Mark della scatola» e «parla a Mark che è già lassù» — e
  // lessicalmente sono identiche per costruzione. Senza questo spareggio ogni
  // coppia del genere finirebbe in un'ambiguità, cioè in un non-ho-capito,
  // proprio dove l'autore era stato più preciso.
  scored.sort((x, y) => y.score - x.score || Number(y.open) - Number(x.open));

  const best = scored[0];
  if (best.score < ACCEPT) return { kind: 'none', intent };
  // L'ambiguità vera è fra due cose che si possono fare tutte e due: se la
  // seconda è bloccata, non c'è niente su cui il giocatore possa essersi
  // confuso.
  const rival = scored.find((s) => s !== best && s.open === best.open);
  if (rival && best.score - rival.score < MARGIN) {
    return { kind: 'ambiguous', intent };
  }
  return best.res;
}

function scoreAction(
  idx: StoryIndex,
  probe: string[],
  intents: ReadonlySet<Intent>,
  a: Action,
  nessunPassaggio: boolean,
): number {
  let base: number;

  if (a.second_target) {
    // Per la coppia la domanda è «sono nominati tutti e due?», non «la frase
    // somiglia a ciascuno?»: una frase con due complementi è per forza più
    // lunga di entrambi i nomi, e misurarla contro ciascuno la fa perdere con
    // tutti e due.
    const s1 = mentions(probe, entitySurfaces(idx, a.target));
    const s2 = mentions(probe, entitySurfaces(idx, a.second_target));
    // Servono nominati tutti e due: «usa il cavo» non è «usa il cavo con la
    // presa», e trattarli uguale vuol dire eseguire una combinazione che il
    // giocatore non ha chiesto.
    if (Math.min(s1, s2) < PAIR_FLOOR) return 0;
    base = 0.5 * (s1 + s2);
  } else if (a.target) {
    base = bestAffinity(probe, entitySurfaces(idx, a.target));
  } else {
    // Un'azione senza bersaglio non ha niente a cui agganciarsi se non il
    // proprio verbo: vale poco di suo, e passa solo se il verbo combacia.
    base = 0.4;
  }
  if (base <= 0) return 0;

  return base * verbFactor(intents, a, nessunPassaggio);
}

/**
 * Quanto il verbo della frase somiglia a quello dell'azione.
 *
 * È il correttivo che tiene «guardo la porta» lontano da «apri la porta»:
 * senza, condividono il complemento e il matcher le vede vicine. Se la frase
 * non ha nessun verbo riconosciuto non si penalizza quasi: non riconoscere un
 * verbo non è una prova di niente, e «la chiave» da solo è una richiesta
 * legittima.
 */
function verbFactor(intents: ReadonlySet<Intent>, a: Action, nessunPassaggio: boolean): number {
  if (intents.size === 0) return 0.9; // nessun verbo riconosciuto: non è una prova di niente
  if (intents.has(intentOfVerb(a.verb))) return 1;
  if (intents.size === 1 && intents.has('movement')) {
    // Chi dice «vai» non sta manipolando — ma solo se c'è dove andare. La
    // regola di questo parser è che **il complemento decide**, e se nessun
    // passaggio risponde a quel complemento allora quel complemento non è un
    // passaggio: la frase non può essere un movimento, e il verbo torna a non
    // dire niente su quale dei tre gesti sia. È il caso di «sali sull'albero»
    // in un bosco — salire è movimento, l'albero non porta da nessuna parte, e
    // arrampicarcisi è l'unica cosa che quella frase può voler dire.
    return nessunPassaggio ? 0.9 : 0.35;
  }
  return 0.5;
}

function scoreExit(idx: StoryIndex, probe: string[], intents: ReadonlySet<Intent>, e: Exit): number {
  const base = bestAffinity(probe, exitSurfaces(idx, e));
  if (base <= 0) return 0;

  // Basta che UNA delle famiglie nominate vada bene: l'uscita non compete con
  // sé stessa, e una frase che dice sia «vai» sia «guarda» sta chiedendo di
  // andare.
  if (intents.has('movement')) {
    // Il caso pieno: verbo di movimento su un bersaglio che è un passaggio.
    return Math.min(1, base * 1.15);
  }
  if (intents.has('manipulation')) {
    // «apri la porta», «usa la scala»: il complemento decide, e il complemento
    // è un'uscita. Nessuna penalità.
    return base;
  }
  if (intents.size === 0) return base * 0.9;
  if (intents.has('perception')) {
    // Guardare una porta non è attraversarla. Resta possibile che il luogo non
    // abbia niente di meglio, ma non deve vincere per poco.
    return base * 0.4;
  }
  return base * 0.5;
}
