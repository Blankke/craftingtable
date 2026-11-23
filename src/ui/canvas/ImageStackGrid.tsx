// 用法：叠图总览传入稳定图片身份；拖动仅更新局部反馈，松开后提交一次排序。
import { useEffect, useRef, useState } from 'react';
import type { JournalSpread } from './vendor/JournalSpreadCarousel';
import { useLanguage } from '../shared/language';

type Gesture = { pointer: number; id: string; target: string; button: HTMLButtonElement; x: number; y: number; lastX: number; lastY: number; scroll: number; moved: boolean };
export function ImageStackGrid({ spreads, activeId, onOpen, onReorder }: {
  spreads: JournalSpread[]; activeId?: string; onOpen(index: number): void; onReorder?(id: string, targetId: string): void;
}) {
  const { t } = useLanguage();
  const grid = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), frame = useRef(0), suppressClick = useRef(false);
  const [feedback, setFeedback] = useState<{ id: string; target: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const finish = () => {
    const drag = gesture.current; gesture.current = null;
    cancelAnimationFrame(frame.current);
    if (drag) {
      drag.button.style.transform = ''; drag.button.style.zIndex = '';
      if (drag.button.hasPointerCapture(drag.pointer)) drag.button.releasePointerCapture(drag.pointer);
    }
    setFeedback(null);
    return drag;
  };
  useEffect(() => {
    const cancel = () => { finish(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); finish(); }
    };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true);
    return () => { cancelAnimationFrame(frame.current); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true); };
  }, []);
  // 外部撤销、锁定或数据替换期间取消手势，不能把旧索引应用到新顺序。
  const order = spreads.map(spread => spread.id).join(',');
  useEffect(() => { finish(); }, [order, !!onReorder]);
  const reorder = (id: string, target: string) => {
    if (id === target) return;
    onReorder?.(id, target);
    const position = spreads.findIndex(spread => spread.id === target) + 1;
    setAnnouncement(t(`已移至第 ${position} 张`, `Moved to position ${position}`));
  };
  const tick = () => {
    const drag = gesture.current, element = grid.current;
    if (!drag?.moved || !element) return;
    const box = element.getBoundingClientRect();
    const inside = drag.lastX >= box.left && drag.lastX <= box.right && drag.lastY >= box.top && drag.lastY <= box.bottom;
    // 边缘自动滚动让长列表可跨行排序；每帧只更新拖动卡片的 transform。
    if (inside) {
      const edge = 44;
      const speed = drag.lastY < box.top + edge ? -Math.min(12, (box.top + edge - drag.lastY) / 3) : drag.lastY > box.bottom - edge ? Math.min(12, (drag.lastY - box.bottom + edge) / 3) : 0;
      element.scrollTop += speed;
    }
    drag.button.style.transform = `translate(${drag.lastX - drag.x}px, ${drag.lastY - drag.y + element.scrollTop - drag.scroll}px) scale(.96)`;
    let target = drag.id;
    if (inside) {
      for (const button of Array.from(element.querySelectorAll<HTMLButtonElement>('button[data-image-id]'))) {
        if (button === drag.button) continue;
        const rect = button.getBoundingClientRect();
        if (drag.lastX >= rect.left && drag.lastX <= rect.right && drag.lastY >= rect.top && drag.lastY <= rect.bottom) { target = button.dataset.imageId!; break; }
      }
    }
    drag.target = target;
    setFeedback(previous => previous?.id === drag.id && previous.target === target ? previous : { id: drag.id, target });
    frame.current = requestAnimationFrame(tick);
  };
  return <div className="jsc-overview">
    <p className="jsc-sort-help">{onReorder ? t('拖动图片调整顺序 · 首张为封面 · Alt + 方向键也可排序', 'Drag to reorder · First image is the cover · Or use Alt + arrow keys') : t('首张为封面 · 叠图已锁定', 'First image is the cover · Stack locked')}</p>
    <div ref={grid} className="jsc-grid" data-sortable={onReorder ? '' : undefined}>
      {spreads.map((spread, index) => <button type="button" key={spread.id ?? index} data-image-id={spread.id}
        aria-label={`${t('查看图片', 'View image')} ${index + 1}`} aria-current={spread.id === activeId ? 'true' : undefined}
        data-dragging={feedback?.id === spread.id ? '' : undefined} data-drop-target={feedback && feedback.target !== feedback.id && feedback.target === spread.id ? '' : undefined}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onOpen(index); }}
        onPointerDown={event => {
          if (gesture.current) return;
          suppressClick.current = false;
          if (!onReorder || !spread.id || event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.focus({ preventScroll: true });
          gesture.current = { pointer: event.pointerId, id: spread.id, target: spread.id, button: event.currentTarget, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, scroll: grid.current!.scrollTop, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = gesture.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          drag.lastX = event.clientX; drag.lastY = event.clientY;
          if (!drag.moved && Math.hypot(drag.lastX - drag.x, drag.lastY - drag.y) >= 6) {
            drag.moved = true; suppressClick.current = true; drag.button.style.zIndex = '2'; tick();
          }
        }}
        onPointerUp={event => {
          if (gesture.current?.pointer !== event.pointerId) return;
          // 最后一个事件可能早于下一动画帧，先更新落点再提交。
          const current = gesture.current; current.lastX = event.clientX; current.lastY = event.clientY;
          cancelAnimationFrame(frame.current); if (current.moved) tick();
          const drag = finish(); if (drag?.moved) reorder(drag.id, drag.target);
        }}
        onPointerCancel={() => finish()} onLostPointerCapture={() => { if (gesture.current) finish(); }}
        onKeyDown={event => {
          suppressClick.current = false;
          if (!onReorder || !spread.id || !event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); finish();
          const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
          const target = spreads[index + offset]?.id;
          if (target) reorder(spread.id, target);
        }}>
        <img src={spread.image} alt={spread.alt ?? ''} draggable={false}/>
        <span>{index + 1}{index === 0 ? t(' · 封面', ' · Cover') : ''} · {spread.label}</span>
        {spread.caption && <small>{spread.caption}</small>}
      </button>)}
    </div>
    <span className="jsc-sort-status" role="status">{announcement}</span>
  </div>;
}
