#!/usr/bin/env node
/**
 * Serve la cartella `dist/` su http, e stampa gli indirizzi con cui
 * raggiungerla dal telefono.
 *
 * A cosa serve, visto che il player e' un file HTML che si apre da solo: a
 * far funzionare il backend a **vettori** da mobile. Aperto da `file://` o
 * dalla pagina pubblicata, quel backend non puo' scaricare il modello — nel
 * primo caso per le regole sulle origini opache, nel secondo perche' quella
 * pagina non fa richieste verso l'esterno. Servito da http, invece, e' una
 * pagina web come un'altra e il modello arriva.
 *
 *   npm run serve                 # -> dist/ sulla porta 8000
 *   npm run serve -- 8080 dist    # porta e cartella
 *
 * Poi, dal telefono sulla stessa rete, si apre uno degli indirizzi stampati.
 *
 * Nessuna dipendenza: e' node e basta, come tutto il resto del player.
 *
 * Una nota che evita mezz'ora di perplessita': su `http://` senza TLS il
 * browser non considera la pagina un contesto sicuro, quindi **WebGPU non e'
 * disponibile** e l'inferenza ripiega su WASM. E' piu' lenta, ma per una frase
 * di cinque parole resta nell'ordine dei millisecondi: non e' un problema, e'
 * solo una cosa da sapere prima di concludere che il telefono e' lento.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const qui = path.dirname(fileURLToPath(import.meta.url));
const [portaArg, cartellaArg] = process.argv.slice(2);
const porta = Number(portaArg) || 8000;
const radice = path.resolve(cartellaArg ?? path.join(qui, '..', 'dist'));

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    let file = path.join(radice, decodeURIComponent(url.pathname));
    // Nessuna risalita fuori dalla cartella servita: e' un server da rete di
    // casa, ma "da rete di casa" non e' una ragione per lasciarlo aperto.
    if (!file.startsWith(radice)) {
      res.writeHead(403).end('403');
      return;
    }
    const info = await stat(file).catch(() => undefined);
    if (info?.isDirectory()) file = path.join(file, 'index.html');
    const corpo = await readFile(file);
    res.writeHead(200, {
      'content-type': TIPI[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      // Il player e' un file solo e cambia a ogni build: una cache qui
      // significherebbe giocare la versione di ieri senza accorgersene. Le
      // immagini di una storia sono l'altro caso: pesano, non cambiano fra
      // una build e l'altra, e riscaricarle a ogni scena su un telefono in
      // wi-fi si vede.
      'cache-control': /\.(webp|png|jpe?g|avif|gif)$/i.test(file)
        ? 'public, max-age=60'
        : 'no-store',
    });
    res.end(corpo);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('non trovato');
  }
});

server.listen(porta, '0.0.0.0', async () => {
  const pagine = await elenco(radice);
  const rete = indirizzi();
  console.log(`\nservo ${radice} sulla porta ${porta}`);

  if (pagine.length === 0) {
    console.log('\n  la cartella non contiene nessun .html: hai lanciato `npm run build:web`?\n');
    return;
  }

  // Prima gli indirizzi di rete, perche' il caso d'uso e' il telefono. Quello
  // locale viene dopo, come nota: da questo computer si aprirebbe comunque il
  // file, senza server.
  if (rete.length === 0) {
    console.log('\n  nessuna interfaccia di rete: da questa macchina raggiungi solo localhost.');
  }
  for (const ip of rete) {
    console.log('');
    for (const f of pagine) console.log(`  http://${ip}:${porta}/${f}`);
  }
  console.log(`\n  da questo computer: http://localhost:${porta}/${pagine[0]}`);
  console.log('\n  dal telefono: stessa rete wi-fi, apri uno degli indirizzi qui sopra.');
  console.log('  (ctrl-c per fermare)\n');
});

/** Gli indirizzi IPv4 su cui il telefono puo' arrivare davvero. */
function indirizzi() {
  const out = [];
  for (const schede of Object.values(networkInterfaces())) {
    for (const s of schede ?? []) {
      if (s.family === 'IPv4' && !s.internal) out.push(s.address);
    }
  }
  return out;
}

/**
 * Le pagine da annunciare: quelle nella cartella servita e quelle una
 * cartella piu' sotto.
 *
 * Il secondo livello non e' generalita' per il gusto di averla: da quando una
 * storia e' una cartella con dentro l'IR e i suoi asset, il player incorporato
 * sta li' — `stories/metal-head/play.html` — proprio perche' le immagini si
 * risolvono relative a lui. Fermarsi al primo livello significherebbe servire
 * le storie e stampare "nessuna pagina".
 */
async function elenco(dir) {
  const { readdir } = await import('node:fs/promises');
  const voci = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const v of voci) {
    if (v.isFile() && v.name.endsWith('.html')) out.push(v.name);
    else if (v.isDirectory() && !v.name.startsWith('_') && !v.name.startsWith('.')) {
      const dentro = await readdir(path.join(dir, v.name)).catch(() => []);
      for (const f of dentro) if (f.endsWith('.html')) out.push(`${v.name}/${f}`);
    }
  }
  return out.sort();
}
