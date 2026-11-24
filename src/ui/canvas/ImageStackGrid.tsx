// 用法：叠图总览传入稳定图片身份；拖动命中图片间的插入槽，松开后提交一次排序。
import { useEffect, useRef, useState } from 'react';
import type { JournalSpread } from './vendor/JournalSpreadCarousel';
import { useLanguage } from '../shared/language';
import { imageSourceAt } from '../media/mediaSource';

type Slot = { index: number; edge: 'before' | 'after'; id: string };
type Gesture = { pointer: number; id: string; slot: Slot | null; button: HTMLButtonElement; x: number; y: number; lastX: number; lastY: number; moved: boolean };
export function ImageStackGrid({ spreads, activeId, onOpen, onReorder }: {
  spreads: JournalSpread[]; activeId?: string; onOpen(index: number): void; onReorder?(id: string, targetId: string): void;
}) {
  const { t } = useLanguage();
  const grid = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), frame = useRef(0), suppressClick = useRef(false);
  const [feedback, setFeedback] = useState<{ id: string; slot: Slot | null } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const finish = () => {
    const drag = gesture.current; gesture.current = null;
    cancelAnimationFrame(frame.current);
    if (drag?.button.hasPointerCapture(drag.pointer)) drag.button.releasePointerCapture(drag.pointer);
    setFeedback(null); return drag;
  };
  useEffect(() => {
    const cancel = () => { finish(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); finish(); } };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true);
    return () => { cancelAnimationFrame(frame.current); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true); };
  }, []);
  const order = spreads.map(spread => spread.id).join(',');
  useEffect(() => { finish(); }, [order, !!onReorder]);
  const reorder = (id: string, index: number) => {
    const target = spreads[index]?.id;
    if (!target || id === target) return;
    onReorder?.(id, target);
    setAnnouncement(t(`已移至第 ${index + 1} 张`, `Moved to position ${index + 1}`));
  };
  const tick = () => {
    const drag = gesture.current, element = grid.current;
    if (!drag?.moved || !element) return;
    const box = element.getBoundingClientRect();
    const inside = drag.lastX >= box.left && drag.lastX <= box.right && drag.lastY >= box.top && drag.lastY <= box.bottom;
    let slot: Slot | null = null, nearest = Infinity;
    if (inside) {
      const edge = 44;
      element.scrollTop += drag.lastY < box.top + edge ? -Math.min(12, (box.top + edge - drag.lastY) / 3) : drag.lastY > box.bottom - edge ? Math.min(12, (drag.lastY - box.bottom + edge) / 3) : 0;
      // 按图片左右两侧的插入位置测距，跨行、首尾与空隙均可命中；图片本身始终留在原位。
      Array.from(element.querySelectorAll<HTMLButtonElement>('button[data-image-id]')).forEach((button, index) => {
        const rect = button.getBoundingClientRect();
        const dy = Math.max(rect.top - drag.lastY, 0, drag.lastY - rect.bottom);
        for (const edge of ['before', 'after'] as const) {
          const x = edge === 'before' ? rect.left - 12 : rect.right + 12;
          const distance = Math.hypot(drag.lastX - x, dy * 2);
          if (distance < nearest) { nearest = distance; slot = { index: index + (edge === 'after' ? 1 : 0), edge, id: button.dataset.imageId! }; }
        }
      });
    }
    drag.slot = slot;
    setFeedback(previous => previous?.id === drag.id && previous.slot?.id === drag.slot?.id && previous.slot?.edge === drag.slot?.edge ? previous : { id: drag.id, slot: drag.slot });
    frame.current = requestAnimationFrame(tick);
  };
  return <div className="jsc-overview">
    <p className="jsc-sort-help">{onReorder ? t('拖到图片间的空隙插入 · 首张为封面 · Alt + 方向键也可排序', 'Drag between images to insert · First image is the cover · Or use Alt + arrow keys') : t('首张为封面 · 叠图已锁定', 'First image is the cover · Stack locked')}</p>
    <div ref={grid} className="jsc-grid" data-sortable={onReorder ? '' : undefined} data-sorting={feedback ? '' : undefined}>
      {spreads.map((spread, index) => <button type="button" key={spread.id ?? index} data-image-id={spread.id}
        aria-label={`${t('查看图片', 'View image')} ${index + 1}`} aria-current={spread.id === activeId ? 'true' : undefined}
        data-dragging={feedback?.id === spread.id ? '' : undefined} data-insert={feedback?.slot && feedback.slot.id === spread.id ? feedback.slot.edge : undefined}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onOpen(index); }}
        onPointerDown={event => {
          if (gesture.current) return;
          suppressClick.current = false;
          if (!onReorder || !spread.id || event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.focus({ preventScroll: true });
          gesture.current = { pointer: event.pointerId, id: spread.id, slot: null, button: event.currentTarget, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = gesture.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          drag.lastX = event.clientX; drag.lastY = event.clientY;
          if (!drag.moved && Math.hypot(drag.lastX - drag.x, drag.lastY - drag.y) >= 6) { drag.moved = true; suppressClick.current = true; tick(); }
        }}
        onPointerUp={event => {
          const current = gesture.current; if (!current || current.pointer !== event.pointerId) return;
          current.lastX = event.clientX; current.lastY = event.clientY;
          cancelAnimationFrame(frame.current); if (current.moved) tick();
          const drag = finish();
          if (drag?.moved && drag.slot) {
            const from = spreads.findIndex(spread => spread.id === drag.id);
            reorder(drag.id, drag.slot.index - (from < drag.slot.index ? 1 : 0));
          }
        }}
        onPointerCancel={() => finish()} onLostPointerCapture={() => { if (gesture.current) finish(); }}
        onKeyDown={event => {
          suppressClick.current = false;
          if (!onReorder || !spread.id || !event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation(); finish();
          reorder(spread.id, index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1));
        }}>
        <img src={spread.image ? imageSourceAt(spread.image, 256) : undefined} loading="lazy" decoding="async" alt={spread.alt ?? ''} draggable={false}/>
        <span>{index + 1}{index === 0 ? t(' · 封面', ' · Cover') : ''} · {spread.label}</span>
        {spread.caption && <small>{spread.caption}</small>}
      </button>)}
    </div>
    <span className="jsc-sort-status" role="status">{announcement}</span>
  </div>;
}
