"""制作 macOS / Windows / Linux 应用图标。

信封图形（项目 logo，用户提供并指定的 SVG）由 make-icon-envelope.cjs 用
sharp 渲染成白色透明底位图；这里为它合成品牌蓝垂直渐变背景，套用 macOS
的 superellipse 圆角遮罩，并按 Apple 的图标网格（824/1024）排布，
最后产出 .icns / .ico / iconset 全套。
"""

import os
import shutil
import subprocess

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENVELOPE = os.path.join(ROOT, "build", "envelope-alpha.png")
MASTER = os.path.join(ROOT, "build", "icon.png")
ICONSET = os.path.join(ROOT, "build", "icon.iconset")
ICNS = os.path.join(ROOT, "build", "icon.icns")

CANVAS = 1024
ARTWORK = 824          # Apple 图标网格中圆角方块占画布的比例
SQUIRCLE_N = 5.0       # Apple squircle 的指数
GRADIENT_TOP = (62, 155, 255)     # #3E9BFF
GRADIENT_BOTTOM = (11, 98, 232)   # #0B62E8


def squircle_mask(size: int, supersample: int = 4) -> Image.Image:
    big = size * supersample
    lin = (np.arange(big, dtype=np.float64) + 0.5) / big * 2.0 - 1.0
    x, y = np.meshgrid(lin, lin)
    radius = (np.abs(x) ** SQUIRCLE_N + np.abs(y) ** SQUIRCLE_N) ** (1.0 / SQUIRCLE_N)
    hard = (radius <= 1.0).astype(np.uint8) * 255
    return Image.fromarray(hard, mode="L").resize((size, size), Image.LANCZOS)


def main() -> None:
    envelope = Image.open(ENVELOPE).convert("RGBA")

    # 1) 品牌蓝垂直渐变背景
    rows = np.linspace(0.0, 1.0, CANVAS)[:, None]
    top = np.asarray(GRADIENT_TOP, dtype=np.float32)
    bottom = np.asarray(GRADIENT_BOTTOM, dtype=np.float32)
    background = (top * (1.0 - rows) + bottom * rows)[:, None, :]
    background = np.repeat(background, CANVAS, axis=1).astype(np.uint8)
    artwork = Image.fromarray(background, mode="RGB").convert("RGBA")

    # 2) 白色信封居中（源图 bbox 垂直中心略偏下，向上补一点视觉平衡）
    offset_x = (CANVAS - envelope.width) // 2
    offset_y = (CANVAS - envelope.height) // 2 - 6
    artwork.alpha_composite(envelope, (offset_x, offset_y))

    # 3) 套圆角遮罩并放入 Apple 图标网格
    artwork = artwork.resize((ARTWORK, ARTWORK), Image.LANCZOS)
    artwork.putalpha(squircle_mask(ARTWORK))

    master = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    offset = (CANVAS - ARTWORK) // 2
    master.paste(artwork, (offset, offset), artwork)
    master.save(MASTER)
    print(f"已写出 {MASTER}")

    # Windows 需要 .ico：单文件内含多档尺寸，任务栏/资源管理器/alt-tab 各取所需
    ico_path = os.path.join(ROOT, "build", "icon.ico")
    master.resize((256, 256), Image.LANCZOS).save(
        ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print(f"已写出 {ico_path}（{os.path.getsize(ico_path) // 1024} KB）")

    # 4) 生成 .iconset 并调用 iconutil 打包 icns
    if os.path.isdir(ICONSET):
        shutil.rmtree(ICONSET)
    os.makedirs(ICONSET)

    for base in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            size = base * scale
            suffix = f"@{scale}x" if scale == 2 else ""
            target = os.path.join(ICONSET, f"icon_{base}x{base}{suffix}.png")
            master.resize((size, size), Image.LANCZOS).save(target)

    subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", ICNS], check=True)
    print(f"已写出 {ICNS}（{os.path.getsize(ICNS) // 1024} KB）")


if __name__ == "__main__":
    main()
