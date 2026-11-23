// 用法：简单字段编辑使用此原生模态，保留调用方校验及焦点返回；用于链接与对象信息。
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from './language';
import '../styles/contextMenu.css';
export type CommandField = { key: string; label: string; value: string; multiline?: boolean; options?: { value: string; label: string }[] };
export function CommandDialog({ title, fields, onSubmit, onClose, onRestoreFocus }: { title: string; fields: CommandField[]; onSubmit(values: Record<string, string>): void; onClose(): void; onRestoreFocus?(): void }) {
  const ref = useRef<HTMLDialogElement>(null), { t } = useLanguage();
  const restoreFocus = useRef(onRestoreFocus); restoreFocus.current = onRestoreFocus;
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(field => [field.key, field.value]))), [error, setError] = useState('');
  // 先解除模态的 inert，再同步恢复调用方选区；延迟 focus 会覆盖下一次按键的原生选区。
  useEffect(() => { const element = ref.current!, previous = document.activeElement as HTMLElement | null; element.showModal(); return () => { element.close(); if (restoreFocus.current) restoreFocus.current(); else previous?.focus(); }; }, []);
  return createPortal(<dialog ref={ref} className="command-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()}>
    <form onSubmit={event => { event.preventDefault(); try { onSubmit(values); onClose(); } catch (error) { setError(String(error).replace(/^Error: /, '')); } }}><h2>{title}</h2>
      {fields.map(field => <label key={field.key}>{field.label}{field.options ? <select aria-label={field.label} value={values[field.key]} onChange={event => setValues({ ...values, [field.key]: event.target.value })}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.multiline ? <textarea aria-label={field.label} value={values[field.key]} onChange={event => setValues({ ...values, [field.key]: event.target.value })}/> : <input aria-label={field.label} value={values[field.key]} onChange={event => setValues({ ...values, [field.key]: event.target.value })}/>}</label>)}
      {error && <p role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>{t('取消', 'Cancel')}</button><button type="submit">{t('应用', 'Apply')}</button></footer>
    </form>
  </dialog>, document.body);
}
