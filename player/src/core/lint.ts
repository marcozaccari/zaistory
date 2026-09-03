/**
 * Il linter di giocabilità.
 *
 * La validazione di schema dice che una storia è **ben formata**; questo dice
 * se è **giocabile**. È il modo più economico di scoprire che non lo è senza
 * prima generare immagini e voci — trova le porte chiuse a chiave, non se la
 * storia si gioca *bene*: per quello serve giocarla.
 *
 * Tre gravità, e la differenza non è di tono:
 *
 * - **errore**: la storia non si può finire, o un riferimento non esiste. Non è
 *   un'opinione.
 * - **avviso**: la storia gira ma da qualche parte resta muta. Sono i controlli
 *   che nascono da una regola sola — *un luogo non deve poter restare senza
 *   niente da dire* — e sono quelli che si è tentati di ignorare, sbagliando.
 * - **info**: una misura, non un difetto.
 *
 * Lo schema è permissivo perché è il contratto; qui si è severi perché questo è
 * il collaudo. Molti campi opzionali nello schema sono obbligatori per giocare,
 * ed è qui che la differenza si vede.
 */

import type { Act, Action, Condition, Effect, Phase, Place, StoryIndex } from './types.js';

export type Severity = 'errore' | 'avviso' | 'info';

export interface Finding {
  severity: Severity;
  where: string;
  message: string;
}

const ORDER: Record<Severity, number> = { errore: 0, avviso: 1, info: 2 };

export function lint(idx: StoryIndex): Finding[] {
  const f: Finding[] = [];
  const story = idx.story;

  checkStory(idx, f);
  for (const act of story.acts) {
    checkAct(idx, act, f);
    for (const place of act.places) checkPlace(idx, act, place, f);
  }
  checkCarryFlags(idx, f);
  checkReachability(idx, f);
  checkEndings(idx, f);

  return f.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.where.localeCompare(b.where));
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { errore: 0, avviso: 0, info: 0 };
  for (const x of findings) out[x.severity]++;
  return out;
}

// ------------------------------------------------------------------ storia

function checkStory(idx: StoryIndex, f: Finding[]): void {
  const s = idx.story;
  const err = (where: string, message: string) => f.push({ severity: 'errore', where, message });
  const warn = (where: string, message: string) => f.push({ severity: 'avviso', where, message });

  if (!s.protagonist) {
    err('story', 'manca protagonist: senza, a «chi c\'è qui» il player elenca anche chi sta chiedendo');
  } else if (!idx.characters.has(s.protagonist)) {
    err('story.protagonist', `"${s.protagonist}" non è nella roster dei personaggi`);
  }

  const pv = s.player_voice;
  if (!pv) {
    err('story', 'manca player_voice: inventario, presenti, uscite e fallback globali restano senza voce');
  } else {
    const intents = new Set((pv.no_match_narration ?? []).map((n) => n.intent));
    if (!intents.has('generic')) {
      err('story.player_voice', 'manca il fallback globale "generic": è la rete sotto tutte le altre');
    }
    for (const k of ['inventory_intro', 'presence_intro', 'exits_intro'] as const) {
      if (!pv[k]?.length) warn(`story.player_voice.${k}`, 'manca: la domanda corrispondente resta senza risposta d\'autore');
    }
  }

  if (!s.cover) warn('story', 'manca cover: la storia si apre su una pagina di solo testo');

  for (const it of s.initial_inventory ?? []) {
    if (!idx.items.has(it)) err('story.initial_inventory', `l'oggetto "${it}" non è in items[]`);
  }
  for (const c of idx.characters.values()) {
    if (!c.description && !(c.description_variants?.length)) {
      warn(`characters.${c.id}`, 'senza description: un personaggio con cui si parla e che non si può guardare è un buco');
    }
  }
  for (const it of idx.items.values()) {
    if (!it.description && !(it.description_variants?.length)) {
      f.push({ severity: 'errore', where: `items.${it.id}`, message: 'senza description: guardarlo non darebbe niente, e il player non la inventa' });
    }
  }

  // Un id per una cosa sola, in tutta la storia.
  //
  // Gli oggetti d'ambiente vivono nei luoghi, quindi due luoghi diversi
  // *sembrano* poter avere ciascuno la propria `coscia` o la propria `porta`.
  // Non possono: il player indicizza le entità per id in una mappa sola, e la
  // seconda cancella la prima — l'azione del primo luogo si ritrova a puntare
  // all'oggetto del secondo, che non è lì, e sparisce senza dire niente. Lo
  // stesso vale fra specie diverse, dove l'ordine di ricerca è props →
  // personaggi → oggetti e il perdente diventa irraggiungibile.
  const visti = new Map<string, string>();
  const dichiara = (id: string, dove: string) => {
    const prima = visti.get(id);
    if (prima) {
      err(dove, `l'id "${id}" è già di ${prima}: un id vale per una cosa sola in tutta la storia, o la seconda cancella la prima`);
    } else {
      visti.set(id, dove);
    }
  };
  for (const c of idx.characters.values()) dichiara(c.id, `characters.${c.id}`);
  for (const it of idx.items.values()) dichiara(it.id, `items.${it.id}`);
  for (const act of s.acts) {
    for (const pl of act.places) {
      for (const o of pl.objects ?? []) dichiara(o.id, `places.${pl.id}.objects.${o.id}`);
    }
  }
}

// -------------------------------------------------------------------- atto

function checkAct(idx: StoryIndex, act: Act, f: Finding[]): void {
  const declared = new Set([...(act.flags ?? []), ...(act.reads_carry_flags ?? []), ...(act.writes_carry_flags ?? [])]);
  const used = new Set<string>();
  const set = new Set<string>();

  const scan = (e: Effect | undefined) => {
    if (!e) return;
    if (e.set_flag) set.add(e.set_flag);
    if (e.unset_flag) set.add(e.unset_flag);
  };
  const scanCond = (c: Condition | undefined) => {
    if (!c) return;
    if (c.flag_present) used.add(c.flag_present);
    if (c.flag_absent) used.add(c.flag_absent);
    // Una condizione composta ne contiene altre: senza scendere, un flag
    // dentro un `all_of` risulterebbe non dichiarato da nessuno.
    for (const sub of [...(c.all_of ?? []), ...(c.any_of ?? [])]) scanCond(sub);
  };

  for (const pl of act.places) {
    scanCond(pl.completed_when);
    for (const o of pl.objects ?? []) {
      scanCond(o.present_when);
      for (const v of o.description_variants ?? []) scanCond(v.condition);
    }
    for (const ex of pl.exits ?? []) {
      scanCond(ex.known_when);
      scanCond(ex.condition);
      for (const t of ex.transitions ?? []) scanCond(t.condition);
    }
    for (const a of pl.actions ?? []) {
      scanCond(a.condition);
      scan(a.effect);
    }
    for (const ph of pl.phases) {
      scanCond(ph.condition);
      for (const v of ph.look_variants ?? []) scanCond(v.condition);
      for (const fl of ph.on_enter_flags_set ?? []) set.add(fl);
      for (const a of ph.actions ?? []) {
        scanCond(a.condition);
        scan(a.effect);
      }
      for (const n of Object.values(ph.dialogue?.nodes ?? {})) {
        scan(n.effect);
        for (const c of n.choices ?? []) {
          scanCond(c.condition);
          scan(c.effect);
        }
      }
    }
  }

  const carryAll = new Set((idx.story.carry_flags ?? []).map((c) => c.id));
  for (const fl of [...used, ...set]) {
    if (declared.has(fl)) continue;
    if (carryAll.has(fl)) {
      f.push({
        severity: 'errore',
        where: `acts.${act.id}`,
        message: `usa il carry flag "${fl}" senza dichiararlo in reads_carry_flags o writes_carry_flags`,
      });
    } else {
      f.push({
        severity: 'errore',
        where: `acts.${act.id}`,
        message: `il flag "${fl}" non è dichiarato in acts.${act.id}.flags — i flag sono locali all'atto, e uno di un altro atto qui non esisterebbe`,
      });
    }
  }
  for (const fl of used) {
    if (!set.has(fl) && !carryAll.has(fl)) {
      f.push({ severity: 'errore', where: `acts.${act.id}`, message: `il flag "${fl}" è richiesto da una condizione ma non lo imposta niente` });
    }
  }
}

function checkCarryFlags(idx: StoryIndex, f: Finding[]): void {
  const carry = idx.story.carry_flags ?? [];
  if (carry.length > 3) {
    f.push({ severity: 'errore', where: 'story.carry_flags', message: `sono ${carry.length}: il tetto è tre, e oltre quella soglia la verifica per atto smette di essere esaustiva` });
  }
  const written = new Set<string>();
  const read = new Set<string>();
  const order = new Map<string, number>();
  idx.story.acts.forEach((a, i) => {
    order.set(a.id, i);
    for (const c of a.writes_carry_flags ?? []) written.add(c);
    for (const c of a.reads_carry_flags ?? []) read.add(c);
  });
  for (const c of carry) {
    if (!written.has(c.id)) f.push({ severity: 'errore', where: `carry_flags.${c.id}`, message: 'nessun atto lo dichiara in scrittura' });
    if (!read.has(c.id)) {
      f.push({ severity: 'errore', where: `carry_flags.${c.id}`, message: 'nessun atto lo legge: la memoria morta è il primo sintomo di un canale che si riempie per inerzia' });
    }
  }
  // Chi lo legge deve venire dopo chi lo scrive, o non arriverà mai.
  for (const c of carry) {
    const w = Math.min(...idx.story.acts.filter((a) => (a.writes_carry_flags ?? []).includes(c.id)).map((a) => order.get(a.id) ?? 99));
    const r = Math.max(...idx.story.acts.filter((a) => (a.reads_carry_flags ?? []).includes(c.id)).map((a) => order.get(a.id) ?? -1));
    if (Number.isFinite(w) && r >= 0 && r < w) {
      f.push({ severity: 'avviso', where: `carry_flags.${c.id}`, message: 'è letto da un atto che viene prima di quello che lo scrive' });
    }
  }
}

// ------------------------------------------------------------------- luogo

function checkPlace(idx: StoryIndex, act: Act, pl: Place, f: Finding[]): void {
  const err = (message: string, where = `places.${pl.id}`) => f.push({ severity: 'errore', where, message });
  const warn = (message: string, where = `places.${pl.id}`) => f.push({ severity: 'avviso', where, message });

  if (!pl.aliases?.length) warn('senza aliases: «vai al magazzino» non arriverebbe qui');

  if (pl.same_as) {
    const altro = idx.places.get(pl.same_as);
    if (!altro) {
      err(`same_as punta a "${pl.same_as}", che non esiste`);
    } else if (idx.actOfPlace.get(pl.same_as) === act.id) {
      // Due nodi dello stesso atto che sono lo stesso posto non sono due
      // luoghi: sono un luogo con due fasi.
      err(`same_as punta a "${pl.same_as}", che è nello stesso atto: due nodi dello stesso posto nello stesso atto vanno uniti in un luogo solo con più fasi`);
    } else if (altro.same_as) {
      err(`same_as punta a "${pl.same_as}", che a sua volta ne ha uno: la catena va appiattita sul luogo che porta l'aspetto`);
    }
    if (pl.visual_prompt) {
      warn(`ha same_as e anche un visual_prompt suo: l'aspetto lo porta "${pl.same_as}", e due descrizioni della stessa stanza divergono alla prima modifica`);
    }
  } else if (!pl.visual_prompt) {
    warn("senza visual_prompt: il modulo assets non ha un'ancora su cui tenere coerenti le viste di qui");
  }

  // Le fasi si valutano in ordine: l'ultima senza condizione è la rete.
  const last = pl.phases[pl.phases.length - 1];
  if (last?.condition && Object.keys(last.condition).length > 0) {
    err('l\'ultima fase ha una condizione: in certi stati il luogo resterebbe senza niente da dire');
  }
  if (pl.completed_when && !pl.phases.some((ph) => sameCondition(ph.condition, pl.completed_when))) {
    warn('completed_when non ha una fase corrispondente: qui non c\'è lo stato «esaurito», cioè cosa si legge tornandoci quando non resta niente');
  }

  // Un'azione del LUOGO che apre un dialogo lo apre in qualunque fase, perché
  // vale in qualunque fase — ma l'albero sta sulla fase, e non tutte le fasi
  // hanno lo stesso. Dove manca, l'azione c'è, si può chiedere, e non fa
  // niente: il player lo segnala come diagnostica e il giocatore vede un
  // buco. È il prezzo di `Place.actions`, e si paga una volta sola scrivendolo
  // qui.
  for (const a of pl.actions ?? []) {
    const nodo = a.effect.goto_dialogue;
    if (!nodo) continue;
    for (const ph of pl.phases) {
      if (!ph.dialogue?.nodes[nodo]) {
        err(`l'azione "${a.id}" del luogo apre il nodo "${nodo}", che la fase "${ph.id}" non ha: lì l'azione si può chiedere e non fa niente`);
      }
    }
  }

  for (const ex of pl.exits ?? []) {
    const w = `places.${pl.id} → ${ex.to}`;
    if (!ex.aliases?.length && !ex.label) warn('uscita senza aliases né label: non si può chiedere a parole', w);
    if (ex.condition && Object.keys(ex.condition).length && !ex.blocked_narration) {
      warn('uscita condizionata senza blocked_narration: chi ci prova riceve un non-ho-capito generico', w);
    }
    const destAct = idx.actOfPlace.get(ex.to);
    if (destAct && destAct !== act.id) {
      const items = requiredItemsDownstream(idx, destAct);
      const chiesti = new Set<string>();
      collectItems(ex.condition, chiesti);
      const asked = chiesti.size > 0;
      if (items.size > 0 && !asked) {
        warn(`chiude l'atto senza chiedere nessun oggetto, ma a valle ne servono (${[...items].join(', ')}): «non posso usare ciò che non ho preso, e non posso tornare indietro a prenderlo»`, w);
      }
    }
  }

  const allActions = [...(pl.actions ?? []), ...pl.phases.flatMap((ph) => ph.actions ?? [])];
  const ids = new Set<string>();
  for (const a of allActions) {
    if (ids.has(a.id)) err(`due azioni con lo stesso id "${a.id}"`);
    ids.add(a.id);
  }

  for (const ph of pl.phases) checkPhase(idx, pl, ph, f);
  for (const a of pl.actions ?? []) checkAction(idx, `places.${pl.id}.actions.${a.id}`, a, f);
}

function checkPhase(idx: StoryIndex, pl: Place, ph: Phase, f: Finding[]): void {
  const where = `places.${pl.id}.phases.${ph.id}`;
  const err = (message: string) => f.push({ severity: 'errore', where, message });
  const warn = (message: string) => f.push({ severity: 'avviso', where, message });
  const cutscene = ph.kind === 'cutscene';

  if (!cutscene) {
    if (!ph.look) err('fase interattiva senza look: «guardati intorno» e «dove sono» restano senza risposta');
    const intents = new Set((ph.no_match_narration ?? []).map((n) => n.intent));
    const globalGeneric = (idx.story.player_voice?.no_match_narration ?? []).some((n) => n.intent === 'generic');
    if (!intents.size && !globalGeneric) err('nessun fallback raggiungibile: quando il gioco non capisce non ha niente da dire');
  } else {
    if (!ph.narration?.length) warn('cutscene senza narration: non c\'è niente da montare');
    if (ph.dialogue) warn('cutscene con un dialogo: se ci sono scelte reali non è una cutscene');
  }

  if (!ph.background) warn('senza background: il palco non ha niente da mostrare né da descrivere');
  for (const id of ph.background?.characters_in_frame ?? []) {
    if (!idx.characters.has(id)) err(`characters_in_frame nomina "${id}", che non è nella roster`);
  }
  for (const c of ph.characters ?? []) {
    if (!idx.characters.has(c.id)) err(`characters nomina "${c.id}", che non è nella roster`);
  }

  // La regola che vale doppio: se un flag prodotto QUI apre o chiude un'azione
  // QUI, allora qui è cambiato qualcosa, e il look è l'unico posto in cui il
  // giocatore può accorgersene.
  const produced = new Set<string>();
  for (const a of ph.actions ?? []) {
    if (a.effect.set_flag) produced.add(a.effect.set_flag);
    if (a.effect.unset_flag) produced.add(a.effect.unset_flag);
  }
  const gating = new Set<string>();
  for (const a of [...(pl.actions ?? []), ...(ph.actions ?? [])]) {
    for (const k of [a.condition?.flag_present, a.condition?.flag_absent]) if (k && produced.has(k)) gating.add(k);
  }
  const varied = new Set<string>();
  for (const v of ph.look_variants ?? []) {
    for (const k of [v.condition.flag_present, v.condition.flag_absent]) if (k) varied.add(k);
  }
  for (const flag of gating) {
    if (!varied.has(flag)) {
      warn(`il flag "${flag}" apre o chiude un'azione qui, ma il look non ha una variante che lo racconti: la scena non è difficile, è muta`);
    }
  }

  for (const a of ph.actions ?? []) checkAction(idx, `${where}.actions.${a.id}`, a, f);
  if (ph.dialogue) checkDialogue(idx, where, pl, ph, f);

  for (const e of collectEffects(ph)) {
    if (e.goto_place && !idx.places.has(e.goto_place)) err(`goto_place verso "${e.goto_place}", che non esiste`);
    if (e.goto_dialogue && !ph.dialogue?.nodes[e.goto_dialogue]) {
      err(`goto_dialogue verso "${e.goto_dialogue}", che non è un nodo del dialogo di questa fase`);
    }
    if (e.add_inventory && !idx.items.has(e.add_inventory)) err(`add_inventory di "${e.add_inventory}", che non è in items[]`);
    if (e.remove_inventory && !idx.items.has(e.remove_inventory)) err(`remove_inventory di "${e.remove_inventory}", che non è in items[]`);
  }
}

function checkAction(idx: StoryIndex, where: string, a: Action, f: Finding[]): void {
  const err = (message: string) => f.push({ severity: 'errore', where, message });
  const warn = (message: string) => f.push({ severity: 'avviso', where, message });

  for (const t of [a.target, a.second_target]) {
    if (!t) continue;
    const e = idx.props.get(t) ?? idx.characters.get(t) ?? idx.items.get(t);
    if (!e) {
      err(`il bersaglio "${t}" non è un oggetto d'ambiente, un personaggio o un oggetto d'inventario`);
      continue;
    }
    if (!('description' in e) || (!e.description && !e.description_variants?.length)) {
      err(`il bersaglio "${t}" non ha description: tutto ciò con cui si interagisce deve essere osservabile`);
    }
    const aliases = e.aliases?.length ?? 0;
    if (aliases < 5) {
      warn(`il bersaglio "${t}" ha ${aliases} alias: con il modello a verbi la copertura sta sulle entità, e cinque sono pochi`);
    }
  }

  if (a.condition && Object.keys(a.condition).length > 0 && !a.blocked_narration) {
    warn('condizionata senza blocked_narration: chi la chiede troppo presto riceve un non-ho-capito invece della storia. Non esiste la deroga «questa nessuno la incontrerà mai al contrario»');
  }
  const tests = a.test_phrases?.length ?? 0;
  if (tests < 3) warn(`ha ${tests} test_phrases: senza, la copertura del parser su questa azione non si misura`);
  else {
    const surfaces = new Set<string>();
    for (const t of [a.target, a.second_target]) {
      const e = t ? idx.props.get(t) ?? idx.characters.get(t) ?? idx.items.get(t) : undefined;
      for (const s of e?.aliases ?? []) surfaces.add(s.toLowerCase().trim());
    }
    for (const p of a.test_phrases ?? []) {
      if (surfaces.has(p.toLowerCase().trim())) {
        warn(`la frase di prova "${p}" è identica a un alias: misura il lookup, non il richiamo`);
      }
    }
  }
}

function checkDialogue(idx: StoryIndex, where: string, pl: Place, ph: Phase, f: Finding[]): void {
  const tree = ph.dialogue!;
  const err = (message: string) => f.push({ severity: 'errore', where: `${where}.dialogue`, message });

  if (!tree.nodes[tree.start]) err(`start "${tree.start}" non è un nodo`);

  // Le radici non sono una sola. `start` è dove il dialogo comincia se nessuno
  // dice altrimenti, ma `goto_dialogue` apre l'albero **a partire da un nodo
  // qualunque**, ed è così che una sola conversazione serve più momenti della
  // stessa scena: il discorso sulla scatola e il bivio di quando Mark è già
  // lassù sono due ingressi dello stesso albero. Contare solo `start` farebbe
  // risultare morto tutto quello che si raggiunge da un'azione.
  const reachable = new Set<string>();
  const queue = [tree.start];
  for (const a of [...(pl.actions ?? []), ...(ph.actions ?? [])]) {
    if (a.effect.goto_dialogue) queue.push(a.effect.goto_dialogue);
  }
  while (queue.length) {
    const id = queue.pop()!;
    if (reachable.has(id) || !tree.nodes[id]) continue;
    reachable.add(id);
    const n = tree.nodes[id];
    if (n.next) queue.push(n.next);
    for (const c of n.choices ?? []) queue.push(c.goto);
  }

  let narratorNodes = 0;
  for (const [id, n] of Object.entries(tree.nodes)) {
    if (!reachable.has(id)) err(`il nodo "${id}" non è raggiungibile`);
    if (n.speaker === 'narrator') narratorNodes++;
    else if (!idx.characters.has(n.speaker)) err(`il nodo "${id}" ha speaker "${n.speaker}", che non è nella roster`);
    if (!n.end && !n.next && !n.choices?.length && !n.effect?.goto_place) {
      err(`il nodo "${id}" è monco: né scelte, né next, né end`);
    }
    if (n.next && !tree.nodes[n.next]) err(`il nodo "${id}" punta a "${n.next}", che non esiste`);
    for (const c of n.choices ?? []) {
      if (!tree.nodes[c.goto]) err(`una scelta di "${id}" punta a "${c.goto}", che non esiste`);
    }
  }

  const total = Object.keys(tree.nodes).length;
  if (total >= 4 && narratorNodes / total < 1 / 6) {
    f.push({
      severity: 'info',
      where: `${where}.dialogue`,
      message: `${narratorNodes} didascalie su ${total} nodi: un dialogo a cui sono state tolte si gioca benissimo, e non se ne accorge nessuno finché non lo si legge`,
    });
  }
}

// ------------------------------------------------------- raggiungibilità

/**
 * La chiusura in avanti: partendo da quello che si ha, cosa si riesce ad
 * accumulare.
 *
 * È ottimista di proposito — ignora `unset_flag` e `remove_inventory`, e non
 * considera l'ordine — quindi quello che **non** raggiunge non è raggiungibile
 * davvero. Trova le porte chiuse a chiave: un flag richiesto che nessuno alza,
 * un oggetto che serve e non si può prendere, un finale che non si tocca.
 *
 * Non trova invece il vicolo cieco *temporale*: prendere una cosa e poi perderla,
 * o chiudersi una strada alle spalle. Quello lo trova giocare.
 */
interface Closure {
  flags: Set<string>;
  items: Set<string>;
  places: Set<string>;
  phases: Set<string>;
}

function closureOfAct(idx: StoryIndex, act: Act, incoming: Set<string>, carry: Set<string>): Closure {
  const flags = new Set<string>(carry);
  const items = new Set<string>(incoming);
  const places = new Set<string>([act.start_place]);
  const phases = new Set<string>();

  const meets = (c?: Condition): boolean => {
    if (!c) return true;
    if (c.flag_present && !flags.has(c.flag_present)) return false;
    if (c.has_item && !items.has(c.has_item)) return false;
    // flag_absent è sempre soddisfacibile in una chiusura ottimista: c'è un
    // momento in cui quel flag non c'è ancora.
    if ((c.all_of ?? []).some((sub) => !meets(sub))) return false;
    if (c.any_of?.length && !c.any_of.some(meets)) return false;
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const pl of act.places) {
      if (!places.has(pl.id)) continue;
      const grow = (s: Set<string>, v?: string) => {
        if (v && !s.has(v)) {
          s.add(v);
          changed = true;
        }
      };
      const useAction = (a: Action) => {
        if (!meets(a.condition)) return;
        grow(flags, a.effect.set_flag);
        grow(items, a.effect.add_inventory);
        if (a.effect.goto_place) grow(places, a.effect.goto_place);
      };
      for (const a of pl.actions ?? []) useAction(a);
      for (const ph of pl.phases) {
        if (!meets(ph.condition)) continue;
        if (!phases.has(ph.id)) {
          phases.add(ph.id);
          changed = true;
        }
        for (const fl of ph.on_enter_flags_set ?? []) grow(flags, fl);
        for (const a of ph.actions ?? []) useAction(a);
        for (const n of Object.values(ph.dialogue?.nodes ?? {})) {
          grow(flags, n.effect?.set_flag);
          grow(items, n.effect?.add_inventory);
          for (const c of n.choices ?? []) {
            grow(flags, c.effect?.set_flag);
            grow(items, c.effect?.add_inventory);
          }
        }
      }
      for (const ex of pl.exits ?? []) {
        if (!meets(ex.condition)) continue;
        if (idx.actOfPlace.get(ex.to) === act.id) grow(places, ex.to);
      }
    }
  }
  return { flags, items, places, phases };
}

function checkReachability(idx: StoryIndex, f: Finding[]): void {
  const carry = new Set<string>();
  let items = new Set<string>(idx.story.initial_inventory ?? []);

  for (const act of idx.story.acts) {
    const cl = closureOfAct(idx, act, items, carry);

    for (const pl of act.places) {
      if (!cl.places.has(pl.id)) {
        f.push({ severity: 'errore', where: `places.${pl.id}`, message: `irraggiungibile dall'inizio dell'atto "${act.id}"` });
        continue;
      }
      for (const ph of pl.phases) {
        if (!cl.phases.has(ph.id)) {
          f.push({ severity: 'avviso', where: `places.${pl.id}.phases.${ph.id}`, message: 'nessuno stato raggiungibile la rende valida' });
        }
      }
    }

    // L'atto si chiude prendendo un'uscita verso un altro atto.
    const isLast = act === idx.story.acts[idx.story.acts.length - 1];
    const closing = act.places
      .filter((p) => cl.places.has(p.id))
      .flatMap((p) => (p.exits ?? []).map((e) => ({ p, e })))
      .filter(({ e }) => idx.actOfPlace.get(e.to) !== act.id);
    if (!isLast && closing.length === 0) {
      f.push({ severity: 'errore', where: `acts.${act.id}`, message: 'nessuna uscita raggiungibile porta a un altro atto: la storia si ferma qui' });
    }
    const usable = closing.filter(({ e }) => {
      const chiesti = new Set<string>();
      collectItems(e.condition, chiesti);
      return [...chiesti].every((it) => cl.items.has(it));
    });
    if (!isLast && closing.length > 0 && usable.length === 0) {
      f.push({ severity: 'errore', where: `acts.${act.id}`, message: 'l\'uscita che chiude l\'atto chiede un oggetto che in questo atto non si può ottenere' });
    }

    for (const c of act.writes_carry_flags ?? []) if (cl.flags.has(c)) carry.add(c);
    items = cl.items;
  }
}

function checkEndings(idx: StoryIndex, f: Finding[]): void {
  const mode = idx.story.failure_mode ?? 'none';
  let natural = 0;
  for (const act of idx.story.acts) {
    for (const pl of act.places) {
      for (const ph of pl.phases) {
        if (!ph.ending) continue;
        if (ph.ending.kind === 'natural') natural++;
        if (ph.ending.kind === 'premature') {
          if (mode === 'none') {
            f.push({
              severity: 'errore',
              where: `places.${pl.id}.phases.${ph.id}`,
              message: 'finale prematuro in una storia con failure_mode "none": qui non si perde',
            });
          }
          const byExit = idx.story.acts.some((a) =>
            a.places.some((p) => (p.exits ?? []).some((e) => e.to === pl.id)),
          );
          if (byExit) {
            f.push({
              severity: 'errore',
              where: `places.${pl.id}.phases.${ph.id}`,
              message: 'un finale prematuro si raggiunge solo da un\'azione, mai da un\'uscita: qui basterebbe camminarci dentro',
            });
          }
        }
      }
    }
  }
  if (natural === 0) f.push({ severity: 'errore', where: 'story', message: 'nessun finale naturale: la storia non finisce' });
}

// ------------------------------------------------------------------ utili

function collectEffects(ph: Phase): Effect[] {
  const out: Effect[] = [];
  for (const a of ph.actions ?? []) out.push(a.effect);
  for (const n of Object.values(ph.dialogue?.nodes ?? {})) {
    if (n.effect) out.push(n.effect);
    for (const c of n.choices ?? []) if (c.effect) out.push(c.effect);
  }
  return out;
}

function sameCondition(a?: Condition, b?: Condition): boolean {
  if (!a || !b) return false;
  return a.flag_present === b.flag_present && a.flag_absent === b.flag_absent && a.has_item === b.has_item;
}

/**
 * Gli oggetti che da qui in avanti servono e **che da qui in avanti non si
 * trovano**. Serve a sapere cosa deve chiedere l'uscita che chiude l'atto
 * precedente.
 *
 * La sottrazione è tutto il senso della funzione. Il coltello serve nell'atto
 * della campagna e nell'atto della campagna si trova, dentro una cassetta degli
 * attrezzi: pretenderlo sulla porta dell'atto prima vorrebbe dire pretendere
 * che il giocatore lo abbia preso prima di poterlo prendere. Quello che resta
 * dopo la sottrazione è invece il vero elenco delle cose che si possono
 * raccogliere solo prima e usare solo dopo — cioè l'unico modo in cui questa
 * struttura ad atti può rendere una storia insolubile.
 */
function requiredItemsDownstream(idx: StoryIndex, fromAct: string): Set<string> {
  const serve = new Set<string>();
  const si_trova = new Set<string>();
  let seen = false;
  for (const act of idx.story.acts) {
    if (act.id === fromAct) seen = true;
    if (!seen) continue;
    for (const pl of act.places) {
      for (const ex of pl.exits ?? []) collectItems(ex.condition, serve);
      const azioni = [...(pl.actions ?? []), ...pl.phases.flatMap((p) => p.actions ?? [])];
      for (const a of azioni) {
        collectItems(a.condition, serve);
        if (a.effect.add_inventory) si_trova.add(a.effect.add_inventory);
      }
      for (const ph of pl.phases) {
        for (const e of collectEffects(ph)) if (e.add_inventory) si_trova.add(e.add_inventory);
      }
    }
  }
  for (const it of si_trova) serve.delete(it);
  return serve;
}

/** Gli oggetti che una condizione richiede, rami composti compresi. */
function collectItems(c: Condition | undefined, out: Set<string>): void {
  if (!c) return;
  if (c.has_item) out.add(c.has_item);
  for (const sub of [...(c.all_of ?? []), ...(c.any_of ?? [])]) collectItems(sub, out);
}
