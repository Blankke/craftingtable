// 用法：<ThemePicker onClose={...}/>。主题卡片画廊：切换、明暗、收藏、基于主色新建自定义主题。
import { useState } from 'react';
import { colorToHex, deriveTheme, themes, type Theme } from '../core/theme';
import { useThemeStore, type ThemeMode } from './themeStore';
import { useLanguage } from './language';

function ThemePreview({ theme, mode }: { theme: Theme; mode: ThemeMode }) {
  const tk = theme[mode].tokens;
  const c = (color: string) => colorToHex(color);
  return <svg className="theme-preview" viewBox="0 0 150 86" aria-hidden="true">
    <rect x="0" y="0" width="150" height="86" fill={c(tk.background)} />
    <g stroke={c(tk.grid)} strokeWidth="1">
      {[20, 40, 60, 80, 100, 120].map(x => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="86" />)}
      {[20, 40, 60].map(y => <line key={`h${y}`} x1="0" y1={y} x2="150" y2={y} />)}
    </g>
    <rect x="106" y="0" width="44" height="86" fill={c(tk.surface)} stroke={c(tk.border)} />
    <rect x="12" y="10" width="56" height="26" rx="4" fill={c(tk.card)} stroke={c(tk.primary)} strokeWidth="1.5" />
    <rect x="17" y="16" width="40" height="5" rx="1" fill={c(tk.mutedForeground)} />
    <rect x="17" y="25" width="30" height="4" rx="1" fill={c(tk.border)} />
    <rect x="12" y="48" width="34" height="22" rx="2" fill={c(tk.accent)} stroke={c(tk.border)} />
    <rect x="17" y="54" width="24" height="4" rx="1" fill={c(tk.foreground)} />
    <line x1="72" y1="22" x2="96" y2="46" stroke={c(tk.primary)} strokeWidth="2" strokeDasharray="4 3" />
    <polygon points="96,46 89,41 94,47" fill={c(tk.primary)} />
    <rect x="12" y="74" width="76" height="8" rx="2" fill={c(tk.muted)} stroke={c(tk.border)} />
    <polyline points="14,79 22,75 29,81 36,75 43,79 50,76" fill="none" stroke={c(tk.primary)} strokeWidth="1.5" />
  </svg>;
}

export function ThemePicker({ onClose }: { onClose(): void }) {
  const { t } = useLanguage();
  const activeThemeId = useThemeStore(state => state.activeThemeId);
  const mode = useThemeStore(state => state.mode);
  const favorites = useThemeStore(state => state.favorites);
  const customThemes = useThemeStore(state => state.customThemes);
  const setTheme = useThemeStore(state => state.setTheme);
  const toggleMode = useThemeStore(state => state.toggleMode);
  const toggleFavorite = useThemeStore(state => state.toggleFavorite);
  const addCustomTheme = useThemeStore(state => state.addCustomTheme);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState('#6366f1');
  const allThemes = [...customThemes, ...themes];
  const baseTheme = allThemes.find(theme => theme.id === activeThemeId) ?? themes[0];
  const createCustom = () => {
    const custom = deriveTheme(baseTheme, `custom-${Date.now()}`, name.trim() || t('自定义主题', 'Custom theme'), primary);
    addCustomTheme(custom); setTheme(custom.id); setCreating(false); setName(''); setPrimary('#6366f1');
  };
  return <div className="theme-picker-backdrop" role="dialog" aria-modal="true" aria-label={t('主题', 'Themes')}>
    <div className="theme-picker">
      <header className="theme-picker-head">
        <h2>{t('主题', 'Themes')}</h2>
        <div className="theme-picker-actions">
          <button aria-pressed={mode === 'dark'} onClick={toggleMode}>{mode === 'light' ? t('浅色', 'Light') : t('深色', 'Dark')}</button>
          <button onClick={() => setCreating(value => !value)}>{t('＋ 新建自定义主题', '＋ New custom theme')}</button>
          <button onClick={onClose} aria-label={t('关闭', 'Close')}>×</button>
        </div>
      </header>
      {creating && <form className="custom-theme-form" onSubmit={event => { event.preventDefault(); createCustom(); }}>
        <input aria-label={t('主题名称', 'Theme name')} placeholder={t('主题名称', 'Theme name')} value={name} onChange={event => setName(event.target.value)} maxLength={40} />
        <label>{t('主色', 'Primary')} <input aria-label={t('主题主色', 'Theme primary')} type="color" value={primary} onChange={event => setPrimary(event.target.value)} /></label>
        <button type="submit">{t('创建', 'Create')}</button>
      </form>}
      <div className="theme-grid">
        {allThemes.map(theme => {
          const tokens = theme[mode].tokens;
          const active = theme.id === activeThemeId;
          return <button key={theme.id} className={`theme-card${active ? ' active' : ''}`} aria-pressed={active} onClick={() => setTheme(theme.id)}>
            <ThemePreview theme={theme} mode={mode} />
            <div className="theme-card-meta">
              <b>{theme.name}</b>
              <span className="theme-swatches">{[tokens.primary, tokens.accent, tokens.secondary, tokens.foreground, tokens.border].map((color, index) => <i key={index} style={{ background: colorToHex(color) }} />)}</span>
              <button className="theme-fav" aria-label={t('收藏', 'Favorite')} aria-pressed={favorites.includes(theme.id)} onClick={event => { event.stopPropagation(); toggleFavorite(theme.id); }}>{favorites.includes(theme.id) ? '★' : '☆'}</button>
            </div>
          </button>;
        })}
      </div>
    </div>
  </div>;
}
