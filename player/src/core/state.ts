/**
 * Lo stato di gioco e l'applicazione degli effetti.
 *
 * Vincolo architetturale di questo modulo: qui non c'è logica narrativa. Lo
 * stato non cambia se non applicando effetti già presenti nella storia. Se
 * qualcosa non si può fare è perché la storia non lo prevede — ed è esattamente
 * l'informazione che questo player serve a far emergere.
 *
 * Lo stato è piccolo e interamente derivabile da quello che il giocatore ha
 * fatto: è la proprietà che rende una traccia di id un salvataggio, un test di
 * regressione e una partita rigiocabile, tutti e tre insieme.
 */

import type { Condition, Effect, VoiceSpec } from './types.js';

/** Cosa un effetto chiede al flusso di fare, dopo aver cambiato lo stato. */
export type Jump =
  | { kind: 'none' }
  | { kind: 'dialogue'; target: string }
  | { kind: 'place'; target: string };

const NO_JUMP: Jump = { kind: 'none' };

/** Le annotazioni che l'applicazione di un effetto produce per l'interfaccia.
 * Lo stato non sa come mostrarle: le consegna e basta. */
export interface EffectSink {
  narration(text: string, voice?: VoiceSpec): void;
  sound(prompt: string): void;
  stateChange(desc: string): void;
}

export class GameState {
  /** L'atto corrente. Cambiarlo azzera i flag locali: è il confine che rende
   * verificabile una storia a pezzi. */
  act = '';
  place = '';
  flags = new Set<string>();
  inventory: string[] = [];
  /** I luoghi attraversati, in ordine. Serve al debug e a «dove sono stato». */
  history: string[] = [];
  /** Quanti turni sono passati: è il contatore con cui si ruotano le varianti
   * d'autore, così ripetere la stessa cosa non dà la stessa frase. */
  turn = 0;
  ended?: { kind: 'natural' | 'premature'; label?: string };

  /** I flag dichiarati come trasportabili fra atti. Non li decide lo stato: li
   * riceve dalla storia, e sono al massimo tre. */
  constructor(private readonly carryFlags: ReadonlySet<string> = new Set()) {}

  // ------------------------------------------------------------ memoria

  /** Azioni con `repeatable: false` già usate. La chiave è la sola azione, non
   * la fase: «prendi la chiave» non deve tornare possibile rientrando. */
  private consumedIds = new Set<string>();
  /** Ogni azione eseguita almeno una volta, ripetibili comprese.
   *
   * Non è un doppione di `consumed`: quello dice *non si può più fare*, questo
   * dice *è già stata fatta*. Sono due domande diverse, e la seconda serve a
   * sapere quando in un luogo non resta più niente — il momento in cui l'uscita
   * smette di essere un enigma e va mostrata. */
  private executedIds = new Set<string>();
  /** Le transizioni già viste, per non rifar guardare una cutscene di
   * passaggio a ogni attraversamento. */
  private seenTransitions = new Set<string>();
  /** I dialoghi già aperti, per nodo d'ingresso.
   *
   * Non è la stessa cosa di `executed`: lì la chiave è l'azione, qui la
   * conversazione. Le porte che danno sulla stessa stanza possono essere tre —
   * «ascolta il discorso», «parla con Mark», «parla con Tommy» — ma la stanza
   * resta una, e averla attraversata una volta significa averla vista. */
  private seenDialogues = new Set<string>();

  consumed(actionId: string): boolean {
    return this.consumedIds.has(actionId);
  }
  consume(actionId: string): void {
    this.consumedIds.add(actionId);
  }
  executed(actionId: string): boolean {
    return this.executedIds.has(actionId);
  }
  markExecuted(actionId: string): void {
    this.executedIds.add(actionId);
  }
  transitionSeen(key: string): boolean {
    return this.seenTransitions.has(key);
  }
  markTransition(key: string): void {
    this.seenTransitions.add(key);
  }
  dialogueSeen(key: string): boolean {
    return this.seenDialogues.has(key);
  }
  markDialogue(key: string): void {
    this.seenDialogues.add(key);
  }

  /**
   * La memoria, in chiaro e in sola lettura: è quello che si guarda quando si
   * ispeziona una partita.
   *
   * Sono `Set` privati perché nessuno deve poterli scrivere da fuori — lo stato
   * cambia solo applicando effetti della storia — ma leggerli è un'altra cosa,
   * ed è l'unico modo di rispondere a «perché quest'azione non riparte» o «che
   * fine ha fatto quel flag». In ordine, che un elenco che cambia ordine a ogni
   * disegno non si legge.
   */
  get memoria(): { consumate: string[]; eseguite: string[]; passaggi: string[]; dialoghi: string[]; carry: string[] } {
    const ord = (s: ReadonlySet<string>) => [...s].sort();
    return {
      consumate: ord(this.consumedIds),
      eseguite: ord(this.executedIds),
      passaggi: ord(this.seenTransitions),
      dialoghi: ord(this.seenDialogues),
      carry: ord(this.carryFlags),
    };
  }

  hasItem(item: string): boolean {
    return this.inventory.includes(item);
  }

  sortedFlags(): string[] {
    return [...this.flags].sort();
  }

  /**
   * Entra in un atto nuovo: sopravvivono l'inventario e i soli carry flag.
   *
   * È la regola più importante del confine d'atto, e va applicata qui e non
   * altrove: se un pezzo di interfaccia si ricordasse un flag locale, la
   * verifica per atto smetterebbe di dire la verità.
   */
  enterAct(actId: string): void {
    if (this.act === actId) return;
    this.act = actId;
    const kept = new Set<string>();
    for (const f of this.flags) if (this.carryFlags.has(f)) kept.add(f);
    this.flags = kept;
  }

  // ---------------------------------------------------------- condizioni

  /**
   * Valuta una condizione. Il secondo valore è il motivo per cui non è
   * soddisfatta, in italiano leggibile: è quello che il debug mostra accanto
   * alle azioni nascoste, perché «perché questa azione non compare?» è la
   * domanda che ci si pone il 90% delle volte collaudando una storia.
   */
  meets(c?: Condition): { ok: boolean; why: string } {
    if (!c) return { ok: true, why: '' };
    if (c.flag_present && !this.flags.has(c.flag_present)) {
      return { ok: false, why: `richiede il flag "${c.flag_present}", non impostato` };
    }
    if (c.flag_absent && this.flags.has(c.flag_absent)) {
      return { ok: false, why: `richiede l'assenza del flag "${c.flag_absent}", che invece è impostato` };
    }
    if (c.has_item && !this.hasItem(c.has_item)) {
      return { ok: false, why: `richiede l'oggetto "${c.has_item}", non in inventario` };
    }
    for (const sub of c.all_of ?? []) {
      const r = this.meets(sub);
      if (!r.ok) return r;
    }
    if (c.any_of?.length) {
      const esiti = c.any_of.map((sub) => this.meets(sub));
      if (!esiti.some((r) => r.ok)) {
        return { ok: false, why: `nessuna delle alternative è soddisfatta (${esiti.map((r) => r.why).join('; ')})` };
      }
    }
    return { ok: true, why: '' };
  }

  /** Comodità per i tanti posti che vogliono solo il sì o no. */
  readonly ok = (c?: Condition): boolean => this.meets(c).ok;

  // -------------------------------------------------------------- effetti

  /**
   * Applica un effetto nell'ordine fissato dallo schema: narrazione, flag,
   * inventario, suono, e per ultimo il salto. L'ordine non è un dettaglio: una
   * narrazione deve poter parlare dello stato *prima* del cambiamento, e
   * spostarsi è sempre l'ultima cosa che succede.
   */
  apply(e: Effect | undefined, sink: EffectSink): Jump {
    if (!e) return NO_JUMP;

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

    // Spostarsi è più forte di aprire un dialogo: se ci fossero entrambi vince
    // il luogo, e il linter segnala l'ambiguità invece di lasciarla decidere
    // qui in silenzio.
    if (e.goto_place) return { kind: 'place', target: e.goto_place };
    if (e.goto_dialogue) return { kind: 'dialogue', target: e.goto_dialogue };
    return NO_JUMP;
  }
}

/** Rende leggibile una condizione (per il debug). */
export function describeCondition(c?: Condition): string {
  if (!c) return 'nessuna';
  const parts: string[] = [];
  if (c.flag_present) parts.push(`flag ${c.flag_present}`);
  if (c.flag_absent) parts.push(`NON flag ${c.flag_absent}`);
  if (c.has_item) parts.push(`oggetto ${c.has_item}`);
  for (const sub of c.all_of ?? []) parts.push(describeCondition(sub));
  if (c.any_of?.length) parts.push(`(${c.any_of.map(describeCondition).join(' oppure ')})`);
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
  if (e.goto_place) parts.push(`→ luogo ${e.goto_place}`);
  return parts.length ? parts.join(', ') : 'nessuno';
}
