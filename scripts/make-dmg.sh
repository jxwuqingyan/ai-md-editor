#!/bin/bash
# 制作安装镜像（dmg）：标准安装窗口——左侧应用、右侧 Applications、中间箭头，卷图标用应用自己的。
#
# 用法：scripts/make-dmg.sh <版本号> [arch]
#   例：scripts/make-dmg.sh 0.14.20 arm64
#
# 为什么手动做：沙箱里 electron-builder 的 dmg target 会被 broker 拦截（清理 .BC.T_* 失败）。
# 为什么挂到 /Volumes：Finder 相关元数据（别名、卷图标）依赖卷挂在 /Volumes/<卷名> 下。
set -euo pipefail

VERSION="${1:?用法: scripts/make-dmg.sh <版本号> [arch]}"
ARCH="${2:-arm64}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
APP="$DESKTOP/release/mac-$ARCH/MarkdownNote.app"
OUT="$DESKTOP/release/MarkdownNote-$VERSION-$ARCH.dmg"
ARROW="$ROOT/build/dmg-arrow.png"
ICON_ICNS="$DESKTOP/build/icon.icns"
WORK="$DESKTOP/release/.dmg-work-$VERSION"
VOL="MarkdownNote"
MNT="/Volumes/$VOL"

[ -d "$APP" ] || { echo "找不到 ${APP}，先跑 electron-builder --dir"; exit 1; }
[ -f "$ARROW" ] || { echo "找不到 ${ARROW}，先跑 python3 scripts/make-dmg-background.py"; exit 1; }
[ -f "$ICON_ICNS" ] || { echo "找不到 ${ICON_ICNS}"; exit 1; }

cleanup() {
  hdiutil detach "$MNT" -force >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "=== 1/6 ad-hoc 签名（Apple Silicon 必需） ==="
codesign --remove-signature "$APP" 2>/dev/null || true
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"

echo "=== 2/6 创建可写镜像 ==="
rm -rf "$WORK"
mkdir -p "$WORK"
hdiutil create -size 800m -fs HFS+ -volname "$VOL" "$WORK/base.dmg" -ov >/dev/null

echo "=== 3/6 挂载到 ${MNT} ==="
hdiutil detach "$MNT" -force >/dev/null 2>&1 || true
hdiutil attach "$WORK/base.dmg" -mountpoint "$MNT" -nobrowse >/dev/null

echo "=== 4/6 放入应用 / Applications 链接 / 箭头图 / 卷图标 ==="
# COPYFILE_DISABLE + ditto 参数：避免把扩展属性与 AppleDouble 带进镜像
COPYFILE_DISABLE=1 ditto --norsrc --noextattr --noacl "$APP" "$MNT/MarkdownNote.app"
ln -sfn /Applications "$MNT/Applications"
# 两个图标之间的箭头：放成图片文件由 Finder 显示缩略图（新版 Finder 的背景图不生效）
cp "$ARROW" "$MNT/箭头.png"
# 卷图标：用应用自己的图标，替换系统默认的「磁盘镜像」灰盒子
cp "$ICON_ICNS" "$MNT/.VolumeIcon.icns"
SetFile -a C "$MNT"

echo "=== 5/6 写入安装窗口布局（.DS_Store） ==="
# 不走 Finder 脚本（本机自动化权限被拒 -10004），直接用 ds_store 生成布局文件
python3 "$ROOT/scripts/write-dmg-layout.py" "$MNT"

# 系统会在卷里建 .fseventsd / .Trashes，沙箱不允许删 /Volumes 下的内容；
# 已在 .DS_Store 里把它们的坐标推到窗口外，打开时不会出现在安装窗口里
hdiutil detach "$MNT" -force >/dev/null 2>&1 || true
sleep 1

echo "=== 6/6 压缩并校验 ==="
ok=0
for i in 1 2 3; do
  if hdiutil convert "$WORK/base.dmg" -format UDZO -o "$OUT" -ov >/dev/null 2>&1; then ok=1; break; fi
  echo "convert 第 ${i} 次失败，重试…"
  sleep 2
done
[ "$ok" = 1 ] || { echo "压缩失败"; exit 1; }
rm -rf "$WORK"
echo "产物：${OUT}"
ls -lh "$OUT"
