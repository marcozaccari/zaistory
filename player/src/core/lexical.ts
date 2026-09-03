/**
 * Il matcher lessicale: normalizzazione, radici, affinità fra frasi.
 *
 * Perché esiste, prima di come funziona. Il parser non genera testo: sceglie
 * un id fra candidate note in anticipo. È ranking su insieme chiuso, e su un
 * insieme chiuso la conoscenza semantica si può scrivere *prima* invece di
 * dedurla ogni volta — gli `aliases` che il compilatore scrive sulle entità
 * sono esattamente questo, un embedding lessicale precalcolato e congelato
 * dentro la storia. Qui non c'è nessun modello perché il lavoro del modello
 * l'ha già fatto il compilatore.
 *
 * Le due proprietà che questo modulo deve avere, e che nessun backend neurale
 * garantisce:
 *
 * - **è deterministico**: la stessa frase dà lo stesso id su ogni macchina e in
 *   ogni sessione, quindi una partita giocata a parole resta rigiocabile;
 * - **sbaglia rifiutando**: preferisce il non-match al match sbagliato. Un
 *   falso negativo costa una frase riscritta; un falso positivo *esegue* —
 *   applica un effetto, alza un flag, brucia un enigma.
 */

/** Minuscole, niente accenti, niente punteggiatura, spazi singoli. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['`’]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parole che non distinguono niente: articoli, preposizioni, clitici,
 * ausiliari e i verbi-appoggio con cui si incartano le frasi. Toglierle serve
 * a non far pesare «la porta» e «porta» in modo diverso.
 */
const STOPWORDS = new Set([
  'il','lo','la','i','gli','le','un','uno','una','del','dello','della','dei','degli','delle',
  'di','a','al','allo','alla','ai','agli','alle','da','dal','dallo','dalla','dai','dagli','dalle',
  'in','nel','nello','nella','nei','negli','nelle','con','col','coi','su','sul','sullo','sulla',
  'sui','sugli','sulle','per','tra','fra','e','ed','o','od','ma','se','che','chi','cui','non',
  'mi','ti','si','ci','vi','ne','me','te','lui','lei','io','tu','noi','voi','loro',
  'ho','hai','ha','abbiamo','avete','hanno','sono','sei','siamo','siete','essere','avere',
  'sto','stai','sta','stiamo','state','stanno',
  'voglio','vorrei','posso','potrei','devo','adesso','ora','poi','qui','ecco','be','beh',
  'po','molto','tanto','tutto','tutta','tutti','tutte','anche','ancora','gia',
  'questo','questa','questi','queste','quel','quello','quella','quei','quegli','quelle',
  'perche','pero','quindi','allora','dunque','insomma','magari','forse','proprio','solo',
  'stesso','stessa','altro','altra','altri','altre','ogni','qualche','nessun','nessuno',
]);

/**
 * Locuzioni che valgono un verbo.
 *
 * L'italiano parlato dice quasi sempre «do un'occhiata» invece di «guardo», e
 * un matcher che ragiona per parole vede lì un sostantivo raro e nessun verbo.
 * Sono poche e comunissime: la tabella non deve crescere per inseguire ogni
 * giro di frase — quella è la strada che porta a riscrivere un modello a mano.
 *
 * Le perifrasi vengono prima: «mi metto a studiare» ha due verbi e quello che
 * conta è il secondo. Senza toglierle, il verbo d'appoggio si prende
 * l'intenzione e la frase finisce nel fallback sbagliato.
 */
const PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
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
  [/\battacc(o|are|a|hiamo) (bottone|discorso)\b/g, 'parlo'],
  [/\bpass(o|are|a|iamo) in rassegna\b/g, 'esamino'],
  [/\bf(accio|ar|a|acciamo) fuoco\b/g, 'sparo'],
  [/\bf(accio|ar|a|acciamo) leva\b/g, 'forzo'],
  [/\bmett(o|ere|iamo) a fuoco\b/g, 'guardo'],
  [/\bf(accio|ar|a|acciamo) cadere\b/g, 'butto'],
  [/\bl(ascio|asciare|ascia) cadere\b/g, 'butto'],
  [/\bfar (notare|presente)\b/g, 'dico'],
  [/\bmett(o|ere) le mani (su|dentro|in)\b/g, 'prendo'],
  [/\bd(o|are|a|ai) un (pugno|calcio|colpo|colpetto)\b/g, 'colpisco'],
  [/\bd(o|are|a|ai) una (spinta|manata|botta)\b/g, 'spingo'],
  [/\band(o|are) a fondo\b/g, 'cerco'],
  [/\bvad(o|a) a fondo\b/g, 'cerco'],
];

/**
 * Suffissi tolti in ordine di lunghezza. Volutamente grossolano: non è uno
 * stemmer linguistico, è un modo di far cadere «porta» e «porte» sulla stessa
 * radice. Un troncamento sbagliato costa un accostamento in più fra parole
 * imparentate, che qui è quasi sempre quello che si vuole.
 */
const SUFFIXES = [
  'issimo','issima','issimi','issime','amento','imento','azione','arono','erono','irono',
  'iamo','ando','endo','arsi','ersi','irsi','erei','irei','anno',
  'are','ere','ire','ato','ata','ati','ate','uto','uta','uti','ute','ito','ita','iti','ite',
  'ano','ono','ete','ai','ei','ii','oi',
  'a','e','i','o',
];

/** La radice di una parola. Mai più corta di tre lettere: sotto quella soglia
 * due parole diverse collassano sulla stessa e il matcher comincia a vedere
 * parentele che non ci sono. */
export function root(word: string): string {
  for (const suf of SUFFIXES) {
    if (word.length - suf.length >= 3 && word.endsWith(suf)) {
      return word.slice(0, word.length - suf.length);
    }
  }
  return word;
}

/** Da frase a radici significative, nell'ordine in cui compaiono. */
export function roots(phrase: string): string[] {
  let flat = normalize(phrase);
  for (const [re, verb] of PHRASES) flat = flat.replace(re, verb);
  const out: string[] = [];
  for (const w of flat.split(' ')) {
    if (!w || STOPWORDS.has(w)) continue;
    const r = root(w);
    if (r.length >= 2) out.push(r);
  }
  return out;
}

/** Due radici valgono come la stessa parola? Uguali, oppure una prefisso
 * dell'altra, oppure a un refuso di distanza. Il refuso conta: chi scrive su
 * un telefono ne fa uno ogni due frasi, e rifiutarlo è rifiutare una frase
 * giusta. */
export function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1) return withinOne(a, b);
  return false;
}

/** Distanza di edit <= 1, senza costruire la matrice. */
function withinOne(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (short.length === long.length) i++;
    j++;
  }
  return true;
}

/**
 * Quanto vale, al minimo, una superficie di una parola sola.
 *
 * Misurato sulle storie di riferimento. Il pericolo per cui esiste è che una
 * domanda lunga faccia partire l'azione agganciata a un alias di una parola —
 * «cerco di capire se quella parete si può salire» che esegue l'alias «sali» —
 * e resta il tipo di errore che questo progetto rifiuta di comprare in cambio
 * di richiamo.
 *
 * Sta più in alto di quanto stesse perché nel frattempo quella difesa è
 * diventata di due: il parser adesso toglie dal complemento TUTTI i verbi
 * riconosciuti, non solo il primo, quindi in «si può salire» la parola
 * pericolosa non arriva nemmeno al confronto. Con il pericolo dimezzato, una
 * penalità che affondava «urlo qualcosa a Tommy mentre sbanda» — dove il nome
 * proprio è detto per intero — costava più di quanto proteggesse.
 */
export const SINGLE_WORD_WEIGHT = 0.78;

/**
 * Quanto una frase somiglia a una superficie (il nome o un alias di un'entità).
 *
 * Si pesano due cose diverse: **dice**, che chiede alle due frasi di essere
 * lunghe uguali, e **copertura**, che chiede solo che la superficie sia detta
 * per intero. La seconda pesa di più perché il giocatore scrive quasi sempre
 * più parole di quante ne servano, e penalizzarlo sarebbe penalizzarlo per aver
 * scritto in italiano.
 */
export function affinity(input: string[], surface: string[]): number {
  if (input.length === 0 || surface.length === 0) return 0;
  const used = new Set<number>();
  let common = 0;
  for (const a of input) {
    for (let j = 0; j < surface.length; j++) {
      if (used.has(j)) continue;
      if (similar(a, surface[j])) {
        used.add(j);
        common++;
        break;
      }
    }
  }
  if (common === 0) return 0;
  const dice = (2 * common) / (input.length + surface.length);
  const coverage = common / surface.length;
  let score = 0.45 * dice + 0.55 * coverage;
  if (surface.length === 1) {
    score *= SINGLE_WORD_WEIGHT + (1 - SINGLE_WORD_WEIGHT) * (common / input.length);
  }
  return score;
}

/** La migliore affinità fra la frase e un insieme di superfici alternative
 * (nome + alias di una stessa entità). */
export function bestAffinity(input: string[], forms: string[]): number {
  let best = 0;
  for (const f of forms) {
    const s = affinity(input, roots(f));
    if (s > best) best = s;
  }
  return best;
}

/**
 * Quanto una superficie è **nominata** dentro la frase, senza chiedere che la
 * frase le somigli.
 *
 * È una domanda diversa da `affinity`, e serve dove la domanda giusta è quella:
 * in «usa il cavo con la presa» la frase contiene per forza due nomi più il
 * contorno, e misurare quanto somiglia a ciascuno dei due la fa perdere con
 * entrambi. Qui si guarda solo se la superficie è detta per intero.
 *
 * Più permissiva, quindi si usa solo dove il contesto è già stringente — la
 * coppia di complementi, dove servono nominati **tutti e due** perché l'azione
 * parta, e due nomi giusti nella stessa frase non capitano per caso.
 */
export function mentions(input: string[], forms: string[]): number {
  let best = 0;
  for (const f of forms) {
    const surface = roots(f);
    if (surface.length === 0) continue;
    let common = 0;
    const used = new Set<number>();
    for (const s of surface) {
      for (let i = 0; i < input.length; i++) {
        if (used.has(i)) continue;
        if (similar(s, input[i])) {
          used.add(i);
          common++;
          break;
        }
      }
    }
    let score = common / surface.length;
    if (surface.length === 1) {
      score *= SINGLE_WORD_WEIGHT + (1 - SINGLE_WORD_WEIGHT) * (common / Math.max(1, input.length));
    }
    if (score > best) best = score;
  }
  return best;
}
