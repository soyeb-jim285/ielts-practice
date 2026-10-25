#!/usr/bin/env python3
"""NextBand symbol v3, built on a construction grid taken from the wordmark (Hanken Grotesk 650 outlines).

Every measure comes from the stem s = 10 (the wordmark's own n stem) and the wordmark's three lines:
  baseline 79, x-height 37.095, cap height 19.76 (Hanken: cap 697 / x-height 493)
  width 4s: stem s + counter 2s + stem s; height = cap height = 1.48 x width (about 2:3, like a capital N)
  skeleton: left stem stops at x-height, roof rises to cap height over the counter, flat top = the right stem
  roof angle falls out of the grid: atan((x-height - cap) / 3s) = 30.0 degrees
  roof thickness 0.9s measured square to the roof (diagonals look heavier than verticals)
  fillets: one family, r = 2s (roof levels off into the top), s (elbow), s/4 (top corner, feet); inner corners sharp
Writes the SVG masters + preview.html (construction sheet and usage mockups) to apps/web/public/nextband.
Then: gen_splash.py (splash.html demo), gen_splash_js.py (installed-app splash), node scripts/gen-brand-assets.mjs (icons, OG cards).
"""
import math, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "apps/web/public/nextband"   # SVG masters, preview.html
# colours = the app's own tokens (DESIGN.md "Ocean Teal"), so logo and UI are one system.
# Symbol and wordmark differ in hue (teal 186° vs navy 266°) and lightness, not just shade.
TEAL, INK, MINT, WHITE, PAPER = "#0F766E", "#0F172A", "#2DD4BF", "#FFFFFF", "#F7F9FB"  # brand, ink, dark-mode brand, white, canvas
NIGHT, NIGHT_INK = "#0A111C", "#E6EDF5"   # dark canvas, dark ink

BASE, XH = 79.0, 37.095
CAP = BASE - (BASE - XH) * 697 / 493
S = 10.0
W = 4 * S
APEX = CAP                                # top of the artwork (flat top on cap height)
ANG = math.atan((XH - CAP) / (W - S))
T = 0.9 * S / math.cos(ANG)               # vertical roof thickness for 0.9 s square to the roof
top = lambda x: XH - x * math.tan(ANG)    # roof top edge
PTS = [(0, BASE), (0, XH), (W - S, CAP), (W, CAP), (W, BASE), (W - S, BASE), (W - S, top(W - S) + T), (S, top(S) + T), (S, BASE)]
RAD = [S / 4, S, 2 * S, S / 4, S / 4, S / 4, 0, 0, S / 4]
f = lambda v: f"{v:.3f}".rstrip("0").rstrip(".")


def filleted(pts, radii):
    """Path through pts with a true circular fillet of radius r at each corner (0 = sharp). Also returns fillet centres."""
    d, centres = [], []
    for i, (p, r) in enumerate(zip(pts, radii)):
        if not r: d.append(f"L{f(p[0])} {f(p[1])}"); continue
        a, b = pts[i - 1], pts[(i + 1) % len(pts)]
        u = [((q[0] - p[0]) / math.dist(p, q), (q[1] - p[1]) / math.dist(p, q)) for q in (a, b)]
        phi = math.acos(u[0][0] * u[1][0] + u[0][1] * u[1][1])          # interior angle
        tl = r / math.tan(phi / 2)
        p1, p2 = [(p[0] + v[0] * tl, p[1] + v[1] * tl) for v in u]
        bis = (u[0][0] + u[1][0], u[0][1] + u[1][1]); bl = math.hypot(*bis)
        centres.append((p[0] + bis[0] / bl * r / math.sin(phi / 2), p[1] + bis[1] / bl * r / math.sin(phi / 2), r))
        sweep = int((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) > 0)
        d.append(f"L{f(p1[0])} {f(p1[1])}A{f(r)} {f(r)} 0 0 {sweep} {f(p2[0])} {f(p2[1])}")
    return "M" + " ".join(d)[1:] + "Z", centres


SYM, CENTRES = filleted(PTS, RAD)
SKELETON = "M" + " L".join(f"{f(x)} {f(y)}" for x, y in PTS) + "Z"

REST = (HERE / "wordmark-extband.path").read_text()  # "extband": Hanken Grotesk 650 outlines, the original wordmark minus its n
E0, END, SIDE = 152.97, 451.912, 7.1      # e's left edge, d's right edge, n→e spacing in the original
LOCK_W = W + SIDE + (END - E0)


def sym(fill, x=0, y=0, k=1):
    return f'<path fill="{fill}" transform="translate({f(x)} {f(y)}) scale({f(k)})" d="{SYM}"/>'


def lockup(sym_fill, word_fill, pad=6):
    """Symbol as the capital N + "extband". viewBox hugs the artwork plus pad."""
    vb = f"{-pad} {f(APEX - pad)} {f(LOCK_W + 2 * pad)} {f(BASE - APEX + 2 * pad)}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="NextBand">'
            f'{sym(sym_fill)}<path fill="{word_fill}" transform="translate({f(W + SIDE - E0)} 0)" d="{REST}"/></svg>')


def mark(fill, bg=None, size=100, h=0.52, rx=0, dy=0):
    """Symbol centred in a square tile, symbol height = h of the tile."""
    k = size * h / (BASE - APEX)
    x = (size - W * k) / 2
    y = (size - (BASE - APEX) * k) / 2 - APEX * k + dy * size
    tile = f'<rect width="{size}" height="{size}" rx="{rx}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="NextBand">'
            f'{tile}{sym(fill, x, y, k)}</svg>')


files = {
    "logo.svg": lockup(TEAL, INK), "logo-dark.svg": lockup(MINT, NIGHT_INK), "logo-on-teal.svg": lockup(WHITE, WHITE),
    "logo-mono.svg": lockup("currentColor", "currentColor"),
    "mark.svg": mark(TEAL, h=0.8), "mark-mono.svg": mark("currentColor", h=0.8),
    "app-icon.svg": mark(WHITE, TEAL, h=0.5),            # full bleed; OS applies the mask
    "favicon.svg": mark(WHITE, TEAL, h=0.66, rx=22),
    "adaptive-foreground.svg": mark(WHITE, h=0.36),      # 108dp canvas, art inside the 66dp safe zone
    "monochrome.svg": mark("#000", h=0.36),              # Android 13 themed icon / notification silhouette
}
for n, svg in files.items():
    (OUT / n).write_text(svg + "\n")

# ---------- construction sheet ----------
def construction():
    x0, x1 = -10, W + 14
    red, blue, grey = "#c0392b", "#2f80ed", "#8a9a96"
    line = lambda xa, ya, xb, yb, c, dash="1.2 .8", w=".25": (f'<line x1="{f(xa)}" y1="{f(ya)}" x2="{f(xb)}" y2="{f(yb)}" stroke="{c}" '
                                                               f'stroke-width="{w}" stroke-dasharray="{dash}"/>')
    text = lambda x, y, t, anchor="start": f'<text x="{f(x)}" y="{f(y)}" class="t" text-anchor="{anchor}">{t}</text>'
    hl = lambda y, lab: line(x0, y, x1, y, red) + text(x1 + 1.5, y + .8, lab)
    vl = lambda x: line(x, CAP - 8, x, BASE + 8, blue)
    dim = lambda a, b, y, lab: (line(a, y, b, y, blue, "none", ".3") + line(a, y - 1, a, y + 1, blue, "none", ".3")
                                + line(b, y - 1, b, y + 1, blue, "none", ".3") + text((a + b) / 2, y + 3.4, lab, "middle"))
    vdim = lambda x, a, b, lab: (line(x, a, x, b, red, "none", ".3") + line(x - 1, a, x + 1, a, red, "none", ".3")
                                 + line(x - 1, b, x + 1, b, red, "none", ".3") + text(x - 1.5, (a + b) / 2 + .8, lab, "end"))
    # roof construction line, extended past both ends, with its angle measured off the x-height line
    ext = 8
    roof = line(-ext * math.cos(ANG), XH + ext * math.sin(ANG), W - S + ext * math.cos(ANG), CAP - ext * math.sin(ANG), grey, "2 .8", ".3")
    ar = 12
    arc = (f'<path d="M{f(ar)} {f(XH)} A{ar} {ar} 0 0 0 {f(ar * math.cos(ANG))} {f(XH - ar * math.sin(ANG))}" fill="none" stroke="{red}" stroke-width=".3"/>'
           + text((ar + 1.5) * math.cos(ANG / 2), XH - (ar + 1.5) * math.sin(ANG / 2) + .8, f"{math.degrees(ANG):.0f}°"))
    fil = "".join(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="none" stroke="{grey}" stroke-width=".15" stroke-opacity=".7"/><circle cx="{f(cx)}" cy="{f(cy)}" r=".35" fill="{grey}"/>'
                  for cx, cy, r in CENTRES if r >= S)
    fil += "".join(text(cx, cy + 3, "r " + ("2s" if r > S else "s"), "middle") for cx, cy, r in CENTRES if r >= S)
    body = (f'<path d="{SYM}" fill="{TEAL}" fill-opacity=".16" stroke="{TEAL}" stroke-width=".35"/>'
            + f'<path d="{SKELETON}" fill="none" stroke="{INK}" stroke-width=".2" stroke-dasharray=".8 .6"/>'
            + "".join(vl(x) for x in (0, S, W - S, W))
            + hl(BASE, "baseline") + hl(XH, "x-height") + hl(CAP, "cap height")
            + roof + arc + fil
            + dim(0, S, BASE + 6, "s") + dim(S, W - S, BASE + 6, "2s") + dim(W - S, W, BASE + 6, "s") + dim(0, W, BASE + 12, "4s")
            + vdim(-5, CAP, BASE, "≈ 6s"))
    return (f'<svg viewBox="-24 {f(CAP - 12)} {f(W + 60)} {f(BASE - CAP + 30)}" class="cons" role="img" aria-label="Symbol construction grid">'
            f'<style>.t{{font:2.2px ui-monospace,monospace;fill:#5b6b67}}</style>{body}</svg>')


def lockup_grid():
    pad = 6
    lines = "".join(f'<line x1="{-pad}" x2="{f(LOCK_W + pad)}" y1="{f(y)}" y2="{f(y)}" stroke="#c0392b" stroke-width=".3" stroke-dasharray="1.5 1"/>'
                    for y in (BASE, XH, CAP))
    clear = f'<rect x="{-S * 2}" y="{f(APEX - S * 2)}" width="{f(LOCK_W + S * 4)}" height="{f(BASE - APEX + S * 4)}" fill="none" stroke="#2f80ed" stroke-width=".4" stroke-dasharray="2 1.2"/>'
    svg = lockup(TEAL, INK, pad=S * 2 + 2).replace("</svg>", lines + clear + "</svg>")
    return svg.replace('role="img"', 'class="lgrid" role="img"', 1)


# ---------- usage page ----------
L, LD, LT, LM = (files[k].replace("currentColor", "#000") for k in ("logo.svg", "logo-dark.svg", "logo-on-teal.svg", "logo-mono.svg"))
LMW = files["logo-mono.svg"].replace("currentColor", "#fff")
APP, FAV, FG, MONO = files["app-icon.svg"], files["favicon.svg"], files["adaptive-foreground.svg"], files["monochrome.svg"]
fg_white = lambda size, h: mark(WHITE, TEAL, size=size, h=h)

neighbours = [("#e8eaed", "#5f6368", "Files"), ("#fde7d9", "#c2410c", "Notes"), ("#dbeafe", "#1d4ed8", "Calendar"),
              ("#ede9fe", "#6d28d9", "Podcasts"), ("#fef3c7", "#b45309", "Photos"), ("#dcfce7", "#15803d", "Maps"), ("#fce7f3", "#be185d", "Music")]
def home(shape):
    cells = [f'<div class="app"><div class="ic {shape}" style="background:{bg}"><span style="background:{fg}"></span></div><small>{n}</small></div>'
             for bg, fg, n in neighbours[:3]]
    cells.insert(1, f'<div class="app"><div class="ic {shape} ours">{APP}</div><small>NextBand</small></div>')
    return "".join(cells)

sizes = "".join(f'<figure><div style="width:{z}px;height:{z}px">{FAV}</div><figcaption>{z}</figcaption></figure>' for z in (16, 24, 32, 48, 64, 128))
masks = "".join(f'<figure><div class="mask {m}">{fg_white(108, 0.36)}</div><figcaption>{m}</figcaption></figure>' for m in ("circle", "squircle", "rounded", "teardrop"))
themed = "".join(f'<figure><div class="mask circle" style="background:{bg};color:{fg}">{mark("currentColor", size=108, h=0.36)}</div><figcaption>{n}</figcaption></figure>'
                 for bg, fg, n in (("#d7e8e2", "#0b3b33", "themed light"), ("#21302d", "#b9e2d4", "themed dark")))

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NextBand Symbol v3</title><link rel="icon" href="favicon.svg">
<style>
:root{{--bg:{PAPER};--fg:{INK};--mute:#5B6B80;--line:#E3E8EF}}
*{{box-sizing:border-box}} svg{{display:block;width:100%;height:auto}} body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Hanken Grotesk",system-ui,sans-serif}}
main{{max-width:1180px;margin:auto;padding:40px max(16px,env(safe-area-inset-left)) 60px}}
h1{{font-size:34px;letter-spacing:-.03em;margin:0 0 4px}} h2{{font-size:13px;letter-spacing:.12em;text-transform:uppercase;margin:48px 0 14px;color:var(--mute)}}
p.lede{{color:var(--mute);max-width:640px;margin:0}}
.grid{{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}}
.card{{background:#fff;border-radius:6px;padding:22px;min-width:0;display:flex;flex-direction:column;gap:12px;justify-content:center}}
.card>small,figcaption,.cap{{font:11px ui-monospace,monospace;color:var(--mute)}}
.dark{{background:{NIGHT};color:{NIGHT_INK}}} .teal{{background:{TEAL};color:#fff}} .cap.l{{color:#8C9AAE}}
.cons{{width:100%;max-width:560px;display:block;margin:auto}} .lgrid{{width:100%;display:block}}
.logo svg{{display:block;width:100%;max-width:420px;height:auto}}
.row{{display:flex;flex-wrap:wrap;gap:22px;align-items:end}} figure{{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}}
figure svg{{display:block;width:100%;height:100%}}
/* phone */
.phone{{width:270px;border-radius:34px;padding:16px;background:linear-gradient(160deg,#355c55,#0f2a26);margin:auto}}
.phone .scr{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px 8px;padding:18px 6px}}
.app{{display:flex;flex-direction:column;align-items:center;gap:5px}} .app small{{color:#fff;font-size:10px}}
.ic{{width:50px;height:50px;overflow:hidden;display:grid;place-items:center}} .ic span{{width:22px;height:22px;border-radius:5px;opacity:.85}}
.ic svg{{width:100%;height:100%;display:block}} .ios{{border-radius:12px}} .and{{border-radius:50%}}
.mask{{width:96px;height:96px;overflow:hidden;background:{TEAL}}} .mask svg{{width:100%;height:100%}}
.circle{{border-radius:50%}} .squircle{{border-radius:38%}} .rounded{{border-radius:18%}} .teardrop{{border-radius:50% 50% 50% 14%}}
/* browser */
.browser{{border-radius:10px;overflow:hidden;border:1px solid var(--line);background:#fff}}
.tabs{{display:flex;gap:2px;background:#dee3e1;padding:8px 8px 0}} .tab{{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px 8px 0 0;font-size:12px;color:#444;min-width:0}}
.tab.on{{background:#fff;color:#111}} .tab svg{{width:16px;height:16px;flex:none}} .tab i{{width:16px;height:16px;border-radius:4px;background:#b9c2bf;flex:none}}
.url{{padding:7px 14px;font:12px ui-monospace,monospace;color:#555;border-bottom:1px solid #e5e9e7}}
.nav{{display:flex;align-items:center;gap:26px;padding:14px 22px;border-bottom:1px solid #e5e9e7;flex-wrap:wrap}} .nav svg{{height:26px;width:auto;display:block}}
.nav a{{font-size:13px;color:var(--mute);text-decoration:none}} .nav a.on{{color:{TEAL};font-weight:650}}
.nav.d{{background:{NIGHT};border-color:#1D293B}} .nav.d a{{color:#8C9AAE}} .nav.d a.on{{color:{MINT}}}
.hero{{padding:26px 22px;color:var(--mute);font-size:13px}} .hero b{{display:block;font-size:22px;color:var(--fg)}}
/* splash, og, chat, notif */
.splash{{width:200px;aspect-ratio:9/19;border-radius:28px;background:{TEAL};display:grid;place-items:center;margin:auto;max-width:100%}} .splash svg{{width:72px}}
.og{{aspect-ratio:1200/630;background:{NIGHT};border-radius:6px;padding:7% 8%;display:flex;flex-direction:column;justify-content:space-between;max-width:100%}}
.og svg{{width:55%;height:auto}} .og b{{color:#fff;font-size:clamp(16px,2.6vw,26px);letter-spacing:-.02em}} .og small{{color:#9fb5ae;font-size:12px}}
.chat{{background:#e7ddd3;border-radius:10px;padding:14px}} .bubble{{background:#d9fdd3;border-radius:8px;padding:5px;max-width:330px;margin-left:auto}}
.bubble .meta{{padding:6px 6px 2px;font-size:12px;color:#333}} .bubble .meta b{{display:block}}
.notif{{display:flex;gap:12px;align-items:center;background:#1f2524;color:#e9efed;border-radius:16px;padding:12px 14px;font-size:13px}}
.notif .n{{width:26px;height:26px;border-radius:50%;background:{TEAL};display:grid;place-items:center;flex:none}} .notif .n svg{{width:26px;height:26px;filter:invert(1)}}
.notif b{{display:block}}
.cert{{border:1px solid var(--line);border-radius:6px;padding:22px;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}}
.cert svg{{height:22px;width:auto}} .band{{font-size:44px;font-weight:700;color:{TEAL};line-height:1}}
.dont{{position:relative}} .dont::after{{content:"✕";position:absolute;top:8px;right:12px;color:#c0392b;font-weight:700}}
.dont svg{{max-width:260px;height:auto;display:block}}
</style></head><body><main>
<h1>NextBand · symbol v3</h1>
<p class="lede">Rebuilt on a grid taken from the wordmark. Left stem stops at the x-height (lowercase), right stem rises to cap height (capital): the letter climbs one level, the way a score climbs one band. Straight edges, softened corners, stem = the wordmark's own stem.</p>

<h2>01 · Construction</h2>
<div class="grid">
 <div class="card">{construction()}<small>Unit s = 10, the wordmark n stem. Width 4s = stem + counter 2s + stem. Left stem stops at x-height, the flat top sits on cap height, so the type sets the roof angle: {math.degrees(ANG):.1f}°. Roof 0.9s thick, square to the slope. Fillets r = 2s, s, s/4 (circles shown for the two large ones). Height ≈ 6s = 1.5 × width (2:3), a capital-N proportion. Dotted = sharp skeleton, fill = final.</small></div>
 <div class="card">{lockup_grid()}<small>Symbol is the capital N: same baseline, cap height, and n→e spacing ({SIDE}). Blue box = clear space, 2s (one counter width) on every side.</small></div>
</div>

<h2>02 · Logo variants</h2>
<div class="grid">
 <div class="card logo">{L}<small>primary · teal + navy ink on white</small></div>
 <div class="card logo dark">{LD}<small class="cap l">dark · teal-300 + light ink on night</small></div>
 <div class="card logo teal">{LT}<small class="cap l" style="color:#d4efe7">reverse · white on teal</small></div>
 <div class="card logo">{LM}<small>mono black · print, fax, stamps</small></div>
 <div class="card logo dark">{LMW}<small class="cap l">mono white · photos, video, the teal brand surface</small></div>
 <div class="card"><div class="row" style="justify-content:center">
   <div style="width:110px">{files["mark.svg"]}</div><div style="width:84px;border-radius:20px;overflow:hidden">{APP}</div><div style="width:64px">{FAV}</div></div>
   <small>symbol · app icon · favicon</small></div>
</div>

<h2>03 · Small sizes (favicon art)</h2>
<div class="card"><div class="row">{sizes}</div><small>Stem stays ≥ 1.7 px at 16 px; counter stays open.</small></div>

<h2>04 · On a phone</h2>
<div class="grid">
 <div class="card" style="align-items:center"><div class="phone"><div class="scr">{home("ios")}</div></div><small>iOS home screen</small></div>
 <div class="card" style="align-items:center"><div class="phone"><div class="scr">{home("and")}</div></div><small>Android, circle mask</small></div>
 <div class="card" style="align-items:center"><div class="splash">{files["mark.svg"].replace(TEAL, WHITE)}</div><small>splash screen</small></div>
</div>

<h2>05 · Android adaptive + themed icons</h2>
<div class="card"><div class="row">{masks}{themed}</div><small>One foreground layer, safe inside every launcher mask; monochrome layer for Android 13+ themed icons.</small></div>

<h2>06 · In the web app</h2>
<div class="browser">
 <div class="tabs"><div class="tab on">{FAV}NextBand · Listening Test 12</div><div class="tab"><i></i>Inbox</div><div class="tab"><i></i>Docs</div></div>
 <div class="url">nextband.app/listening</div>
 <div class="nav">{L}<a class="on" href="#">Listening</a><a href="#">Reading</a><a href="#">Writing</a><a href="#">Speaking</a></div>
 <div class="hero"><b>Good evening, Rafi</b>Your next target: Band 7.5 · 3 practice tests this week</div>
 <div class="nav d">{LD}<a class="on" href="#">Listening</a><a href="#">Reading</a><a href="#">Writing</a><a href="#">Speaking</a></div>
</div>

<h2>07 · Shared link, notification, report</h2>
<div class="grid">
 <div class="card chat"><div class="bubble"><div class="og">{LD}<div><b>One band ahead.</b><br><small>Practice tests with instant band scores</small></div></div>
   <div class="meta"><b>NextBand: practice tests with instant feedback</b>nextband.app</div></div></div>
 <div class="card" style="gap:14px"><div class="notif"><div class="n">{MONO}</div><div><b>NextBand</b>Your Writing Task 2 feedback is ready: Band 6.5</div></div>
   <small>notification: white silhouette (monochrome layer)</small>
   <div class="cert"><div>{L}<div class="cap" style="margin-top:10px">Mock test report · 25 Oct 2026</div></div><div style="text-align:right"><div class="band">7.0</div><div class="cap">overall band</div></div></div>
   <small>score report / PDF header</small></div>
</div>

<h2>08 · Don't</h2>
<div class="grid">
 <div class="card dont">{L.replace(TEAL, "#e4572e")}<small>recolour the symbol</small></div>
 <div class="card dont"><div style="transform:scaleX(1.35);transform-origin:left">{L}</div><small>stretch or squash</small></div>
 <div class="card dont" style="background:#7ab8aa">{L}<small style="color:#163">busy / low-contrast background</small></div>
</div>
</main></body></html>"""
(OUT / "preview.html").write_text(page)
print(f"angle {math.degrees(ANG):.2f}°  cap {CAP:.2f}  roof t {T:.2f}  files: {', '.join(files)}")
