import type { Editor } from '../core/editor';
import type { CanvasObject } from '../core/document';
import { useLanguage } from './language';

type TextObject = Extract<CanvasObject, { text?: string }>;
export function TextToolbar({ editor, object }: { editor: Editor; object: TextObject }) {
  const { t } = useLanguage();
  const update = (change: (target: TextObject) => void) => {
    editor.execute(draft => { const target = draft.objects.find(item => item.id === object.id); if (target && ('text' in target || 'fill' in target)) change(target); });
  };
  return <div className="text-toolbar">
    <label>{t('字号', 'Font size')} <input aria-label={t('字号', 'Font size')} type="number" min="8" max="96" value={object.fontSize ?? 18} onChange={event => update(target => { target.fontSize = Math.max(8, Math.min(96, Number(event.target.value) || 8)); })} /></label>
    <label>{t('颜色', 'Color')} <input aria-label={t('文字颜色', 'Text color')} type="color" value={object.color ?? '#172033'} onChange={event => update(target => { target.color = event.target.value; })} /></label>
    <label>{t('对齐', 'Alignment')} <select aria-label={t('文字对齐', 'Text alignment')} value={object.align ?? 'center'} onChange={event => update(target => { target.align = event.target.value as 'left' | 'center' | 'right'; })}><option value="left">{t('左对齐', 'Left')}</option><option value="center">{t('居中', 'Center')}</option><option value="right">{t('右对齐', 'Right')}</option></select></label>
  </div>;
}
