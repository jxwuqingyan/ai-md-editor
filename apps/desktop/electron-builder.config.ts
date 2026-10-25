/**
 * electron-builder 打包配置。
 * macOS 产出 dmg/zip（arm64 + x64），Windows 产出 nsis/zip。
 */
const config = {
  appId: 'com.markdownnote.app',
  productName: 'MarkdownNote',
  directories: {
    output: 'release'
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
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  }
};

export default config;
