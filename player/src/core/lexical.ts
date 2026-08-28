/**
 * Il matcher lessicale: normalizzazione, radici, affinita' fra frasi e
 * classificazione dell'intenzione.
 *
 * Perche' esiste, prima di come funziona. Il resolver non genera testo:
 * sceglie un id fra cinque o quindici candidate note in anticipo. E' un
 * problema di ranking su insieme chiuso, e su un insieme chiuso la conoscenza
 * semantica si puo' scrivere *prima* invece di dedurla ogni volta: gli
 * `aliases` che il compilatore genera in compilazione sono esattamente questo,
 * un embedding lessicale precalcolato e congelato dentro l'IR. Qui non c'e'
 * nessun modello perche' il lavoro del modello l'ha gia' fatto il compilatore.
 *
 * Le due proprieta' che questo modulo deve avere, e che nessun backend
 * neurale garantisce:
 *
 * - **e' deterministico**: la stessa frase da' lo stesso id su ogni macchina e
 *   in ogni sessione, quindi una partita giocata a parole resta rigiocabile;
 * - **sbaglia rifiutando**: preferisce il non-match al match sbagliato. Un
 *   falso negativo costa una frase riscritta, un falso positivo *esegue* —
 *   applica un `Effect`, alza un flag, consuma un oggetto — e puo' bruciare un
 *   enigma. Le soglie e il margine di ambiguita' piu' sotto sono la traduzione
 *   in numeri di questa preferenza.
 */

import type { Intent } from './types.js';

// --------------------------------------------------------------- normalizza

/** Minuscole, niente accenti, niente punteggiatura, spazi singoli. */
export function normalizza(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['`’]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parole che non distinguono niente: articoli, preposizioni, clitici,
 * ausiliari e i verbi-appoggio con cui si incartano le frasi ("provo a
 * aprire"). Toglierle serve a non far pesare "la porta" e "porta" in modo
 * diverso.
 */
const VUOTE = new Set([
  'il','lo','la','i','gli','le','un','uno','una','del','dello','della','dei','degli','delle',
  'di','a','al','allo','alla','ai','agli','alle','da','dal','dallo','dalla','dai','dagli','dalle',
  'in','nel','nello','nella','nei','negli','nelle','con','col','coi','su','sul','sullo','sulla',
  'sui','sugli','sulle','per','tra','fra','e','ed','o','od','ma','se','che','chi','cui','non',
  'mi','ti','si','ci','vi','ne','me','te','se','lui','lei','io','tu','noi','voi','loro',
  'ho','hai','ha','abbiamo','avete','hanno','sono','sei','siamo','siete','essere','avere',
  'sto','stai','sta','stiamo','state','stanno',
  'provo','provi','prova','provare','proviamo','tento','tentare','cerco di',
  'voglio','vorrei','posso','potrei','devo','adesso','ora','poi','qui','li','la','ecco','be','beh',
  'un po','po','molto','tanto','tutto','tutta','tutti','tutte','anche','ancora','gia',
  'questo','questa','questi','queste','quel','quello','quella','quei','quegli','quelle',
  'perche','pero','quindi','allora','dunque','insomma','magari','forse','proprio','solo',
  'stesso','stessa','altro','altra','altri','altre','ogni','qualche','nessun','nessuno',
]);

/**
 * Locuzioni che valgono un verbo.
 *
 * L'italiano parlato dice quasi sempre "do un'occhiata" invece di "guardo", e
 * un matcher che ragiona per parole vede in quella frase un sostantivo raro e
 * nessun verbo. Sono poche e comunissime: la tabella non deve crescere per
 * inseguire ogni giro di frase — quella e' la strada che porta a riscrivere un
 * modello a mano — ma le mezze dozzine che ricorrono in ogni partita valgono i
 * loro sei valori.
 */
const LOCUZIONI: ReadonlyArray<readonly [RegExp, string]> = [
  // Prima le perifrasi: "mi metto a studiare" ha due verbi, e quello che conta
  // e' il secondo. Senza toglierle, il verbo d'appoggio si prende
  // l'intenzione — "metto" e' manipolazione, "studiare" e' percezione — e la
  // frase finisce nel fallback sbagliato.
  [/\bmi mett(o|ere|iamo) a\b/g, ' '],
  [/\bcominci(o|are|a|amo) a\b/g, ' '],
  [/\binizi(o|are|a|amo) a\b/g, ' '],
  [/\bst(o|are|a) per\b/g, ' '],
  [/\bcerc(o|are|a|hiamo) di\b/g, ' '],
  [/\bprov(o|are|a|iamo) a\b/g, ' '],
  [/\btent(o|are|a|iamo) di\b/g, ' '],
  [/\bfacci(o|amo) per\b/g, ' '],
  [/\b(do|dare|dai|diamo|davo|dato) un (occhiata|occhio|sguardo)\b/g, 'guardo'],
  [/\bbutt(o|are|a) (un )?(occhio|uno sguardo)\b/g, 'guardo'],
  [/\bgett(o|are|a) (un )?(occhio|uno sguardo)\b/g, 'guardo'],
  [/\bd(o|are|a) un occhiata\b/g, 'guardo'],
  [/\bfacci(o|amo)? (caso|attenzione) a\b/g, 'guardo'],
  [/\btend(o|ere) l orecchio\b/g, 'ascolto'],
  [/\bst(o|are|a) (a )?sentire\b/g, 'ascolto'],
  [/\bmett(o|ere)mi in ascolto\b/g, 'ascolto'],
  [/\bfacci(o|amo) notare\b/g, 'dico'],
  [/\bfar (notare|presente)\b/g, 'dico'],
  [/\bmett(o|ere) le mani (su|dentro|in)\b/g, 'prendo'],
  [/\band(o|are) a fondo\b/g, 'cerco'],
  [/\bvad(o|a) a fondo\b/g, 'cerco'],
];

/**
 * Suffissi tolti in ordine di lunghezza. Volutamente grossolano: non e' uno
 * stemmer linguistico, e' un modo di far cadere "porta", "porte" e "portone"
 * (no, quello no) sulla stessa radice. Un troncamento sbagliato costa un
 * accostamento in piu' fra parole imparentate, che qui e' quasi sempre quello
 * che si vuole.
 */
const SUFFISSI = [
  'issimo','issima','issimi','issime','amento','imento','azione','arono','erono','irono',
  'iamo','ando','endo','arsi','ersi','irsi','erei','irei','anno','ando',
  'are','ere','ire','ato','ata','ati','ate','uto','uta','uti','ute','ito','ita','iti','ite',
  'ano','ono','ete','ate','ai','ei','ii','oi',
  'a','e','i','o',
];

/** La radice di una parola. Mai piu' corta di tre lettere: sotto quella
 * soglia due parole diverse collassano sulla stessa e il matcher comincia a
 * vedere parentele che non ci sono. */
export function radice(parola: string): string {
  for (const suf of SUFFISSI) {
    if (parola.length - suf.length >= 3 && parola.endsWith(suf)) {
      return parola.slice(0, parola.length - suf.length);
    }
  }
  return parola;
}

/** Da frase a radici significative, nell'ordine in cui compaiono. */
export function radici(frase: string): string[] {
  let piatto = normalizza(frase);
  for (const [re, verbo] of LOCUZIONI) piatto = piatto.replace(re, verbo);
  const out: string[] = [];
  for (const p of piatto.split(' ')) {
    if (!p || VUOTE.has(p)) continue;
    const r = radice(p);
    if (r.length >= 2) out.push(r);
  }
  return out;
}

/** Due radici valgono come la stessa parola? Uguali, oppure una prefisso
 * dell'altra, oppure a un refuso di distanza. Il refuso conta: chi scrive su
 * un telefono ne fa uno ogni due frasi, e rifiutarlo e' rifiutare una frase
 * giusta. */
export function simili(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1) return entroUno(a, b);
  return false;
}

/** Distanza di edit <= 1, senza costruire la matrice. */
function entroUno(a: string, b: string): boolean {
  if (a === b) return true;
  const [corta, lunga] = a.length <= b.length ? [a, b] : [b, a];
  if (lunga.length - corta.length > 1) return false;
  let i = 0;
  let j = 0;
  let differenze = 0;
  while (i < corta.length && j < lunga.length) {
    if (corta[i] === lunga[j]) {
      i++;
      j++;
      continue;
    }
    if (++differenze > 1) return false;
    if (corta.length === lunga.length) i++;
    j++;
  }
  return true;
}

// ---------------------------------------------------------------- affinita'

/**
 * Quanto una frase somiglia a una superficie (un'etichetta, un alias, il nome
 * di un oggetto).
 *
 * Si pesano due cose diverse: **dice**, che chiede alle due frasi di essere
 * lunghe uguali, e **copertura**, che chiede solo che la superficie sia detta
 * per intero. La seconda pesa di piu' perche' il giocatore scrive quasi sempre
 * piu' parole di quante ne serva ("provo ad aprire la porta con la chiave"
 * contro l'alias "apri la porta"), e penalizzarlo per averlo fatto sarebbe
 * penalizzarlo per aver scritto in italiano.
 *
 * Una superficie di una parola sola vale meno, e la penalita' e'
 * proporzionale a quanto della frase resta fuori invece che una costante: se
 * il giocatore ha scritto dieci parole e l'alias ne copre una, quell'alias non
 * e' quello che stava chiedendo. E' il correttivo che tiene «cerco di capire
 * se quella parete si puo' salire» lontano dall'alias "sali" — cioe' che
 * impedisce a una domanda di far partire l'azione che chiude la storia. Se
 * invece il giocatore ha scritto davvero solo "sali", la penalita' sparisce.
 */
/**
 * Quanto vale, al minimo, una superficie di una parola sola.
 *
 * Misurato sui due IR di esempio: a 0.80 il richiamo e' piu' alto di sei punti
 * ma «cerco di capire se quella parete si puo' salire» fa partire l'azione che
 * *chiude la storia*, agganciata all'alias "sali". A 0.65 quella frase torna a
 * non risolvere. Sei punti di richiamo in cambio di un finale che parte da una
 * domanda: e' lo scambio che questo progetto ha gia' deciso di fare — meglio
 * rifiutare che eseguire.
 *
 * E' una costante, non una verita': si alza in una riga se una storia risulta
 * troppo sorda, e `--copertura` dice subito quanto costa.
 */
export const PESO_PAROLA_SOLA = 0.65;

export function affinita(ingresso: string[], superficie: string[]): number {
  if (ingresso.length === 0 || superficie.length === 0) return 0;
  const usati = new Set<number>();
  let comuni = 0;
  for (const a of ingresso) {
    for (let j = 0; j < superficie.length; j++) {
      if (usati.has(j)) continue;
      if (simili(a, superficie[j])) {
        usati.add(j);
        comuni++;
        break;
      }
    }
  }
  if (comuni === 0) return 0;
  const dice = (2 * comuni) / (ingresso.length + superficie.length);
  const copertura = comuni / superficie.length;
  let punteggio = 0.45 * dice + 0.55 * copertura;
  if (superficie.length === 1) punteggio *= PESO_PAROLA_SOLA + (1 - PESO_PAROLA_SOLA) * (comuni / ingresso.length);
  return punteggio;
}

// ------------------------------------------------------------- intenzioni

/**
 * Le sei famiglie di tentativo, come tabella di radici verbali.
 *
 * E' vocabolario **indipendente dalla storia**: le stesse duecento voci
 * valgono per ogni IR, e per questo la tabella sta nel player e non nell'IR.
 * Serve a due cose: scegliere quale fallback d'autore mostrare, e penalizzare
 * un accostamento fra due frasi che parlano di gesti diversi.
 */
const VERBI: ReadonlyArray<readonly [Intent, readonly string[]]> = [
  [
    'percezione',
    ['guard','osserv','esamin','ispezion','scrut','sbirc','ved','vedr','legg','ascolt','sent',
     'annus','odor','fiut','controll','verific','not','spi','occhi','intravved','riguard','studi'],
  ],
  [
    'manipolazione',
    ['prend','raccogl','affer','pigl','apr','chiud','us','adoper','impieg','mett','pos','infil',
     'inser','colleg','attacc','stacc','scolleg','tir','sping','spost','gir','ruot','frug','cerc',
     'rovist','tagl','leg','sleg','accend','spegn','riemp','svuot','vers','combin','unisc','premi',
     'schiacc','solleva','solleve','abbass','sfil','svit','avvit','strofin','pul','fiss','sistem',
     'ripar','tocc','sposta','carica','caric','scarica','indoss','togl','lanci','tir'],
  ],
  [
    'movimento',
    ['and','vad','esc','usc','entr','sal','scend','torn','cammin','corr','avvicin','allontan',
     'segu','attravers','pass','fugg','scapp','arrampic','salt','vai','part','raggiung','dirig'],
  ],
  [
    'sociale',
    ['parl','dic','chied','domand','rispond','chiam','grid','url','salut','ringrazi','insult',
     'present','raccont','avvis','avvert','spieg','convinc','minacci','implor'],
  ],
  [
    'forza',
    ['romp','spacc','forz','colp','picchi','sfond','distrugg','calci','spar','sbatt','strapp',
     'spezz','scardin','scass','frantum','abbatt','uccid','ammazz','aggred'],
  ],
];

const INTENTO_DI = new Map<string, Intent>();
for (const [intent, radiciVerbo] of VERBI) {
  for (const r of radiciVerbo) if (!INTENTO_DI.has(r)) INTENTO_DI.set(r, intent);
}

/** L'intenzione di una radice, se e' un verbo riconosciuto. */
export function intentoDiRadice(r: string): Intent | undefined {
  const diretto = INTENTO_DI.get(r);
  if (diretto) return diretto;
  // Le radici della tabella sono gia' troncate: un prefisso comune abbastanza
  // lungo basta ("osservo" -> "osserv", "guardarono" -> "guard").
  for (const [chiave, intent] of INTENTO_DI) {
    if (r.length >= 4 && chiave.length >= 4 && (r.startsWith(chiave) || chiave.startsWith(r))) return intent;
  }
  return undefined;
}

/** L'intenzione di una frase: il primo verbo riconosciuto vince. Se non ce
 * n'e' nessuno, `generico` — che e' anche il caso del nonsense, ed e' la
 * ragione per cui quella categoria va scritta sempre. */
export function classificaIntento(frase: string): Intent {
  for (const r of radici(frase)) {
    const i = intentoDiRadice(r);
    if (i) return i;
  }
  return 'generico';
}

/**
 * Penalita' quando le due frasi parlano di gesti di famiglia diversa.
 *
 * E' il correttivo che tiene "guardo la porta" lontano da "apri la porta":
 * senza, condividono il sostantivo e il matcher le vede vicine. Vale solo se
 * *entrambe* hanno un verbo riconosciuto — non riconoscerlo non e' una prova
 * di niente.
 */
export function penalitaIntento(a: string[], b: string[]): number {
  const ia = primoIntento(a);
  const ib = primoIntento(b);
  if (!ia || !ib) return 1;
  return ia === ib ? 1 : 0.5;
}

function primoIntento(rs: string[]): Intent | undefined {
  for (const r of rs) {
    const i = intentoDiRadice(r);
    if (i) return i;
  }
  return undefined;
}
