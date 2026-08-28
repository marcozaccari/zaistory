/**
 * Il resolver dell'input testuale libero.
 *
 * L'interfaccia e' fissata dall'architettura: riceve le azioni disponibili
 * nella scena, il testo libero del giocatore e il tono della scena, e ritorna
 * l'id di un'azione *gia' esistente* oppure nessun match con una narrazione di
 * fallback in-character.
 *
 * Vincolo non negoziabile: un resolver non genera mai un effetto di sua
 * iniziativa, sceglie solo quale azione gia' definita eseguire. E' l'equivalente
 * moderno del "Non puoi farlo" dei punta-e-clicca: coerente col tono della
 * scena, ma senza alcun potere sullo stato del gioco.
 */

/**
 * Un'azione tra cui il resolver puo' scegliere.
 *
 * Solo azioni di scena: le scelte di dialogo non arrivano mai qui. Il parlato
 * si gioca a scelte esplicite come nelle avventure grafiche classiche, e
 * quando un dialogue_tree e' aperto il player mostra l'elenco e il resolver non
 * viene nemmeno interpellato.
 */
export interface Candidate {
  id: string;
  label: string;
  target?: string;
  aliases?: string[];
  /**
   * L'azione esiste in questa scena ma la sua `Condition` non e' soddisfatta.
   *
   * Le azioni bloccate vanno passate lo stesso al resolver, ed e' la differenza
   * fra un menu e una conversazione: in un menu una voce filtrata sparisce e non
   * c'e' niente da dire, a parole il giocatore la chiede comunque. Se il
   * resolver ne sceglie una, il player mostra `blocked_narration` e **non
   * applica nessun effetto**: nessun flag, nessuna transizione, nessun oggetto.
   * Il vincolo "il resolver non genera logica" resta intatto — qui non genera
   * nemmeno il testo, che e' d'autore.
   */
  blocked?: boolean;
  blocked_narration?: string;
}

export interface ResolveRequest {
  candidates: Candidate[];
  input: string;
  tone: string;
}

/** O un id di azione esistente (anche bloccata), o niente. */
export interface ResolveResult {
  /** "" = nessun match. */
  actionId: string;
  /** Narrazione in-character da mostrare quando actionId e' vuoto. */
  fallback?: string;
}

/** Il contratto comune ai tre backend previsti (menu, Claude, modello locale
 * offline). Il resto del player non cambia al variare del backend: si sceglie
 * all'avvio e basta. */
export interface Resolver {
  /** Nome mostrato all'avvio. */
  readonly name: string;
  /** Il backend sa interpretare frasi libere? Il menu risponde false. */
  readonly acceptsFreeText: boolean;
  resolve(req: ResolveRequest): Promise<ResolveResult>;
}

/**
 * Backend 1: selezione a menu numerato.
 *
 * Deterministico, zero dipendenze, nessuna rete: e' la modalita' da usare per i
 * test di regressione e l'unica su cui si possa fondare uno script di
 * playthrough rigiocabile.
 */
export class MenuResolver implements Resolver {
  readonly name = 'menu (deterministico, nessun LLM)';
  readonly acceptsFreeText = false;

  /** Accetta il numero della voce, l'id dell'azione o la sua etichetta esatta
   * (senza distinzione di maiuscole). Qualunque altra cosa non e' un match:
   * nessun tentativo di indovinare, che e' esattamente il compito degli altri
   * backend. */
  async resolve(req: ResolveRequest): Promise<ResolveResult> {
    const input = req.input.trim();
    if (input === '') return { actionId: '' };

    if (/^\d+$/.test(input)) {
      const n = Number(input);
      if (n >= 1 && n <= req.candidates.length) return { actionId: req.candidates[n - 1].id };
      return { actionId: '', fallback: "Non c'e' nessuna voce con quel numero." };
    }

    const low = input.toLowerCase();
    for (const c of req.candidates) {
      if (c.blocked) continue; // il menu non elenca le azioni bloccate, quindi non le sceglie
      if (c.id.toLowerCase() === low || c.label.toLowerCase() === low) return { actionId: c.id };
    }
    return { actionId: '', fallback: 'Scegli il numero di una delle azioni elencate (oppure :aiuto).' };
  }
}

/** I backend previsti dall'architettura ma non ancora implementati. */
export function makeResolver(name: string): Resolver {
  switch (name.toLowerCase()) {
    case '':
    case 'menu':
      return new MenuResolver();
    case 'claude':
      throw new Error(
        `il backend resolver "${name}" e' previsto dall'architettura ma non ancora implementato: per ora usa -resolver menu`,
      );
    case 'locale':
    case 'local':
    case 'slm':
      throw new Error(
        `il backend resolver "${name}" (modello locale offline) e' previsto dall'architettura ma non ancora implementato: per ora usa -resolver menu`,
      );
    default:
      throw new Error(`resolver sconosciuto "${name}" (menu, claude, locale)`);
  }
}
