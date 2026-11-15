import { useState } from 'react';
import { useLanguage } from './language';

export function TextAssetCreator({ onCreate }: { onCreate(name: string, content: string): Promise<void> }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  if (!open) return <button onClick={() => setOpen(true)}>{t('+ 新建文字素材', '+ New text asset')}</button>;
  return <form className="text-asset-form" onSubmit={event => {
    event.preventDefault();
    if (!name.trim()) { setError(t('请输入名称', 'Enter a name')); return; }
    void onCreate(name.trim(), content).then(() => { setOpen(false); setName(''); setContent(''); setError(''); }).catch(reason => setError(String(reason)));
  }}>
    <input aria-label={t('文字素材名称', 'Text asset name')} placeholder={t('素材名称', 'Asset name')} value={name} onChange={event => setName(event.target.value)} />
    <textarea aria-label={t('文字素材内容', 'Text asset content')} placeholder={t('输入纯文本', 'Enter plain text')} value={content} onChange={event => setContent(event.target.value)} />
    {error && <small role="alert">{error}</small>}
    <div><button type="submit">{t('保存素材', 'Save asset')}</button><button type="button" onClick={() => { setOpen(false); setError(''); }}>{t('取消', 'Cancel')}</button></div>
  </form>;
}
