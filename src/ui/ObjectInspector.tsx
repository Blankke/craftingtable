// 用法：<ObjectInspector editor={editor} objects={selection}/>；样式预设、颜色库与文本/排列均通过命令写入，支持撤销。
import { useState } from 'react';
import type { Arrangement, Editor } from '../core/editor';
import type { CanvasObject } from '../core/document';
import { resizeObject, styleOf } from '../core/appearance';
import { stylePresetsFor } from '../core/elementStyles';
import { TextToolbar } from './TextToolbar';
import { ColorEditor } from './ColorEditor';
import { useLanguage } from './language';

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min?: number; max?: number; onChange(value: number): void }) {
  // 使用非受控输入容许清空和输入小数，失焦后校验；切换对象时由父组件 key 重建。
  return <label>{label}<input aria-label={label} type="number" defaultValue={Math.round(value * 100) / 100} key={value} min={min} max={max} step="any" onBlur={event => { const n = event.currentTarget.valueAsNumber; if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))); else event.currentTarget.value = String(value); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

function PresetCard({ label, style }: { label: string; style: NonNullable<CanvasObject['style']> }) {
  const stroke = style.strokeEnabled ? '#5b6cff' : 'rgba(0,0,0,0)';
  const fill = style.fillEnabled ? '#e8ecff' : 'rgba(0,0,0,0)';
  const dash = style.dash === 'dashed' ? '8 5' : style.dash === 'dotted' ? '2 4' : 'none';
  return <span className="preset-card"><svg viewBox="0 0 48 30" aria-hidden="true">
    <rect x="6" y="5" width="36" height="20" rx="4" fill={fill} stroke={stroke} strokeWidth={style.strokeWidth} strokeDasharray={dash} opacity={style.opacity} />
  </svg><em>{label}</em></span>;
}

export function ObjectInspector({ editor, objects }: { editor: Editor; objects: CanvasObject[] }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState('样式');
  const object = objects[0];
  if (!object) return <p className="panel-hint">单击画布对象后，在这里编辑样式、颜色、文字和排列。</p>;
  const style = styleOf(object);
  const update = (change: (target: CanvasObject) => void) => editor.execute(draft => draft.objects.filter(item => objects.some(o => o.id === item.id)).forEach(change));
  const updateStyle = (patch: Partial<typeof style>) => update(target => { target.style = { ...styleOf(target), ...patch }; });
  const resetStyle = () => update(target => { delete target.style; });
  const crop = object.kind === 'image' ? object.crop ?? { x: 0, y: 0, width: 1, height: 1 } : null;
  const cropField = (field: 'x' | 'y' | 'width' | 'height', value: number) => update(target => {
    if (target.kind !== 'image') return;
    const next = { ...(target.crop ?? { x: 0, y: 0, width: 1, height: 1 }), [field]: value / 100 };
    next.width = Math.min(next.width, 1 - next.x); next.height = Math.min(next.height, 1 - next.y);
    if (next.width <= 0 || next.height <= 0) return;
    const old = target.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    if (target.aspectLocked !== false) target.height = target.height * next.height / old.height * old.width / next.width;
    target.crop = next;
  });
  const applyFill = (color: string) => {
    if (object.kind === 'media') update(target => { if (target.kind === 'media') { target.color = color; target.autoColor = false; } });
    else updateStyle({ fill: color, fillEnabled: true });
  };
  const applyStroke = (color: string) => updateStyle({ stroke: color, strokeEnabled: true });
  const restoreAuto = () => update(target => { if (target.kind === 'media') { delete target.color; target.autoColor = true; } });
  const presets = stylePresetsFor(object.kind);
  const arrange = (operation: Arrangement) => editor.arrangeObjects(objects.map(item => item.id), operation);
  return <div className="object-inspector">
    <div className="inspector-tabs" role="tablist">{['样式', '颜色', '文本', '排列'].map(item => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === '样式' && <>
      <div className="preset-grid">{presets.map(preset => <button key={preset.id} className="preset-card" aria-label={preset.label} onClick={() => updateStyle(preset.style)}><PresetCard label={preset.label} style={{ ...style, ...preset.style }} /></button>)}</div>
      {object.kind !== 'image' && object.kind !== 'media' && <fieldset><legend>{t('填充', 'Fill')}</legend>
        <label><span><input type="checkbox" checked={style.fillEnabled} onChange={e => updateStyle({ fillEnabled: e.target.checked })} />{t('启用填充', 'Fill on')}</span><input aria-label={t('填充颜色', 'Fill color')} type="color" value={style.fill} onChange={e => updateStyle({ fill: e.target.value })} /></label>
        <label><span><input type="checkbox" checked={style.gradient} onChange={e => updateStyle({ gradient: e.target.checked })} />{t('渐变', 'Gradient')}</span><input aria-label={t('渐变颜色', 'Gradient color')} type="color" value={style.gradientColor} onChange={e => updateStyle({ gradientColor: e.target.value })} /></label>
        {style.gradient && <label>{t('渐变方向', 'Direction')}<select value={style.gradientDirection} onChange={e => updateStyle({ gradientDirection: e.target.value as 'vertical' | 'horizontal' })}><option value="vertical">{t('上下', 'Vertical')}</option><option value="horizontal">{t('左右', 'Horizontal')}</option></select></label>}
      </fieldset>}
      <fieldset><legend>{t('线条', 'Stroke')}</legend><label><span><input type="checkbox" checked={style.strokeEnabled} onChange={e => updateStyle({ strokeEnabled: e.target.checked })} />{t('启用线条', 'Stroke on')}</span><input aria-label={t('线条颜色', 'Stroke color')} type="color" value={style.stroke} onChange={e => updateStyle({ stroke: e.target.value })} /></label>
        <label>{t('线型', 'Line style')}<select aria-label={t('线型', 'Line style')} value={style.dash} onChange={e => updateStyle({ dash: e.target.value as typeof style.dash })}><option value="solid">{t('实线', 'Solid')}</option><option value="dashed">{t('虚线', 'Dashed')}</option><option value="dotted">{t('点线', 'Dotted')}</option></select></label>
        <NumberField label={t('线宽', 'Width')} value={style.strokeWidth} min={0} max={40} onChange={strokeWidth => updateStyle({ strokeWidth })} />
        <NumberField label={t('周长间距', 'Perimeter gap')} value={style.perimeter} min={0} max={100} onChange={perimeter => updateStyle({ perimeter })} />
      </fieldset>
      <NumberField label={t('不透明度（%）', 'Opacity (%)')} value={style.opacity * 100} min={0} max={100} onChange={value => updateStyle({ opacity: value / 100 })} />
      <button onClick={resetStyle}>{t('恢复默认样式', 'Restore default style')}</button>
    </>}
    {tab === '颜色' && <ColorEditor fill={object.kind === 'media' ? object.color : style.fill} stroke={style.stroke} onPickFill={applyFill} onPickStroke={applyStroke} onRestoreAuto={object.kind === 'media' ? restoreAuto : undefined} />}
    {tab === '文本' && (('text' in object || 'fill' in object) ? <>
      <label>{t('内容', 'Content')}<textarea aria-label={t('对象文字', 'Object text')} value={object.text ?? ''} onChange={e => update(target => { if ('text' in target || 'fill' in target) target.text = e.target.value; })} /></label>
      <TextToolbar editor={editor} object={object} />
      <label>{t('字体', 'Font')}<select value={style.fontFamily} onChange={e => updateStyle({ fontFamily: e.target.value })}>{['Microsoft YaHei', 'SimSun', 'Arial', 'Georgia', 'monospace'].map(font => <option key={font}>{font}</option>)}</select></label>
      <div className="inspector-tabs">{(['bold', 'italic', 'underline'] as const).map((key, index) => <button key={key} aria-pressed={style[key]} onClick={() => updateStyle({ [key]: !style[key] })}>{[t('粗体', 'Bold'), t('斜体', 'Italic'), t('下划线', 'Underline')][index]}</button>)}</div>
      <label>{t('垂直对齐', 'Vertical align')}<select value={style.verticalAlign} onChange={e => updateStyle({ verticalAlign: e.target.value as typeof style.verticalAlign })}><option value="top">{t('顶部', 'Top')}</option><option value="middle">{t('居中', 'Middle')}</option><option value="bottom">{t('底部', 'Bottom')}</option></select></label>
    </> : <p className="panel-hint">双击文字或形状可直接编辑内容。</p>)}
    {tab === '排列' && <>
      <NumberField label="X" value={object.x} onChange={x => editor.moveObjects(objects.map(o => o.id), x - object.x, 0)} />
      <NumberField label="Y" value={object.y} onChange={y => editor.moveObjects(objects.map(o => o.id), 0, y - object.y)} />
      <NumberField label={t('旋转（°）', 'Rotation (°)')} value={object.rotation ?? 0} min={-360} max={360} onChange={rotation => update(target => { target.rotation = rotation || undefined; })} />
      {object.kind !== 'media' && <><NumberField label={t('宽度', 'Width')} value={object.width} min={12} onChange={width => update(target => resizeObject(target, width, target.height))} /><NumberField label={t('高度', 'Height')} value={object.height} min={12} onChange={height => update(target => resizeObject(target, target.width, height, 'height'))} /></>}
      {object.kind === 'image' && <><label><span><input aria-label={t('锁定比例', 'Lock aspect')} type="checkbox" checked={object.aspectLocked !== false} onChange={e => update(target => { if (target.kind === 'image') target.aspectLocked = e.target.checked; })} />{t('锁定比例', 'Lock aspect')}</span></label><fieldset><legend>{t('裁剪（原图百分比）', 'Crop (%)')}</legend>{!object.crop && <button onClick={() => update(target => { if (target.kind === 'image') target.crop = { x: .05, y: .05, width: .9, height: .9 }; })}>{t('开始裁剪', 'Start crop')}</button>}{(['x', 'y', 'width', 'height'] as const).map((field, index) => <NumberField key={field} label={[t('裁剪左侧', 'Crop left'), t('裁剪顶部', 'Crop top'), t('裁剪宽度', 'Crop width'), t('裁剪高度', 'Crop height')][index]} value={crop![field] * 100} min={field === 'x' || field === 'y' ? 0 : 1} max={field === 'x' || field === 'y' ? 99 : 100} onChange={value => cropField(field, value)} />)}<button onClick={() => update(target => { if (target.kind === 'image') { if (target.aspectLocked !== false && target.crop) target.height *= target.crop.width / target.crop.height; delete target.crop; } })}>{t('恢复原图', 'Restore original')}</button></fieldset></>}
      {objects.length > 1 && <fieldset><legend>{t('对齐与分布', 'Align & distribute')}</legend><div className="tool-grid">{([['left', '左对齐'], ['center-x', '水平居中'], ['right', '右对齐'], ['top', '顶对齐'], ['middle-y', '垂直居中'], ['bottom', '底对齐'], ['distribute-x', '水平分布'], ['distribute-y', '垂直分布']] as const).map(([operation, label]) => <button key={operation} onClick={() => arrange(operation)}>{t(label, operation)}</button>)}</div></fieldset>}
      <div className="tool-grid"><button onClick={() => editor.execute(draft => { const chosen = draft.objects.filter(o => objects.some(item => item.id === o.id)); draft.objects = [...draft.objects.filter(o => !chosen.includes(o)), ...chosen]; })}>{t('置于顶层', 'Bring to front')}</button><button onClick={() => editor.execute(draft => { const chosen = draft.objects.filter(o => objects.some(item => item.id === o.id)); draft.objects = [...chosen, ...draft.objects.filter(o => !chosen.includes(o))]; })}>{t('置于底层', 'Send to back')}</button>
      {objects.length > 1 && <button onClick={() => editor.group(objects.map(o => o.id))}>{t('分组', 'Group')}</button>}{object.groupId && <button onClick={() => editor.ungroup(object.groupId!)}>{t('解组', 'Ungroup')}</button>}</div>
    </>}
  </div>;
}
