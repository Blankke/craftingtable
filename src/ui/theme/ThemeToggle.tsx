// 用法：放在全局页头中，点击在浅色与深色模式间切换；组件保持独立，不依赖主题选择器弹窗。
// 日月图标参考 DHxWhy/CCgather 的 theme-switcher（Apache-2.0）；改为可逆过渡，适配本项目主题存储。
import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from './themeStore';
import { useLanguage } from '../shared/language';

export function ThemeToggle() {
  const { t } = useLanguage();
  const mode = useThemeStore(state => state.mode);
  const toggleMode = useThemeStore(state => state.toggleMode);
  const dark = mode === 'dark';
  return <button type="button" className={`theme-toggle${dark ? ' is-dark' : ''}`} aria-label={dark ? t('切换到浅色模式', 'Switch to light mode') : t('切换到深色模式', 'Switch to dark mode')} aria-pressed={dark} title={dark ? t('浅色模式', 'Light mode') : t('深色模式', 'Dark mode')} onClick={toggleMode}>
    <span className="theme-toggle-sky" aria-hidden="true"><span className="theme-toggle-night" /><span className="theme-toggle-stars" /><Sun className="theme-toggle-sun" size={18} /><Moon className="theme-toggle-moon" size={18} fill="currentColor" /></span>
  </button>;
}
