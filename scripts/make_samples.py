# Генерация прайсов лаборатории с встроенными фото (A №, B сорт, C фото, D упаковка, E цена)
import io, math, random, sys
from PIL import Image as PImage, ImageDraw
from openpyxl import Workbook
from openpyxl.drawing.image import Image as XImage
from openpyxl.styles import Font, Alignment

def leaf_img(seed, hue_rgb, varieg):
    rnd = random.Random(seed)
    W = H = 220
    im = PImage.new('RGB', (W, H), (244, 239, 226))
    d = ImageDraw.Draw(im)
    d.rectangle([70, 160, 150, 215], fill=(176, 120, 86))
    d.rectangle([62, 152, 158, 168], fill=(150, 98, 70))
    for k in range(3):
        ang = -0.9 + k * 0.9 + rnd.uniform(-0.15, 0.15)
        cx, cy = 110 + math.sin(ang) * 50, 120 - math.cos(ang) * 55
        pts = []
        for t in range(0, 361, 10):
            r = math.radians(t)
            x = math.sin(r) * 34
            y = -math.cos(r) * 52
            x *= 1 - 0.25 * max(0, -math.cos(r))
            px = cx + x * math.cos(ang) - y * math.sin(ang)
            py = cy + x * math.sin(ang) + y * math.cos(ang)
            pts.append((px, py))
        d.line([(110, 160), (cx, cy)], fill=(70, 110, 60), width=4)
        d.polygon(pts, fill=hue_rgb)
        if varieg:
            for _ in range(5):
                bx, by = cx + rnd.uniform(-22, 22), cy + rnd.uniform(-30, 30)
                rr = rnd.uniform(5, 13)
                d.ellipse([bx - rr, by - rr, bx + rr, by + rr], fill=varieg)
        d.line([(cx - math.sin(ang) * -48, cy + math.cos(ang) * -48), (cx + math.sin(ang) * -40, cy - math.cos(ang) * -40)], fill=(40, 80, 40), width=2)
    b = io.BytesIO(); im.save(b, 'PNG'); b.seek(0)
    return b

def build(path, rows):
    wb = Workbook(); ws = wb.active; ws.title = 'Прайс'
    ws.append(['№', 'Сорт', 'Фото взрослого растения', 'Количество в упаковке', 'Цена'])
    for c in 'ABCDE': ws[f'{c}1'].font = Font(bold=True)
    ws.column_dimensions['B'].width = 40; ws.column_dimensions['C'].width = 22; ws.column_dimensions['D'].width = 26; ws.column_dimensions['E'].width = 14
    for i, (name, pack, price, img) in enumerate(rows, start=2):
        ws.cell(i, 1, i - 1); ws.cell(i, 2, name); ws.cell(i, 4, pack); ws.cell(i, 5, price)
        ws.row_dimensions[i].height = 118
        for c in 'ABDE': ws[f'{c}{i}'].alignment = Alignment(vertical='center', wrap_text=True)
        if img:
            x = XImage(leaf_img(*img)); x.width = 150; x.height = 150
            ws.add_image(x, f'C{i}')
    wb.save(path)

G = (46, 120, 74); D = (32, 90, 60); L = (88, 150, 90)
W_ = (246, 244, 232); P = (232, 150, 170); Y = (226, 205, 110); M = (190, 220, 170)
v1 = [
    ("Monstera 'Thai Constellation'", '5 растений в упаковке', '6 240руб.', (1, G, W_)),
    ('Philodendron «Pink Princess»', 'упаковка 5 шт', '2 400руб.', (2, D, P)),
    ('Anthurium Clarinervium', '1 растение', '1 100руб.', (3, D, None)),
    ('Anthurium Clarinervium', '5 шт.', '4 900руб.', (4, D, None)),
    ('Alocasia Silver Dragon', 'пять растений', '3 800 руб.', (5, (120, 150, 130), None)),
    ('Philodendron Gloriosum', '10 растений в упаковке', '7 500руб.', (6, G, None)),
    ("Syngonium 'Three Kings'", '1 шт', '', (7, L, W_)),
    ('Monstera Adansonii Variegata', '1 растение', '2 900руб.', None),
    ('Hoya Kerrii Variegata', '5 шт', '1 800руб.', (9, L, Y)),
    ('Philodendron «Pink Princess»', 'упаковка 5 шт', '2 400руб.', (10, D, P)),
]
v2 = [r for r in v1 if r[0] != "Syngonium 'Three Kings'"]
v2[2] = ('Anthurium Clarinervium', '1 растение', '1 250руб.', (3, D, None))
v2.append(("Syngonium 'Three Kings'", '1 шт', '1 400руб.', (7, L, W_)))
v2.append(("Begonia 'Polka Dot'", 'три растения', '1 500руб.', (12, (60, 100, 70), M)))
build(sys.argv[1] + '/alfa_price_okt.xlsx', v1)
build(sys.argv[1] + '/alfa_price_nov.xlsx', v2)
print('ok')
