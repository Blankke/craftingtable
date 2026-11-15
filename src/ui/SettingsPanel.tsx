// 使用示例：在首页或编辑页顶部渲染 SettingsPanel，选择默认项目目录与界面语言。
import { useEffect, useState } from 'react';
import { useLanguage } from './language';

export function SettingsPanel({ onRootChange }: { onRootChange(): Promise<void> }) {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !window.workbench) return;
    void window.workbench.getSettings().then(settings => setRoot(settings.projectsRoot)).catch(reason => setError(String(reason)));
  }, [open]);
  async function chooseRoot() {
    if (!window.workbench) return;
    setBusy(true); setError('');
    try {
      const settings = await window.workbench.chooseProjectsRoot();
      setRoot(settings.projectsRoot);
      await onRootChange();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="settings-wrap">
    <button aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('设置', 'Settings')}</button>
    {open && <section className="settings-panel" aria-label={t('设置', 'Settings')}>
      <h2>{t('设置', 'Settings')}</h2>
      <label>{t('界面语言', 'Language')}<select aria-label={t('界面语言', 'Language')} value={language} onChange={event => setLanguage(event.target.value as 'zh-CN' | 'en')}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
      <label>{t('默认项目保存位置', 'Default project location')}</label>
      {window.workbench ? <><output className="settings-path">{root || t('正在读取…', 'Loading…')}</output><button type="button" disabled={busy} onClick={() => void chooseRoot()}>{t('选择文件夹', 'Choose folder')}</button><small>{t('只影响以后新建的项目，不移动当前项目。', 'Applies to new projects. Existing projects stay where they are.')}</small></> : <small>{t('网页版项目保存在此浏览器中；请用桌面版指定磁盘路径。', 'Browser projects are stored in this browser. Use the desktop app to choose a disk location.')}</small>}
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>;
}
