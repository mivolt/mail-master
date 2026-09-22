"""生成菜单栏 / 任务栏图标。

macOS 用模板图（纯黑 + alpha，系统当遮罩用，自动适配深浅色菜单栏）；
Windows 不支持模板图，必须用彩色实心图标，否则深色任务栏上看不见。

用 8 倍超采样绘制再缩下来，保证 16px 下边缘依然干净。
"""

import base64
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "resources")
SUPERSAMPLE = 8


def draw_envelope_outline(size: int) -> Image.Image:
    """macOS 模板图：信封轮廓，纯黑 + alpha。"""
    scale = size / 16.0
    image = Image.new("L", (size * SUPERSAMPLE, size * SUPERSAMPLE), 0)
    draw = ImageDraw.Draw(image)

    def px(value: float) -> float:
        return value * scale * SUPERSAMPLE

    stroke = max(1, round(1.15 * scale * SUPERSAMPLE))
    left, top, right, bottom = px(1.6), px(4.2), px(14.4), px(12.6)
    radius = px(1.2)

    draw.rounded_rectangle(
        [left, top, right, bottom], radius=radius, outline=255, width=stroke
    )
    mid_x, mid_y = (left + right) / 2, px(8.9)
    draw.line([(left, top), (mid_x, mid_y), (right, top)], fill=255, width=stroke, joint="curve")

    return image.resize((size, size), Image.LANCZOS)


def draw_envelope_filled(size: int) -> Image.Image:
    """Windows 任务栏图标：彩色实心信封，浅色与深色任务栏都能看清。"""
    scale = size / 16.0
    image = Image.new("RGBA", (size * SUPERSAMPLE, size * SUPERSAMPLE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def px(value: float) -> float:
        return value * scale * SUPERSAMPLE

    stroke = max(1, round(1.5 * scale * SUPERSAMPLE))
    left, top, right, bottom = px(1.3), px(3.7), px(14.7), px(12.7)
    radius = px(1.5)

    draw.rounded_rectangle([left, top, right, bottom], radius=radius, fill=(10, 132, 255, 255))

    # 折盖用深一档的蓝，制造层次；两端内缩避免戳出圆角
    inset = radius * 0.45
    mid_x, mid_y = (left + right) / 2, px(9.2)
    draw.line(
        [(left + inset, top + inset), (mid_x, mid_y), (right - inset, top + inset)],
        fill=(0, 96, 223, 255),
        width=stroke,
        joint="curve",
    )

    return image.resize((size, size), Image.LANCZOS)


def draw_badge(size: int, label: str) -> Image.Image:
    """Windows 任务栏叠加角标：红底白字。

    主进程里没有 canvas，无法运行时绘制文字，所以数字要预先出图。
    """
    scale = 4
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # 红底圆
    draw.ellipse([0, 0, canvas - 1, canvas - 1], fill=(232, 17, 35, 255))

    font = None
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ):
        if os.path.exists(candidate):
            try:
                font = ImageFont.truetype(candidate, int(canvas * 0.68))
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()

    box = draw.textbbox((0, 0), label, font=font)
    draw.text(
        ((canvas - (box[2] - box[0])) / 2 - box[0], (canvas - (box[3] - box[1])) / 2 - box[1]),
        label,
        font=font,
        fill=(255, 255, 255, 255),
    )
    return image.resize((size, size), Image.LANCZOS)


def report(path: str, size: int) -> None:
    raw = open(path, "rb").read()
    print(f"{path}  {size}x{size}  {len(raw)} 字节  base64 {len(base64.b64encode(raw))} 字符")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    for suffix, size in (("", 16), ("@2x", 32)):
        path = os.path.join(OUT_DIR, f"trayTemplate{suffix}.png")
        draw_envelope_outline(size).save(path)
        report(path, size)

    for suffix, size in (("", 16), ("@2x", 32)):
        path = os.path.join(OUT_DIR, f"trayWindows{suffix}.png")
        draw_envelope_filled(size).save(path)
        report(path, size)

    # Windows 任务栏角标：1-9 与 9+，共 10 张
    badge_dir = os.path.join(OUT_DIR, "badges")
    os.makedirs(badge_dir, exist_ok=True)
    total = 0
    for label in [str(n) for n in range(1, 10)] + ["9+"]:
        path = os.path.join(badge_dir, f"badge-{label.replace('+', 'plus')}.png")
        draw_badge(32, label).save(path)
        total += os.path.getsize(path)
    print(f"已写出 {badge_dir}/ 共 10 张角标，合计 {total // 1024} KB")

    preview = Image.new("RGBA", (540, 260), (245, 245, 247, 255))
    preview.paste(
        draw_envelope_outline(16).resize((128, 128), Image.NEAREST).convert("RGBA"), (40, 40)
    )
    preview.paste(
        draw_envelope_filled(16).resize((128, 128), Image.NEAREST).convert("RGBA"), (200, 40)
    )
    dark = Image.new("RGBA", (128, 128), (32, 32, 34, 255))
    dark.alpha_composite(draw_envelope_filled(16).resize((128, 128), Image.NEAREST))
    preview.paste(dark, (360, 40))
    preview.paste(draw_badge(32, "7").resize((128, 128), Image.LANCZOS), (40, 190))
    preview.paste(draw_badge(32, "9+").resize((128, 128), Image.LANCZOS), (200, 190))
    preview.save(os.path.join(OUT_DIR, "tray-icons-preview.png"))
    print("预览图：resources/tray-icons-preview.png")


if __name__ == "__main__":
    main()
