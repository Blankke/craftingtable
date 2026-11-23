// 用法：画布打开叠图时挂载；图片从项目素材协议读取，每张备注单独保存并合并连续输入为一次撤销。
import { useEffect, useRef, useState } from 'react';
import type { CanvasObject, ProjectDocument } from '../../core/document';
import type { Editor } from '../../core/editor';
import { colorToHex } from '../../core/theme';
import { mediaSource } from '../media/mediaSource';
import { useTheme } from '../theme/themeStore';
import { useLanguage } from '../shared/language';
import JournalSpreadCarousel from './vendor/JournalSpreadCarousel';
import '../styles/imageStack.css';

export function ImageStackViewer({ stack, assets, editor, onClose }: { stack: Extract<CanvasObject, { kind: 'imageStack' }>; assets: ProjectDocument['assets']; editor: Editor; onClose(): void }) {
  const { t } = useLanguage(), { tokens } = useTheme();
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const element = dialog.current!, previous = document.activeElement as HTMLElement | null;
    element.showModal(); element.querySelector<HTMLElement>('.jsc-root')?.focus();
    return () => { element.close(); previous?.focus(); };
  }, []);
  const close = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    editor.commitPreview(); onClose();
  };
  const spreads = stack.images.map((image, i) => {
    const asset = assets.find(item => item.id === image.assetId);
    return { id: image.id, label: asset?.name ?? `${t('图片', 'Image')} ${i + 1}`, caption: image.caption, image: asset ? mediaSource(asset.path) : undefined, alt: asset?.name, paper: colorToHex(tokens.card) };
  });
  return <dialog ref={dialog} className="image-stack-dialog" aria-label={t('叠图浏览', 'Image stack viewer')}
    onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}
    onCopy={event => event.stopPropagation()} onPaste={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <JournalSpreadCarousel spreads={spreads} title={t('叠图', 'Image stack')} height="100%" autoPlay={false}
      onClose={close} onIndexChange={next => { editor.commitPreview(); setIndex(next); }} caption={stack.images[index]?.caption ?? ''} captionReadOnly={stack.locked}
      onCaptionChange={caption => editor.preview(draft => { const current = draft.objects.find(object => object.id === stack.id); if (current?.kind === 'imageStack' && !current.locked && current.images[index]) current.images[index].caption = caption; })}
      onCaptionCommit={() => editor.commitPreview()} />
  </dialog>;
}
