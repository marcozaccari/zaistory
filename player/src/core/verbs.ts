/**
 * Il vocabolario dei verbi: le quattro famiglie di gesto e le domande di
 * sistema.
 *
 * È l'unico modulo del player con dentro dell'italiano, ed è voluto: le
 * famiglie non dipendono dalla storia — le stesse duecento voci valgono per
 * ogni avventura — quindi non stanno nel file zaistory ma qui. Il nome del file
 * è inglese come tutto il codice; il contenuto è un dizionario, e un dizionario
 * ha la lingua di chi lo consulta.
 *
 * Quando serviranno storie in un'altra lingua, questa tabella andrà indicizzata
 * per `Story.language` invece di essere unica. La forma è già quella giusta:
 * una mappa da radice a famiglia, e niente altro.
 */

import type { Intent, Verb } from './types.js';
import { roots } from './lexical.js';

/**
 * Le quattro famiglie, come radici verbali.
 *
 * `manipulation` assorbe anche la forza — rompere, spaccare, sfondare — perché
 * per il motore sono la stessa cosa: un gesto fisico su un oggetto. Distinguere
 * le due famiglie serviva quando i fallback erano sei; con quattro verbi
 * espliciti la distinzione non guadagna niente e costa una categoria in più da
 * scrivere per ogni fase.
 */
const FAMILIES: ReadonlyArray<readonly [Intent, readonly string[]]> = [
  [
    'perception',
    ['guard','osserv','esamin','ispezion','scrut','sbirc','ved','vedr','legg','rilegg','ascolt','sent',
     'annus','odor','fiut','assagg','controll','verific','not','spi','occhi','intravved','riguard',
     'studi','contempl','esplor','sorvegl','ammir','fiss','illumin','confront','conteggi',
     // cercare: con le mani e con gli occhi. «Cerco un albero su cui salire» è
     // percezione pura, «cerco nella cassetta» è frugare, e a distinguerli non
     // è il verbo ma il complemento.
     'cerc'],
  ],
  [
    'manipulation',
    ['prend','raccogl','affer','pigl','apr','chiud','us','utilizz','adoper','impieg','mett','pos',
     'infil','inser','colleg','attacc','stacc','scolleg','tir','sping','spost','muov','gir','ruot',
     'frug','cerc','rovist','tagl','leg','sleg','accend','spegn','riemp','svuot','vuot','vers','combin',
     'unisc','prem','schiacc','solleva','solleve','abbass','sfil','svit','avvit','strofin','pul',
     'fiss','sistem','ripar','tocc','carica','caric','scarica','indoss','togl','lanci','prepar',
     'attiv','modific','dai','dar','consegn','offr','porg','mostr',
     'alz','punt','butt','gett','rovesci','ribalt','scoperchi','trascin','estra','recuper',
     'string','lasci','batt','scav','arrotol','srotol','liber','cambi','sgancia','slacci',
     'allent','volt','spell','cal','riavvit','issa','arret',
     'premi','incid','fascia','nascond',
     // la forza: stesso gesto, altra intensità
     'romp','spacc','forz','colp','picchi','sfond','distrugg','calci','spar','sbatt','strapp',
     'spezz','scardin','scass','frantum','abbatt','aggred'],
  ],
  [
    'communication',
    ['parl','dic','chied','domand','rispond','chiam','grid','url','salut','ringrazi','insult',
     'present','raccont','avvis','avvert','spieg','convinc','minacci','implor','sussurr','negozi',
     // percezione del parlato: si ascolta un rumore e si ascolta una persona
     'ascolt','sent','origli',
     'persuad','rimprover','comment','afferm','dichiar','annunci','provoc','scherz','borbott',
     'brontol','strill','declam','consult','confid','interrog'],
  ],
  [
    'movement',
    ['and','vad','vai','esc','usc','entr','sal','scend','torn','cammin','corr','avvicin','allontan',
     'segu','attravers','pass','fugg','scapp','arrampic','salt','part','raggiung','dirig','rientr',
     'ripart','prosegu','avanz','indietregg','mapp'],
  ],
];

/**
 * Da radice a famiglie. Al plurale, e non per generosità: **ascoltare** è
 * percezione quando l'oggetto è un rumore e comunicazione quando è una persona
 * — «ascolto il vento» e «ascolto Tommy» sono lo stesso verbo e due gesti
 * diversi, e a decidere quale sia non è il verbo ma il complemento, che qui non
 * si è ancora guardato. Costringerlo a una famiglia sola significava perdere
 * «ascolta cosa dicono», che è il modo più naturale di entrare in un dialogo.
 */
const INTENT_OF = new Map<string, Intent[]>();
for (const [intent, verbRoots] of FAMILIES) {
  for (const r of verbRoots) {
    const gia = INTENT_OF.get(r);
    if (gia) {
      if (!gia.includes(intent)) gia.push(intent);
    } else {
      INTENT_OF.set(r, [intent]);
    }
  }
}

/** Il verbo d'azione corrispondente a una famiglia. `movement` non ne ha uno
 * non perché sia un verbo minore, ma perché si scrive in un altro campo: le
 * uscite del luogo. Le famiglie qui sono quattro, i valori di `Action.verb`
 * tre, e la differenza è dove finisce il verbo, non quanti sono. */
export function verbOfIntent(i: Intent): Verb | undefined {
  switch (i) {
    case 'perception':
      return 'look';
    case 'manipulation':
      return 'use';
    case 'communication':
      return 'talk';
    default:
      return undefined;
  }
}

export function intentOfVerb(v: Verb): Intent {
  switch (v) {
    case 'look':
      return 'perception';
    case 'use':
      return 'manipulation';
    case 'talk':
      return 'communication';
  }
}

/**
 * Quanto una radice della frase può allontanarsi da una della tabella e valere
 * ancora come lo stesso verbo.
 *
 * Il prefisso da solo non basta, e il caso che l'ha insegnato è «corridoio»: la
 * sua radice è `corridoi`, comincia per `corr` — che è *correre* — e in un
 * magazzino fatto di corridoi ogni frase risultava un verbo di movimento, con
 * il risultato che «butto giù il carrello in mezzo al corridoio» veniva letto
 * come «vai».
 *
 * Non basta nemmeno contare le lettere di scarto, perché `colpisc` sta a `colp`
 * esattamente come `corridoi` sta a `corr`. Quello che li distingue è **cosa**
 * avanza: da un verbo avanza un pezzo di coniugazione, da un sostantivo avanza
 * il resto della parola. Quindi si guarda l'avanzo, e si accetta solo se è uno
 * di quelli che la coniugazione italiana produce davvero — l'infisso `-isc-`
 * di *colpisco*, la `-h-` di *cerchiamo*, la vocale che lo stemmer non ha
 * tolto.
 */
const AVANZI_DI_CONIUGAZIONE = new Set(['sc', 'isc', 'isch', 'hi', 'he', 'gh', 'ghi', 'ci', 'ce']);

/** Un avanzo va bene se è una lettera sola — la vocale che lo stemmer non ha
 * tolto, o la consonante doppia che la tabella ha troncato di uno (`affer`
 * contro `afferr`) — oppure se è uno degli infissi qui sopra. Due lettere
 * qualunque no: da lì in giù comincia il resto del sostantivo. */
function avanzoDiConiugazione(avanzo: string): boolean {
  return avanzo.length <= 1 || AVANZI_DI_CONIUGAZIONE.has(avanzo);
}

/**
 * Nell'altro verso — la radice della tabella più lunga di quella della frase —
 * si accetta **una vocale sola**.
 *
 * È l'imprecisione dello stemmer al contrario, `sollev` contro `solleva`, e lì
 * la lettera che avanza è sempre una desinenza. Bastavano invece due lettere
 * qualunque perché `spina` diventasse *spingere* e `provo` diventasse
 * *provocare*: il complemento spariva dalla frase perché il parser lo prendeva
 * per il verbo, e la trappola del bagno non si poteva più chiedere a parole.
 */
const VOCALI = new Set(['a', 'e', 'i', 'o', 'u']);

/** Le famiglie di una radice, se è un verbo riconosciuto. */
export function intentsOfRoot(r: string): Intent[] {
  const direct = INTENT_OF.get(r);
  if (direct) return direct;
  // Le radici della tabella sono già troncate: un prefisso comune abbastanza
  // lungo basta («osservo» -> «osserv», «guardarono» -> «guard»).
  for (const [key, intents] of INTENT_OF) {
    if (r.length < 4 || key.length < 4) continue;
    if (r.startsWith(key)) {
      if (avanzoDiConiugazione(r.slice(key.length))) return intents;
      continue;
    }
    if (key.startsWith(r) && key.length - r.length === 1 && VOCALI.has(key[r.length])) return intents;
    if (key === r) return intents;
  }
  return [];
}

/** La prima famiglia di una radice. Comoda dove ne serve una sola. */
export function intentOfRoot(r: string): Intent | undefined {
  return intentsOfRoot(r)[0];
}

/** Il verbo della frase e la posizione in cui compare, così chi legge sa dove
 * finisce il verbo e comincia il complemento. Vince il primo riconosciuto. */
export function findVerb(phraseRoots: string[]): { intent: Intent; at: number } | undefined {
  return findVerbs(phraseRoots)[0];
}

/**
 * TUTTI i verbi riconosciuti nella frase, nell'ordine.
 *
 * Perché non basta il primo. L'italiano parlato incastra i verbi — «mi giro
 * verso Tommy e grido», «vado a vedere cosa c'è dietro» — e il primo è quasi
 * sempre quello di appoggio, non quello che dice cosa si vuole fare. Prendere
 * solo il primo faceva perdere la frase due volte: sbagliava la famiglia con
 * cui pesare le azioni, e lasciava l'altro verbo dentro il complemento a fare
 * punteggio contro il nome di un'entità.
 *
 * Il parser li usa tutti: un'azione vale pieno se la sua famiglia è FRA quelle
 * nominate. Resta il rifiuto che conta — una frase di sola percezione non fa
 * partire un'azione che manipola — perché lì di famiglia ce n'è una sola.
 */
export function findVerbs(phraseRoots: string[]): { intent: Intent; at: number }[] {
  const out: { intent: Intent; at: number }[] = [];
  for (let i = 0; i < phraseRoots.length; i++) {
    for (const intent of intentsOfRoot(phraseRoots[i])) out.push({ intent, at: i });
  }
  return out;
}

/** L'intenzione di una frase. Se non c'è nessun verbo riconosciuto, `generic`
 * — che è anche il caso del nonsense, ed è la ragione per cui quella categoria
 * di fallback va scritta sempre. */
export function classifyIntent(phrase: string): Intent {
  return findVerb(roots(phrase))?.intent ?? 'generic';
}

// ------------------------------------------------- le domande di sistema

/**
 * Le domande che non sono tentativi di agire sul mondo.
 *
 * Si riconoscono **per forma intera**, non per parole sparse, ed è la
 * differenza che conta: «cosa posso fare» è una domanda sull'interfaccia,
 * «cosa posso fare con la leva» è un'azione della scena, e scipparla
 * all'autore sarebbe peggio del non capirla.
 */
export type SystemQuestion = 'help' | 'look_around' | 'inventory' | 'presence' | 'exits';

const FORMS: ReadonlyArray<readonly [SystemQuestion, RegExp]> = [
  ['help', /^(cosa|che cosa|che)\s+(posso|si puo|si può)\s+fare\??$/],
  ['help', /^(aiuto|help|suggerimento|suggeriscimi( qualcosa)?|sono bloccato|non so cosa fare|che si fa( adesso)?)\??$/],
  ['look_around', /^(guardati intorno|guarda intorno|mi guardo intorno|guardo intorno|dove sono|dove mi trovo|osserva intorno)\??$/],
  ['look_around', /^(guarda|osserva|guardo|osservo|esamina|esamino)\??$/],
  ['inventory', /^(inventario|zaino|cosa ho( (in mano|addosso|nello zaino|con me))?|che cosa ho|cosa porto|tasche)\??$/],
  ['inventory', /^(fruga|frugo|cerco) (nello|nel) (zaino|borsa|tasche)\??$/],
  ['presence', /^(chi c e( qui)?|chi ce qui|chi e qui|chi c e in giro|chi sono i personaggi|quali sono i personaggi|chi vedo)\??$/],
  ['exits', /^(dove posso andare|dove si puo andare|mappa|quali sono le uscite|uscite|dove vado|dove si va)\??$/],
  ['exits', /^(vai|esci|vado|esco|muoviti|spostati)\??$/],
];

/**
 * Riconosce una domanda di sistema, oppure niente.
 *
 * `help` e `look_around` si consultano **prima** del parser: non sono
 * tentativi di agire e lasciarle somigliare agli alias di un'entità
 * significava farla partire — una domanda non può applicare un effetto. Il
 * prezzo, che va detto: una storia non può avere un'entità chiamata
 * esattamente «aiuto».
 *
 * Le altre si consultano **dopo**, perché un'azione d'autore deve vincere su
 * un verbo di sistema: un luogo che ha davvero un'azione «fruga nello zaino»
 * non se la deve vedere scippare.
 */
export function systemQuestion(phrase: string): SystemQuestion | undefined {
  const flat = normalizeQuestion(phrase);
  for (const [q, re] of FORMS) if (re.test(flat)) return q;
  return undefined;
}

export function isEarlyQuestion(q: SystemQuestion): boolean {
  return q === 'help' || q === 'look_around';
}

function normalizeQuestion(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['`’]/g, ' ')
    .replace(/[^a-z0-9? ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
