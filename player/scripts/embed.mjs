#!/usr/bin/env node
/**
 * Incorpora una storia nel player web già costruito, producendo un unico file
 * HTML che si apre e parte da solo.
 *
 *   npm run build:web
 *   npm run embed -- ../stories/mini/mini.zaistory.json ../stories/mini/play.html
 *
 * A cosa serve: mandare a qualcuno *una* storia da provare sul telefono senza
 * spiegargli come si carica un file. Il player resta lo stesso, cambia solo
 * cosa trova già pronto all'avvio.
 *
 * Il file finisce DENTRO la cartella della storia, e non è un dettaglio di
 * comodo: le immagini pubblicate stanno in `assets/images/`, la storia le
 * nomina per id e non per percorso, e una pagina che sta lì le trova.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const [storyPath, outPath, htmlPath = path.join(here, '..', 'dist', 'index.html')] = process.argv.slice(2);

if (!storyPath) {
  console.error('uso: node scripts/embed.mjs <id>.zaistory.json [uscita.html] [dist/index.html]');
  process.exit(2);
}

const out = outPath ?? path.join(path.dirname(storyPath), 'play.html');
const html = await readFile(htmlPath, 'utf8');
const story = JSON.parse(await readFile(storyPath, 'utf8'));

// `<` va sfuggito: dentro un <script> chiuderebbe il tag in anticipo.
const json = JSON.stringify(story).replace(/</g, '\\u003c');
const tag = `<script>window.__ZAISTORY__=${json};</script>`;

if (!html.includes('</head>')) {
  console.error(`${htmlPath} non sembra la build del player (manca </head>)`);
  process.exit(2);
}

await writeFile(out, html.replace('</head>', `${tag}\n</head>`));
console.log(`scritto ${out} (${story.title ?? story.id})`);
