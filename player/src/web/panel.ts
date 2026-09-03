/**
 * Il menu.
 *
 * Le schede si dividono in due gruppi: le prime quattro sono per chi gioca, le
 * ultime tre **compaiono solo a debug acceso**. È la stessa ragione per cui il
 * dock non stampa l'elenco delle azioni: un elenco di flag o di azioni risolve
 * gli enigmi al posto del giocatore.
 *
 * In `principale` le cose si chiamano con le parole della storia — il nome del
 * luogo, il nome dell'oggetto; gli id stanno in `stato`, che è dove si va
 * quando si sta collaudando invece di giocando.
 */

import type { Finding, Session } from '../core/index.js';
import { countBySeverity, displayName, lint } from '../core/index.js';
import { byId, clear, conferma, el, kv, premi } from './dom.js';
import type { ConfigEmbedder } from './embedder.js';
import { ASCOLTO_DEFAULT, type ImpostazioniAscolto, type Listen } from './listen.js';

/**
 * Le schede, nell'ordine in cui stanno nella striscia.
 *
 * Le prime quattro sono per chi gioca; le ultime tre ispezionano, e a debug
 * spento non compaiono nemmeno.
 */
export type Tab = 'principale' | 'disco' | 'interprete' | 'ascolto' | 'stato' | 'linter' | 'traccia';

/** Le schede che esistono solo a debug acceso. */
export const TAB_DEBUG: readonly Tab[] = ['stato', 'linter', 'traccia'];

export interface PanelHooks {
  trace: () => string;
  resume: (text: string) => void;
  restart: () => void;
  /** Guardare un oggetto che si ha in mano: chiude il menu e ne fa leggere la
   * descrizione nel trascritto, come se lo si fosse nominato giocando. */
  lookAt: (itemId: string) => void;
  version: string;
  imagesWhy: string;
  /** La modalità ascolto e il modo di regolarla a partita in corso. */
  listen: Listen;
  onAscolto: (imp: ImpostazioniAscolto) => void;
  /** Il backend dell'interprete e il modo di cambiarlo a partita in corso. */
  resolver: () => { nome: string; stato: string; config: ConfigEmbedder };
  onResolver: (nome: string) => void;
  onConfigEmbedder: (c: ConfigEmbedder) => void;
  onResetEmbedder: () => void;
}

export class Panel {
  private root = byId('panel');
  private body = byId('panel-body');
  private scrim = byId('scrim');
  private badge = byId('lint-badge');
  private tab: Tab = 'principale';
  private findings: Finding[] = [];

  constructor(
    private readonly session: Session,
    private readonly hooks: PanelHooks,
  ) {
    byId('btn-panel').addEventListener('click', () => (this.root.hidden ? this.open() : this.close()));
    byId('btn-close-panel').addEventListener('click', () => this.close());
    this.scrim.addEventListener('click', () => this.close());
    for (const b of byId('tabs').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => this.seleziona(b.dataset.tab as Tab));
    }
    byId('panel-version').textContent = `zaiplay ${hooks.version}`;
  }

  /** Il conto del linter si aggiorna a ogni caricamento: è un'informazione sul
   * file, non sulla storia. */
  refreshLint(): void {
    this.findings = lint(this.session.idx);
    const n = countBySeverity(this.findings);
    this.badge.hidden = n.errore === 0 && n.avviso === 0;
    this.badge.textContent = String(n.errore || n.avviso);
    this.badge.classList.toggle('warn', n.errore === 0);
  }

  get aperto(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.scrim.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
    this.scrim.hidden = true;
  }

  seleziona(nome: Tab): void {
    this.tab = nome;
    for (const b of byId('tabs').querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('on', b.dataset.tab === nome);
    }
    this.render();
  }

  /** Spegnendo il debug le schede di ispezione spariscono dalla striscia: se si
   * era fermi su una di quelle, restare lì vorrebbe dire guardare un pannello
   * che non ha più nessuna linguetta accesa. */
  suDebug(acceso: boolean): void {
    if (!acceso && TAB_DEBUG.includes(this.tab)) this.seleziona('principale');
    else if (this.aperto) this.render();
  }

  render(): void {
    if (!this.aperto) return;
    clear(this.body);
    switch (this.tab) {
      case 'principale':
        return this.principale();
      case 'disco':
        return this.disco();
      case 'interprete':
        return this.interprete();
      case 'ascolto':
        return this.ascolto();
      case 'stato':
        return this.stato();
      case 'linter':
        return this.linter();
      case 'traccia':
        return this.traccia();
    }
  }

  // ---------------------------------------------------------- principale

  /**
   * Dove sei e cosa hai in mano.
   *
   * È la prima perché è l'unica che serve a chi sta giocando e basta. Dice le
   * due cose che si dimenticano davvero — in che posto si è e cosa si è
   * raccolto — con le parole della storia e non con quelle del file: il nome
   * del luogo, non il suo id.
   *
   * «Ricomincia» sta qui sotto e non nel piede del menu: è l'unico comando che
   * qualcuno cerchi *mentre* legge questa scheda — si guarda dove si è arrivati
   * e cosa si ha in mano, e da lì si decide se rifare la strada.
   */
  private principale(): void {
    const s = this.session.snapshot();

    this.body.append(el('h3', undefined, 'dove sei'));
    this.body.append(el('p', undefined, s.place ? displayName(s.place) : '—'));
    if (s.look) this.body.append(el('p', 'empty', s.look));

    this.body.append(el('h3', undefined, 'cosa hai in mano'));
    this.body.append(this.inventario());

    // Un filo più marcato di quelli che dividono le sezioni: sotto c'è l'unico
    // bottone del player che possa buttare via qualcosa di irrecuperabile, e
    // non deve sembrare la continuazione dell'elenco che gli sta sopra.
    this.body.append(el('hr', 'sep-forte'));
    const ricomincia = el('button', 'btn ricomincia', 'ricomincia la partita');
    ricomincia.onclick = async () => {
      await premi(ricomincia);
      if (await chiediSeRicominciare()) {
        this.close();
        this.hooks.restart();
      }
    };
    this.body.append(ricomincia);

    // «Come si vede» compare solo quando non si può scegliere, e allora è
    // l'unica cosa che ha da dire: perché non si può. Quando la scelta c'è, sta
    // in barra come interruttore — la si prende guardando quello che cambia.
    if (this.hooks.imagesWhy) {
      this.body.append(el('h3', undefined, 'come si vede'));
      this.body.append(el('p', 'empty', this.hooks.imagesWhy));
    }
  }

  /**
   * L'inventario: i nomi degli oggetti, e ognuno si può guardare.
   *
   * Toccarne uno chiude il menu e ne fa leggere la descrizione nel trascritto —
   * la stessa che si otterrebbe nominandolo mentre si gioca. È il motivo per
   * cui questa scheda è la prima: quello che si ha in mano è l'unica cosa che
   * il giocatore non può rileggere scorrendo indietro, perché non è mai stata
   * scritta tutta insieme da nessuna parte.
   */
  private inventario(): HTMLElement {
    const inv = this.session.snapshot().inventory;
    if (!inv.length) return el('p', 'empty', 'non hai niente con te');

    const box = el('div', 'chips inventario');
    for (const it of inv) {
      if (!it) continue;
      // Un oggetto senza descrizione non è toccabile: non c'è niente da
      // leggere e il player non lo inventa. Il linter intanto lo segnala, che è
      // il posto dove quel buco va risolto.
      if (!it.description && !it.description_variants?.length) {
        box.append(el('span', 'chip', displayName(it)));
        continue;
      }
      const b = el('button', 'chip oggetto', displayName(it));
      b.type = 'button';
      b.onclick = async () => {
        await premi(b);
        this.close();
        this.hooks.lookAt(it.id);
      };
      box.append(b);
    }
    return box;
  }

  // --------------------------------------------------------------- disco

  private disco(): void {
    this.body.append(el('h3', undefined, 'portare via la partita'));
    this.body.append(
      el(
        'p',
        'empty',
        'La partita è la sequenza di quello che hai scritto: il parser può solo scegliere fra azioni già ' +
          'definite, quindi quella sequenza la descrive per intero. Si copia, si manda dove vuoi — una mail a ' +
          'te stesso, una nota, una chat — e si riprende da lì, anche su un altro device. Non passa da nessun ' +
          'server.',
      ),
    );
    const ta = el('textarea', 'trace');
    ta.rows = 8;
    ta.readOnly = true;
    ta.value = this.hooks.trace();
    this.body.append(ta);

    const btns = el('div', 'rowbtns');
    const copia = el('button', 'btn primary', 'copia');
    copia.onclick = async () => {
      // La pressione non si aspetta: scrivere negli appunti richiede che il
      // gesto sia ancora «fresco», e un timer davanti alla chiamata basta a
      // farla rifiutare.
      void premi(copia).then(() => copia.classList.remove('premuto'));
      try {
        await navigator.clipboard.writeText(ta.value);
        copia.textContent = 'copiata';
        setTimeout(() => (copia.textContent = 'copia'), 1200);
      } catch {
        ta.select();
        copia.textContent = 'selezionata: copiala a mano';
      }
    };
    btns.append(copia);
    this.body.append(btns);

    this.body.append(el('h3', undefined, 'riprendere'));
    this.body.append(
      el(
        'p',
        'empty',
        "Incolla una partita — la tua, copiata qui sopra, o quella di qualcun altro. Viene rigiocata in un " +
          "istante e poi si continua da lì.",
      ),
    );
    const inp = el('textarea', 'trace');
    inp.rows = 5;
    inp.placeholder = 'apri la porta\nprendi la torcia\n…';
    this.body.append(inp);
    const go = el('button', 'btn primary', 'riprendi');
    go.onclick = async () => {
      await premi(go);
      this.close();
      this.hooks.resume(inp.value);
    };
    this.body.append(go);
  }

  // ---------------------------------------------------------- interprete

  /**
   * Chi decide a quale azione corrisponde la frase che si è scritta.
   *
   * Ha una scheda sua e non un angolo di «stato» perché non è stato di gioco: è
   * uno **strumento di misura**, e la cosa da fare con lui è accendere i vettori
   * nel luogo in cui il lessicale ha appena detto di no, riscrivere la stessa
   * frase e vedere se cambia qualcosa. Il marchio in coda a ogni risposta nel
   * trascritto dice poi quale dei due ha deciso, turno per turno.
   *
   * Gli indirizzi stanno qui e non nel codice per una ragione molto pratica:
   * quando questo backend fallisce, fallisce sempre su uno di quei tre, e senza
   * poterli cambiare l'unica diagnosi che arriva a chi gioca è «Failed to
   * fetch».
   */
  private interprete(): void {
    const MODI: Array<[string, string, string]> = [
      ['lessicale', 'lessicale', 'Deterministico, nessun modello, nessuna rete, nessun byte scaricato.'],
      [
        'ibrido',
        'lessicale + vettori',
        'Il lessicale decide; i vettori intervengono solo dove tace, e sempre nella scelta del fallback — dove ' +
          'sbagliare non costa niente. È la modalità con cui si gioca.',
      ],
      [
        'vettori',
        'solo vettori',
        'I vettori decidono da soli. Serve a misurare cosa farebbero senza rete di protezione, non a far ' +
          'giocare qualcuno: qui un falso positivo esegue.',
      ],
    ];
    const stato = this.hooks.resolver();

    this.body.append(el('h3', undefined, 'modalità'));
    const riga = el('div', 'chips');
    for (const [nome, etichetta] of MODI) {
      const b = el('button', `chip scelta${stato.nome === nome ? ' on' : ''}`, etichetta);
      b.onclick = async () => {
        if (this.hooks.resolver().nome === nome) return;
        await premi(b);
        this.hooks.onResolver(nome);
      };
      riga.append(b);
    }
    this.body.append(riga);
    this.body.append(el('p', 'empty', MODI.find(([n]) => n === stato.nome)?.[2] ?? ''));
    if (stato.stato) this.body.append(el('p', 'stato-resolver', stato.stato));

    this.body.append(el('h3', undefined, 'da dove viene il modello'));
    this.body.append(
      el('p', 'empty', 'Serve alle due modalità con i vettori. Cambiarli e premere «attiva» rifà il tentativo.'),
    );

    const campi: Array<[keyof ConfigEmbedder, string, string]> = [
      ['libreria', 'libreria', 'URL del modulo ESM da importare'],
      ['modello', 'modello', 'identificatore del modello'],
      ['host', 'host dei modelli', 'da dove scaricare i pesi'],
    ];
    const inputs = new Map<keyof ConfigEmbedder, HTMLInputElement>();
    for (const [chiave, etichetta, aiuto] of campi) {
      const wrap = el('label', 'campo-cfg');
      wrap.append(el('span', 'gname', etichetta));
      const i = el('input');
      i.type = 'text';
      i.spellcheck = false;
      i.autocomplete = 'off';
      i.value = stato.config[chiave];
      i.title = aiuto;
      wrap.append(i, el('span', 'aiuto', aiuto));
      inputs.set(chiave, i);
      this.body.append(wrap);
    }

    const btns = el('div', 'rowbtns');
    const attiva = el('button', 'btn primary', 'attiva');
    attiva.onclick = async () => {
      await premi(attiva);
      this.hooks.onConfigEmbedder({
        libreria: inputs.get('libreria')!.value.trim(),
        modello: inputs.get('modello')!.value.trim(),
        host: inputs.get('host')!.value.trim(),
      });
    };
    const reset = el('button', 'btn', 'valori di default');
    reset.onclick = async () => {
      await premi(reset);
      this.hooks.onResetEmbedder();
    };
    btns.append(attiva, reset);
    this.body.append(btns);
  }

  // ------------------------------------------------------------- ascolto

  /**
   * La modalità ascolto.
   *
   * Ha una scheda sua per la stessa ragione dell'interprete: non è stato di
   * gioco, è un modo di giocare. Qui si decide **cosa** si sente (la storia, e
   * in più i prompt di suono e di voce) e **come** (quale voce di sistema, a
   * che velocità), che sono due domande diverse e stanno in due blocchi diversi.
   *
   * Le modifiche valgono subito, senza un bottone «applica»: si accende la voce
   * mentre la scena sta parlando e si sente se è troppo veloce. Un «applica»
   * costringerebbe a immaginare il risultato invece di sentirlo.
   */
  private ascolto(): void {
    const a = this.hooks.listen;
    const imp = a.impostazioni;
    const applica = (patch: Partial<ImpostazioniAscolto>) =>
      this.hooks.onAscolto({ ...a.impostazioni, ...patch });

    if (!a.voce.disponibile) {
      this.body.append(
        el(
          'p',
          'stato-resolver',
          'Questo browser non espone la sintesi vocale (speechSynthesis): la modalità ascolto resterebbe ' +
            'accesa e muta, quindi qui non c’è niente da regolare.',
        ),
      );
      return;
    }

    this.body.append(el('h3', undefined, 'modalità'));
    this.body.append(
      interruttore(
        'leggi la storia ad alta voce',
        'Narrazione, battute, esito dei comandi e la descrizione di ciò che si vedrebbe: i prompt delle ' +
          'immagini recitati sono l’immagine, finché l’immagine non esiste.',
        imp.attiva,
        (v) => applica({ attiva: v }),
      ),
    );

    this.body.append(el('h3', undefined, 'cosa recita'));
    this.body.append(
      interruttore(
        'anche suoni e tipi di voce',
        'Aggiunge ambient_sound_prompt, sound_effect_prompt, play_sound_prompt e i voice.style_prompt. Serve a ' +
          'collaudare la resa sonora di una storia senza guardare; giocando è una rottura del quarto muro a ' +
          'ogni battuta.',
        imp.suoniEVoci,
        (v) => applica({ suoniEVoci: v }),
      ),
    );
    this.body.append(
      interruttore(
        'avanzamento automatico',
        'Dove il passo è uno solo — l’uscita rimasta quando non c’è più niente da fare — finita la ' +
          'lettura si prosegue da soli, senza cercarla a tentoni. Il bottone resta comunque premibile per ' +
          'tagliare corto.',
        imp.avanzamento,
        (v) => applica({ avanzamento: v }),
      ),
    );

    this.body.append(
      el(
        'p',
        'empty',
        'Si recita quello che succede — narrazione, battute, esito dei comandi — non i bottoni. Chiedendo ' +
          '«guardati intorno» il posto viene ridescritto per intero: la prima visita si sente tutta la ' +
          'composizione, dalle successive solo i nomi dell’ambiente e dei personaggi, e questo è il modo ' +
          'di riaprirla.',
      ),
    );

    // Le voci sono quelle installate sul sistema, non una lista del player: su
    // un telefono sono quattro, su un desktop anche settanta. Quelle della
    // lingua della storia vengono prima, perché è l'unico ordinamento che rende
    // l'elenco usabile senza scorrerlo tutto.
    this.body.append(el('h3', undefined, 'voce'));
    const voci = a.voce.voci(a.lingua);
    const scelta = el('select', 'voce-scelta');
    const auto = el('option', undefined, 'voce di sistema');
    auto.value = '';
    scelta.append(auto);
    for (const v of voci) {
      const o = el('option', undefined, `${v.name} · ${v.lang}${v.localService ? '' : ' (rete)'}`);
      o.value = v.voiceURI;
      scelta.append(o);
    }
    scelta.value = imp.voce;
    scelta.onchange = () => applica({ voce: scelta.value });
    const wrapVoce = el('label', 'campo-cfg');
    wrapVoce.append(el('span', 'gname', 'quale voce'), scelta);
    wrapVoce.append(
      el(
        'span',
        'aiuto',
        voci.length === 0
          ? "il browser non ha ancora caricato l'elenco: riapri la scheda fra un istante"
          : `${voci.length} disponibili; quelle marcate «rete» richiedono la connessione`,
      ),
    );
    this.body.append(wrapVoce);

    this.body.append(cursore('velocità', 0.5, 2, 0.05, imp.velocita, (v) => applica({ velocita: v })));
    this.body.append(cursore('tono', 0, 2, 0.05, imp.tono, (v) => applica({ tono: v })));
    this.body.append(cursore('volume', 0, 1, 0.05, imp.volume, (v) => applica({ volume: v })));

    const btns = el('div', 'rowbtns');
    const prova = el('button', 'btn primary', 'prova');
    prova.onclick = async () => {
      await premi(prova);
      a.prova();
    };
    const reset = el('button', 'btn', 'valori di default');
    reset.onclick = async () => {
      await premi(reset);
      // L'interruttore della modalità non si tocca: è l'unica di queste voci
      // che non sia un parametro di resa, e spegnerla premendo «default»
      // sarebbe una sorpresa.
      this.hooks.onAscolto({ ...ASCOLTO_DEFAULT, attiva: a.impostazioni.attiva });
      this.render();
    };
    btns.append(prova, reset);
    this.body.append(btns);
  }

  // --------------------------------------------------------------- stato

  private stato(): void {
    const s = this.session.snapshot();

    this.body.append(el('h3', undefined, 'dove'));
    const dl = el('dl', 'kv');
    kv(dl, 'atto', s.act);
    kv(dl, 'luogo', s.place?.id ?? '—');
    kv(dl, 'fase', s.phase?.id ?? '—');
    kv(dl, 'look', s.look || '— mancante');
    kv(dl, 'tono', s.phase?.tone || `${this.session.idx.story.global_style?.default_tone ?? '—'} (default globale)`);
    kv(dl, 'in dialogo', String(s.inDialogue));
    this.body.append(dl);

    this.body.append(el('h3', undefined, 'flag attivi'));
    this.body.append(chips(s.flags, 'nessun flag impostato'));

    this.body.append(el('h3', undefined, 'inventario (id)'));
    this.body.append(chips(this.session.state.inventory, 'vuoto'));

    this.body.append(el('h3', undefined, "oggetti d'ambiente presenti"));
    this.body.append(chips(s.props.map((p) => p.id), 'nessuno'));

    this.body.append(el('h3', undefined, `uscite conosciute (${s.exits.length})`));
    if (!s.exits.length) this.body.append(el('p', 'empty', 'nessuna'));
    for (const e of s.exits) {
      const aperta = this.session.state.meets(e.condition);
      const row = el('div', 'act');
      const head = el('div', 'head');
      head.append(el('span', `mark ${aperta.ok ? 'on' : 'off'}`, aperta.ok ? '✓' : '×'));
      head.append(el('span', undefined, e.label || `→ ${e.to}`));
      row.append(head);
      if (!aperta.ok && aperta.why) row.append(el('span', 'why', aperta.why));
      row.append(el('span', 'meta', `verso: ${e.to}`));
      this.body.append(row);
    }
  }

  // -------------------------------------------------------------- linter

  private linter(): void {
    if (!this.findings.length) this.refreshLint();
    const n = countBySeverity(this.findings);
    this.body.append(el('h3', undefined, `${n.errore} errori · ${n.avviso} avvisi · ${n.info} info`));
    if (!this.findings.length) {
      this.body.append(el('p', 'empty', 'nessuna segnalazione: la storia è staticamente sana'));
      return;
    }
    for (const sev of ['errore', 'avviso', 'info'] as const) {
      for (const f of this.findings.filter((x) => x.severity === sev)) {
        const row = el('div', `finding ${sev}`);
        row.append(el('span', 'lv', sev));
        row.append(document.createTextNode(f.message));
        if (f.where) row.append(el('span', 'where', f.where));
        this.body.append(row);
      }
    }
    this.body.append(
      el(
        'p',
        'hint',
        "il linter è statico: trova le porte chiuse a chiave, non dice se la storia si gioca bene. Per quello " +
          'serve giocarla.',
      ),
    );
  }

  // ------------------------------------------------------------- traccia

  private traccia(): void {
    const trace = this.hooks.trace();
    const passi = trace ? trace.split('\n').filter((l) => l.trim()).length : 0;
    this.body.append(el('h3', undefined, `traccia (${passi} ${passi === 1 ? 'passo' : 'passi'})`));
    this.body.append(
      el(
        'p',
        'empty',
        'Poiché il parser può solo scegliere fra azioni già definite, questa sequenza descrive per intero la ' +
          'partita: rigiocarla è il test di regressione della storia.',
      ),
    );
    this.body.append(el('pre', 'trace', trace || '(vuota)'));

    const btns = el('div', 'rowbtns');
    const copy = el('button', 'btn', 'copia');
    copy.onclick = async () => {
      void premi(copy).then(() => copy.classList.remove('premuto'));
      try {
        await navigator.clipboard.writeText(trace);
        copy.textContent = 'copiata';
        setTimeout(() => (copy.textContent = 'copia'), 1200);
      } catch {
        copy.textContent = 'selezionala a mano';
      }
    };
    const restart = el('button', 'btn', 'ricomincia');
    restart.onclick = async () => {
      await premi(restart);
      if (await chiediSeRicominciare()) {
        this.close();
        this.hooks.restart();
      }
    };
    btns.append(copy, restart);
    this.body.append(btns);
  }
}

// ----------------------------------------------------------------- pezzi

function chips(values: string[], vuoto: string): HTMLElement {
  if (values.length === 0) return el('p', 'empty', vuoto);
  const box = el('div', 'chips');
  for (const v of values) box.append(el('span', 'chip', v));
  return box;
}

/**
 * Un interruttore: casella, etichetta e sotto la riga che dice cosa cambia.
 *
 * La didascalia non è decorazione. Due delle tre caselle di questa scheda
 * cambiano *cosa si sente*, non quanto forte, e la differenza fra «suoni e
 * voci» acceso e spento non si indovina dal nome.
 */
function interruttore(etichetta: string, aiuto: string, acceso: boolean, cambia: (v: boolean) => void): HTMLElement {
  const wrap = el('label', 'interruttore');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = acceso;
  box.onchange = () => cambia(box.checked);
  const testi = el('span', 'testi');
  testi.append(el('span', 'gname', etichetta), el('span', 'aiuto', aiuto));
  wrap.append(box, testi);
  return wrap;
}

/**
 * Un cursore con il suo valore letto accanto.
 *
 * Il valore si aggiorna mentre si trascina e la voce lo prende subito: si
 * regola la velocità *mentre* la storia parla, che è l'unico modo di regolarla
 * — su un numero astratto non si decide niente.
 */
function cursore(
  etichetta: string,
  min: number,
  max: number,
  passo: number,
  valore: number,
  cambia: (v: number) => void,
): HTMLElement {
  const wrap = el('label', 'cursore');
  const testa = el('span', 'gname', etichetta);
  const letto = el('span', 'valore', valore.toFixed(2));
  testa.append(letto);
  const range = el('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(passo);
  range.value = String(valore);
  range.oninput = () => {
    const v = Number(range.value);
    letto.textContent = v.toFixed(2);
    cambia(v);
  };
  wrap.append(testa, range);
  return wrap;
}

/**
 * La domanda prima di ricominciare.
 *
 * Da quando la partita si può portare via, «ricomincia» è l'unico bottone del
 * player che distrugga qualcosa che non si può riavere — e la risposta giusta a
 * un tocco per sbaglio non è «pazienza», è dire dov'è il testo da copiare
 * prima.
 */
export function chiediSeRicominciare(): Promise<boolean> {
  return conferma({
    titolo: 'Ricominciare da capo?',
    testo:
      'La partita in corso si perde e si riparte dall’inizio. Se vuoi tenerla, annulla e copiala dalla ' +
      'scheda «disco»: da lì si riprende quando vuoi, anche su un altro device.',
    ok: 'ricomincia',
  });
}
