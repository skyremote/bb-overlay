#!/usr/bin/env python3
"""Build the NavMotion Studio development fixtures (three projects) from CONTRACT.md.

Run: python3 fixtures/make_fixtures.py   (from the plugin folder). Re-running resets them.
"""
import json, pathlib, shutil, subprocess
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ACCENT = (79, 70, 229)
INK = (17, 17, 20)
PAPER = (247, 246, 243)


def font(size):
    for p in ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def still(path, w, h, title, sub, guides=False):
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([w * 0.08, h * 0.30, w * 0.92, h * 0.70], radius=int(h * 0.03), fill=(255, 255, 255), outline=(225, 223, 218), width=2)
    d.text((w * 0.12, h * 0.36), title, fill=INK, font=font(int(h * 0.07)))
    d.text((w * 0.12, h * 0.50), sub, fill=(90, 90, 96), font=font(int(h * 0.04)))
    d.rectangle([w * 0.12, h * 0.60, w * 0.12 + w * 0.3, h * 0.62], fill=ACCENT)
    if guides:
        for fx in (0.05, 0.95):
            d.line([(w * fx, 0), (w * fx, h)], fill=(230, 60, 60), width=2)
        for fy in (0.05, 0.95):
            d.line([(0, h * fy), (w, h * fy)], fill=(230, 60, 60), width=2)
        d.rectangle([w * 0.08, h * 0.30, w * 0.92, h * 0.70], outline=(40, 160, 90), width=3)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path)


def write(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=1) + "\n")


def stages(names, upto, state):
    out = []
    for i, n in enumerate(names):
        if i < upto:
            out.append({"name": n, "state": "done", "started": "2026-10-25T09:00:00+01:00", "finished": "2026-10-25T09:05:00+01:00", "summary": f"{n} done", "log": f"logs/{n}.log"})
        elif i == upto:
            out.append({"name": n, "state": state, "started": "2026-10-25T09:10:00+01:00"})
        else:
            out.append({"name": n, "state": "todo"})
    return out


def project(slug, kind, title, w, h, stage_names, upto, state, awaiting=None, progress=None, outputs=None, stills=(1.0, 3.0), notes=(), storyboard=True, thread_id=None):
    p = HERE / slug
    if p.exists():
        shutil.rmtree(p)
    film = p / "films" / "main" / "out"
    st, sg = [], []
    for t in stills:
        name = f"{t:06.2f}s.png"
        still(film / "stills" / name, w, h, title, f"Frame at {t:.0f} s", False)
        still(film / "stills-guides" / name, w, h, title, f"Frame at {t:.0f} s", True)
        st.append(f"films/main/out/stills/{name}")
        sg.append(f"films/main/out/stills-guides/{name}")
    write(film / "layout-report.json", {"pass": True, "errors": [], "warnings": [{"t": 3.0, "msg": "Caption 6 px from safe area"}, {"t": 1.0, "msg": "Logo slightly small"}]})
    if storyboard:
        rows = "".join(f'<figure><img src="stills/{pathlib.Path(s).name}"><figcaption>{pathlib.Path(s).stem}</figcaption></figure>' for s in st)
        (film / "storyboard.html").write_text(f"<!doctype html><meta charset=utf-8><title>{title} storyboard</title><style>body{{font-family:Inter,system-ui;background:#f7f6f3;color:#111;margin:24px}}figure{{display:inline-block;margin:8px;width:45%}}img{{width:100%;border-radius:8px}}</style><h1>{title}</h1>{rows}")
    (p / "logs").mkdir(parents=True, exist_ok=True)
    for n in stage_names[: upto + 1]:
        (p / "logs" / f"{n}.log").write_text(f"{n}: fixture log\n")
    (p / "deliver").mkdir(exist_ok=True)
    (p / "_work").mkdir(exist_ok=True)
    write(p / "navmotion.json", {"schema": 1, "slug": slug, "title": title, "kind": kind, "brief": f"Fixture brief for {title}.", "footage": None, "duration": 30, "created": "2026-10-25T09:00:00+01:00", "thread_id": thread_id, "deliverTo": f"~/NavMotion/delivered/{title}/"})
    status = {
        "schema": 1, "slug": slug, "title": title, "kind": kind,
        "updated": "2026-10-25T09:30:00+01:00",
        "stage": stage_names[upto], "state": state, "awaiting": awaiting,
        "stages": stages(stage_names, upto, state),
        "progress": progress,
        "films": [{"name": "main", "dir": "films/main", "size": f"{w}x{h}", "duration": 30.0,
                   "storyboard": "films/main/out/storyboard.html" if storyboard else None,
                   "stills": st, "stills_guides": sg,
                   "gate": {"pass": True, "errors": 0, "warnings": 2, "report": "films/main/out/layout-report.json"},
                   "metrics": {"changes_min": 14, "motion": 0.62, "beats_45s": 9}}],
        "outputs": outputs or [],
        "thread_id": thread_id,
        "notes": list(notes),
        "error": None,
        "future_field": "ignored by the Studio",
    }
    write(p / "status.json", status)
    (p / "feedback.jsonl").write_text("")
    return p


deck = project("deck-launch-graphic", "deck", "Launch graphic for the client deck", 960, 540,
               ["brief", "storyboard", "approval", "render", "deliver"], 2, "waiting", awaiting="storyboard",
               notes=["The layout gate has 2 warnings; neither blocks the render."])

project("sow-invoice-short", "short", "SOW to invoice in 30 seconds", 540, 960,
        ["brief", "storyboard", "approval", "music", "render", "verify", "deliver"], 4, "running",
        progress={"stage": "render", "film": "main", "frame": 1320, "of": 2700, "started": "2026-10-25T09:20:00+01:00", "eta_s": 610},
        stills=(2.0, 8.0, 14.0))

film = project("promo-film-delivered", "film", "BluPlai promo film", 960, 540,
               ["brief", "storyboard", "approval", "music", "render", "verify", "deliver"], 6, "done", storyboard=True)
mp4 = film / "deliver" / "promo-film-delivered_v1.mp4"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=60",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=60", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "2M",
                "-c:a", "aac", "-shortest", "-movflags", "+faststart", str(mp4)], check=True)
sheet = film / "deliver" / "promo-film-delivered_v1_check.jpg"
Image.open(film / "films/main/out/stills/001.00s.png").convert("RGB").save(sheet, quality=85)
s = json.loads((film / "status.json").read_text())
s["stages"][-1]["state"] = "done"
s["outputs"] = [
    {"label": "Finished film", "path": "deliver/promo-film-delivered_v1.mp4", "kind": "video", "bytes": mp4.stat().st_size},
    {"label": "Contact sheet", "path": "deliver/promo-film-delivered_v1_check.jpg", "kind": "image", "bytes": sheet.stat().st_size},
    {"label": "Escape attempt (must be rejected)", "path": "../../../../etc/hosts", "kind": "image", "bytes": 1},
]
write(film / "status.json", s)
# A Short waiting for the user to approve its covers (CONTRACT.md v1.1), two versions in three sizes.
cov = project("covers-short", "short", "Sixty comments a day", 540, 960,
              ["brief", "storyboard", "approval", "music", "render", "verify", "covers", "deliver"], 6, "waiting",
              awaiting="covers", stills=(2.0, 8.0))
covers = []
for v, tone in ((2, "v2, bigger number"), (1, "v1")):
    for (w, h, ratio) in ((1080, 1920, "9x16"), (1080, 1440, "3x4"), (1080, 1350, "4x5")):
        rel = f"covers/covers-short_cover_{ratio}_v{v}.png"
        still(cov / rel, w, h, "60 comments a day", f"Cover {ratio.replace('x', ':')} {tone}")
        covers.append({"label": f"Cover {ratio.replace('x', ':')}", "path": rel, "size": f"{w}x{h}", "bytes": (cov / rel).stat().st_size})
covers.append({"label": "Escape attempt (must be rejected)", "path": "../deck-launch-graphic/status.json", "size": "1080x1920", "bytes": 1})
s2 = json.loads((cov / "status.json").read_text())
s2["covers"] = covers
write(cov / "status.json", s2)
print("fixtures written to", HERE)
