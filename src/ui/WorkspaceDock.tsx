// 用法：给工作台传入工具、素材库与编辑面板；拖动左边缘或面板底边调整大小。
// 「编辑」合并对象检查器与媒体工作区：按当前选中类型展示媒体控制、对象样式或箭头样式。
import { useEffect, useRef, useState, type ReactNode } from 'react';
export function WorkspaceDock({ tools, library, inspector, autoOpenProperties }: { tools: ReactNode; library: ReactNode; inspector: ReactNode; autoOpenProperties?: boolean }) {
  const [views, setViews] = useState(['tools', 'library']);
  const [width, setWidth] = useState(360);
  useEffect(() => { if (autoOpenProperties) setViews(current => current.includes('properties') ? current : [...current, 'properties']); }, [autoOpenProperties]);
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const resize = (x: number) => { if (resizing.current) setWidth(Math.max(280, Math.min(innerWidth * .7, resizing.current.width + resizing.current.x - x))); };
  const toggle = (id: string) => setViews(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  return <div className="workspace-dock">
    <nav className="view-rail" aria-label="工作台视图">{[['tools', '工具', '◇'], ['library', '素材库', '▤'], ['properties', '编辑', '⚙']].map(([id, label, icon]) => <button key={id} aria-label={`${label}视图`} title={label} aria-pressed={views.includes(id)} onClick={() => toggle(id)}>{icon}</button>)}</nav>
    {views.length > 0 && <><div className="dock-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" tabIndex={0}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setWidth(value => Math.min(innerWidth * .7, Math.max(280, value + (event.key === 'ArrowLeft' ? 20 : -20)))); }}
      onPointerDown={event => { if (event.button === 0) { event.preventDefault(); resizing.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerMove={event => resize(event.clientX)} onPointerUp={event => { resize(event.clientX); resizing.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { resizing.current = null; }} />
      <aside className="dock-panels" style={{ width }}>{views.includes('tools') && <section className="panel dock-section tools-panel"><h3>工具</h3>{tools}</section>}
      {views.includes('library') && <section className="panel dock-section library"><h3>项目素材库</h3>{library}</section>}
      {views.includes('properties') && <section className="panel dock-section inspector-panel"><h3>编辑</h3>{inspector}</section>}
    </aside></>}
  </div>;
}
