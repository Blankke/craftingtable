// 使用范例：由 App 传入项目笔记及其打开、创建、复制、删除命令。导航和版面偏好保存在本机，正文仍由项目文档管理。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, Plus, Search, X, Copy, Trash2, PanelLeftClose, PanelLeftOpen, Star } from 'lucide-react';
import type { Note } from '../../core/note';
import { noteText } from '../../core/note';
import { IconButton, PanelResizeHandle } from '../shared/EditorControls';
import { useLanguage } from '../shared/language';

export function NotesWorkspace({ notes, activeId, openIds, onOpen, onClose, onCreate, onDuplicate, onDelete, children }: {
  notes: Note[]; activeId: string; openIds: string[]; onOpen(id: string): void; onClose(id: string): void;
  onCreate(): void; onDuplicate(id: string): void; onDelete(id: string): void; children: ReactNode;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(window.innerWidth);
  const [width, setWidth] = useState(() => {
    try { return Math.max(180, Math.min(340, Number(localStorage.getItem('workbench-notes-width')) || 224)); } catch { return 224; }
  });
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('workbench-note-favorites') ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(entries => setAvailableWidth(entries[0].contentRect.width));
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);
  // 窄窗口的显示宽度与拖柄取值共享同一上限，避免 CSS 截断后首次拖动跳变。
  const maximumWidth = Math.max(180, Math.min(340, Math.floor(availableWidth * .25)));
  const visibleWidth = Math.min(width, maximumWidth);
  useEffect(() => { try { localStorage.setItem('workbench-notes-width', String(width)); localStorage.setItem('workbench-note-favorites', JSON.stringify(favorites)); } catch { /* 本机偏好不可写时，当前会话继续使用。 */ } }, [width, favorites]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '\\') { event.preventDefault(); setCollapsed(value => !value); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setCollapsed(false); requestAnimationFrame(() => searchRef.current?.focus()); }
    };
    addEventListener('keydown', keydown); return () => removeEventListener('keydown', keydown);
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const matches = notes.filter(note => !needle || `${note.name}\n${noteText(note)}`.toLocaleLowerCase().includes(needle));
  const groups = [
    { title: t('收藏', 'Favorites'), notes: matches.filter(note => favorites.includes(note.id)) },
    { title: t('所有笔记', 'All notes'), notes: matches.filter(note => !favorites.includes(note.id)) }
  ];
  return <div ref={workspaceRef} className={`note-workspace${collapsed ? ' sidebar-collapsed' : ''}`}>
    {!collapsed && <><aside className="note-sidebar" style={{ width: visibleWidth }} aria-label={t('笔记导航', 'Note navigation')}>
      <div className="note-sidebar-heading"><FileText size={17} /><strong>{t('笔记', 'Notes')}</strong><span>{notes.length}</span><IconButton icon={PanelLeftClose} label={t('收起笔记导航', 'Hide note navigation')} onClick={() => setCollapsed(true)} /></div>
      <label className="editor-search"><Search size={15} /><input ref={searchRef} aria-label={t('搜索笔记', 'Search notes')} placeholder={t('搜索笔记', 'Search notes')} value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton icon={X} label={t('清空搜索', 'Clear search')} onClick={() => setQuery('')} />}</label>
      <button className="note-create-button" onClick={onCreate}><Plus size={16} />{t('新建笔记', 'New note')}</button>
      <nav className="note-navigation-list">{groups.map(group => group.notes.length > 0 && <section key={group.title}>
        <h3>{group.title}</h3>{group.notes.map(note => <div className={`note-navigation-row${note.id === activeId ? ' is-active' : ''}`} key={note.id}>
          <button className="note-navigation-item" aria-current={note.id === activeId ? 'page' : undefined} onClick={() => onOpen(note.id)} title={note.name}><FileText size={16} /><span>{note.name || t('未命名笔记', 'Untitled note')}</span></button>
          <IconButton className={favorites.includes(note.id) ? 'is-favorite' : ''} icon={Star} label={favorites.includes(note.id) ? t('取消收藏', 'Unfavorite') : t('收藏笔记', 'Favorite note')} aria-pressed={favorites.includes(note.id)} onClick={() => setFavorites(current => current.includes(note.id) ? current.filter(id => id !== note.id) : [...current, note.id])} />
        </div>)}
      </section>)}{matches.length === 0 && <p className="editor-empty">{t('没有匹配的笔记', 'No matching notes')}</p>}</nav>
      <div className="note-sidebar-footer"><IconButton icon={Copy} label={t('复制当前笔记', 'Duplicate current note')} onClick={() => onDuplicate(activeId)} /><IconButton icon={Trash2} label={t('删除当前笔记', 'Delete current note')} onClick={() => { const note = notes.find(item => item.id === activeId); if (confirm(t(`删除“${note?.name || '未命名笔记'}”？`, `Delete “${note?.name || 'Untitled note'}”?`))) onDelete(activeId); }} /></div>
    </aside><PanelResizeHandle className="note-navigation-resizer" label={t('调整笔记导航宽度', 'Resize note navigation')} value={visibleWidth} min={180} max={maximumWidth} onChange={setWidth} onReset={() => setWidth(224)} /></>}
    <div className="note-view">
      <div className="note-tabs" role="tablist" aria-label={t('已打开的笔记', 'Open notes')}>
        {collapsed && <IconButton icon={PanelLeftOpen} label={t('展开笔记导航', 'Show note navigation')} onClick={() => setCollapsed(false)} />}
        {openIds.map(id => notes.find(note => note.id === id)).filter((note): note is Note => !!note).map(note => <div key={note.id} className={`note-tab${note.id === activeId ? ' active' : ''}`}>
          <button role="tab" aria-selected={note.id === activeId} onClick={() => onOpen(note.id)} title={note.name}><FileText size={14} /><span>{note.name || t('未命名', 'Untitled')}</span></button>
          <IconButton icon={X} label={t('关闭标签', 'Close tab')} onClick={() => onClose(note.id)} />
        </div>)}
        <IconButton icon={Plus} label={t('新建笔记', 'New note')} onClick={onCreate} />
      </div>
      {children}
    </div>
  </div>;
}
