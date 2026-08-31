#!/usr/bin/env node
/**
 * Compone il sito statico da pubblicare: una cartella per storia, con dentro
 * il player gia' incorporato e le immagini pubblicate accanto a lui.
 *
 *   npm run build:web && npm run build:site      # esce in ../_site
 *   node scripts/build-site.mjs ../_site
 *
 * Quello che ne esce:
 *   _site/index.html            l'elenco delle storie giocabili
 *   _site/<id>/index.html       il player con l'IR gia' dentro
 *   _site/<id>/assets/images/   le immagini, dove il player le cerca
 *   _site/.nojekyll             senza, Pages nasconde i file con l'underscore
 *
 * Perche' `<id>/index.html` e non `<id>.html`: il player cerca le immagini
 * accanto a se stesso e l'IR le nomina per id, non per percorso. Deve quindi
 * stare *dentro* la cartella della storia — la stessa ragione per cui
 * start_local_player.sh mette play.html in stories/<id>/.
 *
 * Le storie senza story.ir.json (sceneggiatura e basta) si saltano: non sono
 * ancora giocabili, e una voce nell'elenco che porta a un errore e' peggio di
 * una voce che non c'e'.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const qui = path.dirname(fileURLToPath(import.meta.url));
const radice = path.resolve(qui, '..', '..');
const storie = path.join(radice, 'stories');
const dist = path.join(qui, '..', 'dist', 'index.html');
const uscita = path.resolve(process.argv[2] ?? path.join(radice, '_site'));

if (!existsSync(dist)) {
  console.error(`manca ${path.relative(radice, dist)}: lancia prima "npm run build:web"`);
  process.exit(2);
}

// Si riparte da zero: un sito che si accumula si porta dietro storie
// rinominate o tolte, e nessuno se ne accorge finche' non le trova online.
await rm(uscita, { recursive: true, force: true });
await mkdir(uscita, { recursive: true });
await writeFile(path.join(uscita, '.nojekyll'), '');

const cartelle = (await readdir(storie, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const pubblicate = [];
for (const id of cartelle) {
  const cartella = path.join(storie, id);
  const ir = path.join(cartella, 'story.ir.json');
  if (!existsSync(ir)) continue;

  const dentro = path.join(uscita, id);
  await mkdir(dentro, { recursive: true });
  execFileSync(process.execPath, [path.join(qui, 'embed.mjs'), ir, path.join(dentro, 'index.html'), dist], {
    stdio: 'inherit',
  });

  let immagini = 0;
  const assets = path.join(cartella, 'assets');
  if (existsSync(assets)) {
    await cp(assets, path.join(dentro, 'assets'), { recursive: true });
    immagini = (await readdir(path.join(assets, 'images')).catch(() => [])).filter((f) =>
      f.endsWith('.webp'),
    ).length;
  }

  const meta = JSON.parse(await readFile(ir, 'utf8'));
  pubblicate.push({ id, titolo: meta.title ?? id, immagini });
}

if (pubblicate.length === 0) {
  console.error(`nessuna storia con uno story.ir.json in ${path.relative(radice, storie)}`);
  process.exit(2);
}

await writeFile(path.join(uscita, 'index.html'), indice(pubblicate));
console.log(`\nsito in ${path.relative(radice, uscita) || '.'}: ${pubblicate.map((s) => s.id).join(', ')}`);

/** L'elenco delle storie. Poca roba: e' una porta, non una vetrina. */
function indice(storie) {
  const voci = storie
    .map(
      (s) => `      <li>
        <a href="./${esc(s.id)}/">
          <span class="titolo">${esc(s.titolo)}</span>
          <span class="nota">${s.immagini ? `${s.immagini} immagini` : 'senza immagini'}</span>
        </a>
      </li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zaistory</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    background: #0e0e11; color: #e8e6e3;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { width: min(34rem, 100% - 3rem); padding: 3rem 0; }
  h1 { margin: 0 0 .25rem; font-size: 1.5rem; letter-spacing: -.02em; }
  p.occhiello { margin: 0 0 2rem; color: #9b978f; font-size: .9rem; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
  a {
    display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
    padding: .9rem 1.1rem; border: 1px solid #26262c; border-radius: .6rem;
    background: #16161a; color: inherit; text-decoration: none;
    transition: border-color .15s, background .15s;
  }
  a:hover, a:focus-visible { border-color: #4a4a55; background: #1c1c22; }
  .titolo { font-weight: 600; }
  .nota { color: #7d7a73; font-size: .8rem; white-space: nowrap; }
</style>
</head>
<body>
  <main>
    <h1>Zaistory</h1>
    <p class="occhiello">Storie interattive. Si aprono e partono, niente da installare.</p>
    <ul>
${voci}
    </ul>
  </main>
</body>
</html>
`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
