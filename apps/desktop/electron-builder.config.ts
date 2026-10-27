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
  files: ['out/**/*', 'package.json'],
  mac: {
    target: ['dmg', 'zip'],
    arch: ['arm64', 'x64'],
    category: 'public.app-category.productivity'
  },
  win: {
    target: ['nsis', 'zip'],
    arch: ['x64']
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
