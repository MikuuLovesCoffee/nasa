# SI-assisted: written with Claude (Anthropic) for the Ember Atlas 30-second demo video. Reviewed and run by Team Ainexa.
# Scene 2 chart animation, caption overlays and the end card (PIL), from the site's real numbers.
import json, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
S, META = sys.argv[1], sys.argv[2]
m = json.load(open(META, encoding="utf-8"))
Y, g = m["years"], m["global"]
naive, harm = [v / 1e6 for v in g["naiveYear"]], [v / 1e6 for v in g["harmYear"]]
FD = "C:/Windows/Fonts/"
F = lambda name, size: ImageFont.truetype(FD + name, size)
REG, SEMI, BOLD = "segoeui.ttf", "seguisb.ttf", "segoeuib.ttf"
BG, TXT, TXT2, MUTED, LINE = (9, 11, 16), (240, 238, 232), (196, 194, 183), (128, 127, 120), (40, 44, 54)
ORANGE, GREY, RED, BLUE = (230, 106, 44), (150, 149, 142), (255, 92, 80), (80, 140, 230)
W, H, FPS = 1920, 1080, 30

def ease(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)

# ---------------------------------------------------------------- scene 2: the chart
def chart_frames(dur=6.6):
    os.makedirs(f"{S}/s2", exist_ok=True)
    X0, X1, Y0, Y1, VMAX = 230, 1690, 250, 860, 22.0
    px = lambda i: X0 + (X1 - X0) * i / (len(Y) - 1)
    py = lambda v: Y1 - (Y1 - Y0) * v / VMAX
    n = int(dur * FPS)
    for f in range(n):
        t = f / FPS
        im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
        d.text((X0, 92), "GLOBAL FIRE DETECTIONS PER YEAR · NASA FIRMS", font=F(SEMI, 26), fill=MUTED)
        title = "Raw record: whichever satellite was flying" if t < 4.6 else "Ember Atlas: one record, one scale"
        d.text((X0, 132), title, font=F(BOLD, 54), fill=TXT)
        for v in (0, 5, 10, 15, 20):
            d.line([(X0, py(v)), (X1, py(v))], fill=LINE, width=1)
            d.text((X0 - 24, py(v)), f"{v}M", font=F(REG, 24), fill=MUTED, anchor="rm")
        for i, y in enumerate(Y):
            if y % 4 == 1: d.text((px(i), Y1 + 22), str(y), font=F(REG, 24), fill=MUTED, anchor="mt")
        # 2012 marker: VIIRS starts
        k12 = Y.index(2012)
        d.line([(px(k12), Y0 - 10), (px(k12), Y1)], fill=(70, 74, 86), width=2)
        d.text((px(k12) + 10, Y0 - 6), "2012: VIIRS joins MODIS", font=F(SEMI, 24), fill=TXT2)
        # grey raw line draws over 0.2–3.0 s
        p = ease((t - 0.2) / 2.8) * (len(Y) - 1)
        pts = [(px(i), py(naive[i])) for i in range(int(p) + 1)]
        if int(p) < len(Y) - 1:
            a = p - int(p); i = int(p)
            pts.append((px(i) + (px(i + 1) - px(i)) * a, py(naive[i] + (naive[i + 1] - naive[i]) * a)))
        grey_w = 6 if t < 4.6 else 4
        if len(pts) > 1: d.line(pts, fill=GREY if t < 4.6 else (95, 95, 92), width=grey_w, joint="curve")
        # the jump callout 3.0–
        a = ease((t - 3.0) / 0.5) * (1 - 0.65 * ease((t - 4.6) / 0.6))
        if a > 0:
            c = tuple(int(BG[j] + (RED[j] - BG[j]) * a) for j in range(3))
            xA, yLo, yHi = px(k12) - 34, py(naive[k12 - 1]), py(naive[k12])
            d.line([(xA, yLo), (xA, yHi + 8)], fill=c, width=5)
            d.polygon([(xA - 14, yHi + 26), (xA + 14, yHi + 26), (xA, yHi)], fill=c)
            d.text((px(k12) - 60, py(9.5)), "×4 overnight", font=F(BOLD, 52), fill=c, anchor="rm")
            d.text((px(k12) - 60, py(9.5) + 44), "not more fire: a sharper satellite", font=F(SEMI, 30), fill=tuple(int(BG[j] + (TXT2[j] - BG[j]) * a) for j in range(3)), anchor="rm")
        # orange unified line 4.6–6.2
        q = ease((t - 4.6) / 1.5) * (len(Y) - 1)
        if t >= 4.6:
            pts = [(px(i), py(harm[i])) for i in range(int(q) + 1)]
            if int(q) < len(Y) - 1:
                a2 = q - int(q); i = int(q)
                pts.append((px(i) + (px(i + 1) - px(i)) * a2, py(harm[i] + (harm[i + 1] - harm[i]) * a2)))
            if len(pts) > 1: d.line(pts, fill=ORANGE, width=7, joint="curve")
            if q > 3: d.text((px(0), py(harm[0]) - 30), "Unified (MODIS calibrated to VIIRS)", font=F(SEMI, 30), fill=ORANGE, anchor="ls")
        # legend
        d.line([(X0, 980), (X0 + 50, 980)], fill=GREY, width=6); d.text((X0 + 64, 980), "Raw: MODIS until 2011, then VIIRS", font=F(REG, 28), fill=TXT2, anchor="lm")
        if t >= 4.6:
            d.line([(X0 + 640, 980), (X0 + 690, 980)], fill=ORANGE, width=7); d.text((X0 + 704, 980), "Ember Atlas unified", font=F(REG, 28), fill=TXT2, anchor="lm")
        im.save(f"{S}/s2/{f:05d}.png")

# ---------------------------------------------------------------- captions (transparent overlays)
def caption(name, kicker, title, body):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    x, y, w = 36, 330, 462
    lines = body.split("\n")
    h = 70 + 2 * 70 + 30 + len(lines) * 44 + 34
    box = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(box)
    bd.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=(10, 12, 18, 215), outline=(240, 138, 36, 110), width=2)
    im = Image.alpha_composite(im, box); d = ImageDraw.Draw(im)
    d.rectangle([x, y + 26, x + 6, y + 60], fill=ORANGE + (255,))
    d.text((x + 30, y + 30), kicker, font=F(SEMI, 24), fill=(240, 160, 90, 255))
    d.multiline_text((x + 30, y + 70), title, font=F(BOLD, 60), fill=TXT + (255,), spacing=6)
    yy = y + 70 + 2 * 70 + 34
    for ln in lines:
        d.text((x + 30, yy), ln, font=F(REG, 28), fill=TXT2 + (255,)); yy += 44
    im.save(f"{S}/{name}.png")

def endcard(dur=4.0):
    os.makedirs(f"{S}/s5", exist_ok=True)
    base = Image.open(f"{S}/s3/" + sorted(x for x in os.listdir(f"{S}/s3") if x.endswith(".jpg"))[-1]).convert("RGB")
    base = base.filter(ImageFilter.GaussianBlur(14))
    dark = Image.new("RGB", (W, H), BG)
    for f in range(int(dur * FPS)):
        t = f / FPS
        im = Image.blend(dark, base, 0.35)
        d = ImageDraw.Draw(im)
        a = ease(t / 0.6)
        col = lambda c: tuple(int(BG[j] + (c[j] - BG[j]) * a) for j in range(3))
        d.text((W / 2, 400), "Ember Atlas", font=F(BOLD, 120), fill=col(TXT), anchor="mm")
        d.text((W / 2, 500), "One fire record for the whole planet", font=F(SEMI, 48), fill=col(ORANGE), anchor="mm")
        d.text((W / 2, 580), "MODIS + VIIRS unified · 2000 – today · history, calendar, live, AI", font=F(REG, 32), fill=col(TXT2), anchor="mm")
        d.text((W / 2, 690), "nasa.mikuuloves.coffee", font=F(BOLD, 44), fill=col(TXT), anchor="mm")
        d.text((W / 2, 900), "Team Ainexa · Uzbekistan · NASA Space Apps Challenge", font=F(SEMI, 30), fill=col(TXT2), anchor="mm")
        d.text((W / 2, 945), "Data: NASA FIRMS (MODIS C6.1, VIIRS 375 m) · NASA POWER", font=F(REG, 26), fill=col(MUTED), anchor="mm")
        im.save(f"{S}/s5/{f:05d}.png")

import sys as _s
if 'nochart' not in _s.argv: chart_frames()
caption("cap1", "RAW NASA DATA", "Two satellites,\ntwo rulers", "MODIS · 1 km pixels · from 2000\nVIIRS · 375 m pixels · from 2012\nWatch the globe jump in 2012")
caption("cap3", "EMBER ATLAS · UNIFIED", "One record,\none scale", "MODIS calibrated to VIIRS\nper 5° region and season\nUnseen years: error 76% → 7%")
caption("cap4", "BURNING ACTIVITY CALENDAR", "Any area,\n25 years", "Uzbekistan: critical Mar–Oct\nUnusual months stand out\nCountry, province or a box")
if 'nochart' not in _s.argv: endcard()
print("graphics done")
