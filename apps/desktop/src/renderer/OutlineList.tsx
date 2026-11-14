/**
 * 大纲列表：侧栏「大纲」面板与独立大纲窗口共用。
 *
 * 支持拖动标题重排章节：把一个标题连同它下面所有子标题、正文整体搬到
 * 另一个标题之前 / 之后，落点用插入指示线标出。具体的文本搬运由
 * shared 的纯函数完成，这里只负责交互与视觉反馈。
 */
import { useState, type DragEvent, type KeyboardEvent } from 'react';
import type { OutlineItem } from '@ai-md-editor/markdown-core';

/** 拖放落点：目标标题之前或之后 */
export type OutlineDropPosition = 'before' | 'after';

interface OutlineListProps {
  /** 文档大纲（按出现顺序） */
  items: OutlineItem[];
  /** 侧栏面板 / 独立窗口，决定样式类名与缩进 */
  variant: 'sidebar' | 'float';
  /** 点击标题跳转到正文 */
  onClick: (line: number, index: number) => void;
  /** 拖动确认：fromIndex / toIndex 是大纲数组下标 */
  onMove: (fromIndex: number, toIndex: number, position: OutlineDropPosition) => void;
}

interface DropTarget {
  index: number;
  position: OutlineDropPosition;
}

/** 大纲列表 */
export default function OutlineList({ items, variant, onClick, onMove }: OutlineListProps): JSX.Element {
  // 当前被拖动的条目下标；null 表示没有进行中的拖动
  const [dragging, setDragging] = useState<number | null>(null);
  // 当前落点，用于画插入指示线
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const listClass = variant === 'sidebar' ? 'outline-list' : 'float-outline-list';
  const itemClass = variant === 'sidebar' ? 'outline-item' : 'float-outline-item';
  const emptyClass = variant === 'sidebar' ? 'outline-empty' : 'quick-open-empty';
  const indent = variant === 'sidebar' ? 16 : 10;
  const step = variant === 'sidebar' ? 14 : 12;

  /** 从 dataTransfer 取起点；同一窗口内拖动也能直接读本地状态兜底 */
  const readDragIndex = (event: DragEvent): number => {
    const raw = event.dataTransfer.getData('text/plain');
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed < items.length ? parsed : (dragging ?? -1);
  };

  const handleDragStart = (event: DragEvent, index: number): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDragging(index);
    setDropTarget(null);
  };

  /** 条目上的悬停：按指针落在上半 / 下半决定插到它之前还是之后 */
  const handleItemDragOver = (event: DragEvent, index: number): void => {
    if (dragging === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position: OutlineDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (dropTarget?.index !== index || dropTarget.position !== position) {
      setDropTarget({ index, position });
    }
  };

  const handleItemDrop = (event: DragEvent, index: number): void => {
    const from = readDragIndex(event);
    if (from < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const position: OutlineDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDragging(null);
    setDropTarget(null);
    onMove(from, index, position);
  };

  /** 拖到列表空白处：统一放到最后一个章节之后 */
  const handleListDragOver = (event: DragEvent): void => {
    if (dragging === null || items.length === 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTarget?.index !== items.length - 1 || dropTarget.position !== 'after') {
      setDropTarget({ index: items.length - 1, position: 'after' });
    }
  };

  const handleListDrop = (event: DragEvent): void => {
    const from = readDragIndex(event);
    if (from < 0 || items.length === 0) return;
    event.preventDefault();
    setDragging(null);
    setDropTarget(null);
    onMove(from, items.length - 1, 'after');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: OutlineItem): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick(item.line, item.index);
    }
  };

  return (
    <div
      className={listClass}
      onDragOver={handleListDragOver}
      onDrop={handleListDrop}
      onDragLeave={(event) => {
        // 只在指针真正离开列表时清指示线，条目间移动时的 leave 不算
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
      }}
    >
      {items.length === 0 ? (
        <div className={emptyClass}>暂无标题</div>
      ) : (
        items.map((item, index) => {
          const isTarget = dropTarget?.index === index && dragging !== index;
          const classes = [
            itemClass,
            'outline-draggable',
            dragging === index ? 'outline-dragging' : '',
            isTarget ? `outline-drop-${dropTarget?.position}` : ''
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={`${item.line}-${item.index}`}
              className={classes}
              style={{ paddingLeft: indent + (item.level - 1) * step }}
              draggable
              data-outline-index={index}
              onClick={() => onClick(item.line, item.index)}
              onKeyDown={(event) => handleKeyDown(event, item)}
              onDragStart={(event) => handleDragStart(event, index)}
              onDragOver={(event) => handleItemDragOver(event, index)}
              onDrop={(event) => handleItemDrop(event, index)}
              onDragEnd={() => {
                setDragging(null);
                setDropTarget(null);
              }}
              role="button"
              tabIndex={0}
              title={`跳转到「${item.text}」（可拖动重排章节）`}
            >
              {item.text}
            </div>
          );
        })
      )}
    </div>
  );
}
