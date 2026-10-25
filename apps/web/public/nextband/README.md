# NextBand

**One band ahead.**

The symbol is the capital N of the wordmark. Its left stem stops at the x-height, and its roof climbs 30° to cap height,
so the letter rises from lowercase to capital the way a score rises one band. Open [`preview.html`](preview.html)
(dev server: `/nextband/preview.html`) for the construction grid, every variant and mockups in use;
[`splash.html`](splash.html) plays the splash animation.

## Build

Everything here is generated. Edit the generators in `scripts/nextband/`, not these files.

```sh
python3 scripts/nextband/build.py          # SVG masters + preview.html
python3 scripts/nextband/gen_splash.py     # splash.html (demo page)
python3 scripts/nextband/gen_splash_js.py  # splash.js (installed-app splash, loaded by index.html)
CHROME_PATH=/usr/bin/google-chrome-stable node scripts/gen-brand-assets.mjs   # root icons, favicon.ico, og/*.png
```

PNGs in this folder: `rsvg-convert -w 1920 logo.svg -o logo.png` (and the same for the others).

## Grid

Unit `s` = 10, the stem of the wordmark's n (Hanken Grotesk 650 outlines). The symbol is 4s wide (stem, 2s counter, stem)
and cap height tall (≈ 6s). The roof is 0.9s thick, measured square to the slope. Fillets are 2s, s and s/4, and the inner
corners stay sharp. Clear space is 2s on every side.

## Colour

The logo uses the app's own tokens (`DESIGN.md`). The symbol and the wordmark differ in hue, not only in shade.

| Surface | Symbol | Wordmark |
| --- | --- | --- |
| Light (`#FFFFFF` / `#F7F9FB`) | teal `#0F766E` | navy ink `#0F172A` |
| Dark (`#0A111C`) | teal-300 `#2DD4BF` | light ink `#E6EDF5` |
| Brand teal `#0F766E` | white | white |

## Files

| File | Use |
| --- | --- |
| `logo.svg` / `.png` | Primary, on light surfaces |
| `logo-dark.svg` / `.png` | On dark surfaces |
| `logo-on-teal.svg` | All white, on the brand teal |
| `logo-mono.svg`, `mark-mono.svg` | One colour via `currentColor` (inline SVG only) |
| `mark.svg` / `.png` | The symbol alone |
| `app-icon.svg` / `.png` | Full-bleed square app icon (the OS applies the mask) |
| `favicon.svg` | Rounded tile, also the source for `/icon.svg`, `/favicon.ico`, `/icon-*.png` |
| `adaptive-foreground.*`, `monochrome.*` | Android adaptive icon layer and themed (Android 13+) icon, 108dp canvas |
| `splash.js` | Launch splash for the installed app |

IELTS is a registered trademark of the British Council, IDP: IELTS Australia and Cambridge University Press & Assessment.
NextBand is not affiliated with, approved or endorsed by them.
