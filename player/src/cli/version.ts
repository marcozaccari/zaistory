/**
 * La versione del player per la CLI, letta dal `package.json` che sta sopra al
 * codice compilato. Non si passa da `define` come nel web: qui il file c'e' e
 * leggerlo evita che il numero stampato sia quello di un'altra build.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PLAYER_VERSION } from '../version.js';

export function playerVersion(): string {
  // Da `dist-node/src/cli/` (o da `src/cli/`) si risale finche' non si trova.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // niente package.json qui: si sale di un livello
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return PLAYER_VERSION;
}
