// 用法：画布快捷键与右键菜单共用这些命令；文本编辑中的快捷键由 Tiptap 处理。
import type { Editor } from '../../core/editor';
import { styleOf } from '../../core/appearance';
import { visualStyleSchema, type CanvasObject } from '../../core/document';
const DEFAULT_STYLE_KEY = 'workbench-object-default-styles';
export function saveDefaultStyle(object: CanvasObject): void {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(localStorage.getItem(DEFAULT_STYLE_KEY) ?? '{}'); } catch { /* 损坏的本机偏好由当前样式替换。 */ }
  saved[object.kind] = styleOf(object); localStorage.setItem(DEFAULT_STYLE_KEY, JSON.stringify(saved));
}
export function withDefaultStyle<T extends CanvasObject>(object: T): T {
  try { const saved = JSON.parse(localStorage.getItem(DEFAULT_STYLE_KEY) ?? '{}'); const result = visualStyleSchema.safeParse(saved[object.kind]); if (result.success) return { ...object, style: result.data }; } catch { /* 本机样式失效时保留正常默认值。 */ }
  return object;
}
export function canvasShortcut(event: KeyboardEvent, editor: Editor, selected: string[]): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key === 'g') { if (event.shiftKey) editor.ungroupObjects(selected); else editor.group([...editor.expandObjectIds(selected)]); }
  else if (key === 'l' && !event.shiftKey) { const objects = editor.document.objects.filter(object => selected.includes(object.id)); editor.setLocked(selected, !objects.every(object => object.locked)); }
  else if (['b', 'i', 'u'].includes(key) && !event.shiftKey) editor.formatObjects(selected, ({ b: 'bold', i: 'italic', u: 'underline' } as const)[key as 'b' | 'i' | 'u']);
  else if (event.shiftKey && ['l', 'e', 'r'].includes(key)) editor.formatObjects(selected, ({ l: 'left', e: 'center', r: 'right' } as const)[key as 'l' | 'e' | 'r']);
  else if (event.code === 'BracketRight') editor.reorderObjects(selected, event.shiftKey ? 'front' : 'forward');
  else if (event.code === 'BracketLeft') editor.reorderObjects(selected, event.shiftKey ? 'back' : 'backward');
  else if (event.shiftKey && (event.code === 'Period' || event.code === 'Comma')) editor.formatObjects(selected, event.code === 'Period' ? 'larger' : 'smaller');
  else return false;
  event.preventDefault(); return true;
}
