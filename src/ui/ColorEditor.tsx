// 用法：<ColorEditor fill={...} stroke={...} onPickFill onPickStroke onRestoreAuto/>。三段式：主题色 / Pantone / 自定义。
import { useState } from 'react';
import { useTheme } from './themeStore';
import { useThemeStore } from './themeStore';
import { pantoneColors } from '../core/pantone';
import { colorToHex, isDarkColor } from '../core/theme';
import { useLanguage } from './language';

export function ColorEditor({ fill, stroke, onPickFill, onPickStroke, onRestoreAuto }: {
  fill?: string; stroke?: string;
  onPickFill(color: string): void;
  onPickStroke(color: string): void;
  onRestoreAuto?(): void;
}) {
  const { t } = useLanguage();
  const { tokens, trackPalette } = useTheme();
  const customColors = useThemeStore(state => state.customColors);
  const addCustomColor = useThemeStore(state => state.addCustomColor);
  const [section, setSection] = useState<'theme' | 'pantone' | 'custom'>('theme');
  const [custom, setCustom] = useState(fill ?? '#6366f1');
  const themePalette = [tokens.primary, tokens.secondary, tokens.accent, tokens.muted, tokens.foreground, tokens.border, tokens.destructive, ...trackPalette];
  const years = [...new Set(pantoneColors.map(color => color.year))].sort((a, b) => b - a);
  return <div className="color-editor">
    <div className="color-editor-tabs" role="tablist">
      {([['theme', t('主题色', 'Theme')], ['pantone', 'Pantone'], ['custom', t('自定义', 'Custom')]] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)}>{label}</button>)}
    </div>
    {section === 'theme' && <div className="swatch-grid">
      {themePalette.map(color => <button key={color} className="swatch" aria-label={color} style={{ background: colorToHex(color) }} onClick={() => onPickFill(color)} />)}
      {onRestoreAuto && <button className="swatch-action" onClick={onRestoreAuto}>{t('恢复自动配色', 'Restore auto')}</button>}
    </div>}
    {section === 'pantone' && <div className="pantone-list">
      {years.map(year => <fieldset key={year} className="pantone-year"><legend>{year}</legend>
        <div className="swatch-grid">
          {pantoneColors.filter(color => color.year === year).map(color => <button key={`${year}-${color.pantone}`} className="swatch" title={`${color.name} ${color.nameEn} ${color.pantone}`} aria-label={`${year} ${color.name}`} style={{ background: color.hex }} onClick={() => onPickFill(color.hex)} />)}
        </div>
      </fieldset>)}
    </div>}
    {section === 'custom' && <div className="custom-color">
      <div className="custom-color-row">
        <input aria-label={t('自定义颜色', 'Custom color')} type="color" value={custom} onChange={event => { setCustom(event.target.value); onPickFill(event.target.value); }} />
        <input aria-label={t('颜色值', 'Color value')} type="text" value={custom} onChange={event => { const value = event.target.value; setCustom(value); if (/^#[0-9a-fA-F]{6}$/.test(value)) onPickFill(value); }} />
      </div>
      <div className="custom-color-row">
        <button onClick={() => { addCustomColor(custom); onPickFill(custom); }}>{t('保存到自定义', 'Save custom')}</button>
        <button onClick={() => { addCustomColor(fill ?? custom); }}>{t('收藏当前色', 'Favorite current')}</button>
      </div>
      {customColors.length > 0 && <div className="swatch-grid">{customColors.map(color => <button key={color} className="swatch" aria-label={color} style={{ background: colorToHex(color) }} onClick={() => { setCustom(color); onPickFill(color); }} />)}</div>}
    </div>}
    <div className="color-editor-targets">
      <span>{t('当前填充', 'Fill')}</span><i style={{ background: fill ? colorToHex(fill) : 'transparent', color: fill && isDarkColor(fill) ? '#fff' : '#000' }} />{fill ?? '—'}
      <span>{t('描边', 'Stroke')}</span><i style={{ background: stroke ? colorToHex(stroke) : 'transparent', color: stroke && isDarkColor(stroke) ? '#fff' : '#000' }} />{stroke ?? '—'}
      <button onClick={() => { if (stroke) onPickStroke(stroke); }} aria-label={t('描边取填充色', 'Use fill for stroke')}>{t('描边↔填充', 'Sync')}</button>
    </div>
  </div>;
}
