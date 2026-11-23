// 用法：<CanvasTextView object={object} scale={camera.scale}/>；图形坐标系内绘制完整文字，超高部分不裁切。
import { useEffect, useMemo, useState } from 'react';
import { Image as KonvaImage, Text } from 'react-konva';
import { isCanvasTextEmpty } from '../../core/canvasText';
import { useLanguage } from '../shared/language';
import { useTheme } from '../theme/themeStore';
import { colorToHex } from '../../core/theme';
import { canvasTextImageSource, canvasTextLayout, type TextObject } from './canvasTextLayout';

export function CanvasTextView({ object, scale = 1 }: { object: TextObject; scale?: number }) {
  const { t } = useLanguage();
  const { tokens } = useTheme();
  const [image, setImage] = useState<HTMLImageElement>();
  const empty = isCanvasTextEmpty(object.text);
  const source = useMemo(() => empty ? '' : canvasTextImageSource(object, Math.max(1, devicePixelRatio * scale)), [empty, object.text, object.width, object.fontSize, object.style, object.color, object.align, scale]);
  useEffect(() => {
    if (!source) { setImage(undefined); return; }
    const next = new window.Image(); next.onload = () => setImage(next); next.src = source;
    return () => { next.onload = null; };
  }, [source]);
  if (empty && object.kind === 'text') return <Text name="text-placeholder" text={t('双击编辑文字', 'Double click to edit')} x={8} y={8} width={Math.max(1, object.width - 16)} fontSize={object.fontSize} fill={colorToHex(tokens.mutedForeground)} listening={false} />;
  if (empty) return null;
  const { y, height } = canvasTextLayout(object);
  return image ? <KonvaImage name="rich-text" image={image} y={y} width={object.width} height={height} /> : null;
}
