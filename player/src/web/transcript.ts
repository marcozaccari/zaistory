/**
 * Il trascritto: quello che è successo, in ordine.
 *
 * Nella stessa colonna scrivono registri diversi — l'autore, i personaggi, il
 * player quando commenta, la macchina quando mostra un prompt — e il foglio di
 * stile dà a ciascuno una voce: un colore, un carattere, uno spazio. Qui si
 * decide soltanto **di chi è** ogni riga; come suoni lo dice il CSS.
 *
 * Due cose vale la pena sapere leggendo questo file.
 *
 * **I prompt di generazione si vedono sempre**, non solo in debug. Sono il
 * segnaposto di quello che diventeranno immagine, suono e voce, ed è leggendoli
 * mentre si gioca che ci si accorge che un beat ha cambiato inquadratura senza
 * dirlo o che manca un suono: si rilegge la storia con gli occhi del modulo
 * assets, prima che il modulo assets esista.
 *
 * **Le diagnostiche stanno sotto il debug.** Dove la storia non ha il testo che
 * servirebbe, il player ripiega sul fallback d'autore e la nota si vede solo a
 * debug acceso: chi gioca non legge mai un messaggio di errore al posto della
 * storia. Diverso `problem`, che si vede sempre — quello segnala una storia
 * **rotta**, e lì non c'è niente da leggere al suo posto.
 */

import type { TurnEvent } from '../core/index.js';
import { byId, el } from './dom.js';
import { promptRow } from './prompt.js';

export class Transcript {
  private root = byId('transcript');

  /** Quello che il giocatore ha scritto, ripetuto in chiaro: senza, dopo tre
   * turni non si sa più a cosa risponde cosa. */
  echo(text: string): void {
    this.add(el('p', 'entry echo', `· ${text}`));
  }

  /** La copertina: quello che vale per tutta la storia, prima che cominci. */
  cover(title: string, description?: string, style?: { image_style_suffix?: string; default_tone?: string }): void {
    const box = el('div', 'cover');
    box.append(el('h1', undefined, title));
    if (description) box.append(el('p', 'desc', description));
    for (const r of [
      ['image_style_suffix', style?.image_style_suffix, 'image'] as const,
      ['default_tone', style?.default_tone, 'none'] as const,
    ]) {
      if (r[1]) box.append(promptRow([r[0], r[1], r[2]]));
    }
    this.add(box);
  }

  events(list: TurnEvent[]): void {
    for (const e of list) {
      switch (e.kind) {
        case 'narration': {
          // Il `look` è testo d'autore rileggibile e senza conseguenze: prende
          // la sua voce, senza il corsivo che nel trascritto dice «è appena
          // successo qualcosa».
          const guardarsi = e.by === 'verbo di sistema';
          const p = el('p', `entry ${guardarsi ? 'look' : 'narration'}`, e.text);
          if (e.by) p.append(el('span', 'via', e.by));
          this.add(p);
          if (e.beat) this.fields(e.beat);
          break;
        }
        case 'say': {
          const p = el('p', 'entry line');
          p.append(el('span', 'speaker', e.speaker ?? ''), document.createTextNode(e.text));
          this.add(p);
          if (e.voice?.style_prompt) this.field('voice_override.style_prompt', e.voice.style_prompt, 'voice');
          break;
        }
        case 'system':
          this.add(el('p', 'entry notice', e.text));
          break;
        case 'sound':
          this.field(e.field ?? 'play_sound_prompt', e.text, 'sound');
          break;
        case 'state':
          this.add(el('p', 'entry notice solo-debug', `[${e.text}]`));
          break;
        case 'note':
          this.add(el('p', 'entry notice solo-debug', `(${e.text})`));
          break;
        case 'problem':
          this.add(el('p', 'entry problem', `!! ${e.text}`));
          break;
      }
    }
  }

  ending(label?: string): void {
    const box = el('div', 'entry finish');
    box.append(el('h3', undefined, '— fine —'));
    if (label) box.append(el('p', undefined, label));
    this.add(box);
  }

  /** Il suono del beat non si stampa qui: arriva come evento suo, subito dopo
   * la narrazione, ed è il core a dire da quale campo viene. Stamparlo in tutti
   * e due i posti lo faceva comparire due volte. */
  private fields(b: { image_prompt?: string; voice?: { style_prompt?: string } }): void {
    if (b.image_prompt) this.field('image_prompt', b.image_prompt, 'image');
    if (b.voice?.style_prompt) this.field('narration_voice.style_prompt', b.voice.style_prompt, 'voice');
  }

  private field(label: string, value: string, media: 'image' | 'sound' | 'voice' | 'music' | 'none'): void {
    const p = el('p', 'entry');
    p.append(promptRow([label, value, media]));
    this.add(p);
  }

  private add(n: HTMLElement): void {
    this.root.append(n);
    this.root.scrollTop = this.root.scrollHeight;
  }

  clear(): void {
    this.root.replaceChildren();
  }
}
