import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Preload the latin variable fonts used above the fold so they download with the HTML, not after the CSS is parsed (vite doesn't hash-resolve hand-written preload hrefs). */
const preloadFonts = (): Plugin => ({
  name: 'preload-fonts',
  transformIndexHtml: {
    order: 'post',
    handler: (_html, ctx) =>
      Object.keys(ctx.bundle ?? {})
        .filter((f) => /(hanken-grotesk|newsreader)-latin-wght-normal.*\.woff2$/.test(f))
        .map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `/${f}` }, injectTo: 'head' as const })),
  },
});

/** The styleguide is a dev-only reference (its menu link is gated on import.meta.env.DEV too): production builds swap the 40 KB page for a 404 stub so it is not emitted. */
const stubStyleguide = (): Plugin => ({
  name: 'stub-styleguide',
  apply: 'build',
  enforce: 'pre',
  transform: (_code, id) =>
    id.replace(/\\/g, '/').endsWith('/routes/_app/styleguide.tsx')
      ? "import { createFileRoute, notFound } from '@tanstack/react-router';\nexport const Route = createFileRoute('/_app/styleguide')({ beforeLoad: () => { throw notFound(); } });"
      : null,
});

export default defineConfig({
  plugins: [stubStyleguide(), tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss(), preloadFonts()],
  build: {
    rolldownOptions: {
      // The ui barrel (components/ui/index.ts) re-exports every primitive; its modules only declare components, so importing Button must not drag in the menu/dialog/slider code too.
      treeshake: { moduleSideEffects: [{ test: /src[\\/]components[\\/]ui[\\/]/, sideEffects: false }] },
      output: {
        codeSplitting: {
          groups: [
            // What /login, /signup and the other signed-out pages need (buttons, inputs, alerts, the cn helper): the only UI in the entry's load.
            { name: 'ui-core', priority: 20, test: /src[\\/](lib[\\/]utils|components[\\/]ui[\\/](Button|Alert|Badge|Card|Field|IconTile|EmptyState|PageContainer|PageHeader|Skeleton|Toast|shadcn[\\/](button|input|label|alert|badge|card|textarea|skeleton)))\.tsx?$|node_modules[\\/](clsx|tailwind-merge|class-variance-authority|@radix-ui[\\/](react-slot|react-label|react-primitive|react-compose-refs))/ },
            // Menus, dialogs, popovers, sliders, command palette: only the authed app's lazy routes use them.
            { name: 'overlay', priority: 10, test: /node_modules[\\/](@radix-ui|@floating-ui|radix-ui|cmdk|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-sidecar|use-callback-ref|aria-hidden|tslib)[\\/]|src[\\/]components[\\/]ui[\\/]/ },
          ],
        },
      },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } } },
});
