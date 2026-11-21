// 用法：<ColorTrigger label="填充" value={color} onChange={setColor}/>。统一颜色弹层嵌入填充、渐变、线条、文本、媒体轨道与连接线各自的颜色入口。
// 弹层上部为可点击色板，下部为「主题色 / Pantone / 自定义」三个来源按钮；切换来源只更新上方内容。选择颜色直接更新当前属性，撤销沿用编辑器命令。
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { useTheme, useThemeStore } from './themeStore';
import { pantoneColors } from '../../core/pantone';
import { colorToHex } from '../../core/theme';
import { useLanguage } from '../shared/language';

type Source = 'theme' | 'pantone' | 'custom';

export function ColorPopover({ value, anchor, onChange, onClose }: { value: string; anchor: HTMLElement; onChange(color: string): void; onClose(): void }) {
  const { t } = useLanguage();
  const { tokens, trackPalette } = useTheme();
  const customColors = useThemeStore(state => state.customColors);
  const addCustomColor = useThemeStore(state => state.addCustomColor);
  const removeCustomColor = useThemeStore(state => state.removeCustomColor);
  const [source, setSource] = useState<Source>('theme');
  const [custom, setCustom] = useState(/^#/.test(value) ? value : colorToHex(value));
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, ready: false });
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    let live = true;
    // Portal 脱离检查器滚动裁剪，浮动布局根据窗口边缘自动翻转并限制偏移。
    const stop = autoUpdate(anchor, panel, () => {
      void computePosition(anchor, panel, { strategy: 'fixed', placement: 'bottom-end', middleware: [offset(7), flip(), shift({ padding: 8 })] }).then(({ x, y }) => { if (live) setPosition({ x, y, ready: true }); });
    });
    return () => { live = false; stop(); };
  }, [anchor]);
  useEffect(() => {
    const onDown = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { onClose(); anchor.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose, anchor]);
  const themePalette = [...new Set([tokens.primary, tokens.secondary, tokens.accent, tokens.muted, tokens.foreground, tokens.border, tokens.destructive, ...trackPalette])];
  return createPortal(<div className="color-popover" ref={ref} style={{ position: 'fixed', left: position.x, top: position.y, visibility: position.ready ? 'visible' : 'hidden' }} role="dialog" aria-label={t('选择颜色', 'Pick a color')}>
    <div className="color-popover-swatches">
      {source === 'theme' && <div className="swatch-grid">{themePalette.map(color => <button key={color} className="swatch" aria-label={colorToHex(color)} style={{ background: colorToHex(color) }} onClick={() => onChange(color)} />)}</div>}
      {source === 'pantone' && <div className="swatch-grid">{pantoneColors.map(color => <button key={`${color.year}-${color.pantone}`} className="swatch" title={`${color.name} ${color.nameEn} ${color.pantone}`} aria-label={color.name} style={{ background: color.hex }} onClick={() => onChange(color.hex)} />)}</div>}
      {source === 'custom' && <div className="custom-color">
        <div className="custom-color-row">
          <input aria-label={t('取色', 'Pick color')} type="color" value={custom} onChange={event => { setCustom(event.target.value); onChange(event.target.value); }} />
          <input aria-label={t('颜色值', 'Color value')} type="text" value={custom} onChange={event => { const text = event.target.value; setCustom(text); if (/^#[0-9a-fA-F]{6}$/.test(text)) onChange(text); }} />
        </div>
        <button className="swatch-action" onClick={() => { addCustomColor(custom); onChange(custom); }}>{t('收藏当前色', 'Favorite current')}</button>
        {customColors.length > 0 && <div className="swatch-grid custom-swatches">{customColors.map(color => <span key={color} className="swatch-wrap"><button className="swatch" aria-label={colorToHex(color)} style={{ background: colorToHex(color) }} onClick={() => { setCustom(color); onChange(color); }} /><button className="swatch-remove" aria-label={t('删除收藏色', 'Remove favorite')} onClick={() => removeCustomColor(color)}>×</button></span>)}</div>}
      </div>}
    </div>
    <div className="color-popover-sources" role="tablist">
      {([['theme', t('主题色', 'Theme')], ['pantone', 'Pantone'], ['custom', t('自定义', 'Custom')]] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={source === id} onClick={() => setSource(id)}>{label}</button>)}
    </div>
  </div>, document.body);
}

export function ColorTrigger({ label, value, onChange }: { label: string; value: string; onChange(color: string): void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return <span className="color-trigger-wrap">
    <button ref={anchor} type="button" className="color-trigger" aria-label={label} aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <i className="color-trigger-swatch" style={{ background: colorToHex(value) }} /><span>{label}</span>
    </button>
    {open && anchor.current && <ColorPopover value={value} anchor={anchor.current} onChange={onChange} onClose={() => setOpen(false)} />}
  </span>;
}
