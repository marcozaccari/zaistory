/**
 * I verbi del player: guardarsi intorno e guardare nello zaino.
 *
 * Non sono azioni della scena. Non stanno in `actions[]`, non consumano un
 * turno, non entrano nella traccia, non cambiano niente — e proprio per questo
 * non pesano sul budget di azioni che il compilatore ha per la scena. Sono
 * pero' le due cose che il giocatore fa piu' spesso di tutte, e finche' il
 * player mostrava le chip non avevano bisogno di esistere: l'elenco *era* la
 * risposta a "cosa posso fare" e il pannello a "cosa ho". Spente le chip,
 * senza questi due verbi la scena diventa muta.
 *
 * Ordine di precedenza, e non e' un dettaglio: **prima il resolver, poi i
 * verbi del player**. Un'azione scritta dall'autore vince sempre su un verbo
 * di sistema, cosi' una scena che ha davvero un'azione "fruga nello zaino"
 * non se la vede scippare da qui. I verbi rispondono solo dove il resolver ha
 * gia' detto di no.
 *
 * Qui non si genera niente: tutto il testo che esce da questo modulo l'ha
 * scritto l'autore (`look`, `look_variants`, `player_voice`). Dove l'autore
 * non ha scritto, il player lo dice come diagnostica e non inventa prosa.
 */

import type { Condition, Scene, Story } from './types.js';
import { descrizioneOra, displayName, findCharacter, lookNow } from './types.js';
import { affinita, normalizza, radice, radici } from './lexical.js';

export type Verbo = 'look' | 'inventario' | 'presenti' | 'esamina' | 'nessuno';

/**
 * Quanto deve somigliare la frase al nome di un oggetto perche' «guarda il
 * walkie» sia una richiesta di guardare *quello*.
 *
 * Piu' bassa delle soglie del resolver, e puo' esserlo: qui il verbo di
 * percezione ha gia' fatto da filtro e le candidate sono solo gli oggetti che
 * si hanno in mano — di solito tre o quattro, non quindici.
 */
export const SOGLIA_OGGETTO = 0.45;

/** Radici che parlano dell'ambiente invece che di una cosa precisa. */
// 'post' non c'e' di proposito: la radice di "posto" e' anche quella di
// "posta", e "guarda la posta" e' un'azione di scena, non un guardarsi
// intorno. "dove sono" e "che posto e' questo" sono gia' coperti dalla forma
// esatta piu' sotto.
const AMBIENTE = new Set(['intorn', 'attorn', 'giro', 'ambient', 'stanz', 'camer', 'luog', 'dov', 'trov', 'scen']);
const PERCEZIONE_ELENCO = ['guard', 'osserv', 'ved', 'esamin', 'ispezion', 'scrut'] as const;
const PERCEZIONE = new Set<string>(PERCEZIONE_ELENCO);
const CONTENITORI = new Set(['inventari', 'zain', 'tasch', 'bors', 'sacc']);

/**
 * Parole che non aggiungono un complemento: articoli, preposizioni, clitici.
 *
 * L'elenco e' corto apposta, ed e' la differenza fra un riconoscimento stretto
 * e uno che scippa azioni all'autore. Ogni parola che *non* sta qui vale come
 * un complemento: "guarda lei" e "osserva ancora" hanno qualcosa in piu' di
 * "guardati intorno", e quel qualcosa in piu' li rende azioni di scena.
 */
const FUNZIONALI = new Set(['mi', 'ti', 'si', 'ci', 'vi', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'in', 'a', 'da', 'qui', 'qua']);

/** Parole ammesse intorno al nome di un contenitore. */
const DI_INVENTARIO = new Set(['cos', 'che', 'ho', 'port', 'possied', 'teng', 'apr', 'frug', 'cerc', 'dentr', 'nell', 'nel', 'mio', 'mia', 'con', 'quant', 'roba']);

/**
 * Le parole che *fanno* una domanda sui presenti: almeno una deve esserci.
 *
 * "present" non c'e' di proposito. La radice di "presente" e' anche quella di
 * "presentati", e «presentati» e' un'azione — parlare a qualcuno — non una
 * domanda su chi ci sia. Sta fra le parole di contorno piu' sotto, dove serve
 * a «chi e' presente» senza poter far scattare niente da sola.
 */
const PRESENZA = new Set(['chi', 'person', 'personagg', 'gent', 'compagn', 'insiem']);

/**
 * Le parole ammesse intorno a quelle sopra.
 *
 * Stessa logica stretta del `look`: qualunque parola fuori da questi due
 * insiemi e' un complemento vero, e con un complemento vero non e' piu' una
 * domanda su chi c'e' ma un'azione della scena. E' cio' che tiene «chi c'e'
 * dietro la porta» — che e' un'azione — lontano da «chi c'e' qui».
 */
const DI_PRESENZA = new Set([
  'c', 'e', 'ce', 'son', 'sta', 'stann', 'sto', 'ved', 'me', 'con', 'quest', 'quant', 'qual', 'altr',
  'present',
  ...PERCEZIONE_ELENCO,
]);

/** Le radici di TUTTE le parole, comprese quelle vuote: qui una parola in piu'
 * cambia la risposta, quindi non se ne butta via nessuna. */
function radiciIntere(input: string): string[] {
  return normalizza(input)
    .split(' ')
    .filter((w) => w !== '')
    .map((w) => radice(w));
}

/**
 * Riconosce un verbo del player in una frase libera.
 *
 * Il riconoscimento e' volutamente stretto. Largo sbaglierebbe dalla parte
 * costosa: "guarda il camino" e' un'azione della scena, e trattarla come
 * "guardati intorno" vorrebbe dire rispondere con la descrizione della stanza
 * a chi stava guardando una cosa precisa — cioe' nascondergli un'azione che
 * esisteva.
 */
export function verboDelPlayer(input: string): Verbo {
  const piatto = normalizza(input);
  if (piatto === '') return 'nessuno';

  const rs = radiciIntere(input);

  // Inventario. Due strade: la domanda di possesso — ancorata all'intera
  // frase, perche' "guarda cosa ho scritto sulla mano" non e' una domanda sul
  // possesso — e il contenitore nominato, purche' intorno non ci sia
  // nient'altro che parole d'inventario.
  if (/^(che )?(cosa|che|quali)( cose| roba)? (ho|porto|possiedo|tengo|abbiamo)( addosso| con me| in tasca| dietro| appresso)?$/.test(piatto)) {
    return 'inventario';
  }
  if (rs.some((r) => CONTENITORI.has(r)) && rs.every((r) => CONTENITORI.has(r) || FUNZIONALI.has(r) || DI_INVENTARIO.has(r) || PERCEZIONE.has(r))) {
    return 'inventario';
  }

  // Chi c'e' qui. Non ha un verbo obbligatorio — «chi c'e'?» e' una frase
  // senza verbo pieno — quindi si riconosce dal fatto che una parola di
  // presenza c'e' e tutto il resto e' contorno.
  if (rs.some((r) => PRESENZA.has(r)) && rs.every((r) => PRESENZA.has(r) || DI_PRESENZA.has(r) || AMBIENTE.has(r) || FUNZIONALI.has(r))) {
    return 'presenti';
  }

  // Guardarsi intorno: un verbo di percezione e, oltre a quello, nient'altro
  // che non sia l'ambiente in generale o una parola funzionale. Basta un
  // complemento vero in piu' — "guarda il camino", "guarda lei", "osserva
  // ancora" — perche' non sia piu' questo ma un'azione della scena.
  if (/^dove (sono|mi trovo|siamo|ci troviamo)\??$/.test(piatto)) return 'look';
  const haPercezione = rs.some((r) => PERCEZIONE.has(r));
  if (haPercezione && rs.every((r) => PERCEZIONE.has(r) || AMBIENTE.has(r) || FUNZIONALI.has(r))) return 'look';

  return 'nessuno';
}

/**
 * Il testo di `look` che vale adesso, o `undefined` se l'autore non ne ha
 * scritto uno.
 *
 * `undefined` non e' un caso da tappare con una frase di comodo: e' la
 * segnalazione che questa scena, in un player a parole, non sa rispondere alla
 * domanda piu' frequente di tutte. Il linter la fa gia' come avviso; qui la si
 * incontra giocando, che e' il momento in cui si capisce quanto pesa.
 */
export function testoLook(sc: Scene, soddisfa: (c?: Condition) => boolean): string | undefined {
  return lookNow(sc, soddisfa);
}

/**
 * L'inventario come frase, non come elenco di slug.
 *
 * La cornice la scrive l'autore in `player_voice`, e ne servono piu' d'una:
 * alla terza volta che si legge la stessa introduzione si sente il meccanismo.
 * Se non c'e', qui non esce niente — il player non scrive una cornice di
 * comodo, e il buco lo dichiara chi ha chiamato. Il linter lo segnala come
 * errore molto prima di arrivare a giocarlo.
 *
 * La rotazione usa un indice **derivato dallo stato** — quante scene si sono
 * attraversate — invece di un contatore proprio: lo stato di gioco resta
 * interamente derivabile dagli `Effect` applicati, che e' il vincolo su cui si
 * regge la rigiocabilita' di una traccia.
 */
export function testoInventario(story: Story, posseduti: string[], giro: number): string | undefined {
  const voce = story.player_voice;
  if (posseduti.length === 0) return scegli(voce?.inventory_empty, giro);
  const intro = scegli(voce?.inventory_intro, giro);
  if (!intro) return undefined;
  const nomi = posseduti.map((id) => story.items?.find((i) => i.id === id)?.name ?? `${id} [senza scheda in items]`);
  return `${intro} ${elenca(nomi)}.`;
}

/**
 * L'oggetto dell'inventario che il giocatore sta chiedendo di guardare.
 *
 * Si consulta **dopo** il resolver, come tutti i verbi del player: se la scena
 * ha un'azione che riguarda quell'oggetto — «apri il coltello», «accendi il
 * walkie» — quella vince, e deve vincere, perche' fa avanzare la storia mentre
 * questa non fa avanzare niente.
 *
 * Due filtri, e servono tutti e due: ci vuole un verbo di percezione (senza,
 * «prendi il coltello» finirebbe qui) e l'oggetto dev'essere **in inventario**
 * (guardare una cosa che non si ha e' materia della scena, non
 * dell'inventario).
 */
export function oggettoDaEsaminare(story: Story, input: string, posseduti: string[]): string | undefined {
  const interi = radiciIntere(input);
  if (!interi.some((r) => PERCEZIONE.has(r))) return undefined;

  const frase = radici(input);
  let migliore = 0;
  let quale: string | undefined;
  for (const id of posseduti) {
    const it = story.items?.find((i) => i.id === id);
    if (!it) continue;
    for (const superficie of [it.name, ...(it.aliases ?? [])]) {
      const v = affinita(frase, radici(superficie));
      if (v > migliore) {
        migliore = v;
        quale = id;
      }
    }
  }
  return migliore >= SOGLIA_OGGETTO ? quale : undefined;
}

/** La descrizione dell'oggetto com'e' adesso: testo d'autore, mai generato. */
export function testoOggetto(story: Story, id: string, soddisfa: (c?: Condition) => boolean): string | undefined {
  const it = story.items?.find((i) => i.id === id);
  return it ? descrizioneOra(it, soddisfa) : undefined;
}

/**
 * Chi c'e' in scena, come frase.
 *
 * I nomi vengono da `Scene.characters` — chi e' *presente*, anche solo come
 * voce — passati per la roster globale, che e' dove sta il nome da mostrare.
 * La cornice la scrive l'autore, esattamente come per l'inventario: qui il
 * player mette in fila dei nomi, non scrive prosa.
 *
 * Conseguenza per chi compila, e va detta perche' non e' ovvia: questo elenco
 * si deriva, non si scrive. Chiunque stia in `Scene.characters` verra' nominato
 * a chi lo chiede — quindi non ci si mette qualcuno che il giocatore deve
 * ancora scoprire.
 */
export function testoPresenti(story: Story, sc: Scene, giro: number): string | undefined {
  const voce = story.player_voice;
  const presenti = (sc.characters ?? [])
    // Il protagonista sta in `characters` perche' ha un aspetto e una voce,
    // ma non e' compagnia: e' chi sta facendo la domanda.
    .filter((c) => c.id !== story.protagonist)
    .map((c) => {
      const g = findCharacter(story, c.id);
      return g ? displayName(g) : c.id;
    });
  if (presenti.length === 0) return scegli(voce?.presence_alone, giro);
  const intro = scegli(voce?.presence_intro, giro);
  if (!intro) return undefined;
  return `${intro} ${elenca(presenti)}.`;
}

/** "a, b e c" invece di "a, b, c": la differenza fra una frase e un dump. */
function elenca(nomi: string[]): string {
  if (nomi.length === 1) return nomi[0];
  return `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`;
}

function scegli(lista: string[] | undefined, giro: number): string | undefined {
  if (!lista?.length) return undefined;
  return lista[((giro % lista.length) + lista.length) % lista.length];
}
