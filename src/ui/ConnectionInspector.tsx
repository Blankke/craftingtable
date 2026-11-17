// 用法：<ConnectionInspector editor={editor} connections={...}/>。编辑箭头线型、起止头部、颜色与线宽。
// 起止头部改为带 SVG 线段与端点形状的可访问选项网格，颜色入口复用统一颜色弹层。
import type { Editor } from '../core/editor';
import { useState } from 'react';
import type { ProjectDocument } from '../core/document';
import { arrowHeadStyles, arrowLineStyles } from '../core/elementStyles';
import { useTheme } from './themeStore';
import { colorToHex } from '../core/theme';
import { ColorTrigger } from './ColorEditor';
import { useLanguage } from './language';

type HeadId = NonNullable<ProjectDocument['connections'][number]['style']>['endHead'];
type DashId = NonNullable<ProjectDocument['connections'][number]['style']>['dash'];

/** 用一条水平线段与端点形状呈现头部选项的可见预览。 */
function ArrowHeadGlyph({ head }: { head: HeadId }) {
  const line = <line x1="8" y1="10" x2={head === 'none' ? 42 : 35} y2="10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />;
  if (head === 'none') return <svg className="arrow-head-preview" viewBox="0 0 50 20" aria-hidden="true">{line}</svg>;
  return <svg className="arrow-head-preview" viewBox="0 0 50 20" aria-hidden="true">
    {line}
    {head === 'arrow' && <polygon points="43,10 32,3 32,17" fill="currentColor" />}
    {head === 'open' && <polyline points="34,4 43,10 34,16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />}
    {head === 'diamond' && <polygon points="39,10 34,4 29,10 34,16" fill="currentColor" />}
    {head === 'circle' && <circle cx="36" cy="10" r="4.2" fill="currentColor" />}
    {head === 'square' && <rect x="32" y="5" width="9" height="9" fill="currentColor" />}
    {head === 'block' && <polygon points="43,10 30,1.5 30,18.5" fill="currentColor" />}
  </svg>;
}

export function ConnectionInspector({ editor, connections }: { editor: Editor; connections: ProjectDocument['connections'] }) {
  const { t } = useLanguage();
  const { tokens } = useTheme();
  const defaultColor = colorToHex(tokens.primary);
  const connection = connections[0];
  const [copied, setCopied] = useState<Pick<ProjectDocument['connections'][number], 'routing' | 'style'> | null>(null);
  if (!connection) return <p className="panel-hint">单击画布箭头后，在这里编辑线型、箭头头部和颜色。</p>;
  const style = connection.style ?? {};
  const update = (patch: NonNullable<ProjectDocument['connections'][number]['style']>) => editor.execute(draft => {
    const ids = new Set(connections.map(item => item.id));
    for (const target of draft.connections) if (ids.has(target.id)) target.style = { ...(target.style ?? {}), ...patch };
  });
  const updateRouting = (routing: ProjectDocument['connections'][number]['routing']) => editor.execute(draft => {
    const ids = new Set(connections.map(item => item.id));
    for (const target of draft.connections) if (ids.has(target.id)) target.routing = routing;
  });
  return <div className="object-inspector">
    <fieldset><legend>{t('路径', 'Routing')}</legend>
      <select aria-label={t('连接线路径', 'Connector routing')} value={connection.routing} onChange={e => updateRouting(e.target.value as ProjectDocument['connections'][number]['routing'])}>
        <option value="straight">{t('直线', 'Straight')}</option><option value="elbow">{t('正交折线', 'Orthogonal')}</option><option value="curve">{t('曲线', 'Curve')}</option>
      </select>
      {connection.routing === 'elbow' && <label><input type="checkbox" checked={style.rounded ?? false} onChange={e => update({ rounded: e.target.checked })} />{t('圆角', 'Rounded')}</label>}
    </fieldset>
    <fieldset><legend>{t('线型', 'Line style')}</legend>
      <div className="tool-grid">{arrowLineStyles.map(item => <button key={item.id} aria-pressed={(style.dash ?? 'dashed') === item.id} onClick={() => update({ dash: item.id as DashId })}>{item.label}</button>)}</div>
      <label>{t('自定义间隔', 'Custom dash')}<input aria-label={t('自定义间隔', 'Custom dash')} defaultValue={(style.customDash ?? [8, 5]).join(',')} onBlur={e => { const values = e.currentTarget.value.split(',').map(Number); if (values.length >= 2 && values.length <= 8 && values.every(value => Number.isFinite(value) && value > 0 && value <= 100)) update({ dash: 'custom', customDash: values }); }} /></label>
    </fieldset>
    <fieldset><legend>{t('箭头头部', 'Arrow heads')}</legend>
      <label>{t('起点', 'Start')}</label>
      <div className="arrow-head-grid" role="group" aria-label={t('起点头部', 'Start head')}>{arrowHeadStyles.map(head => <button key={head.id} aria-pressed={(style.startHead ?? 'none') === head.id} title={head.label} onClick={() => update({ startHead: head.id as HeadId })}><ArrowHeadGlyph head={head.id as HeadId} /><span>{head.label}</span></button>)}</div>
      <label>{t('终点', 'End')}</label>
      <div className="arrow-head-grid" role="group" aria-label={t('终点头部', 'End head')}>{arrowHeadStyles.map(head => <button key={head.id} aria-pressed={(style.endHead ?? 'arrow') === head.id} title={head.label} onClick={() => update({ endHead: head.id as HeadId })}><ArrowHeadGlyph head={head.id as HeadId} /><span>{head.label}</span></button>)}</div>
    </fieldset>
    <label>{t('颜色', 'Color')}<ColorTrigger label={t('箭头颜色', 'Arrow color')} value={style.color ?? defaultColor} onChange={color => update({ color })} /></label>
    <label>{t('线宽', 'Width')}<input aria-label={t('箭头线宽', 'Arrow width')} type="number" min="0" max="40" defaultValue={style.strokeWidth ?? 2} key={style.strokeWidth ?? 2} onBlur={e => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n)) update({ strokeWidth: Math.max(0, Math.min(40, n)) }); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
    <label>{t('端点大小', 'Head size')}<input aria-label={t('端点大小', 'Head size')} type="number" min="4" max="64" value={style.headSize ?? 12} onChange={e => update({ headSize: Math.max(4, Math.min(64, Number(e.target.value) || 12)) })} /></label>
    <label>{t('透明度（%）', 'Opacity (%)')}<input aria-label={t('连接线透明度', 'Connector opacity')} type="number" min="0" max="100" value={Math.round((style.opacity ?? 1) * 100)} onChange={e => update({ opacity: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })} /></label>
    <label>{t('标签', 'Label')}<input aria-label={t('连接线标签', 'Connector label')} value={style.label ?? ''} onChange={e => update({ label: e.target.value })} /></label>
    <div className="tool-grid"><button onClick={() => setCopied({ routing: connection.routing, style: structuredClone(connection.style) })}>{t('复制样式', 'Copy style')}</button><button disabled={!copied} onClick={() => { if (!copied) return; editor.execute(draft => { const ids = new Set(connections.map(item => item.id)); draft.connections.forEach(target => { if (ids.has(target.id)) { target.routing = copied.routing; target.style = structuredClone(copied.style); } }); }); }}>{t('粘贴样式', 'Paste style')}</button></div>
    <button onClick={() => editor.execute(draft => { const ids = new Set(connections.map(item => item.id)); for (const target of draft.connections) if (ids.has(target.id)) delete target.style; })}>{t('恢复默认样式', 'Restore default')}</button>
  </div>;
}
