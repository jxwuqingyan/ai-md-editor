#!/usr/bin/env python3
"""生成安装窗口背景图（纯标准库，无第三方依赖）。

输出 build/dmg-background.png：浅色底 + 一个指向 Applications 的灰色箭头。
尺寸按 Finder 图标视图内容区 540×380，箭头与图标在同一水平线上
（图标中心 y=150，应用在 x=140，Applications 在 x=400）。
"""
import struct
import zlib
from pathlib import Path

W, H = 540, 380
SS = 3  # 超采样倍数，边缘更平滑

# 配色（与浅色主题一致，低调不抢图标）
BG = (250, 250, 251)
ARROW = (188, 194, 204)

# 箭头几何：杆 + 三角头，水平指向右
SHAFT_X0, SHAFT_X1 = 206, 322
SHAFT_HALF = 5.5
HEAD_X, HEAD_HALF = 342, 18.0
HEAD_BACK_X = 300  # 三角头起点
CY = 150


def in_arrow(x: float, y: float) -> bool:
    """点是否落在箭头形状内。"""
    dx = abs(y - CY)
    # 杆
    if SHAFT_X0 <= x <= SHAFT_X1 and dx <= SHAFT_HALF:
        return True
    # 三角头（从左边缘线性收窄到右尖）
    if HEAD_BACK_X <= x <= HEAD_X:
        t = (x - HEAD_BACK_X) / (HEAD_X - HEAD_BACK_X)
        if dx <= HEAD_HALF * (1 - t):
            return True
    return False


def render() -> bytes:
    """按 SS 倍超采样绘制后求平均，得到抗锯齿的 RGB 像素。"""
    rows = []
    for py in range(H):
        row = bytearray()
        for px in range(W):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    color = ARROW if in_arrow(x, y) else BG
                    for i in range(3):
                        acc[i] += color[i]
            n = SS * SS
            row.extend(acc[i] // n for i in range(3))
        rows.append(bytes(row))
    raw = b"".join(b"\x00" + r for r in rows)
    return raw


def png(width: int, height: int, raw: bytes) -> bytes:
    """组装最小 PNG（8 位 RGB，无滤波）。"""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out = root / "build" / "dmg-background.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png(W, H, render()))
    print(f"已生成 {out}（{W}×{H}）")


if __name__ == "__main__":
    main()


# ---- 备用：安装窗口中间的箭头图标（Finder 新版不支持 .DS_Store 背景图时用它） ----
AW = 128
ACX, ACY = AW / 2, AW / 2
SHAFT_X0, SHAFT_X1 = 26, 76
SHAFT_HALF = 5
HEAD_BACK_X, HEAD_X = 68, 100
HEAD_HALF = 17


def in_arrow_icon(x: float, y: float) -> bool:
    dx = abs(y - ACY)
    if SHAFT_X0 <= x <= SHAFT_X1 and dx <= SHAFT_HALF:
        return True
    if HEAD_BACK_X <= x <= HEAD_X:
        t = (x - HEAD_BACK_X) / (HEAD_X - HEAD_BACK_X)
        return dx <= HEAD_HALF * (1 - t)
    return False


def render_arrow_icon() -> bytes:
    """透明底箭头，供 Finder 当图片缩略图显示。"""
    rows = []
    for py in range(AW):
        row = bytearray()
        for px in range(AW):
            inside = 0
            for sy in range(SS):
                for sx in range(SS):
                    if in_arrow_icon(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS):
                        inside += 1
            alpha = int(255 * inside / (SS * SS))
            row.extend((ARROW[0], ARROW[1], ARROW[2], alpha))
        rows.append(bytes(row))
    return b"".join(b"\x00" + r for r in rows)


def png_rgba(width: int, height: int, raw: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8 位 RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main_arrow() -> None:
    root = Path(__file__).resolve().parent.parent
    out = root / "build" / "dmg-arrow.png"
    out.write_bytes(png_rgba(AW, AW, render_arrow_icon()))
    print(f"已生成 {out}（{AW}×{AW} 透明）")
