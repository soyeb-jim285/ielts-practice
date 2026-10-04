import { pageMeta, SITE_NAME, SITEMAP_PATHS } from '@ielts/core';
import type { Hono } from 'hono';
import { env } from './env';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The SPA shell with this path's title, description, canonical URL and share card written in, replacing the
 *  <!--seo-->…<!--/seo--> defaults of index.html. Link previews (WhatsApp, Facebook, X, Slack) read only this HTML. */
export function renderShell(html: string, path: string, origin = env.WEB_ORIGIN): string {
  const m = pageMeta(path);
  const url = origin + (path.length > 1 ? path.replace(/\/+$/, '') : '/');
  const img = origin + m.image;
  const tags = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<meta name="robots" content="${m.index ? 'index, follow, max-image-preview:large' : 'noindex, follow'}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_GB" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:image" content="${esc(img)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(m.title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(img)}" />`,
  ].join('\n    ');
  return html.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, `<!--seo-->\n    ${tags}\n    <!--/seo-->`);
}

export function registerSeo(app: Hono<any>) {
  app.get('/robots.txt', (c) =>
    c.text(['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /docs', `Sitemap: ${env.WEB_ORIGIN}/sitemap.xml`, ''].join('\n')),
  );
  app.get('/sitemap.xml', (c) => {
    const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${env.WEB_ORIGIN}${p}</loc><changefreq>weekly</changefreq><priority>${p === '/' ? '1.0' : '0.8'}</priority></url>`);
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
  });
}
