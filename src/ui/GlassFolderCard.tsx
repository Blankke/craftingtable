// 用法：<GlassFolderCard label="项目" files={files} onOpen={openProject} />。
// 原版文件夹负责前后玻璃、文件展开与视差；包装层把悬停/聚焦展开映射到项目入口。
import { useState, type FocusEvent } from 'react';
import GlassFolder, { type FolderArt as SourceArt, type FolderFile as SourceFile } from './vendor/GlassFolderOriginal';
import { useTheme } from './themeStore';

export type FolderArt = 'aurora' | 'ember' | 'verdant' | 'dusk' | 'none';
export interface FolderFile { name: string; meta?: string; art: FolderArt; image?: string }

export function GlassFolderCard({ label, meta, files, onOpen }: { label: string; meta?: string; files: FolderFile[]; onOpen(): void }) {
  const [expanded, setExpanded] = useState(false);
  const { mode } = useTheme();
  const closeOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false);
  };
  const sheets: SourceFile[] = files.map(file => ({ name: file.name, meta: file.meta, art: file.image ? undefined : file.art === 'none' ? undefined : file.art, image: file.image }));
  return <div className="glass-folder-wrap" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)} onFocusCapture={() => setExpanded(true)} onBlurCapture={closeOnBlur}>
    <GlassFolder label={label} meta={meta} showLabelTitle={false} art={(files[0]?.art ?? 'none') as SourceArt} files={sheets} width={240} tone={mode} action="none" appear={false} open={expanded} onOpenChange={onOpen} onFileSelect={onOpen} />
    {/* 项目名移出玻璃前片，放在文件夹正下方；元数据继续下移并左对齐，完全避开预览图。 */}
    <div className="glass-folder-caption">
      <div className="glass-folder-title" title={label}>{label}</div>
    </div>
  </div>;
}
