"""生成 macOS 菜单栏用的模板图标。

模板图必须是「纯黑 + alpha」：系统会用它作为遮罩，自动适配浅色/深色菜单栏。
用 8 倍超采样绘制再缩下来，保证 16px 下边缘依然干净。
"""

import base64
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "resources")
SUPERSAMPLE = 8


def draw_envelope(size: int) -> Image.Image:
    """在 size x size 的画布上画一个信封轮廓。"""
    scale = size / 16.0
    image = Image.new("L", (size * SUPERSAMPLE, size * SUPERSAMPLE), 0)
    draw = ImageDraw.Draw(image)

    def px(value: float) -> float:
        return value * scale * SUPERSAMPLE

    stroke = max(1, round(1.15 * scale * SUPERSAMPLE))
    left, top, right, bottom = px(1.6), px(4.2), px(14.4), px(12.6)
    radius = px(1.2)

    # 信封主体
    draw.rounded_rectangle(
        [left, top, right, bottom], radius=radius, outline=255, width=stroke
    )
    # 折盖：从左上到中点再到右上
    mid_x, mid_y = (left + right) / 2, px(8.9)
    draw.line([(left, top), (mid_x, mid_y), (right, top)], fill=255, width=stroke, joint="curve")

    # 让线条端点圆润一点，避免小尺寸下出现尖角
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for suffix, size in (("", 16), ("@2x", 32)):
        icon = draw_envelope(size)
        path = os.path.join(OUT_DIR, f"trayTemplate{suffix}.png")
        icon.save(path)
        raw = open(path, "rb").read()
        print(f"{path}  {size}x{size}  {len(raw)} 字节  base64 {len(base64.b64encode(raw))} 字符")

    preview = draw_envelope(16).resize((256, 256), Image.NEAREST)
    preview.save(os.path.join(OUT_DIR, "trayTemplate-preview.png"))
    print("已输出预览图 resources/trayTemplate-preview.png")


if __name__ == "__main__":
    main()
