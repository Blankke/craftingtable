// 用法：给工作台传入工具、素材库与编辑面板；拖动左边缘调整侧栏宽度，拖动面板间水平分隔线调整相邻两块高度。
// 侧栏宽度与三块面板高度写入本机 localStorage（所有项目共享），窗口变化、面板隐藏或恢复时统一归一化与限幅。
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { clampWidth, DOCK_DIVIDER_HEIGHT, DOCK_MIN_HEIGHT, DOCK_PANELS, DOCK_STORAGE_KEY, loadDockLayout, normalizeHeights, type PanelId } from './dockLayout';
import { WorkbenchIcon, type WorkbenchIconName } from '../shared/WorkbenchIcon';
import { Maximize2, Minimize2, X, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { IconButton, PanelResizeHandle } from '../shared/EditorControls';

export function WorkspaceDock({ tools, library, inspector, autoOpenProperties, propertiesRequest = 0, libraryRequest = 0 }: { tools: ReactNode; library: ReactNode; inspector: ReactNode; autoOpenProperties?: boolean; propertiesRequest?: number; libraryRequest?: number }) {
  const initial = useRef(loadDockLayout(localStorage)).current;
  const [views, setViews] = useState<string[]>(['tools', 'library']);
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [width, setWidth] = useState(initial.width);
  const [heights, setHeights] = useState(initial.heights);
  const panelsRef = useRef<HTMLElement | null>(null);
  const [availableHeight, setAvailableHeight] = useState(600);
  const toggle = (id: string) => { setCollapsed(false); setMaximized(null); setViews(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); };
  const maximize = (id: PanelId) => { setCollapsed(false); setViews(current => current.includes(id) ? current : [...current, id]); setMaximized(id); };
  useEffect(() => { if (autoOpenProperties || propertiesRequest) { setCollapsed(false); setMaximized(current => current ? 'properties' : null); setViews(current => current.includes('properties') ? current : [...current, 'properties']); } }, [autoOpenProperties, propertiesRequest]);
  useEffect(() => { if (libraryRequest) { setCollapsed(false); setMaximized('library'); setViews(current => current.includes('library') ? current : [...current, 'library']); } }, [libraryRequest]);
  useEffect(() => { const resize = () => setWindowWidth(window.innerWidth); addEventListener('resize', resize); return () => removeEventListener('resize', resize); }, []);
  useEffect(() => { try { localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify({ width, heights })); } catch { /* 存储不可用仅影响下次记忆 */ } }, [width, heights]);
  useEffect(() => {
    const element = panelsRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setAvailableHeight(entries[0].contentRect.height));
    observer.observe(element);
    setAvailableHeight(element.clientHeight);
    return () => observer.disconnect();
  }, [collapsed, views.length]);
  const visibleIds = maximized ? [maximized] : DOCK_PANELS.map(panel => panel.id).filter(id => views.includes(id)) as PanelId[];
  const panelTotal = Math.max(visibleIds.length * DOCK_MIN_HEIGHT, availableHeight - (visibleIds.length - 1) * DOCK_DIVIDER_HEIGHT);
  const normalized = normalizeHeights(heights, visibleIds, panelTotal);
  const adjustDivider = (index: number, delta: number, base?: { top: number; bottom: number }) => {
    const above = visibleIds[index - 1];
    const below = visibleIds[index];
    if (!above || !below) return;
    setHeights(previous => {
      // 拖动时始终基于按下瞬间的两块高度计算，避免每次 pointermove 把 delta 叠加一次。
      const baseTop = base?.top ?? normalized[above];
      const baseBottom = base?.bottom ?? normalized[below];
      let top = baseTop + delta;
      let bottom = baseBottom - delta;
      if (top < DOCK_MIN_HEIGHT) { bottom = baseTop + baseBottom - DOCK_MIN_HEIGHT; top = DOCK_MIN_HEIGHT; }
      if (bottom < DOCK_MIN_HEIGHT) { top = baseTop + baseBottom - DOCK_MIN_HEIGHT; bottom = DOCK_MIN_HEIGHT; }
      return { ...previous, ...normalized, [above]: top, [below]: bottom };
    });
  };
  const maxWidth = Math.max(280, Math.min(560, windowWidth - 440));
  const actualWidth = clampWidth(width, maxWidth);
  return <div className={`workspace-dock${collapsed ? ' is-collapsed' : ''}`} style={{ width: collapsed ? 42 : actualWidth }}>
    {!collapsed && <PanelResizeHandle className="dock-resizer" label="调整侧栏宽度" value={actualWidth} min={280} max={maxWidth} direction={-1} onChange={setWidth} onReset={() => setWidth(360)} />}
    <nav className="view-rail" aria-label="工作台视图">
      {!collapsed && DOCK_PANELS.map(panel => <button key={panel.id} aria-label={`${panel.label}视图`} title={`${panel.label} · 双击展开整个侧栏`} aria-pressed={maximized ? maximized === panel.id : views.includes(panel.id)} onClick={event => { if (event.detail < 2) toggle(panel.id); }} onDoubleClick={() => maximize(panel.id)} onKeyDown={event => { if (event.shiftKey && event.key === 'Enter') { event.preventDefault(); maximize(panel.id); } }}><WorkbenchIcon name={panel.icon as WorkbenchIconName} size={15} /><span>{panel.label}</span></button>)}
      <IconButton icon={collapsed ? PanelRightOpen : PanelRightClose} label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(value => !value)} />
    </nav>
    {!collapsed && <aside ref={panelsRef} className="dock-panels">{visibleIds.map((id, index) => {
        const panel = DOCK_PANELS.find(item => item.id === id)!;
        return <Fragment key={id}>
          {index > 0 && <PanelResizeHandle className="dock-divider" axis="y" label={`调整${panel.label}与上一块高度`} value={normalized[visibleIds[index - 1]]} min={DOCK_MIN_HEIGHT} max={normalized[visibleIds[index - 1]] + normalized[id] - DOCK_MIN_HEIGHT} onChange={value => adjustDivider(index, value - normalized[visibleIds[index - 1]])} />}
          <section className={`panel dock-section ${id}-panel`} style={{ height: normalized[id], flex: '0 0 auto', minHeight: DOCK_MIN_HEIGHT }}>
            <div className="dock-section-header"><h3>{panel.label}</h3><IconButton icon={maximized === id ? Minimize2 : Maximize2} label={maximized === id ? `还原${panel.label}面板` : `展开${panel.label}面板`} onClick={() => setMaximized(value => value === id ? null : id)} /><IconButton icon={X} label={`关闭${panel.label}面板`} onClick={() => toggle(id)} /></div>
            <div className="dock-section-content">{id === 'tools' ? tools : id === 'library' ? library : inspector}</div>
          </section>
        </Fragment>;
      })}{!visibleIds.length && <div className="editor-empty">从上方选择面板</div>}</aside>}
  </div>;
}
