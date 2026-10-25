#!/usr/bin/env python3
"""Splash animation: "the band climb". Writes splash.html next to this script, geometry from build.py.

Story (≈2.7 s): a pen writes the N, climbing the 30° roof → the symbol lifts once → the wordmark wipes out
from behind the symbol while the lockup re-centres → tagline. The pen is a stroke in a mask over the real symbol,
so the drawn shape is exactly the logo. prefers-reduced-motion: final frame with a plain fade.
"""
import math, runpy
from pathlib import Path

B = runpy.run_path(str(Path(__file__).parent / "build.py"))
S, W, XH, CAP, BASE, ANG, T, SIDE, E0, LOCK_W = (B[k] for k in ("S", "W", "XH", "CAP", "BASE", "ANG", "T", "SIDE", "E0", "LOCK_W"))
SYM, REST, f = B["SYM"], B["REST"], B["f"]

# pen centre line: up the left stem, along the roof's centre, across the top, down the right stem
yc = lambda x: XH - x * math.tan(ANG) + T / 2
cx = (XH + T / 2 - (CAP + S / 2)) / math.tan(ANG)
PEN = f"M{f(S / 2)} {f(BASE + 1)}L{f(S / 2)} {f(yc(S / 2))}L{f(cx)} {f(CAP + S / 2)}L{f(W - S / 2)} {f(CAP + S / 2)}L{f(W - S / 2)} {f(BASE + 1)}"
APEX_LEN = (BASE + 1 - yc(S / 2)) + math.dist((S / 2, yc(S / 2)), (cx, CAP + S / 2)) + (W - S / 2 - cx)

PAD = 16
VB = f"{-PAD} {f(CAP - PAD)} {f(LOCK_W + 2 * PAD)} {f(BASE - CAP + 2 * PAD)}"
SHIFT = (LOCK_W - W) / 2            # symbol starts centred alone, slides left as the wordmark appears

html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>NextBand Splash</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@500;650&display=swap" rel="stylesheet">
<style>
:root{{--bg:#F7F9FB;--sym:#0F766E;--word:#0F172A;--tag:#5B6B80}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0A111C;--sym:#2DD4BF;--word:#E6EDF5;--tag:#8C9AAE;color-scheme:dark}}}}
/* follows the system theme: at night (most sessions) the splash is the app's dark canvas, no bright flash */
*{{box-sizing:border-box}}
html,body{{height:100%;margin:0}}
body{{background:var(--bg);color:var(--word);
  font-family:"Hanken Grotesk",system-ui,sans-serif;display:grid;place-items:center;overflow:hidden;
  padding:env(safe-area-inset-top) max(16px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(16px,env(safe-area-inset-left))}}
.stage{{display:flex;flex-direction:column;align-items:center;gap:clamp(10px,2.4vh,22px);width:min(86vw,560px)}}
svg{{width:100%;height:auto;display:block;overflow:visible}}
.tag{{margin:0;font-size:clamp(15px,2.2vw,19px);font-weight:500;letter-spacing:.01em;color:var(--tag);opacity:0}}
.replay{{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));
  font:13px/1 "Hanken Grotesk",system-ui,sans-serif;color:var(--word);background:transparent;
  border:1px solid color-mix(in srgb,var(--word) 30%,transparent);border-radius:999px;padding:10px 16px;cursor:pointer;opacity:0;transition:opacity .3s}}
.replay:focus-visible{{outline:2px solid var(--sym);outline-offset:3px}}
.replay.on{{opacity:1}}
</style></head><body>
<main class="stage" aria-label="NextBand">
<svg viewBox="{VB}" role="img" aria-label="NextBand">
  <defs>
    <mask id="pen" maskUnits="userSpaceOnUse" x="-40" y="-40" width="600" height="200">
      <path id="penPath" d="{PEN}" fill="none" stroke="#fff" stroke-width="{f(S * 1.45)}" stroke-linejoin="round" stroke-linecap="round"/>
    </mask>
    <clipPath id="wipe"><rect id="wipeRect" x="{f(W)}" y="{f(CAP - 10)}" width="0" height="{f(BASE - CAP + 20)}"/></clipPath>
  </defs>
  <g id="lock">
    <path id="sym" d="{SYM}" fill="var(--sym)" mask="url(#pen)"/>
    <g clip-path="url(#wipe)"><path id="word" fill="var(--word)" transform="translate({f(W + SIDE - E0)} 0)" d="{REST}"/></g>
  </g>
</svg>
<p class="tag" id="tag">One band ahead.</p>
</main>
<button class="replay" id="replay" type="button">Replay</button>
<script>
(() => {{
  const $ = id => document.getElementById(id);
  const pen = $("penPath"), len = pen.getTotalLength(), apex = {f(APEX_LEN)} / len;
  const WORD_W = {f(LOCK_W - W)}, BIG = 2.4, SYM_CX = {f(W / 2)}, LOCK_CX = {f(LOCK_W / 2)}, MID = {f((CAP + BASE) / 2)};
  const clamp = v => Math.min(1, Math.max(0, v));
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const io = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // cubic in-out
  const out = p => 1 - Math.pow(1 - p, 3);                                       // cubic out
  const outBack = p => 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);  // slight settle
  const END = 2750;
  pen.style.strokeDasharray = len;

  function frame(t) {{
    // 2 · pen climbs to the top (Band 7), then drops down the right stem
    const climb = io(span(t, 250, 1050)), drop = out(span(t, 1050, 1270));
    const drawn = climb < 1 ? climb * apex : apex + drop * (1 - apex);
    pen.style.strokeDashoffset = len * (1 - drawn);
    // 3 · on completion the symbol gives one small upward lift: "one band up"
    const lift = span(t, 1180, 1520), bump = Math.sin(Math.PI * lift) * (1 - lift * .4);
    const move = io(span(t, 1350, 1900));
    // symbol starts large and centred; settles to logo size as the lockup centres
    const k = BIG + (1 - BIG) * move, cx = SYM_CX + (LOCK_CX - SYM_CX) * move;
    $("lock").setAttribute("transform", `translate(${{LOCK_CX}} ${{MID - bump * 3}}) scale(${{k}}) translate(${{-cx}} ${{-MID}})`);
    const wipe = out(span(t, 1600, 2250));
    $("wipeRect").setAttribute("width", WORD_W * wipe + 10);
    $("word").style.opacity = span(t, 1600, 1750);
    // 5 · tagline
    const tg = span(t, 2150, 2650);
    $("tag").style.opacity = out(tg);
    $("tag").style.transform = `translateY(${{(1 - outBack(tg)) * 8}}px)`;
    if (t >= END) $("sym").removeAttribute("mask");   // final frame: exact logo, no mask
  }}

  let start;
  const loop = now => {{
    start ??= now;
    const t = now - start;
    frame(t);
    if (t < END) requestAnimationFrame(loop); else $("replay").classList.add("on");
  }};
  const play = () => {{
    $("replay").classList.remove("on");
    $("sym").setAttribute("mask", "url(#pen)");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {{
      frame(END); $("tag").style.transform = "none";
      document.body.animate([{{opacity: 0}}, {{opacity: 1}}], {{duration: 400}});
      $("replay").classList.add("on"); return;
    }}
    start = undefined; requestAnimationFrame(loop);
  }};
  $("replay").addEventListener("click", play);
  // in the app: await window.nextbandSplash, then fade this layer out
  window.nextbandSplash = new Promise(r => setTimeout(r, END + 200));
  const still = location.search.match(/t=(\\d+)/);   // ?t=1200 renders one frame (for previews)
  if (still) {{ frame(+still[1]); return; }}
  (document.fonts?.ready ?? Promise.resolve()).then(play);
}})();
</script>
</body></html>
"""
(B["OUT"] / "splash.html").write_text(html)
print("splash.html", f"pen {APEX_LEN:.1f} to apex")
