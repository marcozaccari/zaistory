/**
 * Stato di gioco e applicazione degli `Effect`.
 *
 * Vincolo architetturale di questo modulo: qui non c'e' logica narrativa. Lo
 * stato non cambia se non applicando `Effect` gia' presenti nell'IR. Se
 * qualcosa non si puo' fare e' perche' l'IR non lo prevede — ed e' esattamente
 * l'informazione che questo player serve a far emergere.
 */

import type { Condition, Effect } from './types.js';

/** Cosa un Effect chiede al flusso di fare, dopo aver cambiato lo stato. */
export type TransitionKind = 'none' | 'dialogue' | 'scene';

export interface Transition {
  kind: TransitionKind;
  target: string;
}

const NO_TRANSITION: Transition = { kind: 'none', target: '' };

/** Le annotazioni che l'applicazione di un Effect produce per la UI.
 * Lo stato non sa come mostrarle: le consegna e basta. */
export interface EffectSink {
  narration(text: string, voice?: Effect['narration_voice']): void;
  sound(prompt: string): void;
  stateChange(desc: string): void;
}

/**
 * Lo stato e' piccolo e interamente derivabile dagli Effect applicati: per
 * questo mostrarlo rende ovvia la diagnosi dei bug.
 */
export class GameState {
  flags = new Set<string>();
  inventory: string[] = [];
  scene = '';
  history: string[] = [];

  /** Azioni con `repeatable: false` gia' usate, per chiave "scena/azione".
   * La consumazione e' permanente anche tornando nella scena: "prendi la
   * chiave" non deve poter essere ripetuta. */
  private consumedKeys = new Set<string>();

  /**
   * Ogni azione eseguita almeno una volta, per chiave "scena/azione" —
   * comprese quelle ripetibili, che `consumedKeys` non registra.
   *
   * Non e' un doppione: `consumed` dice *non si puo' piu' fare*, questo dice
   * *e' gia' stata fatta*. Sono due domande diverse, e la seconda serve a
   * sapere quando in una scena non resta piu' niente da fare — che e' il
   * momento in cui l'uscita smette di essere un enigma e va mostrata.
   *
   * Resta derivabile da quello che il giocatore ha fatto, come `history`:
   * rigiocare la stessa traccia lo ricostruisce identico.
   */
  private eseguite = new Set<string>();

  giaEseguita(sceneID: string, actionID: string): boolean {
    return this.eseguite.has(`${sceneID}/${actionID}`);
  }

  segnaEseguita(sceneID: string, actionID: string): void {
    this.eseguite.add(`${sceneID}/${actionID}`);
  }

  hasItem(item: string): boolean {
    return this.inventory.includes(item);
  }

  sortedFlags(): string[] {
    return [...this.flags].sort();
  }

  consumed(sceneID: string, actionID: string): boolean {
    return this.consumedKeys.has(`${sceneID}/${actionID}`);
  }

  consume(sceneID: string, actionID: string): void {
    this.consumedKeys.add(`${sceneID}/${actionID}`);
  }

  /**
   * Valuta una Condition sullo stato corrente. Il secondo valore e' il motivo
   * per cui non e' soddisfatta, in italiano leggibile: e' quello che la
   * modalita' debug mostra accanto alle azioni nascoste, perche' "perche'
   * questa azione non compare?" e' la domanda che ci si pone il 90% delle
   * volte quando si testa una storia.
   */
  meets(c?: Condition): { ok: boolean; why: string } {
    if (!c) return { ok: true, why: '' };
    if (c.flag_present && !this.flags.has(c.flag_present)) {
      return { ok: false, why: `richiede il flag "${c.flag_present}", non impostato` };
    }
    if (c.flag_absent && this.flags.has(c.flag_absent)) {
      return { ok: false, why: `richiede l'assenza del flag "${c.flag_absent}", che invece e' impostato` };
    }
    if (c.has_item && !this.hasItem(c.has_item)) {
      return { ok: false, why: `richiede l'oggetto "${c.has_item}", non in inventario` };
    }
    return { ok: true, why: '' };
  }

  /**
   * Applica un Effect nell'ordine fissato dallo schema:
   * narration -> set/unset_flag -> add/remove_inventory -> play_sound ->
   * goto_dialogue/goto_scene. L'ordine non e' un dettaglio: una narrazione
   * deve poter parlare dello stato *prima* del cambiamento, e il salto avviene
   * sempre per ultimo.
   */
  apply(e: Effect | undefined, sink: EffectSink): Transition {
    if (!e) return NO_TRANSITION;

    if (e.narration) sink.narration(e.narration, e.narration_voice);
    if (e.set_flag) {
      this.flags.add(e.set_flag);
      sink.stateChange(`flag impostato: ${e.set_flag}`);
    }
    if (e.unset_flag) {
      this.flags.delete(e.unset_flag);
      sink.stateChange(`flag rimosso: ${e.unset_flag}`);
    }
    if (e.add_inventory) {
      if (!this.hasItem(e.add_inventory)) this.inventory.push(e.add_inventory);
      sink.stateChange(`in inventario: ${e.add_inventory}`);
    }
    if (e.remove_inventory) {
      const i = this.inventory.indexOf(e.remove_inventory);
      if (i >= 0) this.inventory.splice(i, 1);
      sink.stateChange(`rimosso dall'inventario: ${e.remove_inventory}`);
    }
    if (e.play_sound_prompt) sink.sound(e.play_sound_prompt);

    // goto_scene e goto_dialogue sono mutuamente esclusivi in pratica; se
    // entrambi presenti vince la transizione di scena, che e' la piu' forte, e
    // il linter segnala l'ambiguita'.
    if (e.goto_scene) return { kind: 'scene', target: e.goto_scene };
    if (e.goto_dialogue) return { kind: 'dialogue', target: e.goto_dialogue };
    return NO_TRANSITION;
  }
}

/** Rende leggibile una condizione (per il debug). */
export function describeCondition(c?: Condition): string {
  if (!c) return 'nessuna';
  const parts: string[] = [];
  if (c.flag_present) parts.push(`flag ${c.flag_present}`);
  if (c.flag_absent) parts.push(`NON flag ${c.flag_absent}`);
  if (c.has_item) parts.push(`oggetto ${c.has_item}`);
  return parts.length ? parts.join(' e ') : 'nessuna';
}

/** Rende leggibile un effetto (per il debug). */
export function describeEffect(e?: Effect): string {
  if (!e) return 'nessuno';
  const parts: string[] = [];
  if (e.narration) parts.push('narrazione');
  if (e.set_flag) parts.push(`+flag ${e.set_flag}`);
  if (e.unset_flag) parts.push(`-flag ${e.unset_flag}`);
  if (e.add_inventory) parts.push(`+oggetto ${e.add_inventory}`);
  if (e.remove_inventory) parts.push(`-oggetto ${e.remove_inventory}`);
  if (e.play_sound_prompt) parts.push('suono');
  if (e.goto_dialogue) parts.push(`→ dialogo ${e.goto_dialogue}`);
  if (e.goto_scene) parts.push(`→ scena ${e.goto_scene}`);
  return parts.length ? parts.join(', ') : 'nessuno';
}
