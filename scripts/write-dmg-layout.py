#!/usr/bin/env python3
"""给 dmg 卷写 .DS_Store：固定安装窗口布局。

窗口内容区 540×320：
    [MarkdownNote.app] (140,140)   [箭头.png] (270,140)   [Applications] (400,140)

为什么不用 Finder 脚本：本机自动化权限被系统拒绝（AppleScript 报 -10004）。
为什么用箭头图片文件而不是窗口背景图：新版 Finder 读 `.DS_Store` 的
`backgroundImageAlias`（alias / bookmark 两种引用都试过）不再显示背景，
改为在两个图标之间放一张透明箭头 PNG——图标视图会显示它的缩略图，
效果等价，且各版本系统都稳定。

用法：python3 scripts/write-dmg-layout.py <挂载点>
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "node_modules" / "dmg-builder" / "vendor"
sys.path.insert(0, str(VENDOR))

from ds_store import DSStore  # noqa: E402

APP_NAME = "MarkdownNote.app"
ARROW_NAME = "箭头.png"
# 图标中心（内容区坐标）
APP_POS = (140, 140)
ARROW_POS = (270, 140)
APPS_POS = (400, 140)
# 窗口内容区 540×380，Finder 的 bounds 还含 28px 标题栏
WINDOW_BOUNDS = "{{200, 200}, {540, 348}}"
ICON_SIZE = 96.0
TEXT_SIZE = 12.0


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法：python3 scripts/write-dmg-layout.py <挂载点>")
    mount = Path(sys.argv[1]).resolve()
    if not (mount / APP_NAME).exists():
        raise SystemExit(f"卷里没有 {APP_NAME}：{mount}")

    bwsp = {
        "ShowStatusBar": False,
        "ContainerShowSidebar": False,
        "PreviewPaneVisibility": False,
        "SidebarWidth": 180,
        "ShowTabView": False,
        "ShowToolbar": False,
        "ShowPathbar": False,
        "ShowSidebar": False,
        "WindowBounds": WINDOW_BOUNDS,
    }

    icvp = {
        "viewOptionsVersion": 1,
        "backgroundType": 1,  # 1 = 纯色（新版 Finder 的图片背景不生效）
        "backgroundColorRed": 1.0,
        "backgroundColorGreen": 1.0,
        "backgroundColorBlue": 1.0,
        "gridOffsetX": 0.0,
        "gridOffsetY": 0.0,
        "gridSpacing": 100.0,
        "arrangeBy": "none",  # 不要自动排列，否则自定义坐标会被覆盖
        "showIconPreview": True,  # 让 →.png 显示成图片缩略图
        "showItemInfo": False,
        "labelOnBottom": True,
        "textSize": TEXT_SIZE,
        "iconSize": ICON_SIZE,
        "scrollPositionX": 0.0,
        "scrollPositionY": 0.0,
    }
    target = mount / ".DS_Store"
    if target.exists():
        target.unlink()

    with DSStore.open(str(target), "w+") as store:
        store["."]["vSrn"] = ("long", 1)
        store["."]["bwsp"] = bwsp
        store["."]["icvp"] = icvp
        store["."]["icvl"] = (b"type", b"icnv")  # 图标视图

        # 隐藏项推到窗口外，避免占位影响布局
        for name, pos in (
            (".background", (2600, 170)),
            (".DS_Store", (2650, 170)),
            (".fseventsd", (2700, 170)),
            (".Trashes", (2750, 170)),
            (".VolumeIcon.icns", (2800, 170)),
        ):
            store[name]["Iloc"] = pos

        store[APP_NAME]["Iloc"] = APP_POS
        store[ARROW_NAME]["Iloc"] = ARROW_POS
        store["Applications"]["Iloc"] = APPS_POS

    print(f"已写入布局：{target}")


if __name__ == "__main__":
    main()
