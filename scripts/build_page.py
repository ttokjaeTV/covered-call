# -*- coding: utf-8 -*-
"""src/ 조각을 합쳐 index.html 생성.  python scripts/build_page.py"""
from pathlib import Path
R = Path(__file__).resolve().parent.parent
page = (R / "src/page.html").read_text(encoding="utf-8")
css = (R / "src/base.css").read_text(encoding="utf-8") + (R / "src/extra.css").read_text(encoding="utf-8")
eng = (R / "src/engine.js").read_text(encoding="utf-8")
app = (R / "src/app.js").read_text(encoding="utf-8")
out = page.replace("{{CSS}}", css).replace("{{ENGINE}}", eng).replace("{{APP}}", app)
(R / "index.html").write_text(out, encoding="utf-8")
print("index.html", len(out.encode()), "bytes")
