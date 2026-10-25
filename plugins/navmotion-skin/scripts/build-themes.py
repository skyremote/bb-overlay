#!/usr/bin/env python3
"""Build the three NavMotion skins: themes/src/base.css + one skin file each.

bb injects a theme as one stylesheet, so each skin carries the shared base.
Run from anywhere: python3 scripts/build-themes.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "themes" / "src"
BASE = (SRC / "base.css").read_text(encoding="utf-8")

for name in ("dots", "live", "tunnel"):
    skin = (SRC / f"{name}.css").read_text(encoding="utf-8")
    out = ROOT / "themes" / f"navmotion-{name}.css"
    header = f"/* Generated from themes/src/base.css + themes/src/{name}.css. Do not edit by hand. */\n"
    # @import must stay the first rule, so it goes before the generated header comment's rules.
    first, rest = BASE.split("\n", 1)
    out.write_text(first + "\n" + header + rest.rstrip() + "\n\n" + skin.rstrip() + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size} bytes)")
