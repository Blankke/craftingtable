// 使用示例：在首页或编辑页顶部渲染 SettingsPanel，选择默认项目目录与界面语言。
import { useEffect, useState } from 'react';
import { useLanguage } from './language';
import { useThemeStore } from '../theme/themeStore';
import { WorkbenchIcon } from './WorkbenchIcon';

export function SettingsPanel({ onRootChange }: { onRootChange(): Promise<void> }) {
  const { language, setLanguage, t } = useLanguage();
  const forceMotion = useThemeStore(state => state.forceMotion);
  const setForceMotion = useThemeStore(state => state.setForceMotion);
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    void window.workbench!.getSettings().then(settings => setRoot(settings.projectsRoot)).catch(reason => setError(String(reason)));
  }, [open]);
  async function chooseRoot() {
    setBusy(true); setError('');
    try {
      const settings = await window.workbench!.chooseProjectsRoot();
      setRoot(settings.projectsRoot);
      await onRootChange();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="settings-wrap">
    <button type="button" className="nav-icon-button" aria-label={t('设置', 'Settings')} title={t('设置', 'Settings')} aria-expanded={open} onClick={() => setOpen(value => !value)}><WorkbenchIcon name="settings" size={16} /><span>{t('设置', 'Settings')}</span></button>
    {open && <section className="settings-panel" aria-label={t('设置', 'Settings')}>
      <h2>{t('设置', 'Settings')}</h2>
      <label>{t('界面语言', 'Language')}<select aria-label={t('界面语言', 'Language')} value={language} onChange={event => setLanguage(event.target.value as 'zh-CN' | 'en')}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
      <label className="settings-toggle">{t('强制播放动画', 'Force animations')}<input aria-label={t('强制播放动画', 'Force animations')} type="checkbox" checked={forceMotion} onChange={event => setForceMotion(event.target.checked)} /></label>
      <small>{t('开启后忽略系统的“减少动态效果”设置；关闭时遵循系统偏好。', 'When enabled, animations ignore the system reduced-motion preference. When disabled, the system preference applies.')}</small>
      <label>{t('默认项目保存位置', 'Default project location')}</label>
      <output className="settings-path">{root || t('正在读取…', 'Loading…')}</output><button type="button" disabled={busy} onClick={() => void chooseRoot()}>{t('选择文件夹', 'Choose folder')}</button><small>{t('只影响以后新建的项目，不移动当前项目。', 'Applies to new projects. Existing projects stay where they are.')}</small>
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>;
}
