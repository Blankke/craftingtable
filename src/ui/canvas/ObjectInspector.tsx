// 用法：<ObjectInspector editor={editor} objects={selection} assets={document.assets}/>；样式预设、颜色库与文本/排列均通过命令写入，支持撤销。
// 颜色不再单独成页签，而是以统一弹层嵌入填充、渐变、线条、媒体轨道与文本各自的颜色入口；图片提供「还原比例」恢复自然比例。
import { useState } from 'react';
import type { Arrangement, Editor } from '../../core/editor';
import type { CanvasObject, ProjectDocument } from '../../core/document';
import { isShapeObject, lockStandardShape, resizeObject, restoredImageRatio, styleOf } from '../../core/appearance';
import { stylePresetsFor } from '../../core/elementStyles';
import { TextToolbar } from './TextToolbar';
import { ColorTrigger } from '../theme/ColorEditor';
import { mediaSource } from '../media/mediaSource';
import { useLanguage } from '../shared/language';
import { NumberField } from '../shared/NumberField';
import { MousePointer2 } from 'lucide-react';

function PresetCard({ label, style }: { label: string; style: NonNullable<CanvasObject['style']> }) {
  const stroke = style.strokeEnabled ? '#5b6cff' : 'rgba(0,0,0,0)';
  const fill = style.fillEnabled ? '#e8ecff' : 'rgba(0,0,0,0)';
  const dash = style.dash === 'dashed' ? '8 5' : style.dash === 'dotted' ? '2 4' : 'none';
  return <span className="preset-preview"><svg viewBox="0 0 48 30" aria-hidden="true">
    <rect x="6" y="5" width="36" height="20" rx="4" fill={fill} stroke={stroke} strokeWidth={style.strokeWidth} strokeDasharray={dash} opacity={style.opacity} />
  </svg><em>{label}</em></span>;
}

export function ObjectInspector({ editor, objects, assets }: { editor: Editor; objects: CanvasObject[]; assets: ProjectDocument['assets'] }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState('样式');
  const object = objects[0];
  if (!object) return <div className="inspector-empty"><MousePointer2 size={24} strokeWidth={1.4} /><span>{t('未选择对象', 'No object selected')}</span></div>;
  const style = styleOf(object);
  const update = (change: (target: CanvasObject) => void) => editor.execute(draft => draft.objects.filter(item => objects.some(o => o.id === item.id)).forEach(change));
  const updateStyle = (patch: Partial<typeof style>) => update(target => { target.style = { ...styleOf(target), ...patch }; });
  const previewUpdate = (change: (target: CanvasObject) => void) => editor.preview(draft => draft.objects.filter(item => objects.some(object => object.id === item.id)).forEach(change));
  const previewStyle = (patch: Partial<typeof style>) => previewUpdate(target => { target.style = { ...styleOf(target), ...patch }; });
  const previewPosition = (axis: 'x' | 'y', value: number) => editor.preview(draft => {
    const source = draft.objects.find(item => item.id === object.id)!;
    const delta = value - source[axis];
    const ids = editor.expandObjectIds(objects.map(item => item.id), draft);
    for (const target of draft.objects.filter(item => ids.has(item.id))) {
      target[axis] += delta;
      if (target.kind === 'stroke') target.points = target.points.map(point => ({ ...point, [axis]: point[axis] + delta }));
    }
  });
  const resetStyle = () => update(target => { delete target.style; });
  const crop = object.kind === 'image' ? object.crop ?? { x: 0, y: 0, width: 1, height: 1 } : null;
  const cropField = (field: 'x' | 'y' | 'width' | 'height', value: number) => previewUpdate(target => {
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
  // 还原图片自然比例：读取素材尺寸；存在裁剪时按可见裁剪区域比例，保持高度不变重算宽度并重新启用锁定。
  const restoreAspect = async () => {
    if (object.kind !== 'image') return;
    const asset = assets.find(item => item.id === object.assetId);
    if (!asset) return;
    try {
      const image = new Image(); image.src = mediaSource(asset.path); await image.decode();
      const cropRegion = object.kind === 'image' ? object.crop : undefined;
      const ratio = restoredImageRatio(cropRegion, image.naturalWidth, image.naturalHeight);
      update(target => { if (target.kind === 'image') { target.width = target.height * ratio; target.aspectLocked = true; } });
    } catch (error) {
      alert(`${t('素材无法解码，已保留当前尺寸', 'Could not decode the asset; kept current size')}：${String(error)}`);
    }
  };
  const presets = stylePresetsFor(object.kind);
  const arrange = (operation: Arrangement) => editor.arrangeObjects(objects.map(item => item.id), operation);
  return <div className="object-inspector">
    <fieldset className="object-geometry"><legend>{t('位置与尺寸', 'Position and size')}</legend><NumberField editor={editor} label="X" value={object.x} onPreview={x => previewPosition('x', x)} />
      <NumberField editor={editor} label="Y" value={object.y} onPreview={y => previewPosition('y', y)} />
      <NumberField editor={editor} label={t('旋转（°）', 'Rotation (°)')} value={object.rotation ?? 0} min={-360} max={360} onPreview={rotation => editor.preview(draft => { draft.objects.filter(item => objects.some(o => o.id === item.id)).forEach(target => { target.rotation = rotation || undefined; }); })} />
      {object.kind !== 'media' && <><NumberField editor={editor} label={t('宽度', 'Width')} value={object.width} min={12} onPreview={width => previewUpdate(target => resizeObject(target, width, target.height))} /><NumberField editor={editor} label={t('高度', 'Height')} value={object.height} min={12} onPreview={height => previewUpdate(target => resizeObject(target, target.width, height, 'height'))} /></>}
      {isShapeObject(object) && <label><span><input type="checkbox" aria-label={t('锁定标准比例', 'Lock standard proportions')} checked={object.aspectLocked === true} onChange={event => update(target => lockStandardShape(target, event.target.checked))} />{t('锁定标准比例', 'Lock standard proportions')}</span></label>}
    </fieldset>
    <div className="inspector-tabs" role="tablist">{['样式', '文本', '排列'].map(item => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === '样式' && <>
      <div className="preset-grid">{presets.map(preset => <button key={preset.id} className="preset-option" aria-label={preset.label} onClick={() => updateStyle(preset.style)}><PresetCard label={preset.label} style={{ ...style, ...preset.style }} /></button>)}</div>
      {object.kind === 'media' && <fieldset><legend>{t('轨道颜色', 'Track color')}</legend><div className="inspector-color-row"><ColorTrigger label={t('轨道颜色', 'Track color')} value={object.color ?? '#8888ff'} onChange={applyFill} /><button onClick={restoreAuto}>{t('恢复自动配色', 'Restore auto')}</button></div></fieldset>}
      {object.kind !== 'image' && object.kind !== 'media' && <fieldset><legend>{t('填充', 'Fill')}</legend>
        <label><span><input type="checkbox" checked={style.fillEnabled} onChange={e => updateStyle({ fillEnabled: e.target.checked })} />{t('启用填充', 'Fill on')}</span><ColorTrigger label={t('填充颜色', 'Fill color')} value={style.fill} onChange={applyFill} /></label>
        <label><span><input type="checkbox" checked={style.gradient} onChange={e => updateStyle({ gradient: e.target.checked })} />{t('渐变', 'Gradient')}</span><ColorTrigger label={t('渐变颜色', 'Gradient color')} value={style.gradientColor} onChange={color => updateStyle({ gradientColor: color })} /></label>
        {style.gradient && <label>{t('渐变方向', 'Direction')}<select value={style.gradientDirection} onChange={e => updateStyle({ gradientDirection: e.target.value as 'vertical' | 'horizontal' })}><option value="vertical">{t('上下', 'Vertical')}</option><option value="horizontal">{t('左右', 'Horizontal')}</option></select></label>}
      </fieldset>}
      <fieldset><legend>{t('线条', 'Stroke')}</legend><label><span><input type="checkbox" checked={style.strokeEnabled} onChange={e => updateStyle({ strokeEnabled: e.target.checked })} />{t('启用线条', 'Stroke on')}</span><ColorTrigger label={t('线条颜色', 'Stroke color')} value={style.stroke} onChange={applyStroke} /></label>
        <label>{t('线型', 'Line style')}<select aria-label={t('线型', 'Line style')} value={style.dash} onChange={e => updateStyle({ dash: e.target.value as typeof style.dash })}><option value="solid">{t('实线', 'Solid')}</option><option value="dashed">{t('虚线', 'Dashed')}</option><option value="dotted">{t('点线', 'Dotted')}</option></select></label>
        <NumberField editor={editor} label={t('线宽', 'Width')} value={style.strokeWidth} min={0} max={40} onPreview={strokeWidth => previewStyle({ strokeWidth })} />
        <NumberField editor={editor} label={t('周长间距', 'Perimeter gap')} value={style.perimeter} min={0} max={100} onPreview={perimeter => previewStyle({ perimeter })} />
      </fieldset>
      <NumberField editor={editor} label={t('不透明度（%）', 'Opacity (%)')} value={style.opacity * 100} min={0} max={100} onPreview={value => previewStyle({ opacity: value / 100 })} />
      <button onClick={resetStyle}>{t('恢复默认样式', 'Restore default style')}</button>
    </>}
    {tab === '文本' && (('text' in object || 'fill' in object) ? <>
      <label>{t('内容', 'Content')}<textarea aria-label={t('对象文字', 'Object text')} value={object.text ?? ''} onChange={e => update(target => { if ('text' in target || 'fill' in target) target.text = e.target.value; })} /></label>
      <TextToolbar editor={editor} object={object} />
      <label>{t('字体', 'Font')}<select value={style.fontFamily} onChange={e => updateStyle({ fontFamily: e.target.value })}>{['Microsoft YaHei', 'SimSun', 'Arial', 'Georgia', 'monospace'].map(font => <option key={font}>{font}</option>)}</select></label>
      <div className="inspector-tabs">{(['bold', 'italic', 'underline'] as const).map((key, index) => <button key={key} aria-pressed={style[key]} onClick={() => updateStyle({ [key]: !style[key] })}>{[t('粗体', 'Bold'), t('斜体', 'Italic'), t('下划线', 'Underline')][index]}</button>)}</div>
      <label>{t('垂直对齐', 'Vertical align')}<select value={style.verticalAlign} onChange={e => updateStyle({ verticalAlign: e.target.value as typeof style.verticalAlign })}><option value="top">{t('顶部', 'Top')}</option><option value="middle">{t('居中', 'Middle')}</option><option value="bottom">{t('底部', 'Bottom')}</option></select></label>
    </> : <p className="panel-hint">双击文字或形状可直接编辑内容。</p>)}
    {tab === '排列' && <>

      {object.kind === 'image' && <><label><span><input aria-label={t('锁定比例', 'Lock aspect')} type="checkbox" checked={object.aspectLocked !== false} onChange={e => update(target => { if (target.kind === 'image') target.aspectLocked = e.target.checked; })} />{t('锁定比例', 'Lock aspect')}</span><button onClick={() => void restoreAspect()}>{t('还原比例', 'Restore aspect')}</button></label><fieldset><legend>{t('裁剪（原图百分比）', 'Crop (%)')}</legend>{!object.crop && <button onClick={() => update(target => { if (target.kind === 'image') target.crop = { x: .05, y: .05, width: .9, height: .9 }; })}>{t('开始裁剪', 'Start crop')}</button>}{(['x', 'y', 'width', 'height'] as const).map((field, index) => <NumberField editor={editor} key={field} label={[t('裁剪左侧', 'Crop left'), t('裁剪顶部', 'Crop top'), t('裁剪宽度', 'Crop width'), t('裁剪高度', 'Crop height')][index]} value={crop![field] * 100} min={field === 'x' || field === 'y' ? 0 : 1} max={field === 'x' || field === 'y' ? 99 : 100} onPreview={value => cropField(field, value)} />)}<button onClick={() => update(target => { if (target.kind === 'image') { if (target.aspectLocked !== false && target.crop) target.height *= target.crop.width / target.crop.height; delete target.crop; } })}>{t('恢复原图', 'Restore original')}</button></fieldset></>}
      {objects.length > 1 && <fieldset><legend>{t('对齐与分布', 'Align & distribute')}</legend><div className="tool-grid">{([['left', '左对齐'], ['center-x', '水平居中'], ['right', '右对齐'], ['top', '顶对齐'], ['middle-y', '垂直居中'], ['bottom', '底对齐'], ['distribute-x', '水平分布'], ['distribute-y', '垂直分布']] as const).map(([operation, label]) => <button key={operation} onClick={() => arrange(operation)}>{t(label, operation)}</button>)}</div></fieldset>}
      <div className="tool-grid"><button onClick={() => editor.execute(draft => { const chosen = draft.objects.filter(o => objects.some(item => item.id === o.id)); draft.objects = [...draft.objects.filter(o => !chosen.includes(o)), ...chosen]; })}>{t('置于顶层', 'Bring to front')}</button><button onClick={() => editor.execute(draft => { const chosen = draft.objects.filter(o => objects.some(item => item.id === o.id)); draft.objects = [...chosen, ...draft.objects.filter(o => !chosen.includes(o))]; })}>{t('置于底层', 'Send to back')}</button>
      {objects.length > 1 && <button onClick={() => editor.group(objects.map(o => o.id))}>{t('分组', 'Group')}</button>}{object.groupId && <button onClick={() => editor.ungroup(object.groupId!)}>{t('解组', 'Ungroup')}</button>}</div>
    </>}
  </div>;
}
