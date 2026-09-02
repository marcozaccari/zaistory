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
 * Due eccezioni, e sono le stesse per la stessa ragione: `isDomandaDiAiuto` e
 * `isGuardatiIntorno` si consultano **prima** del resolver. Non sono tentativi
 * di agire sul mondo ma domande — «cosa posso fare?», «cosa c'e'?» — e
 * lasciarle somigliare agli alias di un'azione significava farla partire. Una
 * domanda non puo' applicare un `Effect`.
 *
 * Qui non si genera niente: tutto il testo che esce da questo modulo l'ha
 * scritto l'autore (`look`, `look_variants`, `player_voice`). Dove l'autore
 * non ha scritto, il player lo dice come diagnostica e non inventa prosa.
 */

import type { Action, Condition, Scene, Story } from './types.js';
import { descrizioneOra, displayName, findCharacter, lookNow } from './types.js';
import { affinita, normalizza, radice, radici } from './lexical.js';

export type Verbo = 'look' | 'inventario' | 'presenti' | 'esamina' | 'aiuto' | 'nessuno';

/**
 * Quanto deve somigliare la frase al nome di un oggetto perche' «guarda il
 * walkie» sia una richiesta di guardare *quello*.
 *
 * Piu' bassa delle soglie del resolver, e puo' esserlo: qui il verbo di
 * percezione ha gia' fatto da filtro e le candidate sono solo gli oggetti che
 * si hanno in mano — di solito tre o quattro, non quindici.
 */
export const SOGLIA_OGGETTO = 0.45;

/**
 * Quanto deve somigliare la frase perche' un tentativo *fallito* si consideri
 * rivolto a una cosa che si ha in mano.
 *
 * Piu' alta di `SOGLIA_OGGETTO` perche' qui manca il filtro del verbo di
 * percezione: la frase puo' essere qualunque cosa, e con una soglia bassa
 * qualunque cosa finirebbe per assomigliare vagamente a un oggetto dello
 * zaino.
 */
export const SOGLIA_OGGETTO_NOMINATO = 0.6;

/**
 * «Cosa posso fare?» — la domanda di chi e' bloccato.
 *
 * Si riconosce per forma intera e non per parole sparse, ed e' la piu' stretta
 * di tutte: «cosa posso fare con la leva» e' un'azione della scena, non una
 * richiesta di aiuto, e la differenza sta tutta nel complemento. Ogni forma
 * qui sotto e' quindi ancorata a inizio e fine frase.
 */
/**
 * Vera se la frase e' la domanda di chi e' bloccato.
 *
 * Sta fuori da `verboDelPlayer` perche' viene consultata **prima del
 * resolver**, unica fra tutte, e la ragione e' un difetto vero: «cosa posso
 * fare» somigliava abbastanza agli alias di certe azioni da farle partire, e
 * su "Metal Head" succedeva in 5 scene su 43 — in una di quelle sparava al
 * tetto del furgone. Una domanda sull'interfaccia non e' un tentativo di agire
 * sul mondo, e non deve poter applicare nessun `Effect`.
 *
 * Il prezzo, e va detto: una storia non puo' piu' avere un'azione che si
 * chiama esattamente «aiuto» — un grido, per dire. E' un prezzo accettabile
 * per non far sparare nessuno a caso.
 */
export function isDomandaDiAiuto(input: string): boolean {
  const piatto = normalizza(input);
  return piatto !== '' && AIUTO.some((r) => r.test(piatto));
}

const AIUTO = [
  /^(ma |e |allora )?(che|cosa) (posso|potrei|si puo|devo|dovrei) fare( adesso| ora| qui)?$/,
  /^(ma |e |allora )?(che|cosa) (faccio|si fa)( adesso| ora| qui)?$/,
  /^(che|cosa) (c e|ce) da fare( qui| adesso| ora)?$/,
  /^aiuto$/,
  /^(sono |mi sono )?blocc(ato|ata)$/,
  /^non so (che|cosa) fare$/,
  /^(dammi un |un )?(suggerimento|indizio)$/,
  /^suggerisci(mi)?( qualcosa| un azione)?$/,
];

/** Radici che parlano dell'ambiente invece che di una cosa precisa. */
// 'post' non c'e' di proposito: la radice di "posto" e' anche quella di
// "posta", e "guarda la posta" e' un'azione di scena, non un guardarsi
// intorno. "dove sono" e "che posto e' questo" sono gia' coperti dalla forma
// esatta piu' sotto.
// 'gir' e non 'giro': qui si confrontano **radici**, e la radice di "giro" e'
// "gir" — con la parola intera «guarda in giro» non ha mai combaciato con
// niente. E' sicura quanto le altre: da sola non fa scattare un look, che ha
// comunque bisogno di un verbo di percezione, e «gira la manovella» ha un
// complemento vero.
const AMBIENTE = new Set(['intorn', 'attorn', 'gir', 'ambient', 'stanz', 'camer', 'luog', 'dov', 'trov', 'scen']);
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
  // L'aiuto prima del look: «cosa posso fare qui» contiene "qui", che e' una
  // parola funzionale, e senza questo controllo cadrebbe fra i guardarsi
  // intorno alla prima occasione. (In pratica `InputLibero` lo intercetta gia'
  // prima del resolver: questo resta perche' la funzione dev'essere completa
  // per conto suo.)
  if (isDomandaDiAiuto(input)) return 'aiuto';

  if (isGuardatiIntorno(input)) return 'look';

  return 'nessuno';
}

/**
 * Le domande che chiedono cosa si vede senza contenere un verbo di percezione
 * riconoscibile parola per parola.
 *
 * «cosa c'e'?» non ha un verbo di percezione affatto, e «cosa vedo?» ce l'ha
 * ma accompagnato da "cosa", che non e' ne' ambiente ne' parola funzionale —
 * con la regola generale sarebbe un complemento, cioe' un'azione di scena.
 * Sono pero' esattamente la stessa domanda di «guardati intorno», e chi gioca
 * le usa indifferentemente. Ancorate a inizio e fine come quelle dell'aiuto:
 * «cosa c'e' dietro la porta» ha un complemento vero, ed e' un'azione.
 */
const GUARDA = [
  /^dove (sono|mi trovo|siamo|ci troviamo)$/,
  /^(ma |e |allora )?(che cosa|cosa|che)( c e| ce)( qui| qua| intorno| in giro| qui intorno| qui attorno)?$/,
  /^(ma |e |allora )?(che cosa|cosa|che) (vedo|vedi|vediamo|si vede)( qui| qua| adesso| ora| intorno| in giro)?$/,
  /^(che cosa|cosa|che) (c e|ce) da (vedere|guardare)( qui| qua)?$/,
];

/**
 * Vera se la frase e' un guardarsi intorno **puro**: la domanda su dove si e',
 * senza niente su cui agire.
 *
 * Sta fuori da `verboDelPlayer` per la stessa ragione di `isDomandaDiAiuto`, e
 * per lo stesso difetto: viene consultata **prima del resolver**. «osserva» da
 * sola somigliava abbastanza agli alias di certe azioni da farle partire, e chi
 * scrive «osserva» non sta agendo sul mondo — sta chiedendo cos'ha davanti. Una
 * domanda non deve poter applicare un `Effect`.
 *
 * Il prezzo e' lo stesso gia' accettato per l'aiuto, e va detto: una storia non
 * puo' avere un'azione che si chiama esattamente «guarda» o «osserva». Puo'
 * averne una che si chiama «osserva il cadavere», perche' li' c'e' un
 * complemento vero e questa funzione dice di no.
 *
 * Stretta apposta, in tutte e tre le direzioni: basta un complemento («guarda
 * il camino») perche' torni a essere materia del resolver, e una parola di
 * contenitore («guarda nello zaino») o di presenza («chi vedi») la manda ai
 * verbi che le competono, che sono altri.
 */
export function isGuardatiIntorno(input: string): boolean {
  const piatto = normalizza(input);
  if (piatto === '') return false;
  // «cosa posso fare qui» contiene "qui", che e' funzionale, e senza questo
  // cadrebbe fra i guardarsi intorno alla prima occasione.
  if (isDomandaDiAiuto(input)) return false;
  if (GUARDA.some((r) => r.test(piatto))) return true;

  const rs = radiciIntere(input);
  if (!rs.some((r) => PERCEZIONE.has(r))) return false;
  // Lo zaino e chi c'e' hanno i loro verbi: qui si parla della stanza.
  if (rs.some((r) => CONTENITORI.has(r) || PRESENZA.has(r))) return false;
  return rs.every((r) => PERCEZIONE.has(r) || AMBIENTE.has(r) || FUNZIONALI.has(r));
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
  return piuVicino(story, input, posseduti, SOGLIA_OGGETTO);
}

/**
 * L'oggetto dell'inventario che una frase **nomina**, qualunque cosa la frase
 * chiedesse di farci.
 *
 * Si consulta per ultima, quando ormai non ha risposto nessuno: non c'e'
 * un'azione della scena, non c'e' un verbo del player, e la sola cosa rimasta
 * sarebbe un fallback d'autore scritto per l'*intenzione* — «Le mani non
 * trovano niente» — che della cosa che il giocatore ha appena nominato non sa
 * niente. Se quella cosa e' nello zaino, la sua descrizione e' una risposta
 * molto migliore, ed e' scritta dallo stesso autore.
 *
 * E' il caso di «usa il walkie» in una scena che sul walkie non ha nessuna
 * azione: la descrizione dice che e' scarico, che e' esattamente quello che il
 * giocatore stava chiedendo. Senza, la storia risponde parlando d'altro.
 *
 * Non e' un verbo di percezione mascherato: qui non c'e' nessun filtro sul
 * verbo, e proprio per questo la soglia e' piu' alta.
 */
export function oggettoNominato(story: Story, input: string, posseduti: string[]): string | undefined {
  return piuVicino(story, input, posseduti, SOGLIA_OGGETTO_NOMINATO);
}

/** L'oggetto posseduto piu' vicino alla frase, se supera la soglia. */
function piuVicino(story: Story, input: string, posseduti: string[], soglia: number): string | undefined {
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
  return migliore >= soglia ? quale : undefined;
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

/**
 * La risposta a «cosa posso fare?»: **cosa** e' in gioco, non **come** si usa.
 *
 * E' il compromesso fra due cose vere. La prima: un player a parole in cui non
 * si trova la frase giusta e' un player in cui la storia si ferma, e chi si
 * blocca non ha nessun appiglio. La seconda: l'elenco delle azioni risolve gli
 * enigmi al posto del giocatore, e finche' resta acceso non si puo' giudicare
 * quanto una storia sia difficile davvero (decisione 1.8.0) — per questo le
 * chip stanno sotto il debug.
 *
 * Quello che esce di qui non e' mai un verbo. Sono i **bersagli**: gli oggetti
 * e le persone su cui questa scena risponde, con il nome che l'autore ha dato
 * loro. Dice dove guardare, non cosa fare — «Tommy» non e' «parla con Tommy»,
 * «la cassa» non e' «apri la cassa» ne' «sposta la cassa». L'enigma resta
 * intero, l'attrito di indovinare *su cosa* no.
 *
 * Due pezzi, e si sommano invece di escludersi:
 *
 *  - il **`look`** della scena com'e' adesso, `look_variants` comprese. E' il
 *    pezzo che porta l'indizio vero, perche' e' l'unico testo della scena che
 *    cambia con lo stato: dopo aver confrontato il codice sul palmo, il
 *    magazzino di "Metal Head" dice «il numero sul palmo e quello sul montante
 *    coincidono: e' questo». E' anche il posto dove l'autore nomina le cose
 *    della stanza — scaffali, schedario, armadietto — che nell'IR non sono
 *    oggetti e che nessun altro campo saprebbe elencare.
 *  - i **bersagli**: i `target` delle azioni **disponibili**, cioe' le cose a
 *    cui la scena reagisce adesso.
 *
 * Sommarli invece di metterli in cascata e' una correzione, non un dettaglio:
 * la prima versione si fermava al primo pezzo che trovava, e siccome «chi e'
 * in scena» viene quasi sempre prima, rispondeva «In gioco: Mark» proprio
 * dove il `look` aveva l'indizio buono. Il pezzo piu' povero copriva il piu'
 * ricco.
 *
 * Quello che non esce di qui, e non deve: **un verbo**. «Tommy» non e' «parla
 * con Tommy», «la cassa» non e' «apri la cassa» ne' «sposta la cassa». Si dice
 * dove guardare, non cosa fare — l'elenco delle azioni risolverebbe gli enigmi
 * al posto del giocatore, ed e' la ragione per cui le chip stanno sotto il
 * debug (decisione 1.8.0).
 *
 * I bersagli vengono dalle azioni e **non** da `Scene.characters`, e non e'
 * un dettaglio: la roster di scena contiene chiunque sia presente, anche chi
 * il giocatore deve ancora scoprire. Provandolo, nel magazzino di "Metal Head"
 * l'aiuto annunciava il Cane-robot mentre era ancora una sagoma nel buio. Un
 * `target` di un'azione disponibile, invece, e' per costruzione qualcosa a cui
 * si puo' gia' parlare o mettere le mani.
 *
 * Le azioni nascoste da una condizione non entrano: sarebbero un anticipo, a
 * volte uno spoiler. Il protagonista nemmeno: non e' un bersaglio, e' chi sta
 * chiedendo. E nemmeno i `target` che non si risolvono
 * in un oggetto o in un personaggio — `"ambiente"` e' la convenzione dello
 * schema per un bersaglio generico, e un id buttato in faccia al giocatore non
 * e' una risposta. Se non resta niente di niente, tace: e' il caso di una
 * scena senza `look`, che il linter segnala gia' per conto suo, ed e' l'unico
 * in cui questo verbo produce una diagnostica.
 */
export function testoAiuto(
  story: Story,
  sc: Scene,
  disponibili: Action[],
  soddisfa: (c?: Condition) => boolean,
): string | undefined {
  const dove = lookNow(sc, soddisfa);

  const nomi = nomiDei(
    story,
    disponibili.map((a) => a.target),
  );

  const chi = nomi.length > 0 ? `In gioco: ${elenca(nomi)}.` : undefined;
  if (dove && chi) return `${dove}\n\n${chi}`;
  return dove ?? chi;
}

/** Da id a nomi d'autore, in ordine e senza ripetizioni. Salta quello che non
 * si lascia nominare: il protagonista, e ogni id che non e' un oggetto ne' un
 * personaggio — `"ambiente"` compreso, che e' la convenzione dello schema per
 * un bersaglio generico e non un nome da dire al giocatore. */
function nomiDei(story: Story, ids: Array<string | undefined>): string[] {
  const visti = new Set<string>();
  const nomi: string[] = [];
  for (const id of ids) {
    if (!id || visti.has(id)) continue;
    visti.add(id);
    const item = story.items?.find((i) => i.id === id);
    if (item) {
      nomi.push(item.name);
      continue;
    }
    const pg = findCharacter(story, id);
    if (pg && pg.id !== story.protagonist) nomi.push(displayName(pg));
  }
  return nomi;
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
