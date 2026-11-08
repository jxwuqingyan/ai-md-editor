/**
 * 输入法（IME）按键判定。
 *
 * 中文输入法用 Enter 上屏候选词，此时 keydown 同样带 key === 'Enter'。
 * 不判断组合状态就会把还没上屏的拼音当成「确认」：
 * 改名对话框会拿到半截名字、搜索框会提前发起搜索。
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** 当前按键是否属于输入法拼字过程（不应触发确认/搜索等动作） */
export function isImeKey(event: ReactKeyboardEvent): boolean {
  return (event.nativeEvent as KeyboardEvent).isComposing === true || event.keyCode === 229;
}
