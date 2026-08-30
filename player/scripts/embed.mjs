#!/usr/bin/env node
/**
 * Incorpora un IR nel player web gia' costruito, producendo un unico file HTML
 * che si apre e parte da solo.
 *
 *   npm run build:web
 *   npm run embed -- ../stories/nel-paese-dei-ciechi/story.ir.json paese-dei-ciechi.html
 *
 * A cosa serve: mandare a qualcuno *una* storia da provare sul telefono senza
 * spiegargli come si carica un file. Il player resta lo stesso, cambia solo
 * cosa trova gia' pronto all'avvio.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const [irPath, outPath = 'zaiplay-story.html', htmlPath = path.join(here, '..', 'dist', 'index.html')] =
  process.argv.slice(2);

if (!irPath) {
  console.error('uso: node scripts/embed.mjs story.ir.json [uscita.html] [dist/index.html]');
  process.exit(2);
}

const html = await readFile(htmlPath, 'utf8');
const ir = JSON.parse(await readFile(irPath, 'utf8'));

// `<` va sfuggito: dentro un <script> chiuderebbe il tag in anticipo.
const json = JSON.stringify(ir).replace(/</g, '\\u003c');
const tag = `<script>window.__ZAISTORY_IR__=${json};</script>`;

if (!html.includes('</head>')) {
  console.error(`${htmlPath} non sembra la build del player (manca </head>)`);
  process.exit(2);
}

await writeFile(outPath, html.replace('</head>', `${tag}\n</head>`));
console.log(`scritto ${outPath} (${ir.title ?? ir.id})`);
