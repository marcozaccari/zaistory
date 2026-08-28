/**
 * Quanto del parlato di una storia il resolver capisce davvero.
 *
 * Il linter statico trova le porte chiuse a chiave. Questo trova un'altra cosa,
 * che senza misura resta un'opinione: quante delle frasi con cui un giocatore
 * chiederebbe un'azione arrivano a quell'azione. Le frasi sono
 * `Action.test_phrases`, scritte in compilazione e tenute **fuori** da
 * `aliases` apposta — se le si copia di li' si misura il lookup, non il
 * richiamo.
 *
 * A cosa serve concretamente: la domanda "vale la pena scaricare centoventi
 * megabyte di modello per questa storia?" ha una risposta per storia, e questa
 * e' la funzione che la calcola invece di lasciarla al fiuto. Si lancia lo
 * stesso set su due backend e si guarda il delta — e, altrettanto importante,
 * si guarda l'elenco delle frasi che solo il piu' costoso prende.
 *
 * La distinzione fra i due modi di fallire e' il cuore del rapporto:
 *
 * - **persa** — il resolver non ha scelto niente. Costa al giocatore una frase
 *   riscritta, e nel peggiore dei casi la sensazione di aver sbagliato strada
 *   quando invece aveva ragione.
 * - **sbagliata** — il resolver ha scelto un'altra azione. Costa un `Effect`
 *   applicato che nessuno ha chiesto: un flag alzato, un oggetto consumato, un
 *   enigma bruciato. Un backend che alza il richiamo aggiungendo errori di
 *   questo tipo sta peggiorando la storia, e il totale da solo non lo direbbe.
 */

import type { Resolver } from './resolver.js';
import type { Story } from './types.js';
import { noMatchPool, sceneType, SCENE_INTERACTIVE } from './types.js';

export interface EsitoFrase {
  scene: string;
  atteso: string;
  frase: string;
  ottenuto: string;
  via?: string;
  why?: string;
  stato: 'presa' | 'persa' | 'sbagliata';
}

export interface Copertura {
  resolver: string;
  totale: number;
  prese: number;
  perse: EsitoFrase[];
  sbagliate: EsitoFrase[];
  /** Azioni che avrebbero dovuto avere frasi di prova e non ne hanno. */
  senzaFrasi: string[];
}

export async function copertura(story: Story, resolver: Resolver): Promise<Copertura> {
  const out: Copertura = { resolver: resolver.name, totale: 0, prese: 0, perse: [], sbagliate: [], senzaFrasi: [] };

  const world = [
    ...(story.items ?? []).map((i) => ({ id: i.id, name: i.name, aliases: i.aliases })),
    ...(story.characters ?? []).map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })),
  ];

  for (const sc of story.scenes) {
    if (sceneType(sc) !== SCENE_INTERACTIVE) continue;

    // Tutte le azioni della scena fanno da candidate, senza filtrare per
    // condizione: qui si misura il *matching*, non la disponibilita'. Filtrare
    // renderebbe il compito piu' facile di quanto sara' giocando, che e' il
    // modo piu' comune di farsi dire dal proprio banco di prova quello che si
    // sperava di sentirsi dire.
    const candidates = sc.actions.map((a) => ({ id: a.id, label: a.label, target: a.target, aliases: a.aliases }));
    if (candidates.length === 0) continue;

    for (const a of sc.actions) {
      if (!a.test_phrases?.length) {
        out.senzaFrasi.push(`${sc.id} / ${a.id}`);
        continue;
      }
      for (const frase of a.test_phrases) {
        const res = await resolver.resolve({
          candidates,
          input: frase,
          tone: sc.scene_tone ?? story.global_style?.default_tone ?? '',
          world,
          noMatch: noMatchPool(story, sc),
        });
        out.totale++;
        const base = { scene: sc.id, atteso: a.id, frase, ottenuto: res.actionId, via: res.via, why: res.why };
        if (res.actionId === a.id) out.prese++;
        else if (res.actionId === '') out.perse.push({ ...base, stato: 'persa' });
        else out.sbagliate.push({ ...base, stato: 'sbagliata' });
      }
    }
  }
  return out;
}

/** Il rapporto in righe di testo, uguale in terminale e nel pannello web. */
export function formattaCopertura(c: Copertura): string[] {
  const righe: string[] = [];
  if (c.totale === 0) {
    righe.push('nessuna frase di prova nell\'IR: aggiungi test_phrases alle azioni per poter misurare');
    if (c.senzaFrasi.length) righe.push(`azioni senza test_phrases: ${c.senzaFrasi.length}`);
    return righe;
  }
  const pct = (n: number) => `${((100 * n) / c.totale).toFixed(0)}%`;
  righe.push(`resolver: ${c.resolver}`);
  righe.push(`frasi di prova: ${c.totale} · prese ${c.prese} (${pct(c.prese)}) · perse ${c.perse.length} (${pct(c.perse.length)}) · sbagliate ${c.sbagliate.length} (${pct(c.sbagliate.length)})`);
  if (c.sbagliate.length) {
    righe.push('');
    righe.push('sbagliate (un Effect applicato che il giocatore non ha chiesto):');
    for (const e of c.sbagliate) righe.push(`  [${e.scene}] "${e.frase}" -> ${e.ottenuto} invece di ${e.atteso}${e.why ? ` · ${e.why}` : ''}`);
  }
  if (c.perse.length) {
    righe.push('');
    righe.push('perse (nessun match: il giocatore deve riscrivere la frase):');
    for (const e of c.perse) righe.push(`  [${e.scene}] "${e.frase}" -> atteso ${e.atteso}${e.why ? ` · ${e.why}` : ''}`);
  }
  if (c.senzaFrasi.length) {
    righe.push('');
    righe.push(`azioni senza test_phrases (non misurate): ${c.senzaFrasi.length}`);
  }
  return righe;
}
