// 用法：<GlassFolderCard label="项目" files={files} onOpen={openProject} />。
// 原版文件夹负责前后玻璃、文件展开与视差；包装层把悬停/聚焦展开映射到项目入口。
import { useState, type FocusEvent } from 'react';
import GlassFolder, { type FolderArt as SourceArt, type FolderFile as SourceFile } from './vendor/GlassFolderOriginal';
import { useTheme } from '../theme/themeStore';

export type FolderArt = 'aurora' | 'ember' | 'verdant' | 'dusk' | 'none';
export interface FolderFile { name: string; meta?: string; art: FolderArt; image?: string }

export function GlassFolderCard({ label, meta, files, onOpen, onReveal, onRename, onDelete }: { label: string; meta?: string; files: FolderFile[]; onOpen(): void; onReveal(): void; onRename(): void; onDelete(): void }) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { mode } = useTheme();
  const closeOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setExpanded(false); setMenuOpen(false); }
  };
  const sheets: SourceFile[] = files.map(file => ({ name: file.name, meta: file.meta, art: file.image ? undefined : file.art === 'none' ? undefined : file.art, image: file.image }));
  return <div className="glass-folder-wrap" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)} onFocusCapture={() => setExpanded(true)} onBlurCapture={closeOnBlur} onKeyDown={event => { if (event.key === 'Escape') setMenuOpen(false); }}>
    <GlassFolder label={label} showLabelTitle={false} showLabelMeta={false} art={(files[0]?.art ?? 'none') as SourceArt} files={sheets} width={240} tone={mode} action="none" appear={false} open={expanded} onOpenChange={setExpanded} onActivate={onOpen} onFileSelect={onOpen} />
    {/* 项目名移出玻璃前片，放在文件夹正下方；元数据继续下移并左对齐，完全避开预览图。 */}
    <button type="button" className="glass-folder-more" aria-label="项目菜单" aria-haspopup="menu" aria-expanded={menuOpen} onPointerDown={event => { event.stopPropagation(); }} onClick={event => { event.stopPropagation(); setMenuOpen(open => !open); }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></svg>
    </button>
    {menuOpen && <div className="glass-folder-menu" role="menu">
      <button type="button" role="menuitem" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setMenuOpen(false); onOpen(); }}>打开项目</button>
      <button type="button" role="menuitem" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setMenuOpen(false); onReveal(); }}>在资源管理器中显示</button>
      <button type="button" role="menuitem" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setMenuOpen(false); onRename(); }}>重命名项目</button>
      <button type="button" role="menuitem" className="glass-folder-delete" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setMenuOpen(false); onDelete(); }}>删除项目</button>
    </div>}
    <div className="glass-folder-caption">
      <div className="glass-folder-title" title={label}>{label}</div>
      {meta && <div className="glass-folder-meta">{meta}</div>}
    </div>
  </div>;
}
