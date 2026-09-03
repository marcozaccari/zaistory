#!/usr/bin/env node
/**
 * La prova del fumo: apre la build in un browser vero e gioca una partita.
 *
 *   npm run build:web
 *   npm run embed -- testdata/mini.zaistory.json /tmp/play.html
 *   npm i --no-save playwright && node scripts/smoke.mjs /tmp/play.html
 *
 * Playwright non è una dipendenza del progetto e non deve diventarlo: il player
 * non ha dipendenze a runtime, e questo è uno strumento che si installa quando
 * serve. Serve però davvero — i test in `test/` provano il core, e il core può
 * essere perfetto mentre l'interfaccia non parte: la prima volta questo script
 * ha trovato una classe usata prima di essere inizializzata e un pannello
 * nascosto che continuava a intercettare i tocchi. Nessuno dei due si vede
 * leggendo il codice.
 *
 * La partita è quella di riferimento — `testdata/completo.txt`, la stessa che
 * gioca la CLI — e non una copia scritta qui dentro: due elenchi di frasi per
 * la stessa storia divergono al primo enigma che cambia, e a divergere in
 * silenzio è sempre quello che nessuno rilegge. Una riga che è un numero è una
 * battuta, e sul web una battuta si tocca: la riga in cui si scrive, in
 * dialogo, non c'è.
 *
 * Esce con 1 se la partita non arriva al finale o se il browser ha registrato
 * un errore JavaScript.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [page = '/tmp/play.html', script = fileURLToPath(new URL('../testdata/completo.txt', import.meta.url))] =
  process.argv.slice(2);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('serve playwright: npm i --no-save playwright');
  process.exit(2);
}

// In un ambiente dove i browser sono già installati altrove, si usa quello:
// `npm i --no-save playwright` porta la libreria, non i browser, e su una
// macchina che ha già Chrome scaricarne un altro da 150 MB è un pedaggio.
const candidati = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter((p) => p && existsSync(p));

const linee = readFileSync(script, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const browser = await chromium.launch(candidati.length ? { executablePath: candidati[0] } : {});
const p = await browser.newPage({ viewport: { width: 390, height: 800 } });

const errori = [];
p.on('pageerror', (e) => errori.push(String(e)));

const dock = p.locator('#dock');

/** Il «continua» fra un blocco e l'altro, quando c'è e non è già stato premuto.
 *
 * Non basta la classe: l'uscita consigliata è anche lei un `choice continue`, e
 * prenderla per un «continua» vorrebbe dire giocare una mossa che il copione
 * non ha chiesto. A distinguerli è quello che c'è scritto sopra, meno il segno
 * che apre ogni bottone del dock.
 *
 * `premuto` è il bottone che sta già facendo il suo mestiere: finché la
 * pressione dura il dock non accetta altro, e ricliccarlo vuol dire aspettare
 * un tocco che non arriverà mai a destinazione. */
async function bottoneContinua() {
  const bs = dock.locator('button.continue:not(.premuto)');
  for (let i = 0; i < (await bs.count()); i++) {
    const b = bs.nth(i);
    if ((await b.innerText()).replace('▸', '').trim() === 'continua') return b;
  }
  return undefined;
}

/**
 * Si aspetta che il dock torni giocabile, toccando i «continua» che si
 * incontrano: un turno può essere più blocchi, e la mossa successiva non arriva
 * prima dell'ultimo.
 *
 * Non basta un giro solo di «finché c'è un continua, premilo»: il dock si
 * ridisegna dopo il tocco, e guardarlo troppo presto lo trova ancora vuoto —
 * si vedeva come una riga in cui scrivere che non compariva mai. Quello che si
 * aspetta è uno dei tre stati in cui la partita accetta una mossa: si scrive,
 * si sceglie una battuta, oppure è finita.
 */
async function scandisci() {
  const scadenza = Date.now() + 15000;
  while (Date.now() < scadenza) {
    // Mentre un tocco è in corso il dock non accetta altro: quello che si vede
    // adesso è ancora lo schermo di prima.
    if (await p.locator('#dock.bloccato').count()) {
      await p.waitForTimeout(60);
      continue;
    }
    const b = await bottoneContinua();
    if (b) {
      await b.click();
      await p.waitForTimeout(80);
      continue;
    }
    if (await p.locator('.riga-input input').count()) return;
    if (await dock.locator('button.choice:not(.continue)').count()) return;
    if (await p.locator('.entry.finish').count()) return;
    await p.waitForTimeout(60);
  }
  throw new Error('il dock non torna giocabile');
}

/**
 * Una mossa, e l'attesa che sia arrivata.
 *
 * Il dock si ridisegna quando il turno ha una risposta, non quando il tocco
 * parte: guardarlo subito dopo il click lo trova ancora com'era, e la mossa
 * seguente si giocherebbe contro lo schermo di quella prima — un dialogo appena
 * chiuso continuerebbe a sembrare aperto. A dire che il turno è passato è il
 * trascritto, che cresce sempre: anche una frase che non ha fatto match ci
 * scrive il ripiego per intenzione.
 */
async function passo(linea) {
  const prima = await p.locator('#transcript > *').count();
  const battuta = /^(?:battuta\s+)?([1-9]\d*)$/.exec(linea);
  if (battuta) {
    // Le battute sono i `choice` veri: «continua» e l'uscita consigliata
    // portano la stessa classe ma non sono cose che qualcuno dice.
    await dock.locator('button.choice:not(.continue)').nth(Number(battuta[1]) - 1).click();
  } else {
    await p.locator('.riga-input input').fill(linea);
    await p.keyboard.press('Enter');
  }
  await p.waitForFunction((n) => document.querySelectorAll('#transcript > *').length > n, prima, { timeout: 15000 });
  await scandisci();
}

await p.goto(`file://${page}`);
await dock.locator('button.start').click(); // inizia
await scandisci();

for (const linea of linee) await passo(linea);

const finale = await p.locator('.entry.finish').count();
const testo = await p.locator('#transcript').innerText();
await browser.close();

if (!finale) {
  console.error('la partita non è arrivata a un finale:\n' + testo.slice(-400));
  process.exit(1);
}
if (errori.length) {
  console.error('errori JavaScript nella pagina:\n' + errori.join('\n'));
  process.exit(1);
}
console.log(`la build gira: ${linee.length} mosse, finale raggiunto, nessun errore in pagina.`);
