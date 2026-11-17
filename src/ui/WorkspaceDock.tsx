// 用法：给工作台传入工具、素材库与编辑面板；拖动左边缘调整侧栏宽度，拖动面板间水平分隔线调整相邻两块高度。
// 侧栏宽度与三块面板高度写入本机 localStorage（所有项目共享），窗口变化、面板隐藏或恢复时统一归一化与限幅。
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { clampHeight, clampWidth, DOCK_DIVIDER_HEIGHT, DOCK_MIN_HEIGHT, DOCK_PANELS, DOCK_STORAGE_KEY, loadDockLayout, normalizeHeights, type PanelId } from './dockLayout';

export function WorkspaceDock({ tools, library, inspector, autoOpenProperties }: { tools: ReactNode; library: ReactNode; inspector: ReactNode; autoOpenProperties?: boolean }) {
  const initial = useRef(loadDockLayout(localStorage)).current;
  const [views, setViews] = useState<string[]>(['tools', 'library']);
  const [width, setWidth] = useState(initial.width);
  const [heights, setHeights] = useState(initial.heights);
  const panelsRef = useRef<HTMLElement | null>(null);
  const [availableHeight, setAvailableHeight] = useState(600);
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const dividerDrag = useRef<{ index: number; startY: number; top: number; bottom: number } | null>(null);
  const resize = (x: number) => { if (resizing.current) setWidth(clampWidth(resizing.current.width + resizing.current.x - x, window.innerWidth * 0.7)); };
  const toggle = (id: string) => setViews(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  useEffect(() => { if (autoOpenProperties) setViews(current => current.includes('properties') ? current : [...current, 'properties']); }, [autoOpenProperties]);
  useEffect(() => { try { localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify({ width, heights })); } catch { /* 存储不可用仅影响下次记忆 */ } }, [width, heights]);
  useEffect(() => {
    const element = panelsRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setAvailableHeight(entries[0].contentRect.height));
    observer.observe(element);
    setAvailableHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);
  const visibleIds = DOCK_PANELS.map(panel => panel.id).filter(id => views.includes(id)) as PanelId[];
  const panelTotal = Math.max(visibleIds.length * DOCK_MIN_HEIGHT, availableHeight - (visibleIds.length - 1) * DOCK_DIVIDER_HEIGHT);
  const normalized = normalizeHeights(heights, visibleIds, panelTotal);
  const adjustDivider = (index: number, delta: number, base?: { top: number; bottom: number }) => {
    const above = visibleIds[index - 1];
    const below = visibleIds[index];
    if (!above || !below) return;
    setHeights(previous => {
      // 拖动时始终基于按下瞬间的两块高度计算，避免每次 pointermove 把 delta 叠加一次。
      const baseTop = base?.top ?? previous[above];
      const baseBottom = base?.bottom ?? previous[below];
      let top = baseTop + delta;
      let bottom = baseBottom - delta;
      if (top < DOCK_MIN_HEIGHT) { bottom = baseTop + baseBottom - DOCK_MIN_HEIGHT; top = DOCK_MIN_HEIGHT; }
      if (bottom < DOCK_MIN_HEIGHT) { top = baseTop + baseBottom - DOCK_MIN_HEIGHT; bottom = DOCK_MIN_HEIGHT; }
      return { ...previous, [above]: top, [below]: bottom };
    });
  };
  return <div className="workspace-dock">
    <nav className="view-rail" aria-label="工作台视图">{DOCK_PANELS.map(panel => <button key={panel.id} aria-label={`${panel.label}视图`} title={panel.label} aria-pressed={views.includes(panel.id)} onClick={() => toggle(panel.id)}>{panel.icon}</button>)}</nav>
    {views.length > 0 && <><div className="dock-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuenow={Math.round(width)} tabIndex={0}
      onKeyDown={event => { if (event.key === 'ArrowLeft') setWidth(value => clampWidth(value + 20, window.innerWidth * 0.7)); if (event.key === 'ArrowRight') setWidth(value => clampWidth(value - 20, window.innerWidth * 0.7)); }}
      onPointerDown={event => { if (event.button === 0) { event.preventDefault(); resizing.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerMove={event => resize(event.clientX)} onPointerUp={event => { resize(event.clientX); resizing.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { resizing.current = null; }} />
      <aside ref={panelsRef} className="dock-panels" style={{ width }}>{visibleIds.map((id, index) => {
        const panel = DOCK_PANELS.find(item => item.id === id)!;
        return <Fragment key={id}>
          {index > 0 && <div className="dock-divider" role="separator" aria-orientation="horizontal" aria-label={`调整${panel.label}与上一块高度`} tabIndex={0}
            onPointerDown={event => { if (event.button !== 0) return; dividerDrag.current = { index, startY: event.clientY, top: heights[visibleIds[index - 1]], bottom: heights[id] }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={event => { const drag = dividerDrag.current; if (drag) adjustDivider(drag.index, event.clientY - drag.startY, drag); }}
            onPointerUp={event => { dividerDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onPointerCancel={() => { dividerDrag.current = null; }}
            onKeyDown={event => { if (event.key === 'ArrowUp') adjustDivider(index, 20); if (event.key === 'ArrowDown') adjustDivider(index, -20); }} />}
          <section className={`panel dock-section ${id}-panel`} style={{ height: normalized[id], flex: index === visibleIds.length - 1 ? '1 1 auto' : '0 0 auto', minHeight: DOCK_MIN_HEIGHT }}>
            <h3>{panel.label}</h3>{id === 'tools' ? tools : id === 'library' ? library : inspector}
          </section>
        </Fragment>;
      })}</aside></>}
  </div>;
}
