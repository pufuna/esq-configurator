from PIL import Image, ImageDraw, ImageFont
import numpy as np, sys
K = 4                                                        # масштаб
src = np.array(Image.open('clean.png').convert('RGB'))
src[:, 690:700] = 255                                        # остатки выносных у бокового вида
src[60:70, 540:552] = 255                                    # точка у вентилятора
im = Image.fromarray(src).resize((src.shape[1] * K, src.shape[0] * K), Image.LANCZOS)
# поля: снизу и справа место под размеры
W, H = im.size
canvas = Image.new('RGB', (W, H), 'white'); canvas.paste(im, (0, 0))
d = ImageDraw.Draw(canvas)
font = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 15 * K)
LW = max(1, int(0.9 * K)); A = 9 * K; AW = 2.2 * K
def arrow(x, y, dx, dy):                                     # острие в (x, y), направление (dx, dy) — куда смотрит
    px, py = -dy, dx
    d.polygon([(x, y), (x - dx * A + px * AW, y - dy * A + py * AW), (x - dx * A - px * AW, y - dy * A - py * AW)], fill='black')
def hdim(x0, x1, yobj, yl, txt):
    s = lambda v: v * K
    d.line([(s(x0), s(yobj + 3)), (s(x0), s(yl + 5))], fill='black', width=LW); d.line([(s(x1), s(yobj + 3)), (s(x1), s(yl + 5))], fill='black', width=LW)
    d.line([(s(x0), s(yl)), (s(x1), s(yl))], fill='black', width=LW); arrow(s(x0), s(yl), -1, 0); arrow(s(x1), s(yl), 1, 0)
    tw = d.textlength(txt, font=font); d.text(((s(x0) + s(x1) - tw) / 2, s(yl) - 20 * K), txt, font=font, fill='black')
def vdim(xobj0, xobj1, xl, y0, y1, txt):                     # y0 — низ, y1 — верх (в пикселях исходника)
    s = lambda v: v * K
    d.line([(s(xobj0 + 3), s(y0)), (s(xl + 5), s(y0))], fill='black', width=LW); d.line([(s(xobj1 + 3), s(y1)), (s(xl + 5), s(y1))], fill='black', width=LW)
    d.line([(s(xl), s(y0)), (s(xl), s(y1))], fill='black', width=LW); arrow(s(xl), s(y0), 0, 1); arrow(s(xl), s(y1), 0, -1)
    tw = int(d.textlength(txt, font=font)); t = Image.new('RGBA', (tw + 4, 20 * K), (255, 255, 255, 0))
    ImageDraw.Draw(t).text((2, 0), txt, font=font, fill='black'); t = t.rotate(90, expand=True)
    canvas.paste(t, (s(xl) - 21 * K, int((s(y0) + s(y1)) / 2 - t.size[1] / 2)), t)
Hh = sys.argv[1]
hdim(110, 563, 350, 395, '4500 (ПЧ)')
hdim(700, 846, 351, 395, '1500')
vdim(563, 552, 620, 350, 66, Hh)
canvas = canvas.crop((80 * K, 40 * K, 880 * K, 420 * K))
canvas.save(f'R_G1L_{Hh}.png'); canvas.save(f'R_G1L_{Hh}.pdf', resolution=72 * K * 1.0)
print(canvas.size)
