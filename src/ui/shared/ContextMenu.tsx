// 用法：<ContextMenu x={x} y={y} items={items} onClose={close}/>；画布和正文共用，支持分组、子菜单和键盘。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import '../styles/contextMenu.css';

export type MenuItem = { id: string; label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; checked?: boolean; danger?: boolean; separator?: boolean; run?(): void; children?: MenuItem[] };
type Props = { x: number; y: number; items: MenuItem[]; label?: string; onClose(): void; onRestoreFocus?(): void };

function MenuPanel({ x, y, items, label, close, parent, firstFocus = true }: { x: number; y: number; items: MenuItem[]; label: string; close(): void; parent?: { element: HTMLElement; close(): void }; firstFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [child, setChild] = useState<{ item: MenuItem; element: HTMLButtonElement; keyboard: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const element = ref.current!, rect = element.getBoundingClientRect();
    // 子菜单按父菜单外框定位，避免菜单项内边距导致两层面板相互覆盖。
    const anchor = parent?.element.closest('[role="menu"]')?.getBoundingClientRect();
    const right = anchor ? anchor.right + 3 : x;
    const left = anchor && right + rect.width > innerWidth - 8 ? anchor.left - rect.width - 3 : right;
    element.style.left = `${Math.max(8, Math.min(left, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    if (firstFocus) element.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y, firstFocus]);
  const openChild = (item: MenuItem, element: HTMLButtonElement, keyboard = false) => {
    clearTimeout(timer.current); setChild(item.children?.length && !item.disabled ? { item, element, keyboard } : null);
  };
  return <><div ref={ref} role="menu" aria-label={label} className="context-menu" data-edit-menu style={{ left: x, top: y }}
    onScroll={() => setChild(null)}
    onContextMenu={event => event.preventDefault()} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'ArrowLeft' && parent) { event.preventDefault(); parent.close(); parent.element.focus(); }
      else if (event.key === 'ArrowRight' && current >= 0) { event.preventDefault(); const item = items.find(item => item.id === buttons[current].dataset.id); if (item) openChild(item, buttons[current], true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) {
        event.preventDefault(); setChild(null);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' || event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    {items.map(item => <button key={item.id} data-id={item.id} type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-label={item.label}
      aria-checked={item.checked} aria-haspopup={item.children ? 'menu' : undefined} aria-expanded={item.children ? child?.item.id === item.id : undefined}
      disabled={item.disabled} className={`${item.separator ? 'menu-separator ' : ''}${item.danger ? 'is-danger' : ''}`} tabIndex={-1}
      onPointerEnter={event => { const element = event.currentTarget; clearTimeout(timer.current); timer.current = setTimeout(() => openChild(item, element), item.children ? 120 : 80); }}
      onClick={event => { if (item.children) openChild(item, event.currentTarget, true); else { close(); item.run?.(); } }}>
      <span className="menu-icon">{item.checked ? <Check size={16}/> : item.icon}</span><span className="menu-label">{item.label}</span>
      {item.shortcut && <kbd>{item.shortcut}</kbd>}{item.children && <ChevronRight size={14}/>}
    </button>)}
  </div>{child?.item.children && <MenuPanel key={child.item.id} x={child.element.getBoundingClientRect().right + 3} y={child.element.getBoundingClientRect().top} items={child.item.children} label={child.item.label} close={close} firstFocus={child.keyboard} parent={{ element: child.element, close: () => setChild(null) }}/>}</>;
}

export function ContextMenu({ x, y, items, label = '右键菜单', onClose, onRestoreFocus }: Props) {
  const latest = useRef({ onClose, onRestoreFocus }); latest.current = { onClose, onRestoreFocus };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest('[data-edit-menu]')) latest.current.onClose(); };
    const close = () => latest.current.onClose();
    window.addEventListener('pointerdown', outside); window.addEventListener('blur', close); window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('blur', close); window.removeEventListener('resize', close); if (document.activeElement === document.body || (document.activeElement as Element)?.closest('[data-edit-menu]')) { if (latest.current.onRestoreFocus) latest.current.onRestoreFocus(); else previous?.focus({ preventScroll: true }); } };
  }, []);
  return createPortal(<MenuPanel x={x} y={y} items={items} label={label} close={onClose}/>, document.body);
}
