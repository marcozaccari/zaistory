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
 * Esce con 1 se la partita non arriva al finale o se il browser ha registrato
 * un errore JavaScript.
 */

import { existsSync } from 'node:fs';

const [page = '/tmp/play.html'] = process.argv.slice(2);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('serve playwright: npm i --no-save playwright');
  process.exit(2);
}

// In un ambiente dove i browser sono già installati altrove, si usa quello.
const candidati = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter((p) => p && existsSync(p));

const browser = await chromium.launch(candidati.length ? { executablePath: candidati[0] } : {});
const p = await browser.newPage({ viewport: { width: 390, height: 800 } });

const errori = [];
p.on('pageerror', (e) => errori.push(String(e)));

await p.goto(`file://${page}`);
await p.locator('#dock button').click(); // inizia

const scrivi = async (frase) => {
  await p.locator('.riga-input input').fill(frase);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(50);
};

await scrivi("parlo con l'oste");
await p.locator('.scelte .btn').nth(1).click();
await scrivi("do un'occhiata al bancone");
await scrivi('afferro il luccichio sotto il banco');
await scrivi('do fuoco alla lanterna con le braci del camino');
await scrivi('esco sulla strada');
await scrivi('proseguo verso il cortile');
await scrivi('batto sulla porta');

const finale = await p.locator('.riga.fine').count();
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
console.log('la build gira: partita completata, nessun errore in pagina.');
