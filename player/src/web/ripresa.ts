/**
 * La partita che sopravvive al ricaricamento della pagina.
 *
 * Su un telefono ricaricare non e' un gesto deliberato: e' il browser che
 * scarica la scheda per fare spazio, e' un ritorno all'app dopo mezz'ora, e'
 * un tocco sulla barra degli indirizzi. Finora ognuno di questi buttava via la
 * partita e riportava alla copertina, che e' il modo piu' rapido di far
 * smettere di collaudare una storia lunga.
 *
 * ## Non c'e' niente di nuovo da salvare
 *
 * La partita e' gia' interamente descritta dalla sua traccia — il resolver puo'
 * solo scegliere fra azioni gia' definite nell'IR — ed esiste gia' un modulo
 * che la mette in un involucro e la rilegge (`core/salvataggio.ts`). Qui non
 * si inventa un secondo formato: si prende quello, lo si scrive in
 * `localStorage` a ogni mossa e lo si rilegge all'avvio. Il codice da copiare e
 * la ripresa automatica sono la stessa cosa in due posti diversi.
 *
 * ## Una chiave per storia
 *
 * `zaiplay:ripresa:<story.id>`. Chi collauda tiene aperte due storie in due
 * schede, e una chiave sola farebbe finire la traccia dell'una dentro l'altra —
 * dove `story_id` la salverebbe dal disastro, ma solo dopo aver buttato via
 * l'altra partita.
 *
 * ## Cosa non torna da sola
 *
 * Le impostazioni si riprendono, tranne il backend del resolver: riaprire una
 * pagina non deve poter far partire il download di un modello. Accenderlo e'
 * una cosa che si chiede, e sta a un tocco nel pannello.
 *
 * ## Quando lo spazio non c'e'
 *
 * `localStorage` puo' non esserci affatto (una finestra anonima, un browser che
 * blocca i dati di sito) e puo' rifiutare una scrittura quando e' pieno. In
 * tutti e due i casi qui si tace: una partita che non si riprende e' un
 * peccato, un player che si ferma con un errore mentre si gioca e' un difetto.
 */

import {
  leggiSalvataggio,
  scriviSalvataggio,
  type Salvataggio,
  type Story,
} from '../core/index.js';

function chiave(story: Story): string {
  return `zaiplay:ripresa:${story.id}`;
}

/** `localStorage` quando c'e'. Accedervi puo' gia' bastare a far eccezione. */
function deposito(): Storage | undefined {
  try {
    return window.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Scrive la partita in corso. Una traccia vuota cancella invece di salvare:
 * essere appena arrivati alla prima scena non e' un punto a cui tornare. */
export function salvaRipresa(story: Story, trace: string[], config: Record<string, unknown>): void {
  const box = deposito();
  if (!box) return;
  try {
    if (trace.length === 0) {
      box.removeItem(chiave(story));
      return;
    }
    box.setItem(
      chiave(story),
      scriviSalvataggio({
        salvato: new Date().toISOString(),
        partita: { story_id: story.id, ir_version: story.ir_version, title: story.title, trace },
        config,
      }),
    );
  } catch {
    // Spazio finito o scrittura negata: si continua a giocare.
  }
}

/**
 * La partita da riprendere, se ce n'e' una di *questa* storia.
 *
 * Una traccia con l'id di un'altra storia non si riprende e si butta: e' il
 * residuo di una chiave riusata, e rigiocarla qui darebbe una partita
 * silenziosamente sbagliata invece di un errore.
 */
export function leggiRipresa(story: Story): Salvataggio | undefined {
  const box = deposito();
  if (!box) return undefined;
  let grezzo: string | null = null;
  try {
    grezzo = box.getItem(chiave(story));
  } catch {
    return undefined;
  }
  if (!grezzo) return undefined;

  try {
    const salv = leggiSalvataggio(grezzo);
    if (!salv.partita?.trace.length) return undefined;
    if (salv.partita.story_id && salv.partita.story_id !== story.id) {
      dimenticaRipresa(story);
      return undefined;
    }
    return salv;
  } catch {
    // Un residuo di una versione precedente dell'involucro: non c'e' niente da
    // spiegare a nessuno, si riparte dalla copertina.
    dimenticaRipresa(story);
    return undefined;
  }
}

/** Butta via la partita salvata: si ricomincia, e la vecchia non c'e' piu'. */
export function dimenticaRipresa(story: Story): void {
  try {
    deposito()?.removeItem(chiave(story));
  } catch {
    // vedi sopra
  }
}
