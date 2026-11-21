// 使用范例：<NoteAnnotationLinks container={layoutRef} annotations={note.annotations} document={note.document}/>。
// 在布局变化和两个滚动容器移动时重算正交虚线；SVG 不接收鼠标事件。
import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Note } from '../../core/note';

export function NoteAnnotationLinks({ container, annotations, document, activeId }: { container: RefObject<HTMLDivElement>; annotations: Note['annotations']; document: Note['document']; activeId: string | null }) {
  const [paths, setPaths] = useState<{ id: string; path: string; color: string }[]>([]);
  useEffect(() => {
    const layout = container.current;
    if (!layout) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = layout.getBoundingClientRect();
      const next = annotations.flatMap(annotation => {
        const card = layout.querySelector<HTMLElement>(`[data-annotation-card="${annotation.id}"]`);
        if (!card || annotation.orphaned) return [];
        const to = card.getBoundingClientRect();
        // 分屏时优先连接靠近批注的可见原文，避免虚线穿过整列预览正文。
        const from = Array.from(layout.querySelectorAll<HTMLElement>(`[data-note-annotation="${annotation.id}"]`))
          .map(source => ({ rect: source.getBoundingClientRect(), pane: source.closest('.note-paper,.note-markdown-preview')?.getBoundingClientRect() }))
          .filter(({ rect, pane }) => {
            const centerY = rect.top + rect.height / 2;
            return rect.width > 0 && rect.right <= to.left && rect.right > bounds.left && rect.right < bounds.right
              && centerY >= Math.max(bounds.top, pane?.top ?? bounds.top) && centerY <= Math.min(bounds.bottom, pane?.bottom ?? bounds.bottom);
          })
          .sort((a, b) => b.rect.right - a.rect.right)[0]?.rect;
        if (!from) return [];
        const y1 = from.top + from.height / 2, y2 = to.top + 22;
        if (y1 < bounds.top || y1 > bounds.bottom || y2 < bounds.top || y2 > bounds.bottom) return [];
        const elbow = to.left - 12;
        return [{ id: annotation.id, path: `M ${from.right + 3} ${y1} H ${elbow} V ${y2} H ${to.left}`, color: annotation.color }];
      });
      setPaths(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(layout);
    for (const element of Array.from(layout.querySelectorAll('.note-paper,.note-markdown-preview,.note-annotations,.note-annotation'))) observer.observe(element);
    layout.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); layout.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [container, annotations, document]);
  return createPortal(<svg className="note-annotation-links" aria-hidden="true">{paths.map(item => <path key={item.id} d={item.path} fill="none" stroke={item.color} strokeWidth={activeId === item.id ? 1.5 : 1} strokeDasharray="3 4" />)}</svg>, window.document.body);
}
