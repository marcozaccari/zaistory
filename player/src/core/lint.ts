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

import type { Condition, Effect, Scene, Story } from './types.js';
import { SCENE_CUTSCENE, findScene, sceneHasExit, sceneType } from './types.js';

export type Level = 'info' | 'avviso' | 'errore';

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
          this.add('errore', c.where, `richiede l'oggetto "${c.cond.has_item}", che nessuna azione mette mai in inventario`);
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
    if (this.story.inventory_schema?.length) {
      const declared = new Set(this.story.inventory_schema);
      for (const it of [...addItems].sort()) {
        if (!declared.has(it)) this.add('info', '', `oggetto "${it}" usato ma non elencato in inventory_schema`);
      }
    }
  }

  // ------------------------------------------------------------ personaggi

  checkCharacters(): void {
    const seen = new Set<string>();
    for (const c of this.story.characters ?? []) {
      if (seen.has(c.id)) this.add('avviso', '', `personaggio duplicato nella roster globale: "${c.id}"`);
      seen.add(c.id);
    }
    // Nota: uno speaker fuori dalla roster NON e' un errore. I personaggi
    // occasionali (voci fuori campo, comparse) per scelta architetturale non
    // stanno nella roster globale.
    for (const sc of this.story.scenes) {
      for (const c of sc.characters ?? []) {
        if (!seen.has(c.id) && !c.visual_prompt && !c.voice) {
          this.add(
            'avviso',
            sc.id,
            `personaggio "${c.id}" in scena non e' nella roster globale e non ha override locali: non ha ne' aspetto ne' voce`,
          );
        }
      }
    }
  }
}

/** Esegue tutti i controlli statici sull'IR. */
export function lintStory(story: Story): Finding[] {
  const l = new Linter(story);
  l.checkScenes();
  l.checkReachability();
  l.checkFlagsAndItems();
  l.checkCharacters();
  return l.findings;
}
