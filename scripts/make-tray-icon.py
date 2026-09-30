"""生成菜单栏 / 任务栏图标。

macOS 菜单栏使用用户指定的 M 形 SVG 图标：按原路径坐标绘制成黑色模板图，
透明背景，系统自动染成菜单栏前景色；Windows / Linux 继续使用彩色实心信封。

8 倍超采样绘制再缩小，保证小尺寸边缘干净。1x 与 2x 必须成对产出，
加载侧按表示分离注册。
"""

import base64
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "resources")
SUPERSAMPLE = 8

# macOS 菜单栏规范：22pt 逻辑画布，SVG 的 1024×1024 图形映射到 18pt 安全区。
MAC_CANVAS = 22.0
MAC_SAFE_INSET = 2.0
MAC_SVG_SIZE = 1024.0

# Windows / Linux 沿用 16pt 托盘图标。
OTHER_CANVAS = 16.0
OTHER_BODY = (0.95, 3.45, 15.05, 12.95)
OTHER_RADIUS = 1.5
OTHER_GROOVE_WIDTH = 1.3
OTHER_GROOVE_BOTTOM = 9.7


def draw_menu_template(size: int) -> Image.Image:
    """macOS 模板图：把用户指定 SVG 的三个闭合子路径原样映射到 18pt 安全区。"""
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    inset = MAC_SAFE_INSET / MAC_CANVAS * canvas
    safe_size = (MAC_CANVAS - MAC_SAFE_INSET * 2) / MAC_CANVAS * canvas

    def point(x: float, y: float) -> tuple[float, float]:
        return (
            inset + x / MAC_SVG_SIZE * safe_size,
            inset + y / MAC_SVG_SIZE * safe_size,
        )

    # 原 SVG path 的三个子路径：上方 M 形折线、左柱、右柱。
    top = [
        point(295.152941, 0),
        point(519.529412, 224.376471),
        point(743.905882, 0),
        point(1024, 0),
        point(1024, 63.247059),
        point(519.529412, 567.717647),
        point(0, 49.694118),
        point(0, 0),
    ]
    left = [
        point(0, 256),
        point(243.952941, 499.952941),
        point(243.952941, 1024),
        point(0, 1024),
    ]
    right = [
        point(1024, 271.058824),
        point(1024, 1024),
        point(780.047059, 1024),
        point(780.047059, 515.011765),
    ]
    color = (0, 0, 0, 255)
    for polygon in (top, left, right):
        draw.polygon(polygon, fill=color)

    return image.resize((size, size), Image.LANCZOS)


def draw_envelope_filled(size: int) -> Image.Image:
    """Windows / Linux：透明底的蓝色实心信封。"""
    scale = size / OTHER_CANVAS
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def px(value: float) -> float:
        return value * scale * SUPERSAMPLE

    left, top, right, bottom = (px(v) for v in OTHER_BODY)
    draw.rounded_rectangle(
        [left, top, right, bottom], radius=px(OTHER_RADIUS), fill=(10, 132, 255, 255)
    )

    inset = px(OTHER_RADIUS) * 0.5
    mid_x = (left + right) / 2
    draw.line(
        [
            (left + inset, top + inset),
            (mid_x, px(OTHER_GROOVE_BOTTOM)),
            (right - inset, top + inset),
        ],
        fill=(0, 0, 0, 0),
        width=max(1, round(px(OTHER_GROOVE_WIDTH))),
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

    for suffix, size in (("", 22), ("@2x", 44)):
        path = os.path.join(OUT_DIR, f"trayTemplate{suffix}.png")
        draw_menu_template(size).save(path)
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
    preview.alpha_composite(
        draw_menu_template(22).resize((128, 128), Image.NEAREST),
        (40, 40),
    )
    preview.alpha_composite(
        draw_envelope_filled(16).resize((128, 128), Image.NEAREST),
        (200, 40),
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
