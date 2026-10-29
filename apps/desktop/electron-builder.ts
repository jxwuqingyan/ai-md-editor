/**
 * electron-builder 打包配置。
 * macOS 产出 dmg/zip（arm64 + x64），Windows 产出 nsis/zip。
 * 图标位于 build/ 目录（icon.icns / icon.ico）。
 */
const config = {
  appId: 'com.markdownnote.app',
  productName: 'MarkdownNote',
  // 图标资源目录（相对于本配置文件所在目录）
  directories: {
    output: 'release',
    buildResources: 'build'
  },
  // 所有第三方依赖（React/Milkdown/Shiki）均已被 electron-vite 打包进 out/，
  // 无需在打包时重装 node_modules。跳过依赖重装可避免 npm 在 CI 上误删
  // 7zip-bin 平台二进制（7za）导致的 "ENOENT chmod 7za" 打包失败。
  npmRebuild: false,
  files: ['out/**/*', 'package.json'],
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.productivity'
  },
  win: {
    target: ['nsis', 'zip']
  },
  dmg: {
    title: 'MarkdownNote',
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  }
};

export default config;
