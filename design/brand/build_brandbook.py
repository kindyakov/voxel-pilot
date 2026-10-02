"""Build the review PDF and standalone HTML from the shared brand content and tokens.

Run with a Python environment containing reportlab and pypdf. Font paths default
to Windows system fonts; the PDF uses these fallbacks without installing fonts.
"""

import html
import json
from pathlib import Path

from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
TOKENS = json.loads((ROOT / "tokens.json").read_text(encoding="utf-8"))
CONTENT = json.loads((ROOT / "brandbook-content.json").read_text(encoding="utf-8"))
D = TOKENS["color"]["dark"]
L = TOKENS["color"]["light"]
B = TOKENS["color"]["brand"]
W, H = 1000, 700


def luminance(color):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb]
    return sum(a * b for a, b in zip(linear, (0.2126, 0.7152, 0.0722)))


def contrast(a, b):
    values = sorted((luminance(a), luminance(b)))
    return (values[1] + 0.05) / (values[0] + 0.05)


checks = []
for theme_name, theme in (("dark", D), ("light", L)):
    for background in ("background", "surface", "surfaceRaised"):
        for foreground in ("text", "textSecondary", "accentText", "success", "warning", "danger", "info"):
            ratio = contrast(theme[foreground], theme[background])
            assert ratio >= 4.5, (theme_name, foreground, background, ratio)
            checks.append((theme_name, foreground, background, ratio))
        for foreground in ("borderControl", "focus"):
            ratio = contrast(theme[foreground], theme[background])
            assert ratio >= 3, (theme_name, foreground, background, ratio)
            checks.append((theme_name, foreground, background, ratio))
for state in ("primary", "hover", "pressed"):
    ratio = contrast(B["onPrimary"], B[state])
    assert ratio >= 4.5, (state, ratio)
    checks.append(("brand", "onPrimary", state, ratio))

for name, filename in (("UI", "arial.ttf"), ("UIBold", "arialbd.ttf"), ("Mono", "consola.ttf")):
    pdfmetrics.registerFont(TTFont(name, str(Path("C:/Windows/Fonts") / filename)))

pdf_path = ROOT / "voxelpilot-brandbook.pdf"
c = canvas.Canvas(str(pdf_path), pagesize=(W, H))
c.setTitle("VoxelPilot - Брендбук и основа интерфейсов v0.1")
c.setAuthor("VoxelPilot")


def rect(x, top, width, height, fill, stroke=None, radius=0):
    c.setFillColor(HexColor(fill))
    c.setStrokeColor(HexColor(stroke or fill))
    if radius:
        c.roundRect(x, H - top - height, width, height, radius, fill=1, stroke=int(bool(stroke)))
    else:
        c.rect(x, H - top - height, width, height, fill=1, stroke=int(bool(stroke)))


def text(x, top, value, size=14, color=None, font="UI"):
    c.setFillColor(HexColor(color or D["text"]))
    c.setFont(font, size)
    c.drawString(x, H - top - size, value)


def para(x, top, value, width, size=13, color=None, max_height=None):
    style = ParagraphStyle("body", fontName="UI", fontSize=size, leading=size * 1.45,
                           textColor=HexColor(color or D["textSecondary"]))
    p = Paragraph(html.escape(value).replace("\n", "<br/>"), style)
    _, height = p.wrap(width, H)
    if max_height is not None:
        assert height <= max_height, (value[:60], height, max_height)
    p.drawOn(c, x, H - top - height)
    return height


def button(x, top, label, fill=None, secondary=False):
    width = max(140, pdfmetrics.stringWidth(label, "UIBold", 14) + 32)
    rect(x, top, width, 40, fill or (D["surface"] if secondary else B["primary"]),
         D["borderControl"] if secondary else None, 8)
    text(x + 16, top + 10, label, 14, D["text"] if secondary else B["onPrimary"], "UIBold")
    return width


def card(x, title, body):
    rect(x, 467, 288, 180, D["surface"], radius=12)
    text(x + 18, 485, title, 15, font="UIBold")
    para(x + 18, 516, body, 252, 11, max_height=119)


def swatch(x, top, color, label, width=140):
    rect(x, top, width, 54, color, radius=8)
    text(x, top + 64, label, 12)
    text(x, top + 84, color, 12, D["textSecondary"], "Mono")


def mock_tui(x=48, top=213, width=904, height=239, compact=False):
    rect(x, top, width, height, D["background"], D["borderControl"], 0)
    text(x + 18, top + 13, "VoxelPilot", 16, D["accentText"], "Mono")
    text(x + width - 80, top + 16, "LIVE", 12, D["textSecondary"], "Mono")
    rect(x + 1, top + 42, width - 2, 1, D["borderDecorative"])
    sidebar = 296
    split = x + width - sidebar
    rect(split, top + 43, 1, height - 73, D["borderDecorative"])
    lines = ["13:20:39 INFO  CORE   Запуск бота...", "13:20:40 INFO  CORE   Бот заспавнился",
             "13:20:40 INFO  HSM    MAIN_ACTIVITY.IDLE", "13:21:00 INFO  HSM    heartbeat / active"]
    for i, line in enumerate(lines):
        text(x + 18, top + 62 + i * 27, line, 13, D["text"], "Mono")
    for i, line in enumerate(["HP 20/20     Сытость 20/20", "XYZ 169.44 68 48.35", "HSM MAIN_ACTIVITY.IDLE",
                              "Мониторинг RUNNING", "Цель: -"]):
        text(split + 16, top + 60 + i * 25, line, 12.5, D["accentText"] if i == 2 else D["text"], "Mono")
    rect(x + 1, top + height - 31, width - 2, 1, D["borderDecorative"])
    text(x + 18, top + height - 23, "PgUp/PgDn история   End LIVE   Enter детали   / поиск   F фильтр", 11,
         D["textSecondary"], "Mono")


def figure(kind, page):
    if kind == "cover":
        rect(48, 243, 220, 192, B["primary"], radius=12)
        text(70, 266, "BRAND PRIMARY", 12, B["onPrimary"], "Mono")
        text(70, 319, "#DB143C", 30, B["onPrimary"], "UIBold")
        text(305, 253, "VoxelPilot", 67, font="UIBold")
        rect(307, 341, 42, 4, B["primary"])
        para(307, 364, "Текстовая подпись до разработки логотипа.\nБез маскота. Без коричневого фона.", 560, 16)
    elif kind == "palette":
        roles = [(B["primary"], "Бренд"), (D["accentText"], "Текстовый акцент"),
                 (D["background"], "Тёмный фон"), (D["surface"], "Поверхность"),
                 (D["text"], "Основной текст"), (D["textSecondary"], "Вторичный текст")]
        for i, (value, label) in enumerate(roles):
            swatch(48 + i * 153, 209, value, label, 138)
        rect(48, 327, 442, 125, L["surface"], radius=12)
        text(67, 341, "СВЕТЛАЯ ТЕМА", 11, L["textSecondary"], "Mono")
        text(67, 367, "VoxelPilot", 25, L["text"], "UIBold")
        text(67, 405, "Акцент #DB143C / текст #17191F", 12, L["accentText"], "Mono")
        rect(510, 327, 442, 125, D["surface"], radius=12)
        text(529, 341, "ТЁМНАЯ ТЕМА", 11, D["textSecondary"], "Mono")
        text(529, 367, "VoxelPilot", 25, D["text"], "UIBold")
        text(529, 405, "Акцент текста #FF5277", 12, D["accentText"], "Mono")
    elif kind == "type":
        text(48, 213, "VoxelPilot", 48, font="UIBold")
        text(48, 282, "Управление ботом", 32, font="UIBold")
        text(48, 333, "Состояние и цель", 24, font="UIBold")
        text(48, 376, "Понятные подписи. Читаемые значения.", 16)
        text(48, 414, "HP 20/20  XYZ 169.44 68 48.35", 16, D["accentText"], "Mono")
        rect(650, 212, 302, 240, D["surface"], radius=12)
        text(670, 230, "РИТМ И ФОРМА", 12, D["textSecondary"], "Mono")
        for i, size in enumerate((4, 8, 12, 16, 24, 32, 48)):
            rect(670, 267 + i * 22, size * 3, 8, D["accentText"])
            text(825, 262 + i * 22, f"{size} px", 12, D["textSecondary"], "Mono")
    elif kind == "components":
        text(48, 210, "DEFAULT", 11, D["textSecondary"], "Mono")
        button(48, 237, "О проекте")
        text(228, 210, "HOVER", 11, D["textSecondary"], "Mono")
        button(228, 237, "О проекте", B["hover"])
        text(408, 210, "PRESSED", 11, D["textSecondary"], "Mono")
        button(408, 237, "О проекте", B["pressed"])
        button(620, 237, "Подробнее", secondary=True)
        rect(48, 318, 420, 134, D["surface"], D["borderControl"], 12)
        text(69, 333, "Название подключения", 14, font="UIBold")
        rect(69, 371, 378, 44, D["background"], D["borderControl"], 8)
        text(84, 382, "Локальный сервер", 14)
        rect(510, 318, 442, 134, D["surface"], radius=12)
        text(530, 335, "ВЫБОР И ФОКУС", 11, D["textSecondary"], "Mono")
        rect(530, 371, 185, 44, D["accentSubtle"], D["focus"], 8)
        text(544, 383, "> Состояние бота", 14, D["accentText"], "UIBold")
        text(735, 383, "Журнал", 14, D["textSecondary"])
    elif kind == "status":
        rect(48, 208, 442, 244, D["surface"], radius=12)
        text(68, 224, "УРОВЕНЬ + ТЕКСТ", 11, D["textSecondary"], "Mono")
        for i, (label, role, message) in enumerate([
            ("INFO", "text", "Бот заспавнился"), ("DEBUG", "textSecondary", "gaze_target / player"),
            ("WARN", "warning", "Данные неактуальны"), ("ERROR", "danger", "Ошибка подключения")]):
            text(68, 266 + i * 39, label, 14, D[role], "Mono")
            text(147, 267 + i * 39, message, 13)
        rect(510, 208, 442, 244, D["surface"], radius=12)
        text(530, 224, "СЕМАНТИЧЕСКИЕ ЦВЕТА", 11, D["textSecondary"], "Mono")
        for i, (label, role) in enumerate([("Норма", "success"), ("Предупреждение", "warning"),
                                           ("Ошибка", "danger"), ("Информация", "info")]):
            rect(530, 265 + i * 40, 20, 20, D[role], radius=4)
            text(565, 265 + i * 40, label, 14)
            text(823, 266 + i * 40, D[role], 12, D["textSecondary"], "Mono")
    elif kind == "applications":
        rect(48, 208, 442, 244, L["surface"], radius=12)
        text(68, 222, "САЙТ / СХЕМАТИЧНЫЙ ПРИМЕР", 11, L["textSecondary"], "Mono")
        text(68, 252, "VoxelPilot", 22, L["text"], "UIBold")
        text(68, 298, "Игровой бот Minecraft", 28, L["text"], "UIBold")
        para(68, 340, "Выполняет поручения игроков.\nСостояние и цель всегда под рукой.", 390, 14, L["textSecondary"])
        button(68, 398, "О проекте")
        rect(510, 208, 442, 244, D["surface"], radius=12)
        text(530, 222, "GUI / СХЕМАТИЧНЫЙ ПРИМЕР", 11, D["textSecondary"], "Mono")
        text(530, 255, "Состояние бота", 24, font="UIBold")
        for i, line in enumerate(["HP 20/20    Сытость 20/20", "XYZ 169.44 68 48.35", "HSM MAIN_ACTIVITY.IDLE", "Цель: -"]):
            text(530, 303 + i * 31, line, 15, D["accentText"] if i == 2 else D["text"], "Mono")
    elif kind == "tui":
        mock_tui()
    elif kind == "handoff":
        rect(48, 208, 442, 244, D["surface"], radius=12)
        text(68, 226, "ИСТОЧНИКИ СИСТЕМЫ", 11, D["textSecondary"], "Mono")
        for i, name in enumerate(["tokens.json", "brandbook-content.json", "build_brandbook.py", "voxelpilot-brandbook.html", "voxelpilot-brandbook.pdf"]):
            text(68, 265 + i * 31, name, 15, D["accentText"] if i == 0 else D["text"], "Mono")
        text(510, 211, "Официальные справочные источники", 17, font="UIBold")
        for i, (label, url) in enumerate(page["sources"]):
            top = 250 + i * 53
            text(510, top, label, 14, D["accentText"])
            c.linkURL(url, (510, H - top - 22, 952, H - top + 3), relative=0)
        para(510, 415, "В PDF используются системные Arial и Consolas. В продуктовых интерфейсах рекомендуются Inter и JetBrains Mono.", 442, 10.5, max_height=34)


for index, page in enumerate(CONTENT["pages"], 1):
    rect(0, 0, W, H, D["background"])
    rect(48, 34, 34, 4, B["primary"])
    text(94, 28, "VoxelPilot", 14, font="UIBold")
    text(744, 30, page["kicker"], 11, D["textSecondary"], "Mono")
    title = page["title"].replace("\n", " ")
    text(48, 76, title, 32, font="UIBold")
    para(48, 132, page["intro"], 904, 14, max_height=66)
    figure(page["kind"], page)
    for i, (heading, body) in enumerate(page["cards"]):
        card(48 + 308 * i, heading, body)
    text(48, 673, "Брендбук / " + CONTENT["version"] + " / Маскот и знак отложены", 10, D["textSecondary"])
    text(880, 672, f"{index:02d} / 08", 11, D["textSecondary"], "Mono")
    c.showPage()
c.save()


def esc(value):
    return html.escape(value)


def html_figure(kind):
    if kind in ("cover", "palette"):
        swatches = [(B["primary"], "Бренд"), (D["accentText"], "Акцент на тёмном"), (D["background"], "Фон"),
                    (D["surface"], "Поверхность"), (D["text"], "Текст"), (D["textSecondary"], "Вторичный")]
        return '<div class="swatches">' + ''.join(f'<div><span style="background:{color}"></span><b>{label}</b><code>{color}</code></div>' for color, label in swatches) + '</div>'
    if kind == "type":
        return '<div class="type-sample"><strong>VoxelPilot</strong><h3>Состояние и цель</h3><p>Понятные подписи. Читаемые значения.</p><code>HP 20/20 / XYZ 169.44 68 48.35</code></div>'
    if kind == "components":
        return '<div class="examples"><button>О проекте</button><button class="hover">Hover</button><button class="pressed">Pressed</button><button class="secondary">Подробнее</button><span class="selected">&gt; Состояние бота</span></div><p class="note">Образцы оформления; элементы не управляют ботом.</p>'
    if kind == "status":
        return '<div class="examples">' + ''.join(f'<span class="status" style="color:{D[role]}">{label}</span>' for label, role in [("INFO", "text"), ("DEBUG", "textSecondary"), ("OK / Норма", "success"), ("WARN / Предупреждение", "warning"), ("ERROR / Ошибка", "danger")]) + '</div>'
    if kind in ("tui", "applications"):
        return '<div class="terminal"><div class="terminal-head">VoxelPilot <span>LIVE / пример</span></div><div class="terminal-body"><pre>13:20:39 INFO  CORE  Запуск бота...\n13:20:40 INFO  CORE  Бот заспавнился\n13:20:40 INFO  HSM   MAIN_ACTIVITY.IDLE\n13:21:00 INFO  HSM   heartbeat / active</pre><pre>HP 20/20   Сытость 20/20\nXYZ 169.44 68 48.35\nHSM MAIN_ACTIVITY.IDLE\nМониторинг RUNNING\nЦель: -</pre></div><div class="terminal-foot">PgUp/PgDn история / End LIVE / Enter детали</div></div>'
    return '<div class="files"><code>tokens.json</code><code>brandbook-content.json</code><code>build_brandbook.py</code></div>'


sections = []
for page in CONTENT["pages"]:
    cards = ''.join(f'<article><h3>{esc(title)}</h3><p>{esc(body)}</p></article>' for title, body in page["cards"])
    sources = ''.join(f'<a href="{esc(url)}">{esc(label)}</a>' for label, url in page.get("sources", []))
    sections.append(f'<section><p class="kicker">{esc(page["kicker"])}</p><h2>{esc(page["title"]).replace(chr(10), " ")}</h2><p class="intro">{esc(page["intro"])}</p>{html_figure(page["kind"])}<div class="cards">{cards}</div><div class="sources">{sources}</div></section>')

document = '''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VoxelPilot / Брендбук 0.1</title><style>
:root{color-scheme:dark;--bg:#101114;--surface:#181A20;--text:#F4F5F7;--muted:#A2A8B4;--brand:#DB143C;--accent:#FF5277;--border:#343843}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,"Segoe UI",Arial,sans-serif;line-height:1.5}main{max-width:1200px;margin:auto;padding:48px 24px}header{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid var(--border);padding-bottom:24px}header b{font-size:24px}header span{color:var(--muted)}section{padding:48px 0;border-bottom:1px solid var(--border);break-inside:avoid}.kicker{font:12px Consolas,monospace;color:var(--accent);letter-spacing:.08em}h2{font-size:36px;line-height:1.2;margin:16px 0}h3{margin:0 0 12px;font-size:18px}.intro{max-width:900px;font-size:18px;color:var(--muted);margin-bottom:32px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:32px}article{background:var(--surface);padding:24px;border-radius:12px}article p{color:var(--muted);margin:0;font-size:14px}.swatches{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}.swatches span{display:block;height:80px;border-radius:8px;border:1px solid var(--border);margin-bottom:12px}.swatches b,.swatches code{display:block;font-size:13px}code,pre{font-family:"JetBrains Mono","Cascadia Mono",Consolas,monospace}.swatches code{color:var(--muted);margin-top:8px}.type-sample strong{font-size:48px}.type-sample h3{font-size:24px;margin-top:20px}.type-sample code{color:var(--accent)}.examples{display:flex;flex-wrap:wrap;gap:20px;align-items:center}button{border:0;border-radius:8px;background:var(--brand);color:white;padding:10px 16px;min-height:40px;font:600 14px Inter,"Segoe UI",Arial,sans-serif;cursor:default}button.hover{background:#C81036}button.pressed{background:#B20F30}button.secondary{background:var(--surface);border:1px solid #697386;color:var(--text)}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.selected{padding:10px 16px;background:#301820;color:var(--accent);border:2px solid var(--accent);border-radius:8px}.note{font-size:12px;color:var(--muted)}.status{font:16px Consolas,monospace;padding:16px;background:var(--surface);border-radius:8px}.terminal{border:1px solid #697386;font-family:Consolas,monospace}.terminal-head{padding:16px;color:var(--accent);border-bottom:1px solid var(--border)}.terminal-head span{float:right;color:var(--muted);font-size:12px}.terminal-body{display:grid;grid-template-columns:1fr 34ch}.terminal pre{font-size:14px;padding:20px;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.terminal pre+pre{border-left:1px solid var(--border)}.terminal-foot{border-top:1px solid var(--border);padding:12px 16px;font-size:12px;color:var(--muted)}.files{display:flex;flex-wrap:wrap;gap:24px;color:var(--accent)}.sources{display:flex;flex-wrap:wrap;gap:24px;margin-top:24px}.sources a{color:var(--accent);font-size:13px}footer{padding-top:24px;color:var(--muted);font-size:13px}@media(max-width:800px){main{padding:24px 16px}h2{font-size:28px}.cards{grid-template-columns:1fr}.swatches{grid-template-columns:repeat(3,1fr)}.terminal-body{grid-template-columns:1fr}.terminal pre+pre{border-left:0;border-top:1px solid var(--border)}header{flex-direction:column}.intro{font-size:16px}}@media print{main{padding:0}section{page-break-after:always}.cards{grid-template-columns:repeat(3,1fr)}}
</style></head><body><main><header><b>VoxelPilot</b><span>Брендбук / версия 0.1 / 02.10.2026</span></header>''' + ''.join(sections) + '''<footer>Малиновый и нейтральный графит выбраны пользователем. Остальные правила - стартовая система. Маскот и графический знак отложены. Данные и интерфейсы в примерах иллюстративные.</footer></main></body></html>'''
(ROOT / "voxelpilot-brandbook.html").write_text(document, encoding="utf-8")

reader = PdfReader(pdf_path)
assert len(reader.pages) == 8
all_text = "\n".join(page.extract_text() or "" for page in reader.pages)
for expected in ("#DB143C", "#FF5277", "Цвет - по роли", "Маскот", "120", "tokens.json"):
    assert expected in all_text, expected
assert all((page.extract_text() or "").strip() for page in reader.pages)
print(json.dumps({"pages": len(reader.pages), "contrast_pairs_checked": len(checks),
                  "minimum_text_ratio": round(min(x[3] for x in checks if x[1] not in ("borderControl", "focus")), 2),
                  "pdf": str(pdf_path), "html": str(ROOT / "voxelpilot-brandbook.html")}, ensure_ascii=False))
