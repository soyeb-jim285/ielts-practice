import { expect, it } from 'vitest';
import { renderShell } from './seo';

const shell = '<head>\n<!--seo-->\n<title>x</title>\n<!--/seo-->\n</head>';

it('writes each page its own title, share card and canonical URL; private pages are noindex', () => {
  const sp = renderShell(shell, '/speaking/', 'https://ielts.example');
  expect(sp).toContain('<title>IELTS Speaking practice test with band score | IELTS Practice</title>');
  expect(sp).toContain('<meta property="og:image" content="https://ielts.example/og/speaking.png" />');
  expect(sp).toContain('<link rel="canonical" href="https://ielts.example/speaking" />');
  expect(sp).toContain('content="index, follow, max-image-preview:large"');
  expect(sp).not.toContain('<title>x</title>');
  const result = renderShell(shell, '/speaking/result/abc', 'https://ielts.example');
  expect(result).toContain('<title>Speaking result | IELTS Practice</title>');
  expect(result).toContain('content="noindex, follow"');
  expect(renderShell(shell, '/', 'https://ielts.example')).toContain('og/home.png');
});
