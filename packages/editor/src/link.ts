/**
 * 链接点击插件：⌘ / Ctrl + 点击编辑器内的链接，用系统默认浏览器打开。
 *
 * WYSIWYG 里链接是正文的一部分，普通单击保留 ProseMirror 的光标定位语义
 * （点了把光标放进去改文字），只有带修饰键的点击才视为「打开」动作——
 * 这也是常见编辑器的通用习惯。
 *
 * 悬停链接时补 title 提示（⌘ 点击打开链接 / Ctrl+点击打开链接），
 * 提示用户怎么打开；title 属性可能被 ProseMirror 重绘清掉，下次悬停会再补。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

/**
 * 是否 macOS：决定用 ⌘ 还是 Ctrl。
 * 沙箱渲染进程没有完整 process 对象，用 UA 判断平台。
 */
const IS_MAC = /Macintosh|Mac OS X/i.test(navigator.userAgent);

/** 悬停提示文案 */
const LINK_HINT = IS_MAC ? '⌘ 点击打开链接' : 'Ctrl+点击打开链接';

/** 插件选项：打开回调由渲染层注入（走主进程 shell.openExternal） */
export interface LinkClickOptions {
  openLink: (url: string) => void;
}

/**
 * 创建链接点击插件。
 * @param options.openLink 收到合法 http/https 地址后打开
 */
export function linkClickPlugin(options: LinkClickOptions) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('markdownNoteLinkClick'),
        props: {
          handleDOMEvents: {
            // 悬停补提示：不覆盖 Markdown 自带的 title（[文字](url "标题")）
            mouseover: (_view, event) => {
              const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
              if (anchor && !anchor.title) anchor.title = LINK_HINT;
              return false;
            },
            // ⌘/Ctrl + 点击打开链接必须拦在 mousedown：
            // 放到 click 再 preventDefault 就晚了——macOS 上修饰键点击的默认行为
            // 会先让 ProseMirror 建出 NodeSelection（整段出现 selectednode 描边框）、
            // 选中链接文字，打开链接后残留一圈高亮框。
            mousedown: (_view, event) => {
              const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
              if (!anchor) return false;
              // macOS 用 ⌘（Ctrl+点击是右键），其他平台用 Ctrl
              const modifier = IS_MAC ? event.metaKey : event.ctrlKey;
              if (!modifier) return false;
              const href = anchor.getAttribute('href') ?? '';
              // 只放行 http/https；相对地址与其他协议主进程还会再校验一次
              if (!/^https?:\/\//i.test(href)) return false;
              event.preventDefault();
              options.openLink(href);
              return true;
            }
          }
        }
      })
  );
}
