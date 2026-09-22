"""从生成的底图制作 macOS 应用图标。

生成服务的底图右下角带有品牌水印，且水印位于背景渐变上。由于背景是纯垂直渐变，
这里逐行采样左侧干净列重建背景，再按「信封 alpha」合成，从而完全去掉水印；
随后套用 macOS 的 superellipse 圆角遮罩，并按 Apple 的图标网格（824/1024）排布。
"""

import os
import shutil
import subprocess

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "build", "icon-source.png")
MASTER = os.path.join(ROOT, "build", "icon.png")
ICONSET = os.path.join(ROOT, "build", "icon.iconset")
ICNS = os.path.join(ROOT, "build", "icon.icns")

CANVAS = 1024
ARTWORK = 824          # Apple 图标网格中圆角方块占画布的比例
SQUIRCLE_N = 5.0       # Apple squircle 的指数
# 背景蓝 (B-R) 约为 197~223，白色信封约为 1，水印约为 115。
# 以 100 为界可把水印一并归入背景。
ALPHA_HIGH = 100.0
ALPHA_RANGE = 90.0


def squircle_mask(size: int, supersample: int = 4) -> Image.Image:
    big = size * supersample
    lin = (np.arange(big, dtype=np.float64) + 0.5) / big * 2.0 - 1.0
    x, y = np.meshgrid(lin, lin)
    radius = (np.abs(x) ** SQUIRCLE_N + np.abs(y) ** SQUIRCLE_N) ** (1.0 / SQUIRCLE_N)
    hard = (radius <= 1.0).astype(np.uint8) * 255
    return Image.fromarray(hard, mode="L").resize((size, size), Image.LANCZOS)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    pixels = np.asarray(source).astype(np.float32)
    height, width, _ = pixels.shape

    # 1) 逐行用左侧干净列重建背景渐变，天然抹掉右下角水印
    clean_columns = pixels[:, 2:42, :].mean(axis=1)          # (height, 3)
    background = np.repeat(clean_columns[:, None, :], width, axis=1)

    # 2) 由 B-R 推导信封的软 alpha：白色→1，背景与水印→0
    diff = pixels[:, :, 2] - pixels[:, :, 0]
    alpha = np.clip((ALPHA_HIGH - diff) / ALPHA_RANGE, 0.0, 1.0)[:, :, None]

    # 3) 合成：信封保留原像素，其余用干净渐变替换
    composed = pixels * alpha + background * (1.0 - alpha)
    composed = np.clip(composed, 0, 255).astype(np.uint8)

    artwork = Image.fromarray(composed, mode="RGB")
    print(f"源图 {width}x{height}，信封覆盖率 {(alpha > 0.5).mean() * 100:.1f}%")

    # 4) 套圆角遮罩并放入 Apple 图标网格
    artwork = artwork.resize((ARTWORK, ARTWORK), Image.LANCZOS).convert("RGBA")
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

    # 5) 生成 .iconset 并调用 iconutil 打包 icns
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
