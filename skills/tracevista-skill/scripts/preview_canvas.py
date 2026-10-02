#!/usr/bin/env python3
"""Render a .thoughtdag.json canvas as a static HTML/SVG preview (no ThoughtDAG needed).

    python3 preview_canvas.py <canvas.thoughtdag.json> --out <preview.html>

Frames, cards (badge + title + takeaway), notes and the three wire kinds are drawn at their canvas
positions. Use it to check the layout before importing, or to share a quick look with someone who
has no ThoughtDAG. Hover a card for its body.
"""
import argparse
import html
import json
import os
from pathlib import Path

CARD_W, CARD_H, NOTE_H = 520, 118, 150
FRAME_FILL = {"violet": "#ede9fe", "sky": "#e0f2fe", "green": "#dcfce7", "amber": "#fef3c7", "rose": "#ffe4e6", "gray": "#f1f5f9"}
FRAME_LINE = {"violet": "#a78bfa", "sky": "#38bdf8", "green": "#34d399", "amber": "#fbbf24", "rose": "#fb7185", "gray": "#94a3b8"}
TYPE_COLOR = {"decision": "#2563eb", "pivot": "#d97706", "ruleout": "#9ca3af", "open": "#7c3aed"}
CATEGORY_COLOR = {"agent":"#2563eb", "tool":"#d97706", "review":"#dc2626", "thinking":"#9333ea", "input":"#059669", "status":"#64748b"}


def clip(text: str, n: int) -> str:
    text = " ".join(str(text or "").replace("**", "").replace("*", "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def main() -> None:
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("canvas", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    canvas = json.loads(args.canvas.read_text())
    nodes = {n["id"]: n for n in canvas["nodes"]}

    def size(n):
        kind = n["data"].get("stepKind")
        if kind == "frame":
            return n.get("width", 600), n.get("height", 400)
        return n.get("width", CARD_W), NOTE_H if kind == "note" else CARD_H

    xs = [n["position"]["x"] for n in nodes.values()] + [n["position"]["x"] + size(n)[0] for n in nodes.values()]
    ys = [n["position"]["y"] for n in nodes.values()] + [n["position"]["y"] + size(n)[1] for n in nodes.values()]
    x0, y0, x1, y1 = min(xs) - 60, min(ys) - 60, max(xs) + 60, max(ys) + 60
    parts = []
    for n in nodes.values():  # frames first, underneath
        if n["data"].get("stepKind") != "frame":
            continue
        c = n["data"].get("frameColor", "gray")
        w, h = size(n)
        parts.append(f'<rect x="{n["position"]["x"]}" y="{n["position"]["y"]}" width="{w}" height="{h}" rx="18" '
                     f'fill="{FRAME_FILL.get(c, "#f1f5f9")}" stroke="{FRAME_LINE.get(c, "#94a3b8")}" stroke-width="2"/>'
                     f'<text x="{n["position"]["x"] + 18}" y="{n["position"]["y"] + 34}" class="frame">{html.escape(clip(n["data"]["question"], 90))}</text>')
    for e in canvas["edges"]:
        a, b = nodes.get(e["source"]), nodes.get(e["target"])
        if not a or not b:
            continue
        aw, ah = size(a)
        bw, bh = size(b)
        if e.get("sourceHandle") == "branch":
            sx, sy, tx, ty = a["position"]["x"] + aw, a["position"]["y"] + ah / 2, b["position"]["x"], b["position"]["y"] + bh / 2
            mid = (sx + tx) / 2
            path = f"M{sx},{sy} C{mid},{sy} {mid},{ty} {tx},{ty}"
        else:
            sx, sy, tx, ty = a["position"]["x"] + aw / 2, a["position"]["y"] + ah, b["position"]["x"] + bw / 2, b["position"]["y"]
            mid = (sy + ty) / 2
            path = f"M{sx},{sy} C{sx},{mid} {tx},{mid} {tx},{ty}"
        color = (e.get("style") or {}).get("stroke", "#6B5CE7")
        dash = (e.get("style") or {}).get("strokeDasharray")
        dashed = f' stroke-dasharray="{dash}"' if dash else ""
        parts.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2.5"{dashed} marker-end="url(#arrow)"/>')
    for n in nodes.values():
        d, kind = n["data"], n["data"].get("stepKind")
        if kind == "frame":
            continue
        x, y = n["position"]["x"], n["position"]["y"]
        w, h = size(n)
        tip = html.escape(clip(d.get("response") or d.get("question"), 600))
        category = d.get('traceExport', {}).get('category')
        category_color = CATEGORY_COLOR.get(category, '#cbd5e1')
        if kind == "note":
            parts.append(f'<g><title>{tip}</title><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#fffbea" stroke="{category_color}" stroke-width="2.5"/>'
                         f'<foreignObject x="{x + 12}" y="{y + 8}" width="{w - 24}" height="{h - 16}"><div xmlns="http://www.w3.org/1999/xhtml" class="note">'
                         f'{html.escape(clip(d["question"], 230))}</div></foreignObject></g>')
            continue
        kind_type = (d.get("summaryTypes") or [None])[0]
        stripe = TYPE_COLOR.get(kind_type, "#6B5CE7")
        takeaway = (d.get("summaries") or [""])[0] or ""
        fill = "#f8fafc" if kind_type == "ruleout" else "#ffffff"
        parts.append(f'<g><title>{tip}</title><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{category_color}" stroke-width="2.5"/>'
                     f'<rect x="{x}" y="{y}" width="8" height="{h}" rx="4" fill="{stripe}"/>'
                     f'<foreignObject x="{x + 20}" y="{y + 10}" width="{w - 32}" height="{h - 20}"><div xmlns="http://www.w3.org/1999/xhtml" class="card">'
                     f'<b>{html.escape(clip(d["question"], 90))}</b><span>{html.escape(clip(takeaway, 150))}</span>'
                     f'{"<i>📎 raw events</i>" if d.get("attachments") else ""}</div></foreignObject></g>')
    title = html.escape(canvas.get("name") or "Trajectory")
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><style>
body{{margin:0;font-family:-apple-system,"PingFang SC","Noto Sans SC",sans-serif;background:#f6f7f9;color:#1f2430}}
header{{padding:12px 20px;font-size:14px;border-bottom:1px solid #e2e5ea;background:#fff;position:sticky;top:0}}
header b{{font-size:16px;margin-right:12px}} .wrap{{overflow:auto;height:calc(100vh - 48px)}}
text.frame{{font-size:26px;font-weight:600;fill:#334155}}
.card{{font-size:15px;line-height:1.35;display:flex;flex-direction:column;gap:4px}} .card span{{color:#475569}} .card i{{font-size:12px;color:#94a3b8;font-style:normal}}
.note{{font-size:13.5px;line-height:1.35;color:#4b4020}}
</style></head><body><header><b>{title}</b>紫色实线：沿同一条线继续 · 橙色：分叉出去的尝试 · 虚线：观察 → 它推动的步骤 · 彩色框：阶段 · 悬停卡片看正文</header>
<div>节点边框：蓝=主 agent · 橙=工具 · 红=Review · 紫=可见思考 · 绿=输入 · 灰=状态。卡片内条带表示决策／转向／排除／未决。</div>
<div class="wrap"><svg xmlns="http://www.w3.org/2000/svg" width="{(x1 - x0) * 0.6:.0f}" height="{(y1 - y0) * 0.6:.0f}" viewBox="{x0} {y0} {x1 - x0} {y1 - y0}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#64748b"/></marker></defs>
{''.join(parts)}</svg></div></body></html>"""
    args.out.write_text(page)
    args.out.chmod(0o600)
    print(args.out)


if __name__ == "__main__":
    main()
