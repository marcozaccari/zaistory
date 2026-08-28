/**
 * Il pannello di debug: quello che nel player CLI sono i comandi `:stato`,
 * `:scena`, `:azioni`, `:traccia` e il linter.
 *
 * Mostra lo stato di gioco (piccolo e interamente derivabile dagli Effect
 * applicati) e **tutte** le azioni della scena, comprese quelle filtrate, con
 * accanto il motivo per cui non compaiono.
 */

import {
  type Finding,
  type Salvataggio,
  type Scene,
  type Story,
  SalvataggioError,
  contenuto,
  countFindings,
  describeCondition,
  describeEffect,
  findCharacter,
  isRepeatable,
  leggiSalvataggio,
  nodeIds,
  sceneType,
  toneOf,
} from '../core/index.js';
import { clear, conferma, el, kv, premi } from './dom.js';
import type { ConfigEmbedder } from './embedder.js';
import { ASCOLTO_DEFAULT, type Ascolto, type ImpostazioniAscolto } from './ascolto.js';
import type { WebUI } from './webui.js';

/**
 * Le schede, nell'ordine in cui stanno nella striscia.
 *
 * Le prime quattro sono per chi gioca; le ultime tre ispezionano, e a debug
 * spento non compaiono nemmeno — un elenco di azioni o di flag risolve gli
 * enigmi al posto del giocatore, che e' la stessa ragione per cui le chip del
 * dock stanno sotto il debug.
 */
export type Tab = 'principale' | 'disco' | 'interprete' | 'ascolto' | 'stato' | 'linter' | 'traccia';

/** Le schede che esistono solo a debug acceso. */
export const TAB_DEBUG: readonly Tab[] = ['stato', 'linter', 'traccia'];

export interface PanelContext {
  story: Story;
  findings: Finding[];
  ui: WebUI;
  trace: () => string[];
  onRestart: () => void;
  onReplay: (script: string) => void;
  onLoadOther: () => void;
  /** Il debug e' acceso: qui serve solo alle diagnostiche in mezzo al testo —
   * quali schede si vedono lo decide il CSS, come per il resto della
   * diagnostica. */
  debug: boolean;
  /** Il codice da copiare: partita corrente piu' impostazioni correnti. */
  codiceSalvataggio: () => string;
  /** Carica quello che e' stato incollato, ma solo i pezzi scelti. */
  onCarica: (s: Salvataggio, cosa: { partita: boolean; config: boolean }) => void;
  /** Il backend attivo e il modo di cambiarlo a partita in corso. */
  resolver: string;
  statoResolver: string;
  configEmbedder: ConfigEmbedder;
  onResolver: (nome: string) => void;
  onConfigEmbedder: (c: ConfigEmbedder) => void;
  onResetEmbedder: () => void;
  /** La modalita' ascolto e il modo di regolarla a partita in corso. */
  ascolto: Ascolto;
  onAscolto: (imp: ImpostazioniAscolto) => void;
}

export function renderPanel(body: HTMLElement, tab: Tab, ctx: PanelContext): void {
  clear(body);
  switch (tab) {
    case 'principale':
      renderPrincipale(body, ctx);
      break;
    case 'disco':
      renderDisco(body, ctx);
      break;
    case 'interprete':
      renderInterprete(body, ctx);
      break;
    case 'ascolto':
      renderAscolto(body, ctx);
      break;
    case 'stato':
      renderStato(body, ctx);
      break;
    case 'linter':
      renderLinter(body, ctx);
      break;
    case 'traccia':
      renderTraccia(body, ctx);
      break;
  }
}

function chips(values: string[], vuoto: string): HTMLElement {
  if (values.length === 0) return el('p', 'empty', vuoto);
  const box = el('div', 'chips');
  for (const v of values) box.append(el('span', 'chip', v));
  return box;
}

/**
 * La scheda dell'interprete: chi decide a quale azione corrisponde la frase
 * che si e' scritta.
 *
 * Ha una scheda sua e non un angolo di "stato" perche' non e' stato di gioco:
 * e' uno **strumento di misura**, e la cosa da fare con lui e' accendere
 * l'embedder nella scena in cui il lessicale ha appena detto di no, riscrivere
 * la stessa frase e vedere se cambia qualcosa. Il marchio in coda a ogni
 * risposta nel transcript dice poi quale dei due ha deciso, turno per turno.
 *
 * Gli indirizzi stanno qui e non nel codice per una ragione molto pratica:
 * quando questo backend fallisce, fallisce sempre su uno di quei tre, e senza
 * poterli cambiare l'unica diagnosi che arriva all'utente e' "Failed to fetch".
 */
function renderInterprete(body: HTMLElement, ctx: PanelContext): void {
  const MODI: Array<[string, string, string]> = [
    ['lessicale', 'lessicale', 'Deterministico, nessun modello, nessuna rete, nessun byte scaricato.'],
    [
      'ibrido',
      'lessicale + embedding',
      "Il lessicale decide; i vettori intervengono solo dove tace, e sempre nella scelta del fallback — dove sbagliare non costa niente. E' la modalita' con cui si gioca.",
    ],
    [
      'embedding',
      'solo embedding',
      "I vettori decidono da soli. Serve a misurare cosa farebbero senza rete di protezione, non a far giocare qualcuno: qui un falso positivo esegue.",
    ],
  ];

  body.append(el('h3', undefined, 'modalita'));
  const riga = el('div', 'chips');
  for (const [nome, etichetta] of MODI) {
    const b = el('button', `chip scelta${ctx.resolver === nome ? ' on' : ''}`, etichetta);
    b.onclick = async () => {
      if (ctx.resolver === nome) return;
      await premi(b);
      ctx.onResolver(nome);
    };
    riga.append(b);
  }
  body.append(riga);
  body.append(el('p', 'empty', MODI.find(([n]) => n === ctx.resolver)?.[2] ?? ''));

  if (ctx.statoResolver) {
    body.append(el('p', 'stato-resolver', ctx.statoResolver));
  }

  body.append(el('h3', undefined, 'da dove viene il modello'));
  body.append(
    el('p', 'empty', "Serve alle due modalita' con i vettori. Cambiarli e premere «attiva» rifa il tentativo."),
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
    i.value = ctx.configEmbedder[chiave];
    i.title = aiuto;
    wrap.append(i, el('span', 'aiuto', aiuto));
    inputs.set(chiave, i);
    body.append(wrap);
  }

  const btns = el('div', 'rowbtns');
  const attiva = el('button', 'btn primary', 'attiva');
  attiva.onclick = async () => {
    await premi(attiva);
    ctx.onConfigEmbedder({
      libreria: inputs.get('libreria')!.value.trim(),
      modello: inputs.get('modello')!.value.trim(),
      host: inputs.get('host')!.value.trim(),
    });
  };
  const reset = el('button', 'btn', 'valori di default');
  reset.onclick = async () => {
    await premi(reset);
    ctx.onResetEmbedder();
  };
  btns.append(attiva, reset);
  body.append(btns);
}

/**
 * La scheda principale: dove sei e cosa hai in mano.
 *
 * E' la prima perche' e' l'unica che serve a chi sta giocando e basta. Dice le
 * due cose che si dimenticano davvero — in che scena si e' e cosa si e'
 * raccolto — con le parole della storia e non con quelle dell'IR: il titolo
 * della scena, non il suo id; il nome dell'oggetto, non la chiave
 * dell'inventario. Gli id restano nella scheda «stato», che e' dove si va
 * quando si sta collaudando invece di giocare.
 *
 * «Ricomincia» non sta qui ma nel piede del menu, accanto al debug: non e' una
 * cosa che si guarda, e' un comando, e vale per tutta la partita e non per la
 * scheda che si sta leggendo.
 */
function renderPrincipale(body: HTMLElement, ctx: PanelContext): void {
  const sc = ctx.ui.scene;

  body.append(el('h3', undefined, 'dove sei'));
  if (sc) body.append(el('p', undefined, sc.title || sc.id));
  else body.append(el('p', 'empty', "La partita non e' ancora cominciata."));

  body.append(el('h3', undefined, 'inventario'));
  body.append(chips(nomiInventario(ctx), 'non hai niente con te'));
}

/**
 * I nomi degli oggetti, non le loro chiavi.
 *
 * Un oggetto senza scheda in `items` non ha un nome da mostrare: resta l'id, e
 * che manchi la scheda si dice solo a debug acceso — e' una diagnostica
 * sull'IR, e chi gioca non c'entra niente.
 */
function nomiInventario(ctx: PanelContext): string[] {
  return (ctx.ui.state?.inventory ?? []).map((id) => {
    const nome = ctx.story.items?.find((i) => i.id === id)?.name;
    if (nome) return nome;
    return ctx.debug ? `${id} [senza scheda]` : id;
  });
}

/**
 * La domanda prima di ricominciare.
 *
 * Da quando la partita si puo' portare via, «ricomincia» e' l'unico bottone
 * del player che distrugga qualcosa che non si puo' riavere — e la risposta
 * giusta a un tocco per sbaglio non e' «pazienza», e' dire dov'e' il codice da
 * copiare prima.
 */
export function chiediSeRicominciare(): Promise<boolean> {
  return conferma({
    titolo: 'Ricominciare da capo?',
    testo:
      "La partita in corso si perde e si riparte dalla prima scena. Se vuoi tenerla, annulla e copia " +
      "il codice dalla scheda «disco»: da li' si riprende quando vuoi, anche su un altro device.",
    ok: 'ricomincia',
  });
}

/**
 * La scheda «stato»: la partita vista come dato, piu' la scena vista come IR.
 *
 * Le due cose stanno insieme perche' si guardano insieme: un'azione che non
 * compare si spiega quasi sempre con un flag che manca, e tenerle in due
 * schede diverse voleva dire saltare avanti e indietro con la domanda in
 * mente.
 */
function renderStato(body: HTMLElement, ctx: PanelContext): void {
  const st = ctx.ui.state;
  if (!st) {
    body.append(el('p', 'empty', 'La partita non e\' ancora cominciata.'));
    return;
  }
  body.append(el('h3', undefined, 'scena corrente'));
  body.append(el('p', undefined, st.scene || '—'));

  body.append(el('h3', undefined, 'flag attivi'));
  body.append(chips(st.sortedFlags(), 'nessun flag impostato'));

  body.append(el('h3', undefined, 'scene visitate'));
  body.append(el('p', undefined, st.history.length ? st.history.join(' → ') : '—'));

  renderScena(body, ctx);
}

function renderScena(body: HTMLElement, ctx: PanelContext): void {
  const sc = ctx.ui.scene;
  if (!sc) {
    body.append(el('p', 'empty', 'Nessuna scena in corso.'));
    return;
  }

  body.append(el('h3', undefined, 'parametri'));
  const dl = el('dl', 'kv');
  kv(dl, 'id', sc.id);
  if (sc.title) kv(dl, 'title', sc.title);
  kv(dl, 'scene_type', sceneType(sc));
  // `look` non e' un'azione e non compare nel dock di proposito: nel player
  // definitivo e' una domanda che si fa a parole. Qui si legge perche' senza
  // non si potrebbe collaudare (ne' accorgersi che manca).
  kv(dl, 'look', sc.look || '— mancante');
  // Le varianti e i fallback non si vedono giocando finche' non capita lo
  // stato o la frase che li fa uscire: qui si controlla che ci siano.
  for (const v of sc.look_variants ?? []) {
    kv(dl, `look_variants [${describeCondition(v.condition)}]`, v.text);
  }
  for (const n of sc.no_match_narration ?? []) {
    kv(dl, `no_match_narration [${n.intent}]`, n.text);
  }
  if (!sc.no_match_narration?.length) {
    kv(dl, 'no_match_narration', '— nessuno: valgono solo i fallback globali');
  }
  kv(dl, 'scene_tone', sc.scene_tone || `${toneOf(ctx.story, sc)} (default globale)`);
  if (sc.background) {
    kv(dl, 'background.image_prompt', sc.background.image_prompt);
    if (sc.background.ambient_sound_prompt) kv(dl, 'background.ambient_sound_prompt', sc.background.ambient_sound_prompt);
  } else {
    kv(dl, 'background', '— mancante');
  }
  if (sc.on_enter_flags_set?.length) kv(dl, 'on_enter_flags_set', sc.on_enter_flags_set.join(', '));
  kv(dl, 'narration', `${(sc.narration ?? []).length} beat`);
  if (sc.dialogue_tree) kv(dl, 'dialogue_tree', `start=${sc.dialogue_tree.start} · nodi: ${nodeIds(sc).join(', ')}`);
  if (sc.characters?.length) {
    kv(
      dl,
      'characters',
      sc.characters
        .map((c) => {
          const g = findCharacter(ctx.story, c.id);
          return g?.name ? `${g.name} (${c.id})` : `${c.id} [non nella roster globale]`;
        })
        .join(', '),
    );
  }
  body.append(dl);

  body.append(el('h3', undefined, `azioni della scena (${sc.actions.length})`));
  if (sc.actions.length === 0) {
    body.append(el('p', 'empty', "nessuna azione: e' un finale, oppure un vicolo cieco"));
  }
  for (const a of sc.actions) {
    body.append(actionRow(sc, a, ctx));
  }
}

function actionRow(sc: Scene, a: Scene['actions'][number], ctx: PanelContext): HTMLElement {
  const st = ctx.ui.state;
  let ok = true;
  let why = '';
  if (st) {
    if (!isRepeatable(a) && st.consumed(sc.id, a.id)) {
      ok = false;
      why = "gia' usata (repeatable: false)";
    } else {
      const m = st.meets(a.condition);
      ok = m.ok;
      why = m.why;
    }
  }

  const row = el('div', 'act');
  const head = el('div', 'head');
  head.append(el('span', `mark ${ok ? 'on' : 'off'}`, ok ? '✓' : '×'));
  head.append(el('span', undefined, a.label || '(senza label)'));
  row.append(head);
  if (!ok && why) row.append(el('span', 'why', why));
  row.append(el('span', 'meta', `id: ${a.id} · condizione: ${describeCondition(a.condition)} · effetto: ${describeEffect(a.effect)}`));
  return row;
}

function renderLinter(body: HTMLElement, { findings }: PanelContext): void {
  const { errors, warnings, infos } = countFindings(findings);
  body.append(el('h3', undefined, `${errors} errori · ${warnings} avvisi · ${infos} info`));
  if (findings.length === 0) {
    body.append(el('p', 'empty', "nessuna segnalazione: la storia e' staticamente sana"));
    return;
  }
  const order: Finding['level'][] = ['errore', 'avviso', 'info'];
  for (const level of order) {
    for (const f of findings.filter((x) => x.level === level)) {
      const row = el('div', `finding ${f.level}`);
      row.append(el('span', 'lv', f.level));
      row.append(document.createTextNode(f.msg));
      if (f.where) row.append(el('span', 'where', f.where));
      body.append(row);
    }
  }
  body.append(
    el('p', 'hint', "il linter e' statico: trova le porte chiuse a chiave, non dice se la storia si gioca bene. Per quello serve giocarla."),
  );
}

function renderTraccia(body: HTMLElement, ctx: PanelContext): void {
  const trace = ctx.trace();
  body.append(el('h3', undefined, `traccia (${trace.length} passi)`));
  body.append(
    el(
      'p',
      'empty',
      "Poiche' il resolver puo' solo scegliere tra azioni gia' definite, questa sequenza descrive per intero la partita: rigiocarla e' il test di regressione della storia.",
    ),
  );
  body.append(el('pre', 'trace', trace.length ? trace.join('\n') : '(vuota)'));

  const btns = el('div', 'rowbtns');
  const copy = el('button', 'btn', 'copia');
  copy.onclick = async () => {
    // Qui la pressione non si aspetta: scrivere negli appunti richiede che il
    // gesto dell'utente sia ancora "fresco", e mettere un timer davanti alla
    // chiamata basta a farla rifiutare. Il bottone resta al suo posto, quindi
    // il tocco si vede lo stesso.
    void premi(copy).then(() => copy.classList.remove('premuto'));
    try {
      await navigator.clipboard.writeText(trace.join('\n'));
      copy.textContent = 'copiata';
      setTimeout(() => (copy.textContent = 'copia'), 1200);
    } catch {
      copy.textContent = 'selezionala a mano';
    }
  };
  // Questi tre invece rifanno il pannello sotto le proprie dita: senza la
  // trattenuta il tocco non si vedrebbe affatto, come per le chip del dock.
  const restart = el('button', 'btn', 'ricomincia');
  restart.onclick = async () => {
    await premi(restart);
    if (await chiediSeRicominciare()) ctx.onRestart();
  };
  const other = el('button', 'btn', 'cambia IR');
  other.onclick = async () => {
    await premi(other);
    ctx.onLoadOther();
  };
  btns.append(copy, restart, other);
  body.append(btns);

  body.append(el('h3', undefined, 'riprendi una partita'));
  body.append(
    el(
      'p',
      'empty',
      "Incolla una traccia — la tua, copiata qui sopra, o quella di qualcun altro. Viene rigiocata in un istante e poi il gioco continua da li': e' cosi' che si riprende una partita. La traccia intanto ricomincia a crescere, quindi si puo' ricopiare e risalvare quando si vuole.",
    ),
  );
  const ta = el('textarea');
  ta.rows = 6;
  ta.placeholder = 'a:continua\na:parla_oste\nc:d_chiave\n…';
  ta.style.width = '100%';
  ta.className = 'trace';
  body.append(ta);
  const go = el('button', 'btn primary', 'rigioca');
  go.style.marginTop = '8px';
  go.onclick = async () => {
    await premi(go);
    ctx.onReplay(ta.value);
  };
  body.append(go);
}

/**
 * Un interruttore: casella, etichetta e sotto la riga che dice cosa cambia.
 *
 * La didascalia non e' decorazione. Tre delle quattro caselle di questa scheda
 * cambiano *cosa si sente*, non quanto forte, e la differenza fra «suoni e
 * voci» acceso e spento non si indovina dal nome.
 */
function interruttore(
  etichetta: string,
  aiuto: string,
  acceso: boolean,
  cambia: (v: boolean) => void,
): HTMLElement {
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
 * regola la velocita' *mentre* la storia parla, che e' l'unico modo di
 * regolarla — su un numero astratto non si decide niente.
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
 * La scheda della modalita' ascolto.
 *
 * Ha una scheda sua per la stessa ragione del resolver: non e' stato di gioco,
 * e' un modo di giocare. Qui si decide **cosa** si sente (la storia, e in piu'
 * i prompt di suono e di voce) e **come** (quale voce di sistema, a che
 * velocita'), che sono due domande diverse e stanno in due blocchi diversi.
 *
 * Le modifiche valgono subito, senza un bottone «applica»: si accende la voce
 * mentre la scena sta parlando e si sente se e' troppo veloce. Un «applica»
 * costringerebbe a immaginare il risultato invece di sentirlo.
 */
function renderAscolto(body: HTMLElement, ctx: PanelContext): void {
  const a = ctx.ascolto;
  const imp = a.impostazioni;
  const applica = (patch: Partial<ImpostazioniAscolto>) => ctx.onAscolto({ ...a.impostazioni, ...patch });

  if (!a.voce.disponibile) {
    body.append(
      el(
        'p',
        'stato-resolver',
        "Questo browser non espone la sintesi vocale (speechSynthesis): la modalita' ascolto resterebbe accesa e muta, quindi qui non c'e' niente da regolare.",
      ),
    );
    return;
  }

  body.append(el('h3', undefined, 'modalita'));
  body.append(
    interruttore(
      'leggi la storia ad alta voce',
      "Narrazione, battute, esito dei comandi e la descrizione di cio' che si vedrebbe: i prompt delle immagini recitati sono l'immagine, finche' l'immagine non esiste.",
      imp.attiva,
      (v) => applica({ attiva: v }),
    ),
  );

  body.append(el('h3', undefined, 'cosa recita'));
  body.append(
    interruttore(
      'anche suoni e tipi di voce',
      "Aggiunge ambient_sound_prompt, sound_effect_prompt, play_sound_prompt e i VoiceSpec.style_prompt. Serve a collaudare la resa sonora di un IR senza guardare; giocando e' una rottura del quarto muro a ogni battuta.",
      imp.suoniEVoci,
      (v) => applica({ suoniEVoci: v }),
    ),
  );
  body.append(
    interruttore(
      'avanzamento automatico',
      "Finita la lettura si prosegue da soli, senza cercare «continua» a tentoni. Il bottone resta comunque premibile per tagliare corto.",
      imp.avanzamento,
      (v) => applica({ avanzamento: v }),
    ),
  );

  body.append(
    el(
      'p',
      'empty',
      "Si recita quello che succede — narrazione, battute, esito dei comandi — non i bottoni. Chiedendo «guardati intorno» la scena viene ridescritta per intero: la prima visita si sente tutta la composizione, dalle successive solo i nomi dell'ambiente e dei personaggi, e questo e' il modo di riaprirla.",
    ),
  );

  // --- come suona.
  //
  // Le voci sono quelle installate sul sistema, non una lista del player: su
  // un telefono sono quattro, su un desktop anche settanta. Quelle della
  // lingua dell'IR vengono prima, perche' e' l'unico ordinamento che rende
  // l'elenco usabile senza scorrerlo tutto.
  body.append(el('h3', undefined, 'voce'));

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
  if (voci.length === 0) {
    wrapVoce.append(
      el('span', 'aiuto', "il browser non ha ancora caricato l'elenco: riapri la scheda fra un istante"),
    );
  } else {
    wrapVoce.append(
      el('span', 'aiuto', `${voci.length} disponibili; quelle marcate «rete» richiedono la connessione`),
    );
  }
  body.append(wrapVoce);

  body.append(cursore('velocita', 0.5, 2, 0.05, imp.velocita, (v) => applica({ velocita: v })));
  body.append(cursore('tono', 0, 2, 0.05, imp.tono, (v) => applica({ tono: v })));
  body.append(cursore('volume', 0, 1, 0.05, imp.volume, (v) => applica({ volume: v })));

  const btns = el('div', 'rowbtns');
  const prova = el('button', 'btn primary', 'prova');
  prova.onclick = async () => {
    await premi(prova);
    a.prova();
  };
  const reset = el('button', 'btn', 'valori di default');
  reset.onclick = async () => {
    await premi(reset);
    // L'interruttore della modalita' non si tocca: e' l'unica di queste voci
    // che non e' un parametro di resa, e spegnerla premendo «default» sarebbe
    // una sorpresa.
    ctx.onAscolto({ ...ASCOLTO_DEFAULT, attiva: a.impostazioni.attiva });
    renderAscolto(clearBody(body), ctx);
  };
  btns.append(prova, reset);
  body.append(btns);
}

/** Svuota e restituisce lo stesso nodo: serve al solo caso in cui la scheda
 * debba ridisegnarsi da sola, cioe' quando e' lei a cambiare i valori che
 * mostra. */
function clearBody(body: HTMLElement): HTMLElement {
  clear(body);
  return body;
}

/**
 * La scheda «disco»: portare una partita su un altro device senza nessun
 * server.
 *
 * Il codice non contiene niente che il player non avesse gia': la traccia — che
 * *e'* la partita, perche' il resolver puo' solo scegliere fra azioni gia'
 * definite — e le impostazioni, che vivono fuori dalla partita da sempre. Sono
 * pero' due cose con due vite diverse, ed e' per questo che al momento di
 * caricare si sceglie: chi porta la partita sul telefono di solito vuole anche
 * la sua voce, ma chi ricomincia da capo sul desktop vuole solo quella.
 *
 * La scheda resta separata da «traccia» apposta. La traccia in chiaro e' uno
 * strumento di collaudo: si legge, si mette in un file, si rigioca in CI. Il
 * codice qui e' un salvataggio: opaco, breve, buono da mandare in chat. Fondere
 * le due cose avrebbe reso peggiore l'una e l'altra — anche se il campo qui
 * sotto accetta lo stesso una traccia nuda, perche' rifiutarla sarebbe stato
 * solo pedanteria.
 */
function renderDisco(body: HTMLElement, ctx: PanelContext): void {
  const codice = ctx.codiceSalvataggio();
  const passi = ctx.trace().length;

  body.append(el('h3', undefined, 'salva'));
  body.append(
    el(
      'p',
      'empty',
      "Un codice solo, e dentro ci sono due cose separate: la partita fin qui e le impostazioni del player. " +
        "Copialo e mandatelo dove vuoi — una mail a te stesso, una nota, una chat — poi incollalo sull'altro " +
        "device. Non passa da nessun server: sta tutto in quella riga.",
    ),
  );
  body.append(el('p', 'empty', `${ctx.story.title} · ${quantiPassi(passi)} · ${codice.length} caratteri`));

  const pre = el('pre', 'trace codice', codice);
  body.append(pre);

  const btns = el('div', 'rowbtns');
  const copy = el('button', 'btn primary', 'copia il codice');
  copy.onclick = async () => {
    // Come per la traccia: la pressione non si aspetta, perche' un timer messo
    // davanti alla scrittura negli appunti basta a far scadere il gesto e a
    // farla rifiutare.
    void premi(copy).then(() => copy.classList.remove('premuto'));
    try {
      await navigator.clipboard.writeText(codice);
      copy.textContent = 'copiato';
      setTimeout(() => (copy.textContent = 'copia il codice'), 1200);
    } catch {
      // Gli appunti si possono negare — capita da `file://` su qualche browser.
      // Il codice pero' e' li' sopra per intero: lo si seleziona e si dice che
      // ora tocca a Ctrl-C, invece di lasciare un bottone che non fa niente.
      seleziona(pre);
      copy.textContent = 'selezionato: copialo a mano';
    }
  };
  btns.append(copy);
  body.append(btns);

  // ------------------------------------------------------------------ carica

  body.append(el('h3', undefined, 'carica'));
  body.append(
    el(
      'p',
      'empty',
      'Incolla un codice: prima si vede che cosa contiene, poi si sceglie che cosa prenderne. ' +
        'Va bene anche una traccia in chiaro, come quelle della scheda «traccia».',
    ),
  );

  const ta = el('textarea', 'trace');
  ta.rows = 4;
  ta.style.width = '100%';
  ta.placeholder = 'ZAI1.…';
  body.append(ta);

  const esito = el('div', 'esito');
  const azioni = el('div', 'rowbtns');

  const esamina = el('button', 'btn primary', 'esamina');
  esamina.onclick = async () => {
    await premi(esamina);
    mostraEsito(esito, ta.value, ctx);
  };

  // `readText` non c'e' su tutti i browser (Firefox non lo espone alle pagine):
  // dove manca il bottone non compare affatto, e resta l'incolla a mano nel
  // campo, che funziona sempre.
  if (navigator.clipboard?.readText) {
    const leggi = el('button', 'btn', 'leggi dagli appunti');
    leggi.onclick = async () => {
      void premi(leggi).then(() => leggi.classList.remove('premuto'));
      try {
        ta.value = await navigator.clipboard.readText();
        mostraEsito(esito, ta.value, ctx);
      } catch {
        clear(esito);
        esito.append(
          el('p', 'stato-resolver', 'Il browser non mi lascia leggere gli appunti: incolla il codice nel campo qui sopra.'),
        );
      }
    };
    azioni.append(leggi);
  }

  azioni.append(esamina);
  body.append(azioni, esito);
}

/**
 * Che cosa c'e' nel codice incollato, e che cosa se ne puo' prendere.
 *
 * Il controllo che conta e' quello sulla storia. Una traccia rigiocata nella
 * storia sbagliata non da' un errore: gli id semplicemente non corrispondono a
 * niente e ne esce una partita sbagliata in silenzio — che e' il modo peggiore
 * di sbagliare. Quindi partita di un'altra storia: bloccata. Stessa storia ma
 * IR diverso: solo un avviso, perche' li' il caso e' un altro — la traccia puo'
 * finire prima del previsto, e una traccia che finisce e' gia' gestita: la
 * partita torna in mano a chi gioca.
 */
function mostraEsito(esito: HTMLElement, testo: string, ctx: PanelContext): void {
  clear(esito);

  let salv: Salvataggio;
  try {
    salv = leggiSalvataggio(testo);
  } catch (err) {
    esito.append(
      el(
        'p',
        'stato-resolver',
        err instanceof SalvataggioError ? err.message : `Non riesco a leggerlo: ${(err as Error).message}`,
      ),
    );
    return;
  }

  const c = contenuto(salv);
  const p = salv.partita;

  const dl = el('dl', 'kv');
  kv(
    dl,
    'partita',
    p
      ? `${p.title ? `«${p.title}»` : 'senza titolo'} · ${quantiPassi(c.passi)}${p.ir_version ? ` · IR ${p.ir_version}` : ''}`
      : '— non ce n\'e\' una',
  );
  kv(dl, 'impostazioni', c.config ? 'voce, backend del resolver, debug' : '— non ci sono');
  if (salv.salvato) kv(dl, 'salvato', quando(salv.salvato));
  esito.append(dl);

  let partitaOk = !!p;
  if (p) {
    if (p.story_id && p.story_id !== ctx.story.id) {
      partitaOk = false;
      esito.append(
        el(
          'p',
          'stato-resolver',
          `Questa partita e' di un'altra storia (${p.title || p.story_id}), e qui si sta giocando «${ctx.story.title}». ` +
            "Rigiocarla non darebbe un errore, darebbe una partita sbagliata senza dirlo: carica prima l'IR giusto. " +
            'Le impostazioni invece si possono prendere lo stesso.',
        ),
      );
    } else if (!p.story_id) {
      esito.append(
        el(
          'p',
          'empty',
          `Traccia in chiaro, senza il nome della storia: se non e' di «${ctx.story.title}» quello che ne esce non vuol dire niente.`,
        ),
      );
    } else if (p.ir_version && p.ir_version !== ctx.story.ir_version) {
      esito.append(
        el(
          'p',
          'stato-resolver',
          `Salvata con IR ${p.ir_version}, qui c'e' la ${ctx.story.ir_version}. Si carica lo stesso, ma se la storia e' ` +
            "cambiata dove passava la partita la traccia puo' finire prima: da li' si continua a giocare a mano.",
        ),
      );
    }
  }

  if (!partitaOk && !c.config) {
    esito.append(el('p', 'empty', 'Non c\'e\' niente che si possa caricare qui.'));
    return;
  }

  const scelte = el('div', 'rowbtns');
  const bottone = (label: string, cls: string, cosa: { partita: boolean; config: boolean }): HTMLButtonElement => {
    const b = el('button', cls, label);
    b.onclick = async () => {
      await premi(b);
      ctx.onCarica(salv, cosa);
      // Caricando la partita il pannello si chiude e riparte tutto: non c'e'
      // niente da confermare. Le impostazioni invece cambiano qualcosa che non
      // si vede da qui, e senza una parola sembrerebbe non essere successo
      // niente.
      if (!cosa.partita) b.textContent = 'caricate';
    };
    return b;
  };

  if (partitaOk && c.config) {
    scelte.append(
      bottone('carica tutto', 'btn primary', { partita: true, config: true }),
      bottone('solo la partita', 'btn', { partita: true, config: false }),
      bottone('solo le impostazioni', 'btn', { partita: false, config: true }),
    );
  } else if (partitaOk) {
    scelte.append(bottone('carica la partita', 'btn primary', { partita: true, config: false }));
  } else {
    scelte.append(bottone('carica le impostazioni', 'btn primary', { partita: false, config: true }));
  }
  esito.append(scelte);
}

function quantiPassi(n: number): string {
  return `${n} ${n === 1 ? 'passo' : 'passi'}`;
}

/** La data del salvataggio come la scriverebbe chi la legge, non in ISO. */
function quando(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

/** Seleziona un blocco: il ripiego quando gli appunti sono negati. */
function seleziona(node: Node): void {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(r);
}
