// 使用范例：<IconButton icon={Search} label="查找" onClick={open}/>；<PanelResizeHandle label="调整侧栏宽度" .../>。
// 分栏统一支持鼠标、触摸、方向键、双击复位，以及 Esc / 失焦取消拖动。
import { useEffect, useRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

export function IconButton({ icon: Icon, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button type="button" className={`editor-icon-button ${className}`} aria-label={label} title={label} {...props}><Icon size={17} strokeWidth={1.7} aria-hidden="true" /></button>;
}

export function PanelResizeHandle({ label, value, min, max, onChange, onReset, axis = 'x', direction = 1, className = '' }: {
  label: string; value: number; min: number; max: number; onChange(value: number): void; onReset?(): void;
  axis?: 'x' | 'y'; direction?: 1 | -1; className?: string;
}) {
  const drag = useRef<{ origin: number; value: number; cursor: string; select: string } | null>(null);
  const change = useRef(onChange); change.current = onChange;
  const clamp = (next: number) => Math.max(min, Math.min(Math.max(min, max), next));
  const finish = (cancel = false) => {
    const previous = drag.current;
    if (!previous) return;
    drag.current = null;
    document.body.style.cursor = previous.cursor;
    document.body.style.userSelect = previous.select;
    if (cancel) change.current(previous.value);
  };
  useEffect(() => {
    const cancel = () => finish(true);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape); finish(); };
  }, []);
  return <div className={`panel-resize-handle axis-${axis} ${className}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-valuemin={min} aria-valuemax={Math.max(min, max)} aria-valuenow={Math.round(value)}
    onDoubleClick={onReset}
    onKeyDown={event => {
      const step = event.shiftKey ? 40 : 16;
      const delta = event.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown') ? step : event.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp') ? -step : 0;
      if (delta) { event.preventDefault(); onChange(clamp(value + delta * direction)); }
      if (event.key === 'Home') { event.preventDefault(); onChange(min); }
      if (event.key === 'End') { event.preventDefault(); onChange(max); }
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { origin: axis === 'x' ? event.clientX : event.clientY, value, cursor: document.body.style.cursor, select: document.body.style.userSelect };
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { if (drag.current) onChange(clamp(drag.current.value + ((axis === 'x' ? event.clientX : event.clientY) - drag.current.origin) * direction)); }}
    onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()} />;
}
