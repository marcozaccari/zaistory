/**
 * Un turno giocato a parole, dall'input alla decisione.
 *
 * Sta nel core e non nelle due interfacce per la ragione di sempre: web e CLI
 * sono facce, e una regola scritta due volte diverge. Qui c'e' l'ordine con cui
 * si consulta il mondo, e quell'ordine e' una scelta di progetto, non un
 * dettaglio d'implementazione:
 *
 *   1. **il resolver**, su tutte le azioni della scena — comprese quelle che
 *      una condizione ha filtrato, perche' a parole il giocatore le chiede lo
 *      stesso;
 *   2. **i verbi del player** (guardarsi intorno, guardare nello zaino), solo
 *      se il resolver ha detto di no: un'azione scritta dall'autore vince
 *      sempre su un verbo di sistema;
 *   3. **il fallback d'autore**, scelto per intenzione.
 *
 * Cosa NON succede mai qui, ed e' il vincolo che tiene in piedi il resto: non
 * si applica nessun `Effect` che il player abbia deciso di suo, non si inventa
 * nessuna azione, non si scrive nessuna riga di prosa. Ogni testo che esce da
 * questa funzione l'ha scritto l'autore ed e' dentro l'IR. Le uniche frasi del
 * player sono le note diagnostiche, che si riconoscono perche' stanno fra
 * parentesi e parlano dell'IR invece che della storia.
 */

import type { ActionPrompt } from './engine.js';
import type { Resolver, Via } from './resolver.js';
import type { Story } from './types.js';
import type { Verbo } from './verbi.js';
import { noMatchPool } from './types.js';
import { classificaIntento } from './lexical.js';
import { scegliFallback } from './resolver.js';
import { isDomandaDiAiuto, oggettoDaEsaminare, oggettoNominato, testoAiuto, testoInventario, testoLook, testoOggetto, testoPresenti, verboDelPlayer } from './verbi.js';

export type EsitoKind = 'azione' | 'bloccata' | 'verbo' | 'niente';

export interface EsitoTurno {
  kind: EsitoKind;
  /** Solo per `azione`: l'id da passare all'engine. */
  actionId?: string;
  /** Testo d'autore da mostrare: `blocked_narration`, il `look` della scena,
   * l'inventario, o il fallback. Mai generato. */
  testo?: string;
  /** Diagnostica del player, non narrazione. Va mostrata come tale. */
  nota?: string;
  /** Chi ha deciso: si mostra sempre, anche fuori dal debug, perche' e' il
   * solo modo di accorgersi giocando di quando il backend costoso serva
   * davvero. */
  via?: Via;
  /** Perche' ha deciso cosi': punteggi, superficie vincente, soglie. */
  why?: string;
  verbo?: Verbo;
}

/**
 * Un turno a input libero, con la memoria che serve a non ripetersi.
 *
 * Il contatore dei rifiuti sta qui e non in `GameState` di proposito: lo stato
 * di gioco deve restare interamente derivabile dagli `Effect` applicati,
 * altrimenti una traccia rigiocata non ricostruisce la stessa partita. Quale
 * variante di fallback si legge non e' stato di gioco — non cambia niente di
 * cio' che si puo' fare — quindi non ha diritto di starci.
 */
export class InputLibero {
  private giro = 0;

  constructor(
    private story: Story,
    private resolver: Resolver,
  ) {}

  async risolvi(p: ActionPrompt, input: string): Promise<EsitoTurno> {
    if (input.trim() === '') return { kind: 'niente' };

    // «Cosa posso fare?» prima di tutto, ed e' l'unica eccezione all'ordine
    // dichiarato qui sopra.
    //
    // Non e' un tentativo di agire sul mondo, e' una domanda
    // sull'interfaccia — e trattarla come una frase qualunque significava
    // lasciarla somigliare agli alias di un'azione e farla partire: su "Metal
    // Head" capitava in 5 scene su 43, e in una di quelle il giocatore che
    // chiedeva aiuto sparava al tetto del furgone. Una domanda non puo'
    // applicare un `Effect`.
    if (isDomandaDiAiuto(input)) {
      const soddisfaSubito = (c?: Parameters<typeof p.state.meets>[0]) => p.state.meets(c).ok;
      const testo = testoAiuto(this.story, p.scene, p.available, soddisfaSubito);
      return {
        kind: 'verbo',
        verbo: 'aiuto',
        testo,
        nota: buco(`la scena "${p.scene.id}" non risponde a "aiuto"`, 'look', testo),
      };
    }

    // Le azioni filtrate da una condizione entrano fra le candidate: e' la
    // differenza fra un menu e una conversazione. Quelle gia' consumate pure,
    // ma senza testo d'autore — la risposta li' e' una nota, non narrazione.
    const candidate = [
      ...p.available.map((a) => ({
        id: a.id,
        label: a.label,
        target: a.target,
        aliases: a.aliases,
      })),
      ...p.hidden.map((h) => ({
        id: h.action.id,
        label: h.action.label,
        target: h.action.target,
        aliases: h.action.aliases,
        blocked: true,
      })),
    ];

    const res = await this.resolver.resolve({
      candidates: candidate,
      input,
      tone: p.scene.scene_tone ?? this.story.global_style?.default_tone ?? '',
      world: mondo(this.story),
      noMatch: noMatchPool(this.story, p.scene),
      giro: this.giro,
    });

    if (res.actionId) {
      const disponibile = p.available.find((a) => a.id === res.actionId);
      if (disponibile) return { kind: 'azione', actionId: res.actionId, via: res.via, why: res.why };

      // Azione esistente ma non eseguibile adesso. Il player mostra il testo
      // d'autore e non applica NIENTE: nessun flag, nessuna transizione,
      // nessun oggetto. L'engine non la vede nemmeno passare.
      //
      // Ma solo se e' una **condizione** a fermarla: li' `blocked_narration`
      // e' la risposta prevista, e la sua assenza e' un buco vero. Un'azione
      // gia' usata e' un'altra cosa — lo schema non ha un campo per «l'hai
      // gia' fatto» e non deve averlo — quindi li' non si accusa l'IR di
      // niente e si prosegue: risponderanno i verbi del player o il fallback
      // d'autore, che sono comunque testo scritto da qualcuno. Il motivo
      // resta in `why`, dove il collaudo lo legge.
      const nascosta = p.hidden.find((h) => h.action.id === res.actionId);
      if (nascosta?.perche !== 'gia-usata') {
        this.giro++;
        // Se l'autore la `blocked_narration` non l'ha scritta, si ripiega sul
        // fallback per intenzione. E' comunque testo suo, ed e' molto meglio
        // di niente: la nota resta, ma come diagnostica — chi gioca non deve
        // leggere un messaggio di errore al posto della storia.
        const scritto = nascosta?.action.blocked_narration;
        const ripiego =
          scritto ?? scegliFallback(noMatchPool(this.story, p.scene), classificaIntento(input), this.giro);
        return {
          kind: 'bloccata',
          actionId: res.actionId,
          testo: ripiego,
          nota: buco(`l'azione "${res.actionId}" non e' disponibile ora`, 'blocked_narration', scritto),
          via: res.via,
          why: res.why,
        };
      }
      // Il resolver aveva trovato un'azione, quindi non aveva scelto nessun
      // fallback: da qui in poi si prosegue come se quella frase non avesse
      // fatto match, e il fallback va scelto adesso.
      res.why = `${res.why ? res.why + ' · ' : ''}azione "${res.actionId}" gia' usata`;
      res.intent = res.intent ?? classificaIntento(input);
      res.fallback = res.fallback ?? scegliFallback(noMatchPool(this.story, p.scene), res.intent, this.giro);
      res.actionId = '';
    }

    // Nessuna azione. Ora, e solo ora, i verbi del player.
    const soddisfa = (c?: Parameters<typeof p.state.meets>[0]) => p.state.meets(c).ok;

    // Guardare una cosa che si ha in mano. Prima degli altri verbi perche' e'
    // il piu' specifico: nomina un oggetto preciso, mentre gli altri parlano
    // della stanza o dell'elenco.
    const oggetto = oggettoDaEsaminare(this.story, input, p.state.inventory);
    if (oggetto) {
      const testo = testoOggetto(this.story, oggetto, soddisfa);
      return {
        kind: 'verbo',
        verbo: 'esamina',
        testo,
        nota: buco(`l'oggetto "${oggetto}" non si lascia guardare`, 'items[].description', testo),
        via: res.via,
        why: res.why,
      };
    }

    const verbo = verboDelPlayer(input);
    if (verbo !== 'nessuno') {
      const giro = p.state.history.length;
      const testo =
        verbo === 'look'
          ? testoLook(p.scene, soddisfa)
          : verbo === 'inventario'
            ? testoInventario(this.story, p.state.inventory, giro)
            : verbo === 'aiuto'
              ? testoAiuto(this.story, p.scene, p.available, soddisfa)
              : testoPresenti(this.story, p.scene, giro);
      // L'aiuto ripiega sul `look`, quindi quando tace e' perche' manca
      // quello — non i `target`, che lo schema lascia opzionali e che un IR
      // conforme puo' legittimamente non avere.
      const campo = verbo === 'look' || verbo === 'aiuto' ? 'look' : 'player_voice';
      return {
        kind: 'verbo',
        verbo,
        testo,
        nota: buco(`la scena "${p.scene.id}" non risponde a "${verbo}"`, campo, testo),
        via: res.via,
        why: res.why,
      };
    }

    // Ultima spiaggia prima del fallback: la frase nomina una cosa che si ha
    // in mano? Il fallback d'autore e' scritto per l'*intenzione* e della cosa
    // appena nominata non sa niente — «usa il walkie» si sentirebbe rispondere
    // «Le mani non trovano niente», mentre la descrizione del walkie dice che
    // e' scarico, cioe' proprio quello che si stava chiedendo. Fra due testi
    // d'autore vince quello che parla della cosa giusta.
    const nominato = oggettoNominato(this.story, input, p.state.inventory);
    if (nominato) {
      const testo = testoOggetto(this.story, nominato, soddisfa);
      if (testo) {
        return { kind: 'verbo', verbo: 'esamina', testo, via: res.via, why: res.why };
      }
    }

    this.giro++;
    return {
      kind: 'niente',
      testo: res.fallback,
      nota: buco(`nessuna azione per questa frase`, `no_match_narration [${res.intent ?? 'generico'}]`, res.fallback),
      via: res.via,
      why: res.why,
    };
  }
}

/**
 * La sola forma di nota che il player produce: un buco nell'IR, detto come
 * tale.
 *
 * Esiste un unico caso in cui il player parla con voce propria, ed e' questo:
 * l'autore non ha scritto il testo che servirebbe qui. Non lo si tappa con una
 * frase di comodo — un buco deve vedersi come un buco, ed e' anche quello che
 * il linter segnala come errore prima ancora di giocare. Una forma sola per
 * tutti i casi perche' e' sempre la stessa informazione: cosa manca, e dove.
 */
function buco(cosa: string, campo: string, testo?: string): string | undefined {
  return testo ? undefined : `(${cosa}: manca ${campo} nell'IR)`;
}

/**
 * Chi ha deciso questo turno, in una parola.
 *
 * Si mostra sempre, non solo in debug, ed e' una scelta deliberata: il backend
 * a embedding esiste per essere valutato, e un confronto fatto solo su un
 * rapporto di copertura non dice cosa si prova a giocarci. Vedere ⟨lessicale⟩
 * per venti turni di fila e poi ⟨embedding⟩ su una frase che il lessicale non
 * avrebbe preso e' l'informazione che il numero non da'.
 */
export function segnoTurno(e: EsitoTurno): string {
  if (e.kind === 'verbo') return 'verbo del player';
  return e.via ?? '';
}

/** Le anagrafiche a cui le azioni puntano col loro `target`. */
function mondo(story: Story) {
  return [
    ...(story.items ?? []).map((i) => ({ id: i.id, name: i.name, aliases: i.aliases })),
    ...(story.characters ?? []).map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })),
  ];
}
