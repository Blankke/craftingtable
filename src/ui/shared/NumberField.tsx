// 使用范例：<NumberField editor={editor} label="宽度" value={width} onPreview={previewWidth}/>。
// 连续按住微调按钮实时预览，松手或离开输入框只提交一次，Esc 取消整次修改。
import { useEffect, useRef } from 'react';
import type { Editor } from '../../core/editor';

export function NumberField({ editor, label, value, min, max, onPreview }: { editor: Editor; label: string; value: number; min?: number; max?: number; onPreview(value: number): void }) {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const baseline = useRef(value);
  const finish = () => { if (active.current) { active.current = false; editor.commitPreview(); } };
  const cancel = () => {
    if (!active.current) return;
    active.current = false; editor.cancelPreview();
    if (input.current) input.current.value = String(baseline.current);
  };
  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = String(Math.round(value * 100) / 100);
  }, [value]);
  useEffect(() => {
    window.addEventListener('pointerup', finish); window.addEventListener('blur', finish);
    return () => { window.removeEventListener('pointerup', finish); window.removeEventListener('blur', finish); finish(); };
  }, [editor]);
  return <label>{label}<input ref={input} aria-label={label} type="number" step="1" min={min} max={max} defaultValue={Math.round(value * 100) / 100}
    onChange={event => {
      const next = event.currentTarget.valueAsNumber;
      if (!Number.isFinite(next)) return;
      if (!active.current) baseline.current = value;
      active.current = true;
      onPreview(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)));
    }} onBlur={event => {
      if (!Number.isFinite(event.currentTarget.valueAsNumber)) cancel(); else finish();
      event.currentTarget.value = String(Math.round(value * 100) / 100);
    }} onPointerCancel={cancel} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); finish(); editor.undo(); event.currentTarget.blur(); }
    }} onKeyUp={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') finish(); }} /></label>;
}
