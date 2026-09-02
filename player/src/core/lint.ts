/**
 * Analisi statica di giocabilita': i bug che la validazione di schema non puo'
 * vedere.
 *
 * La distinzione e' quella dell'architettura del progetto: la validazione di
 * schema dice che l'IR e' *ben formato*, il linter e la partita dicono se e'
 * *giocabile*. Qui stanno i controlli statici (goto rotti, scene senza uscita,
 * flag mai impostati, rami di dialogo irraggiungibili); quelli che richiedono
 * di giocare davvero restano al player.
 */

import type { Condition, Effect, Intent, Scene, Story } from './types.js';
import { NARRATORE, SCENE_CUTSCENE, SCENE_INTERACTIVE, coverShot, displayName, findScene, isDidascalia, sceneHasExit, sceneType, shotsOf, type Shot } from './types.js';
import { verboDelPlayer } from './verbi.js';

export type Level = 'info' | 'avviso' | 'errore';

/**
 * Sotto quanti alias la copertura di un'azione si sente.
 *
 * Non e' un numero magico: e' l'ordine di grandezza a cui un elenco di
 * sinonimi smette di coprire i modi in cui la stessa cosa si chiede. Tre alias
 * coprono tre frasi; quindici cominciano a coprire un modo di parlare.
 */
export const SOGLIA_ALIAS = 8;

/**
 * Sotto quanti nodi un dialogo e' troppo corto perche' valga la pena contare le
 * descrizioni. Uno scambio di tre battute serrate senza didascalie e' una
 * scelta di scrittura legittima, e segnalarlo sarebbe solo rumore.
 */
export const MIN_NODI_DIALOGO = 4;

/**
 * Ogni quanti nodi ci si aspetta almeno una descrizione.
 *
 * E' un rapporto e non un conteggio, ed e' l'unica forma che funziona: la
 * regola "zero descrizioni" lascia passare proprio il caso da cui questo
 * controllo e' nato — undici battute con una sola didascalia superstite, che a
 * giocarle sono dieci frasi a vuoto di fila. Sei e' largo apposta: deve
 * accendersi su un dialogo spogliato, non su uno scritto fitto.
 */
export const NODI_PER_DESCRIZIONE = 6;

export interface Finding {
  level: Level;
  /** Posizione leggibile: scena, azione, nodo... */
  where: string;
  msg: string;
}

export function formatFinding(f: Finding): string {
  const lv = f.level.padEnd(7);
  return f.where ? `${lv} [${f.where}] ${f.msg}` : `${lv} ${f.msg}`;
}

export function countFindings(fs: Finding[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: fs.filter((f) => f.level === 'errore').length,
    warnings: fs.filter((f) => f.level === 'avviso').length,
    infos: fs.filter((f) => f.level === 'info').length,
  };
}

interface EffLoc {
  eff: Effect;
  where: string;
}
interface CondLoc {
  cond: Condition;
  where: string;
}

function allEffects(sc: Scene): EffLoc[] {
  const out: EffLoc[] = [];
  for (const a of sc.actions) {
    if (a.effect) out.push({ eff: a.effect, where: `${sc.id} / ${a.id}` });
  }
  if (sc.dialogue_tree) {
    for (const [id, n] of Object.entries(sc.dialogue_tree.nodes)) {
      if (n.effect) out.push({ eff: n.effect, where: `${sc.id} / nodo ${id}` });
      (n.choices ?? []).forEach((c, k) => {
        if (c.effect) out.push({ eff: c.effect, where: `${sc.id} / nodo ${id} / scelta ${k + 1}` });
      });
    }
  }
  return out;
}

function allConditions(sc: Scene): CondLoc[] {
  const out: CondLoc[] = [];
  for (const a of sc.actions) {
    if (a.condition) out.push({ cond: a.condition, where: `${sc.id} / ${a.id}` });
  }
  if (sc.dialogue_tree) {
    for (const [id, n] of Object.entries(sc.dialogue_tree.nodes)) {
      (n.choices ?? []).forEach((c, k) => {
        if (c.condition) out.push({ cond: c.condition, where: `${sc.id} / nodo ${id} / scelta ${k + 1}` });
      });
    }
  }
  return out;
}

class Linter {
  findings: Finding[] = [];
  constructor(private story: Story) {}

  add(level: Level, where: string, msg: string): void {
    this.findings.push({ level, where, msg });
  }

  // ----------------------------------------------------------------- scene

  checkScenes(): void {
    for (const sc of this.story.scenes) {
      const where = sc.id;

      if (!sc.background?.image_prompt) {
        this.add('errore', where, 'manca background.image_prompt (richiesto dallo schema)');
      }
      if (sc.actions.length === 0) {
        // Una scena senza azioni e' un bug solo se la storia dovrebbe
        // proseguire: se da qui non esce nessun goto_scene, e' un finale.
        if (sceneHasExit(sc)) {
          this.add('errore', where, 'nessuna azione: la scena non ha alcun modo di proseguire');
        } else {
          this.add('info', where, "scena senza azioni: e' un finale della storia");
        }
      }
      if (sceneType(sc) === SCENE_CUTSCENE) {
        if (sc.dialogue_tree) {
          this.add('avviso', where, 'cutscene con dialogue_tree: per convenzione una cutscene non ha dialoghi');
        }
        if (sc.actions.length > 1) {
          this.add('avviso', where, `cutscene con ${sc.actions.length} azioni: per convenzione ne ha una sola ("continua")`);
        }
        if ((sc.narration ?? []).length === 0) {
          this.add('avviso', where, 'cutscene senza narration[]: non ha nulla da raccontare');
        }
      }

      const seen = new Set<string>();
      sc.actions.forEach((a, j) => {
        const aw = `${where} / ${a.id}`;
        if (!a.id) this.add('errore', where, `azione ${j} senza id`);
        if (seen.has(a.id)) this.add('errore', aw, 'id di azione duplicato nella stessa scena');
        seen.add(a.id);
        if (!a.label) this.add('errore', aw, 'azione senza label');
        if (!a.effect) {
          this.add('errore', aw, 'azione senza effect (richiesto dallo schema): selezionarla non farebbe nulla');
          return;
        }
        this.checkEffect(sc, aw, a.effect);
      });

      this.checkLookVarianti(sc);
      this.checkDialogue(sc);
    }
  }

  checkEffect(sc: Scene, where: string, e?: Effect): void {
    if (!e) return;
    if (e.goto_scene && !findScene(this.story, e.goto_scene)) {
      this.add('errore', where, `goto_scene punta alla scena inesistente "${e.goto_scene}"`);
    }
    if (e.goto_dialogue) {
      if (!sc.dialogue_tree) {
        this.add('errore', where, `goto_dialogue "${e.goto_dialogue}" ma la scena non ha dialogue_tree`);
      } else if (!sc.dialogue_tree.nodes[e.goto_dialogue]) {
        this.add('errore', where, `goto_dialogue punta al nodo inesistente "${e.goto_dialogue}"`);
      }
    }
    if (e.goto_scene && e.goto_dialogue) {
      this.add('avviso', where, 'goto_scene e goto_dialogue insieme: il player esegue la transizione di scena e ignora il dialogo');
    }
    if (e.set_flag && e.set_flag === e.unset_flag) {
      this.add('avviso', where, `set_flag e unset_flag sullo stesso flag "${e.set_flag}"`);
    }
  }

  /**
   * Un flag che apre o chiude un'azione **in questa stessa scena**, ma che il
   * `look` ignora.
   *
   * Se un flag cambia cosa si puo' fare qui, per definizione qualcosa qui e'
   * cambiato — e il `look` e' l'unico posto in cui il giocatore puo'
   * accorgersene, perche' e' l'unico testo della scena che si rilegge quando si
   * vuole. Senza la variante corrispondente si rilegge la stanza di partenza e
   * si conclude di non aver combinato niente.
   *
   * Il caso che ha fatto scrivere il controllo: una scena di fuga in cui
   * `carrello_visto` chiudeva «corri» e apriva «rovescia il carrello», con zero
   * `look_variants` e nessuna menzione del carrello da nessuna parte. Il
   * giocatore aveva in mano tutto tranne la parola: non una scena difficile,
   * una scena muta.
   *
   * Si guardano solo i flag **prodotti dalla scena stessa**: uno impostato
   * altrove descrive qualcosa che qui non e' successo, e pretendere che la
   * stanza lo racconti sarebbe sbagliato.
   */
  checkLookVarianti(sc: Scene): void {
    if (sceneType(sc) === SCENE_CUTSCENE) return;

    const impostatiQui = new Set<string>();
    const raccogli = (e?: Effect) => {
      if (e?.set_flag) impostatiQui.add(e.set_flag);
    };
    for (const a of sc.actions) raccogli(a.effect);
    for (const f of sc.on_enter_flags_set ?? []) impostatiQui.add(f);
    for (const n of Object.values(sc.dialogue_tree?.nodes ?? {})) {
      raccogli(n.effect);
      for (const c of n.choices ?? []) raccogli(c.effect);
    }

    // I flag che, qui, decidono se un'azione si puo' fare.
    const cancelli = new Set<string>();
    for (const a of sc.actions) {
      const c = a.condition;
      if (c?.flag_present && impostatiQui.has(c.flag_present)) cancelli.add(c.flag_present);
      if (c?.flag_absent && impostatiQui.has(c.flag_absent)) cancelli.add(c.flag_absent);
    }
    if (cancelli.size === 0) return;

    const raccontati = new Set<string>();
    for (const v of sc.look_variants ?? []) {
      if (v.condition.flag_present) raccontati.add(v.condition.flag_present);
      if (v.condition.flag_absent) raccontati.add(v.condition.flag_absent);
    }

    const muti = [...cancelli].filter((f) => !raccontati.has(f)).sort();
    if (muti.length === 0) return;
    this.add(
      'avviso',
      sc.id,
      `il flag ${muti.map((f) => `"${f}"`).join(', ')} cambia cosa si puo' fare qui, ma il look non cambia: guardandosi intorno si rilegge la stanza di prima (manca look_variants)`,
    );
  }

  checkDialogue(sc: Scene): void {
    const dt = sc.dialogue_tree;
    if (!dt) return;
    const where = `${sc.id} / dialogue_tree`;

    if (!dt.nodes[dt.start]) {
      this.add('errore', where, `start punta al nodo inesistente "${dt.start}"`);
    }

    // Punti di ingresso: lo start piu' ogni goto_dialogue che arriva dalle
    // azioni della scena.
    const entries = new Set<string>();
    let entryFromAction = false;
    for (const a of sc.actions) {
      if (a.effect?.goto_dialogue) {
        entries.add(a.effect.goto_dialogue);
        entryFromAction = true;
      }
    }
    if (!entryFromAction) {
      this.add('avviso', where, "nessuna azione della scena porta al dialogo (goto_dialogue): l'albero e' irraggiungibile");
      entries.add(dt.start);
    }

    const ids = Object.keys(dt.nodes).sort();

    for (const id of ids) {
      const n = dt.nodes[id];
      const nw = `${sc.id} / nodo ${id}`;
      if (!n.speaker) this.add('errore', nw, 'nodo senza speaker');
      this.checkEffect(sc, nw, n.effect);

      (n.choices ?? []).forEach((c, k) => {
        const cw = `${nw} / scelta ${k + 1}`;
        if (!c.goto) this.add('errore', cw, 'scelta senza goto');
        else if (!dt.nodes[c.goto]) this.add('errore', cw, `goto punta al nodo inesistente "${c.goto}"`);
        this.checkEffect(sc, cw, c.effect);
      });

      if (n.next) {
        if (!dt.nodes[n.next]) this.add('errore', nw, `next punta al nodo inesistente "${n.next}"`);
        if ((n.choices ?? []).length > 0) {
          this.add('avviso', nw, 'ha sia choices sia next: il player usa le scelte e ignora next');
        }
      }

      const leadsOut = !!(n.effect?.goto_scene || n.effect?.goto_dialogue);
      if (!n.end && !n.next && (n.choices ?? []).length === 0 && !leadsOut) {
        this.add('errore', nw, 'nodo monco: nessuna scelta, nessun next, nessun end - il dialogo si interrompe qui');
      }
    }

    // Un dialogo lungo senza nemmeno una didascalia.
    //
    // Non e' un errore di struttura — si gioca benissimo — ed e' proprio per
    // questo che serve dirlo: e' la firma di una compilazione che ha buttato
    // via le didascalie della sceneggiatura, quelle che stanno fra due battute
    // e dicono cosa succede mentre si parla. A leggerlo, un dialogo cosi' e'
    // una sequenza di frasi a vuoto, e senza questo controllo lo si scopre
    // solo giocandolo. Conta anche `effect.narration`, che e' l'altro modo in
    // cui una descrizione puo' stare dentro un dialogo.
    // Le tre forme in cui una descrizione puo' stare dentro un dialogo, e
    // contano tutte: un nodo `narrator`, una `narration` sull'effetto del
    // nodo, e una sull'effetto di una *scelta* — che e' dove finisce ogni
    // didascalia posata su un ramo, e dimenticarla farebbe suonare l'allarme
    // proprio sui dialoghi appena sistemati.
    const descrizioni = ids.filter((id) => {
      const n = dt.nodes[id];
      return isDidascalia(n) || !!n.effect?.narration || (n.choices ?? []).some((c) => !!c.effect?.narration);
    }).length;
    if (ids.length >= MIN_NODI_DIALOGO && descrizioni * NODI_PER_DESCRIZIONE < ids.length) {
      this.add(
        'info',
        where,
        `${ids.length} nodi e ${descrizioni === 0 ? 'nessuna descrizione' : `solo ${descrizioni} descrizione${descrizioni > 1 ? 'i' : ''}`}: nella sceneggiatura le didascalie fra le battute quasi certamente c'erano. Si scrivono come nodi con speaker "${NARRATORE}" (o come effect.narration), e senza si legge una sequenza di frasi a vuoto`,
      );
    }

    // Raggiungibilita' dei nodi a partire dagli ingressi.
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      const n = dt.nodes[id];
      if (!n) return;
      seen.add(id);
      if (n.effect?.goto_dialogue) visit(n.effect.goto_dialogue);
      for (const c of n.choices ?? []) {
        if (c.effect?.goto_dialogue) visit(c.effect.goto_dialogue);
        visit(c.goto);
      }
      if (n.next) visit(n.next);
    };
    for (const id of entries) visit(id);
    for (const id of ids) {
      if (!seen.has(id)) this.add('avviso', `${sc.id} / nodo ${id}`, 'nodo di dialogo irraggiungibile');
    }
  }

  // ------------------------------------------------------ raggiungibilita'

  checkReachability(): void {
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      const sc = findScene(this.story, id);
      if (!sc) return;
      seen.add(id);
      for (const e of allEffects(sc)) {
        if (e.eff.goto_scene) visit(e.eff.goto_scene);
      }
    };
    visit(this.story.start_scene);

    let terminals = 0;
    for (const sc of this.story.scenes) {
      if (!seen.has(sc.id)) this.add('avviso', sc.id, 'scena irraggiungibile da start_scene');
      if (!sceneHasExit(sc)) {
        terminals++;
        this.add('info', sc.id, 'scena terminale: nessun goto_scene esce da qui (finale della storia?)');
      }
    }
    if (terminals === 0) {
      this.add('avviso', '', 'nessuna scena terminale: la storia non ha un finale raggiungibile');
    }
  }

  // --------------------------------------------------------- flag e oggetti

  checkFlagsAndItems(): void {
    const setFlags = new Set<string>();
    const unsetFlags = new Set<string>();
    const addItems = new Set<string>();
    const readFlags = new Map<string, string[]>();
    const readItems = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, v: string) => {
      m.set(k, [...(m.get(k) ?? []), v]);
    };

    for (const it of this.story.initial_inventory ?? []) addItems.add(it);

    for (const sc of this.story.scenes) {
      for (const f of sc.on_enter_flags_set ?? []) setFlags.add(f);
      for (const e of allEffects(sc)) {
        if (e.eff.set_flag) setFlags.add(e.eff.set_flag);
        if (e.eff.unset_flag) unsetFlags.add(e.eff.unset_flag);
        if (e.eff.add_inventory) addItems.add(e.eff.add_inventory);
        if (e.eff.remove_inventory && !addItems.has(e.eff.remove_inventory)) {
          push(readItems, e.eff.remove_inventory, e.where);
        }
      }
      for (const c of allConditions(sc)) {
        if (c.cond.flag_present) push(readFlags, c.cond.flag_present, c.where);
        if (c.cond.flag_absent) push(readFlags, c.cond.flag_absent, c.where);
        if (c.cond.has_item) push(readItems, c.cond.has_item, c.where);
      }
    }

    // Un flag richiesto con flag_present e mai impostato da nessuna parte e'
    // una porta chiusa a chiave che non ha una chiave.
    for (const sc of this.story.scenes) {
      for (const c of allConditions(sc)) {
        if (c.cond.flag_present && !setFlags.has(c.cond.flag_present)) {
          this.add(
            'errore',
            c.where,
            `richiede il flag "${c.cond.flag_present}", che nessuna azione imposta mai: la condizione non sara' mai vera`,
          );
        }
        if (c.cond.has_item && !addItems.has(c.cond.has_item)) {
          this.add('errore', c.where, `richiede l'oggetto "${c.cond.has_item}", che nessuna azione mette mai in inventario e che non e' in initial_inventory`);
        }
      }
    }
    for (const f of [...setFlags].sort()) {
      if (!(readFlags.get(f) ?? []).length) {
        this.add('info', '', `flag "${f}" impostato ma mai letto da nessuna condizione`);
      }
    }
    for (const f of [...unsetFlags].sort()) {
      if (!setFlags.has(f)) this.add('avviso', '', `flag "${f}" rimosso (unset_flag) ma mai impostato`);
    }
    for (const it of [...addItems].sort()) {
      if (!(readItems.get(it) ?? []).length) {
        this.add('info', '', `oggetto "${it}" raccolto ma mai richiesto da nessuna condizione`);
      }
    }

    // Confronto con gli elenchi documentali, se presenti.
    if (this.story.state_flags_schema?.length) {
      const declared = new Set(this.story.state_flags_schema);
      for (const f of [...setFlags].sort()) {
        if (!declared.has(f)) this.add('info', '', `flag "${f}" usato ma non elencato in state_flags_schema`);
      }
    }
    const carried = new Set(this.story.initial_inventory ?? []);
    for (const sc of this.story.scenes) {
      for (const e of allEffects(sc)) {
        if (e.eff.add_inventory && carried.has(e.eff.add_inventory)) {
          this.add(
            'avviso',
            e.where,
            `mette in inventario "${e.eff.add_inventory}", che il giocatore ha gia' da initial_inventory`,
          );
        }
      }
    }

    // L'anagrafica degli oggetti non e' documentale come lo era
    // inventory_schema: un oggetto senza scheda non ha un nome da mostrare a chi
    // chiede cosa ha nello zaino, ne' sinonimi con cui nominarlo. In un player
    // che si comanda a parole e' un oggetto che il giocatore non puo' usare.
    // Il player si comanda a parole: "dove mi trovo" e' la domanda
    // piu' frequente di tutte, e senza `look` non ha una risposta d'autore.
    for (const sc of this.story.scenes) {
      if (sceneType(sc) === SCENE_INTERACTIVE && !sc.look) {
        this.add('errore', `scena "${sc.id}"`, 'scena interattiva senza look: a parole "guardati intorno" non ha risposta');
      }
      for (const a of sc.actions ?? []) {
        if (a.blocked_narration && !a.condition) {
          this.add('avviso', `scena "${sc.id}", azione "${a.id}"`, 'blocked_narration senza condition: non si vedra\' mai');
        }
        if (a.condition && !a.blocked_narration) {
          // Avviso e non info: la conseguenza si vede giocando, ed e' la
          // peggiore che il player possa produrre. Il giocatore che indovina
          // *l'azione giusta troppo presto* — cioe' quello che sta giocando
          // bene — non riceve una risposta della storia ma una diagnostica fra
          // parentesi. E' il caso in cui l'IR ha piu' bisogno di testo, non
          // meno.
          this.add(
            'avviso',
            `scena "${sc.id}", azione "${a.id}"`,
            'azione condizionata senza blocked_narration: chiesta troppo presto, il player mostra una diagnostica invece di una risposta',
          );
        }
      }
    }

    const schede = new Set((this.story.items ?? []).map((i) => i.id));
    for (const it of [...addItems].sort()) {
      if (!schede.has(it)) {
        this.add('errore', '', `oggetto "${it}" usato ma senza scheda in items[]: niente nome, niente sinonimi`);
      }
    }
    for (const i of this.story.items ?? []) {
      if (!addItems.has(i.id)) {
        this.add('info', '', `oggetto "${i.id}" con scheda in items[] ma che nessuna azione mette mai in inventario`);
      }
      if (!i.aliases?.length) {
        this.add('avviso', '', `oggetto "${i.id}" senza aliases: a input libero si potra' nominare solo con "${i.name}"`);
      }
      // Un oggetto che si porta in giro e non si puo' guardare e' un oggetto
      // muto: «guarda il coltello» e' fra le prime cose che si scrivono.
      if (!i.description) {
        this.add('errore', '', `oggetto "${i.id}" senza description: a chi lo guarda in inventario il player non ha niente da rispondere`);
      }
      for (const v of i.description_variants ?? []) {
        if (!v.condition || Object.keys(v.condition).length === 0) {
          this.add('avviso', '', `oggetto "${i.id}": description_variants con condition vuota, vince sempre e la description di base non si vedra' mai`);
        }
      }
    }
  }

  // ------------------------------------------------------ quinta colonna

  /**
   * I controlli sul testo che il player mostra ma che non e' un `Effect`:
   * fallback, `look` che cambia con lo stato, prosa dell'inventario, alias e
   * frasi di prova.
   *
   * Tutto quello che si controlla qui esiste per la stessa ragione. Spente le
   * chip, il giocatore non vede piu' l'elenco delle azioni: le chiede. Da quel
   * momento ogni cosa che non e' scritta nell'IR e' una cosa a cui il gioco non
   * sa rispondere — e l'alternativa, generarla a runtime, e' peggio del
   * silenzio: un testo generato nomina scenario che non esiste e nessun linter
   * puo' controllarlo. Questi avvisi sono il prezzo di quella scelta, ed e' un
   * prezzo che si paga in compilazione, una volta.
   */
  checkQuintaColonna(): void {
    const globali = new Set<Intent>((this.story.player_voice?.no_match_narration ?? []).map((n) => n.intent));
    const scarsi: string[] = [];
    let nonMisurate = 0;

    if (!this.story.player_voice) {
      this.add(
        'errore',
        '',
        "manca player_voice: senza, \"cosa ho nello zaino\" non ha risposta e una frase non capita nemmeno",
      );
    } else {
      if (!globali.has('generico')) {
        this.add(
          'errore',
          '',
          "player_voice.no_match_narration senza intenzione \"generico\": e' l'unica che serve sempre, perche' e' dove finisce tutto cio' che non si classifica",
        );
      }
      if (!this.story.player_voice.inventory_intro?.length) {
        this.add('info', '', "player_voice senza inventory_intro: \"cosa ho nello zaino\" non avra' risposta");
      }
      if (!this.story.player_voice.presence_intro?.length) {
        this.add('info', '', "player_voice senza presence_intro: \"chi c'e' qui\" non avra' risposta");
      }
      const conta = new Map<Intent, number>();
      for (const n of this.story.player_voice.no_match_narration ?? []) {
        conta.set(n.intent, (conta.get(n.intent) ?? 0) + 1);
      }
      for (const [intent, n] of conta) {
        if (n === 1) {
          this.add('info', '', `player_voice: una sola frase per l'intenzione "${intent}", quindi si ripetera' identica ogni volta`);
        }
      }
    }

    for (const sc of this.story.scenes) {
      if (sceneType(sc) !== SCENE_INTERACTIVE) continue;
      const locali = new Set<Intent>((sc.no_match_narration ?? []).map((n) => n.intent));

      if (locali.size === 0 && globali.size === 0) {
        this.add(
          'errore',
          sc.id,
          "nessun no_match_narration, ne' qui ne' globale: una frase che non corrisponde a niente non ricevera' nessuna risposta",
        );
      }

      for (const v of sc.look_variants ?? []) {
        if (!v.condition || Object.keys(v.condition).length === 0) {
          this.add('avviso', sc.id, "look_variants con condition vuota: vince sempre, quindi look di base non si vedra' mai");
        }
        if (!v.text) this.add('errore', sc.id, 'look_variants senza text');
      }
      if ((sc.look_variants?.length ?? 0) > 0 && !sc.look) {
        this.add('avviso', sc.id, "look_variants senza look di base: se nessuna condizione e' soddisfatta la scena non ha descrizione");
      }

      for (const a of sc.actions) {
        const aw = `${sc.id} / ${a.id}`;
        const n = a.aliases?.length ?? 0;
        if (n === 0) {
          this.add(
            'errore',
            aw,
            "azione senza aliases: si potra' chiedere solo dicendo quasi esattamente la label, cioe' quasi mai",
          );
        } else if (n < SOGLIA_ALIAS) {
          // Aggregata piu' sotto: su una storia intera sarebbero centinaia di
          // righe identiche, e un linter che grida a ogni riga smette di
          // essere letto.
          scarsi.push(`${aw} (${n})`);
        }
        for (const x of a.aliases ?? []) {
          if (verboDelPlayer(x) !== 'nessuno') {
            this.add(
              'errore',
              aw,
              `l'alias "${x}" e' un verbo del player: il resolver gira per primo, quindi se lo prende questa azione la scena non risponde piu' a "guardati intorno" o all'inventario`,
            );
          }
        }
        if (!a.test_phrases?.length) {
          nonMisurate++;
        } else {
          // Una frase di prova che ricopia un alias non misura niente: fa
          // sembrare bravo il matcher su una stringa che gli e' gia' stata
          // data. E' l'errore che rende inutile tutta la misura, quindi e' un
          // avviso e non un'informazione.
          const alias = new Set((a.aliases ?? []).map((x) => x.toLowerCase().trim()));
          for (const f of a.test_phrases) {
            if (alias.has(f.toLowerCase().trim())) {
              this.add('avviso', aw, `la frase di prova "${f}" e' identica a un alias: misura il lookup, non il richiamo`);
            }
          }
        }
      }
    }

    if (scarsi.length) {
      const primi = scarsi.slice(0, 8).join(', ');
      this.add(
        'info',
        '',
        `${scarsi.length} azioni con meno di ${SOGLIA_ALIAS} aliases — gli alias sono la copertura del resolver lessicale, e sotto la decina si sente: ${primi}${scarsi.length > 8 ? ', …' : ''}`,
      );
    }
    if (nonMisurate) {
      this.add('info', '', `${nonMisurate} azioni senza test_phrases: non entrano nella misura di copertura (--copertura)`);
    }
  }

  // --------------------------------------------------------- provenienza

  /**
   * Da dove viene questo file.
   *
   * Non incide sulla giocabilita', per questo e' un avviso e non un errore. Ma
   * un IR senza provenienza e' un file di cui, fra sei mesi, non si sapra' se
   * va ricompilato, con cosa, e perche' differisce da un altro: il compilatore
   * non e' deterministico fra sessioni, e senza firma non c'e' modo di
   * ricostruirlo.
   */
  checkProvenance(): void {
    const g = this.story.generated_by;
    if (!g) {
      this.add('avviso', '', 'manca generated_by: non si sa quale compilatore abbia prodotto questo IR');
      return;
    }
    if (!g.compiler) this.add('errore', '', 'generated_by senza compiler');
    if (!g.compiler_version) this.add('errore', '', 'generated_by senza compiler_version');
    if (!g.model) {
      this.add('info', '', 'generated_by senza model: compilatore deterministico, o modello non determinabile');
    }
  }

  // -------------------------------------------------------- inquadrature

  /**
   * I riferimenti su cui si regge la coerenza visiva.
   *
   * Un'immagine generata senza sapere DOVE si trova e CHI inquadra e' un'
   * immagine che non puo' essere resa coerente con le altre: il modulo assets
   * aggancia il ritratto di riferimento di un personaggio e la descrizione
   * stabile di un luogo proprio a questi due campi. Un riferimento rotto o
   * mancante non rompe la partita — il player e' testuale — ma rompe la
   * generazione, ed e' meglio scoprirlo prima di pagare 59 immagini.
   */
  checkShots(): void {
    const roster = new Map<string, string>();
    for (const c of this.story.characters ?? []) roster.set(c.id, displayName(c));
    const places = new Set((this.story.places ?? []).map((p) => p.id));
    const usati = new Set<string>();

    // La copertina: obbligatoria come i campi della 1.8.0 — opzionale nello
    // schema, pretesa qui. Una storia senza locandina si apre su una pagina di
    // testo, e non c'e' niente nell'IR che possa rimediare: la prima scena
    // dice dove si comincia, non di cosa parla la storia.
    if (!this.story.cover?.image_prompt) {
      this.add('errore', '', "manca cover: la storia non ha una locandina, e nessun altro campo puo' farne le veci");
    } else if (this.story.cover.ambient_sound_prompt) {
      this.add('info', '', 'cover.ambient_sound_prompt: una copertina non suona, quel prompt non lo generera\' nessuno');
    }

    // La copertina passa dagli stessi controlli sui riferimenti, perche' e'
    // un'inquadratura come le altre. Due differenze: chi puo' comparirci e'
    // l'intera roster — non c'e' una scena intorno a cui appartenere, e la
    // locandina e' anzi il posto del protagonista — e il controllo sui nomi
    // citati nel prompt li' non si fa, perche' senza una scena a restringere
    // il campo tornerebbe a gridare al lupo su ogni nome che e' una parola
    // comune.
    const cover = coverShot(this.story);
    const inquadrature: Array<{ shot: Shot; presenti: Set<string>; nomiNelPrompt: boolean }> = [];
    if (cover) inquadrature.push({ shot: cover, presenti: new Set(roster.keys()), nomiNelPrompt: false });

    for (const sc of this.story.scenes) {
      const presenti = new Set((sc.characters ?? []).map((c) => c.id));
      for (const shot of shotsOf(sc)) inquadrature.push({ shot, presenti, nomiNelPrompt: true });
    }

    {
      for (const { shot, presenti, nomiNelPrompt } of inquadrature) {
        if (shot.place) {
          if (places.has(shot.place)) usati.add(shot.place);
          else this.add('errore', shot.where, `place punta al luogo inesistente "${shot.place}"`);
        }

        const inquadrati = new Set(shot.characters_in_frame ?? []);
        for (const id of inquadrati) {
          if (!roster.has(id)) {
            this.add('errore', shot.where, `characters_in_frame cita "${id}", che non e' nella roster globale`);
          } else if (!presenti.has(id)) {
            this.add('info', shot.where, `"${id}" e' inquadrato ma non compare fra i presenti della scena`);
          }
        }

        // Se il prompt nomina un personaggio ma l'inquadratura non lo dichiara,
        // quel volto verra' generato senza riferimento — cioe' diverso ogni
        // volta. E' il caso piu' facile da lasciarsi sfuggire scrivendo l'IR.
        //
        // Si guardano solo i presenti nella scena, non tutta la roster: il
        // confronto e' sui nomi, e i nomi dei personaggi minori tendono a
        // essere parole comuni ("anziano", "il dottore") che ricorrono nei
        // prompt parlando di tutt'altro. Ristretto a chi in quella scena c'e'
        // davvero, l'avviso smette di gridare al lupo.
        for (const id of nomiNelPrompt ? presenti : []) {
          if (inquadrati.has(id)) continue;
          const nome = roster.get(id);
          if (!nome || !mentions(shot.image_prompt, id, nome)) continue;
          this.add(
            'avviso',
            shot.where,
            `il prompt nomina "${nome}" ma characters_in_frame non lo elenca: il volto sara' generato senza riferimento`,
          );
        }
      }
    }

    for (const p of this.story.places ?? []) {
      if (!usati.has(p.id)) this.add('info', '', `luogo "${p.id}" dichiarato in places ma mai referenziato da un'inquadratura`);
      if (!p.visual_prompt) this.add('errore', '', `luogo "${p.id}" senza visual_prompt: non puo' fare da riferimento`);
    }
  }

  // ------------------------------------------------------------ personaggi

  checkCharacters(): void {
    const roster = new Set<string>();
    for (const c of this.story.characters ?? []) {
      if (roster.has(c.id)) this.add('avviso', '', `personaggio duplicato nella roster globale: "${c.id}"`);
      roster.add(c.id);
    }

    // Chi il giocatore e'. Senza, «chi c'e' qui» elenca anche lui — cioe'
    // risponde "in questa stanza ci sono: Laura, Mark e Tommy" a Laura.
    if (this.story.protagonist && !roster.has(this.story.protagonist)) {
      this.add('errore', '', `protagonist "${this.story.protagonist}" non e' nella roster globale`);
    }
    if (!this.story.protagonist) {
      this.add('info', '', "manca protagonist: se il personaggio giocante compare in characters di una scena, \"chi c'e' qui\" elenchera' anche lui");
    }

    // Chi parla deve stare nella roster globale, sempre — anche una voce fuori
    // campo con una sola battuta. Non e' pignoleria: il modulo assets assegna
    // il timbro una volta per parlante, e un parlante che esiste solo come
    // stringa in `speaker` non ha niente a cui agganciare quell'assegnazione.
    // `narrator` e' l'eccezione: non e' un personaggio, la sua voce sta in
    // global_style.narrator_voice.
    const speakers = new Map<string, string>();
    for (const sc of this.story.scenes) {
      if (!sc.dialogue_tree) continue;
      for (const [id, n] of Object.entries(sc.dialogue_tree.nodes)) {
        if (!n.speaker || n.speaker === 'narrator' || roster.has(n.speaker)) continue;
        if (!speakers.has(n.speaker)) speakers.set(n.speaker, `${sc.id} / nodo ${id}`);
      }
    }
    for (const [speaker, where] of speakers) {
      this.add(
        'errore',
        where,
        `lo speaker "${speaker}" non e' nella roster globale: non avra' ne' aspetto ne' voce assegnabili`,
      );
    }

    for (const sc of this.story.scenes) {
      for (const c of sc.characters ?? []) {
        if (!roster.has(c.id)) {
          this.add(
            'errore',
            sc.id,
            `personaggio "${c.id}" in scena ma non nella roster globale: gli override locali non sostituiscono la scheda globale`,
          );
        }
      }
    }
  }
}

/**
 * Dice se il testo di un prompt nomina un personaggio.
 *
 * Volutamente grossolano — confronto su minuscole, senza regex: serve a un
 * avviso, e un falso positivo costa una riga di rumore mentre un falso negativo
 * costa un volto sbagliato. Si prova il nome intero, il suo primo pezzo e l'id
 * con gli underscore sciolti, scartando le parole troppo corte per essere
 * distintive.
 */
function mentions(prompt: string, id: string, nome: string): boolean {
  const testo = prompt.toLowerCase();
  const forme = new Set<string>();
  const aggiungi = (v: string) => {
    if (v.length >= 4) forme.add(v.toLowerCase());
  };
  aggiungi(nome);
  aggiungi(nome.split(/\s+/)[0]);
  aggiungi(id.replace(/_/g, ' '));
  for (const f of forme) {
    if (testo.includes(f)) return true;
  }
  return false;
}

/** Esegue tutti i controlli statici sull'IR. */
export function lintStory(story: Story): Finding[] {
  const l = new Linter(story);
  l.checkScenes();
  l.checkReachability();
  l.checkFlagsAndItems();
  l.checkCharacters();
  l.checkShots();
  l.checkQuintaColonna();
  l.checkProvenance();
  return l.findings;
}
