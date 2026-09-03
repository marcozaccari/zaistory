/**
 * Il motore: che luogo, che fase, cosa si può fare, dove si può andare.
 *
 * Tutto quello che qui si chiama «corrente» è **derivato dallo stato**, mai
 * memorizzato: la fase non si sceglie e non si ricorda, si calcola valutando le
 * condizioni nell'ordine in cui l'autore le ha scritte. È la proprietà che
 * rende naturale il ritorno libero in un luogo — entrando si ottiene com'è
 * adesso, non com'era — e che toglie di mezzo il router condizionale che
 * servirebbe se il nodo di gioco fosse la scena.
 */

import type {
  Action,
  Exit,
  NarrationBeat,
  Phase,
  Place,
  Prop,
  StoryIndex,
  Transition,
} from './types.js';
import { textNow } from './types.js';
import type { EffectSink, GameState } from './state.js';

// --------------------------------------------------------------- luogo

export function place(idx: StoryIndex, id: string): Place | undefined {
  return idx.places.get(id);
}

export function currentPlace(idx: StoryIndex, st: GameState): Place | undefined {
  return idx.places.get(st.place);
}

/**
 * La fase che vale adesso: la prima la cui condizione è soddisfatta.
 *
 * L'ordine è significativo e sta nelle mani di chi compila — le più specifiche
 * prima, l'ultima senza condizione. Se nessuna matcha il luogo non ha niente da
 * dire, e non è una cosa che il player possa aggiustare: è un buco, e il linter
 * lo segnala come tale.
 */
export function currentPhase(pl: Place | undefined, st: GameState): Phase | undefined {
  if (!pl) return undefined;
  for (const ph of pl.phases) if (st.ok(ph.condition)) return ph;
  return undefined;
}

/** Il `look` com'è adesso, varianti comprese. */
export function lookNow(ph: Phase | undefined, st: GameState): string | undefined {
  if (!ph) return undefined;
  return textNow(ph.look, ph.look_variants, st.ok);
}

/** Gli oggetti d'ambiente presenti adesso. Un prop assente non è un bersaglio:
 * il parser non lo considera nemmeno. */
export function visibleProps(pl: Place | undefined, st: GameState): Prop[] {
  return (pl?.objects ?? []).filter((o) => st.ok(o.present_when));
}

// -------------------------------------------------------------- azioni

/**
 * Il bersaglio di un'azione è qui, adesso?
 *
 * Non è logica narrativa inventata: è la stessa cosa che `present_when` dice
 * per un oggetto d'ambiente, estesa alle altre due specie di bersaglio. Una
 * cosa che non c'è non è un bersaglio — e chiedere all'autore di ripetere
 * `has_item: lanterna` su ogni azione che usa la lanterna sarebbe scrivere due
 * volte lo stesso fatto, con il secondo che prima o poi si dimentica.
 *
 * Il caso che l'ha fatta scrivere: dopo aver acceso la lanterna, «cosa posso
 * fare» continuava a elencare *la lanterna spenta* — un oggetto che il
 * giocatore non aveva più in mano, perché accenderla lo aveva sostituito con
 * un altro oggetto.
 */
export function targetPresent(
  idx: StoryIndex,
  pl: Place | undefined,
  ph: Phase | undefined,
  st: GameState,
  targetId: string | undefined,
): boolean {
  if (!targetId) return true;

  const prop = idx.props.get(targetId);
  if (prop) {
    // Un oggetto d'ambiente vale solo nel suo luogo, e solo quando c'è.
    if (idx.placeOfProp.get(targetId) !== pl?.id) return false;
    return st.ok(prop.present_when);
  }
  if (idx.items.has(targetId)) return st.hasItem(targetId);
  if (idx.characters.has(targetId)) {
    // Solo se la fase dichiara chi c'è: una fase senza elenco non sta dicendo
    // «non c'è nessuno», sta tacendo, e su un silenzio non si filtra.
    const roster = ph?.characters;
    if (!roster?.length) return true;
    return roster.some((c) => c.id === targetId);
  }
  return true; // un id che non è nessuna delle tre: è il linter a doverlo dire
}

/** Tutte le azioni giocabili adesso, comprese quelle la cui **condizione** non
 * è soddisfatta.
 *
 * Le bloccate restano candidate ed è la differenza fra un menu e una
 * conversazione: in un menu un'azione filtrata sparisce e non c'è niente da
 * dire; a parole il giocatore la chiede lo stesso, e riceve la risposta
 * d'autore. Diverso è un'azione il cui **bersaglio** non c'è: lì non c'è niente
 * da raccontare sulla cosa, perché la cosa non è qui. */
export function candidateActions(
  idx: StoryIndex,
  pl: Place | undefined,
  ph: Phase | undefined,
  st: GameState,
): Action[] {
  // Le azioni del luogo valgono in ogni fase e vengono per prime: sono i gesti
  // che il posto permette finché è quel posto. Quelle della fase si aggiungono.
  // Senza questa somma, un'azione necessaria che vive in una fase sola sparisce
  // appena lo stato cambia la fase — ed è un vicolo cieco che nessuno vede
  // finché non ci finisce dentro.
  return [...(pl?.actions ?? []), ...(ph?.actions ?? [])].filter(
    (a) =>
      !st.consumed(a.id) &&
      targetPresent(idx, pl, ph, st, a.target) &&
      targetPresent(idx, pl, ph, st, a.second_target),
  );
}

/** Le azioni effettivamente eseguibili adesso. */
export function availableActions(
  idx: StoryIndex,
  pl: Place | undefined,
  ph: Phase | undefined,
  st: GameState,
): Action[] {
  return candidateActions(idx, pl, ph, st).filter((a) => st.ok(a.condition));
}

/** Un'azione è una pura osservazione se il suo effetto non muove niente: si può
 * rileggere per sempre senza che la storia si sposti. */
export function isPureObservation(a: Action): boolean {
  const e = a.effect;
  return !e.set_flag && !e.unset_flag && !e.add_inventory && !e.remove_inventory && !e.goto_dialogue && !e.goto_place;
}

/**
 * Qui non resta più niente da fare?
 *
 * Definizione precisa, ed è la sola che regge: ogni azione disponibile è già
 * stata eseguita almeno una volta, oppure è una pura osservazione. Senza la
 * prima metà la regola non scatterebbe mai dove serve — l'azione che apre un
 * dialogo resta disponibile anche dopo averlo ascoltato, e riascoltarlo non è
 * qualcosa che *resta da fare*.
 */
export function nothingLeftToDo(
  idx: StoryIndex,
  pl: Place | undefined,
  ph: Phase | undefined,
  st: GameState,
): boolean {
  const acts = availableActions(idx, pl, ph, st);
  return acts.every((a) => st.executed(a.id) || isPureObservation(a));
}

// -------------------------------------------------------------- uscite

/** Le uscite che il giocatore sa che esistono. Una sconosciuta non compare da
 * nessuna parte: si scopre dal testo, con un effetto d'autore, mai da un
 * elemento di interfaccia che si accende. */
export function knownExits(pl: Place | undefined, st: GameState): Exit[] {
  return (pl?.exits ?? []).filter((e) => st.ok(e.known_when));
}

/** Le uscite percorribili adesso. */
export function openExits(pl: Place | undefined, st: GameState): Exit[] {
  return knownExits(pl, st).filter((e) => st.ok(e.condition));
}

/** Come si chiama un'uscita per chi legge: l'etichetta se c'è, altrimenti il
 * nome della destinazione. */
export function exitLabel(idx: StoryIndex, e: Exit): string {
  if (e.label && e.label.trim()) return e.label;
  return idx.places.get(e.to)?.name ?? e.to;
}

/** Le superfici lessicali di un'uscita: i suoi alias, la sua etichetta, e nome
 * e alias del luogo di destinazione — «vai al magazzino» deve funzionare anche
 * se l'uscita non si chiama così. */
export function exitSurfaces(idx: StoryIndex, e: Exit): string[] {
  const out: string[] = [];
  if (e.label) out.push(e.label);
  for (const a of e.aliases ?? []) out.push(a);
  const dest = idx.places.get(e.to);
  if (dest) {
    out.push(dest.name);
    for (const a of dest.aliases ?? []) out.push(a);
  }
  return out;
}

/** La cutscene di passaggio che vale adesso, se non è già stata vista. */
export function transitionFor(
  from: string,
  e: Exit,
  st: GameState,
): { transition: Transition; key: string } | undefined {
  const list = e.transitions ?? [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!st.ok(t.condition)) continue;
    const key = `${from}>${e.to}#${i}`;
    if (!t.replay && st.transitionSeen(key)) return undefined;
    return { transition: t, key };
  }
  return undefined;
}

// ------------------------------------------------------------- ingresso

export interface EnterResult {
  /** I beat da mostrare entrando: la transizione, poi la narrazione della fase. */
  beats: NarrationBeat[];
  place?: Place;
  phase?: Phase;
  /** Valorizzato se la fase in cui si è entrati chiude la storia. */
  ending?: { kind: 'natural' | 'premature'; label?: string };
  /** Se il luogo non ha nessuna fase valida: è un buco della storia, non un
   * caso da gestire in silenzio. */
  problem?: string;
}

/**
 * Entra in un luogo. È l'unico posto da cui si cambia `st.place`.
 *
 * Fa tre cose in quest'ordine, e l'ordine conta: cambia atto se serve (e lì i
 * flag locali muoiono), alza i flag d'ingresso della fase, e raccoglie i beat
 * da leggere. La transizione, se c'è, l'ha già messa in coda chi ha attraversato
 * l'uscita: entrare non sa da dove si arriva, ed è giusto che non lo sappia.
 */
export function enterPlace(
  idx: StoryIndex,
  st: GameState,
  placeId: string,
  sink: EffectSink,
  before: NarrationBeat[] = [],
): EnterResult {
  const pl = idx.places.get(placeId);
  if (!pl) {
    return { beats: before, problem: `il luogo "${placeId}" non esiste nella storia` };
  }

  const actId = idx.actOfPlace.get(placeId);
  if (actId && actId !== st.act) {
    st.enterAct(actId);
    sink.stateChange(`atto: ${actId}`);
  }

  st.place = placeId;
  st.history.push(placeId);

  // I flag d'ingresso si alzano, e la fase resta questa.
  //
  // Prima si rileggeva la fase subito dopo averli alzati, e la conseguenza era
  // che una fase capace di marcarsi da sola come vista **perdeva la propria
  // narrazione**: cedeva il posto alla successiva allo stesso ingresso, e il
  // testo che avrebbe dovuto leggersi quella volta lì non si leggeva mai. È il
  // caso di ogni cosa che succede una volta quando si entra — la casa che si
  // sveglia, la stanza che al secondo giro è un'altra stanza — cioè il pane di
  // un atto in cui si gira per una casa.
  //
  // Ed era anche un disaccordo interno: `settlePhase`, che è l'altra metà dello
  // stesso meccanismo, ha sempre fatto il contrario — alza i flag e mostra la
  // narrazione di QUESTA fase, e passa alla successiva al giro dopo. Adesso le
  // due strade dicono la stessa cosa, ed è quella giusta: la fase che si marca
  // vista si vede, una volta.
  const ph = currentPhase(pl, st);
  if (ph?.on_enter_flags_set?.length) {
    for (const f of ph.on_enter_flags_set) st.flags.add(f);
  }

  if (!ph) {
    return { beats: before, place: pl, problem: `il luogo "${placeId}" non ha nessuna fase valida in questo stato` };
  }

  const beats = [...before, ...(ph.narration ?? [])];
  return { beats, place: pl, phase: ph, ending: ph.ending };
}

/** Il primo ingresso della partita: atto iniziale, luogo iniziale, inventario
 * di partenza. */
export function start(idx: StoryIndex, st: GameState, sink: EffectSink): EnterResult {
  const act = idx.acts.get(idx.story.start_act);
  if (!act) return { beats: [], problem: `l'atto iniziale "${idx.story.start_act}" non esiste` };
  for (const it of idx.story.initial_inventory ?? []) {
    if (!st.hasItem(it)) st.inventory.push(it);
  }
  st.enterAct(act.id);
  return enterPlace(idx, st, act.start_place, sink);
}
