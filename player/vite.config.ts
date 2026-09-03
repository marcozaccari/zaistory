import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Il numero di versione del player vive in un posto solo: il package.json. */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * Incolla CSS e JS dentro l'HTML, così la build è **un solo file**.
 *
 * Non è un vezzo, è il requisito del progetto: un unico .html si apre da
 * `file://`, si manda in chat, si mette su qualunque static host e si gioca dal
 * telefono senza installare niente.
 */
function singleFile(): Plugin {
  return {
    name: 'zaistory-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') return;
      let source = String(html.source);

      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRe(file.fileName)}"[^>]*>`);
          source = source.replace(tag, () => `<style>\n${String(file.source)}\n</style>`);
          delete bundle[file.fileName];
        }
      }
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') {
          const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRe(file.fileName)}"[^>]*></script>`);
          // `</script>` dentro il codice chiuderebbe il tag in anticipo.
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          source = source.replace(tag, () => `<script type="module">\n${code}\n</script>`);
          delete bundle[file.fileName];
        }
      }
      html.source = source;
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig({
  base: './',
  // Il browser non ha un package.json da leggere: glielo si incolla addosso.
  define: { __ZAIPLAY_VERSION__: JSON.stringify(version) },
  build: {
    target: 'es2022',
    // La build produce UN file solo e lo sovrascrive: svuotare la cartella non
    // serve, e dove il filesystem non concede la cancellazione — un repository
    // montato da remoto, per dire — sarebbe l'unica cosa che impedisce di
    // compilare.
    emptyOutDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: { inlineDynamicImports: true, entryFileNames: 'zaiplay.js', assetFileNames: 'zaiplay.[ext]' },
    },
  },
  plugins: [singleFile()],
});
