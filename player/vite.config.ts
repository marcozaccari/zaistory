import { defineConfig, type Plugin } from 'vite';

/**
 * Incolla CSS e JS dentro l'HTML, cosi' la build e' **un solo file**.
 *
 * Non e' un vezzo: e' il requisito del progetto. Un unico .html si apre da
 * `file://`, si manda in chat, si mette su qualunque static host e si gioca dal
 * telefono senza installare niente — che e' esattamente il motivo per cui il
 * player e' passato da Go al browser.
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
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: { inlineDynamicImports: true, entryFileNames: 'zaiplay.js', assetFileNames: 'zaiplay.[ext]' },
    },
  },
  plugins: [singleFile()],
});
