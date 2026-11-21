// 用法：<WorkspaceModeSwitch mode={mode} onModeChange={setMode}/>。主顶栏中的笔记/画布单选切换器。
// 根据 21st / Halaska Segmented Control 改写；保留 3px 内边距、浮起底板及原缓动，授权见 vendor/Halaska-MIT.txt。
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { NotebookPen, PanelsTopLeft } from 'lucide-react';
import { useLanguage } from '../shared/language';

export type WorkspaceMode = 'notes' | 'canvas';
const modes: WorkspaceMode[] = ['notes', 'canvas'];

export function WorkspaceModeSwitch({ mode, onModeChange }: { mode: WorkspaceMode; onModeChange(mode: WorkspaceMode): void }) {
  const { t, language } = useLanguage();
  const container = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<WorkspaceMode, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  useLayoutEffect(() => {
    const root = container.current;
    const selected = buttons.current[mode];
    if (!root || !selected) return;
    // 按真实按钮尺寸定位，语言、字体和窗口缩放变化后选中底板仍与点击区重合。
    const measure = () => {
      // offset 几何不受按钮按下时的 scale 影响，避免松手后底板仍停在缩小尺寸。
      const next = { left: selected.offsetLeft, width: selected.offsetWidth };
      setIndicator(previous => previous?.left === next.left && previous.width === next.width ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const button of Object.values(buttons.current)) if (button) observer.observe(button);
    return () => observer.disconnect();
  }, [mode, language]);
  const change = (next: WorkspaceMode, fromKeyboard: boolean) => {
    setKeyboard(fromKeyboard);
    if (next !== mode) onModeChange(next);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    if (!previous && !next && event.key !== 'Home' && event.key !== 'End') {
      // 原生按钮处理 Enter/空格；阻止空格冒泡触发画布播放快捷键。
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
      return;
    }
    event.preventDefault(); event.stopPropagation();
    const target = event.key === 'Home' ? modes[0] : event.key === 'End' ? modes.at(-1)!
      : modes[(modes.indexOf(mode) + (next ? 1 : -1) + modes.length) % modes.length];
    buttons.current[target]?.focus({ preventScroll: true });
    change(target, true);
  };
  return <div ref={container} className="mode-switch" role="radiogroup" aria-label={t('工作台模式', 'Workspace mode')} data-input={keyboard ? 'keyboard' : 'pointer'} onKeyDown={navigate} onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); }}>
    {indicator && <span className="mode-switch-indicator" aria-hidden="true" style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />}
    {modes.map(value => {
      const Icon = value === 'notes' ? NotebookPen : PanelsTopLeft;
      return <button key={value} ref={element => { buttons.current[value] = element; }} type="button" role="radio" className="mode-switch-btn" aria-checked={mode === value} tabIndex={mode === value ? 0 : -1} onClick={event => change(value, event.detail === 0)}>
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" /><span>{value === 'notes' ? t('笔记', 'Notes') : t('画布', 'Canvas')}</span>
      </button>;
    })}
  </div>;
}
