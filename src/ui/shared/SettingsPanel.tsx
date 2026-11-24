// 使用示例：在首页或编辑页顶部渲染 SettingsPanel，选择默认项目目录与界面语言。
import { useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_IMAGE_COMPRESSION, type ImageCompression } from '../../core/imageCompression';
import { X } from 'lucide-react';
import { IconButton } from './EditorControls';
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
  const [imageCompression, setImageCompression] = useState<ImageCompression>(DEFAULT_IMAGE_COMPRESSION);
  const [loading, setLoading] = useState(true);
  const compressionHelp = useId();
  const wrap = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void window.workbench!.getSettings().then(settings => { if (active) { setRoot(settings.projectsRoot); setImageCompression(settings.imageCompression); } }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);
  async function chooseCompression(mode: ImageCompression) {
    setBusy(true); setError('');
    try { const settings = await window.workbench!.setImageCompression(mode); setImageCompression(settings.imageCompression); }
    catch (reason) { setError(`${t('压缩方式保存失败，请重试', 'Could not save compression preference. Try again')}: ${String(reason)}`); }
    finally { setBusy(false); }
  }
  async function chooseRoot() {
    setBusy(true); setError('');
    try {
      const settings = await window.workbench!.chooseProjectsRoot();
      setRoot(settings.projectsRoot);
      await onRootChange();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="settings-wrap" ref={wrap}>
    <button ref={trigger} type="button" className="nav-icon-button" aria-label={t('设置', 'Settings')} title={t('设置', 'Settings')} aria-expanded={open} onClick={() => setOpen(value => !value)}><WorkbenchIcon name="settings" size={16} /><span>{t('设置', 'Settings')}</span></button>
    {open && <section className="settings-panel" aria-label={t('设置', 'Settings')}>
      <div className="settings-heading"><h2>{t('设置', 'Settings')}</h2><IconButton icon={X} label={t('关闭设置', 'Close settings')} onClick={close}/></div>
      <label>{t('界面语言', 'Language')}<select aria-label={t('界面语言', 'Language')} value={language} onChange={event => setLanguage(event.target.value as 'zh-CN' | 'en')}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
      <label className="settings-toggle">{t('强制播放动画', 'Force animations')}<input aria-label={t('强制播放动画', 'Force animations')} type="checkbox" checked={forceMotion} onChange={event => setForceMotion(event.target.checked)} /></label>
      <small>{t('开启后忽略系统的“减少动态效果”设置；关闭时遵循系统偏好。', 'When enabled, animations ignore the system reduced-motion preference. When disabled, the system preference applies.')}</small>
      <label>{t('图片压缩', 'Image compression')}<select aria-label={t('图片压缩', 'Image compression')} aria-describedby={compressionHelp} value={imageCompression} disabled={busy || loading} onChange={event => void chooseCompression(event.target.value as ImageCompression)}>
        <option value="lossy">{t('有损 · 节省空间', 'Lossy · Smaller files')}</option>
        <option value="lossless">{t('无损 · 保留原始像素', 'Lossless · Preserve pixels')}</option>
      </select></label>
      <small id={compressionHelp}>{t('默认有损。用于之后导入、粘贴或重新关联的图片，保留图片尺寸和透明背景。', 'Lossy by default. Applies to future imports, pastes and relinks, preserving dimensions and transparency.')}</small>
      <label>{t('默认项目保存位置', 'Default project location')}</label>
      <output className="settings-path">{root || t('正在读取…', 'Loading…')}</output><button type="button" disabled={busy} onClick={() => void chooseRoot()}>{t('选择文件夹', 'Choose folder')}</button><small>{t('只影响以后新建的项目，不移动当前项目。', 'Applies to new projects. Existing projects stay where they are.')}</small>
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>;
}
