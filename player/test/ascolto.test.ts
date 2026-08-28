/**
 * La regola del collapse acustico.
 *
 * E' l'unica parte della modalita' ascolto che non si vede: se sbaglia, la
 * storia continua a funzionare e semplicemente diventa insopportabile da
 * sentire — il paragrafo di un luogo ripetuto cinque volte a scena, oppure
 * (peggio) un'entrata muta perche' si e' collassato al primo passaggio. Un
 * test la fissa; l'altoparlante no.
 *
 * La voce e' finta di proposito: qui si verifica **cosa** viene detto e in
 * quale ordine, non che il browser lo pronunci.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Ascolto, ASCOLTO_DEFAULT } from '../src/web/ascolto.js';
import { MAX_PEZZO, limiteDiTaglio, spezza, Voce } from '../src/web/voce.js';
import type { Story } from '../src/core/index.js';

/** Una `Voce` che invece di parlare annota. `disponibile` deve dire true:
 * fuori dal browser la vera direbbe false e la modalita' resterebbe spenta. */
class VoceFinta extends Voce {
  dette: string[] = [];
  override get disponibile(): boolean {
    return true;
  }
  override parla(t: string): void {
    if (t.trim() !== '') this.dette.push(t);
  }
  override taci(): void {
    /* niente da interrompere */
  }
}

const STORIA: Story = {
  ir_version: '1.8.0',
  id: 'prova',
  title: 'Prova',
  start_scene: 'a',
  places: [{ id: 'cucina', name: 'La cucina', visual_prompt: 'una cucina stretta, piastrelle verdi' }],
  characters: [
    {
      id: 'yacob',
      name: 'Yacob',
      visual_prompt: 'uomo anziano, barba corta',
      voice: { style_prompt: 'roca, lenta' },
    },
  ],
  scenes: [
    {
      id: 'a',
      title: 'Prima',
      background: {
        image_prompt: 'campo medio dalla porta',
        place: 'cucina',
        ambient_sound_prompt: 'un rubinetto che gocciola',
      },
      characters: [{ id: 'yacob' }],
      actions: [],
    },
    {
      id: 'b',
      title: 'Dopo',
      background: { image_prompt: 'primo piano del tavolo', place: 'cucina' },
      characters: [{ id: 'yacob' }],
      actions: [],
    },
  ],
};

function apparecchia(imp: Partial<typeof ASCOLTO_DEFAULT> = {}): { a: Ascolto; v: VoceFinta } {
  const v = new VoceFinta();
  const a = new Ascolto(STORIA, v);
  a.configura({ ...ASCOLTO_DEFAULT, attiva: true, ...imp });
  return { a, v };
}

const scena = (id: string) => STORIA.scenes.find((s) => s.id === id)!;
const tutto = (v: VoceFinta) => v.dette.join(' | ');

test('alla prima visita si sente la composizione per intero', () => {
  const { a, v } = apparecchia();
  a.scena(scena('a'));
  const detto = tutto(v);
  assert.match(detto, /Ambiente: La cucina/);
  assert.match(detto, /piastrelle verdi/);
  assert.match(detto, /campo medio dalla porta/);
  assert.match(detto, /Personaggio: Yacob/);
  assert.match(detto, /barba corta/);
});

test('tornando nella stessa scena restano solo i nomi', () => {
  const { a, v } = apparecchia();
  a.scena(scena('a'));
  v.dette = [];
  a.scena(scena('a'));
  const detto = tutto(v);
  assert.match(detto, /Ambiente: La cucina/);
  assert.match(detto, /Personaggio: Yacob/);
  assert.doesNotMatch(detto, /piastrelle verdi/);
  assert.doesNotMatch(detto, /campo medio dalla porta/);
  assert.doesNotMatch(detto, /barba corta/);
});

test("una scena nuova nello stesso luogo dice la sua inquadratura, non di nuovo il luogo", () => {
  const { a, v } = apparecchia();
  a.scena(scena('a'));
  v.dette = [];
  a.scena(scena('b'));
  const detto = tutto(v);
  assert.match(detto, /Ambiente: La cucina/);
  // L'image_prompt vale solo qui: e' l'unica cosa davvero nuova.
  assert.match(detto, /primo piano del tavolo/);
  assert.doesNotMatch(detto, /piastrelle verdi/);
});

test('«guardati intorno» ricompone tutto senza consumare la prima volta', () => {
  const { a, v } = apparecchia();
  a.scena(scena('a'));
  v.dette = [];
  a.riosserva(scena('a'));
  const riletto = tutto(v);
  assert.match(riletto, /piastrelle verdi/);
  assert.match(riletto, /campo medio dalla porta/);
  assert.match(riletto, /barba corta/);

  // E la volta dopo si torna a collassare: la rilettura era su richiesta, non
  // un azzeramento della memoria.
  v.dette = [];
  a.scena(scena('a'));
  assert.doesNotMatch(tutto(v), /piastrelle verdi/);
});

test('suoni e tipi di voce solo col loro flag', () => {
  const spento = apparecchia();
  spento.a.scena(scena('a'));
  assert.doesNotMatch(tutto(spento.v), /rubinetto|roca/);

  const acceso = apparecchia({ suoniEVoci: true });
  acceso.a.scena(scena('a'));
  const detto = tutto(acceso.v);
  assert.match(detto, /Ambiente sonoro: un rubinetto che gocciola/);
  assert.match(detto, /Voce: roca, lenta/);
});

test('a modalita spenta non esce niente', () => {
  const { a, v } = apparecchia({ attiva: false });
  a.copertina();
  a.scena(scena('a'));
  a.riosserva(scena('a'));
  a.dilo('una riga di narrazione');
  assert.equal(v.dette.length, 0);
});

test('ricominciare azzera la memoria: la prima scena non arriva muta', () => {
  const { a, v } = apparecchia();
  a.scena(scena('a'));
  a.ricomincia();
  v.dette = [];
  a.scena(scena('a'));
  assert.match(tutto(v), /piastrelle verdi/);
});

// --------------------------------------------------------------------------
// Il taglio delle frasi lunghe.
//
// Chrome smette di parlare dopo ~15 secondi di una stessa utterance, e sull'IR
// di riferimento le descrizioni d'ambiente arrivano a 44. Il taglio e' quindi
// la differenza fra sentire la scena e sentirne meta'. Qui si verifica che
// tagli — e soprattutto che non perda niente: il testo e' d'autore.

test('un testo corto non si tocca', () => {
  assert.deepEqual(spezza('Ambiente: Il bagno.'), ['Ambiente: Il bagno.']);
});

test('nessun pezzo supera il limite, e le parole restano tutte', () => {
  const lungo = [
    'Ambiente: Il magazzino.',
    'capannone logistico abbandonato, buio a fasce con colonne di luce polverosa dai lucernari sfondati,',
    'scaffalature metalliche alte otto metri, corridoi lunghi che si perdono nel nero, pallet rotti e',
    'cellophane strappato, polvere sospesa nell aria ferma, un silenzio che amplifica ogni passo.',
    'Inquadratura larga dall ingresso, controluce.',
  ].join(' ');

  const pezzi = spezza(lungo);
  assert.ok(pezzi.length > 1, 'doveva spezzarsi');
  for (const p of pezzi) assert.ok(p.length <= MAX_PEZZO, `pezzo da ${p.length}: ${p}`);
  assert.deepEqual(pezzi.join(' ').split(' '), lungo.split(' '));
});

test('si taglia sui confini che ci sono gia nel testo', () => {
  // Tre frasi da 60: le prime due stanno insieme (121), la terza no (182).
  const pezzi = spezza('a'.repeat(60) + '. ' + 'b'.repeat(60) + '. ' + 'c'.repeat(60));
  assert.equal(pezzi.length, 2);
  // Il taglio cade dopo un punto, non in mezzo a una frase.
  assert.ok(pezzi[0].endsWith('.'), pezzi[0]);
  assert.equal(pezzi[1], 'c'.repeat(60));
});

test('un elenco di virgole senza punti si taglia sulle virgole', () => {
  const elenco = Array.from({ length: 12 }, (_, i) => `elemento numero ${i} della lista`).join(', ');
  const pezzi = spezza(elenco);
  for (const p of pezzi) assert.ok(p.length <= MAX_PEZZO);
  // Nessun pezzo comincia con una virgola orfana.
  for (const p of pezzi) assert.doesNotMatch(p, /^[,;:]/);
  assert.deepEqual(pezzi.join(' ').split(' '), elenco.split(' '));
});

test('una parola piu lunga del limite non manda in tilt e non sparisce', () => {
  const mostro = 'x'.repeat(400);
  const pezzi = spezza(`prima ${mostro} dopo`);
  assert.ok(pezzi.length >= 1);
  assert.deepEqual(pezzi.join(' ').split(' '), ['prima', mostro, 'dopo']);
});

test('il limite segue la velocita: rallentare non fa tornare il taglio', () => {
  // A parita' di durata: piu' lenta la voce, piu' corti i pezzi.
  assert.ok(limiteDiTaglio(0.5) < limiteDiTaglio(1));
  assert.ok(limiteDiTaglio(1) < limiteDiTaglio(2));
  // Stessa durata di parlato entro il margine, a qualunque velocita'.
  for (const v of [0.5, 0.8, 1, 1.2, 1.6, 2]) {
    const secondi = limiteDiTaglio(v) / (12 * v);
    assert.ok(secondi <= 12, `a velocita ${v} un pezzo dura ${secondi.toFixed(1)}s`);
  }
});
