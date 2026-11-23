// 用法：<StackCountButton count={images.length} width={width} height={height} onOpen={open}/>。
// 按 HeroUI v3 ToggleButton small 的 32px 高度、圆角和按压反馈适配 Konva；来源与授权见 vendor/NOTICE.txt。
import { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Group, Rect, Text } from 'react-konva';
import { colorToHex } from '../../core/theme';
import { useTheme, useThemeStore } from '../theme/themeStore';
import { useLanguage } from '../shared/language';

export function StackCountButton({ count, width, height, onOpen }: { count: number; width: number; height: number; onOpen(): void }) {
  const { tokens, fontFamily } = useTheme(), { t } = useLanguage();
  const forceMotion = useThemeStore(state => state.forceMotion);
  const [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false);
  const group = useRef<Konva.Group>(null), rect = useRef<Konva.Rect>(null);
  const label = t(`${count}张`, `${count} images`), buttonWidth = Math.max(48, label.length * 8 + 24);
  const background = colorToHex(tokens.surfaceAlt), hover = colorToHex(tokens.hover);
  useEffect(() => {
    if (!group.current || !rect.current) return;
    const reduce = !forceMotion && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scale = pressed ? .98 : 1, fill = hovered || pressed ? hover : background;
    if (reduce) { group.current.scale({ x: scale, y: scale }); rect.current.fill(fill); return; }
    const motion = new Konva.Tween({ node: group.current, duration: .25, scaleX: scale, scaleY: scale, easing: Konva.Easings.EaseOut });
    const color = new Konva.Tween({ node: rect.current, duration: .1, fill });
    motion.play(); color.play(); return () => { motion.destroy(); color.destroy(); };
  }, [pressed, hovered, forceMotion, background, hover]);
  return <Group name="image-stack-open" x={Math.max(4, width - buttonWidth - 8)} y={Math.max(4, height - 40)}
    onMouseEnter={event => { setHovered(true); event.target.getStage()!.container().style.cursor = 'pointer'; }}
    onMouseLeave={event => { setHovered(false); setPressed(false); event.target.getStage()!.container().style.cursor = ''; }}
    onMouseDown={event => { if (event.evt.button === 0) setPressed(true); }} onMouseUp={() => setPressed(false)}
    onClick={event => { event.cancelBubble = true; if (event.evt.button === 0) onOpen(); }}>
    <Group ref={group} x={buttonWidth / 2} y={16} offsetX={buttonWidth / 2} offsetY={16}>
      <Rect ref={rect} name="image-stack-open" width={buttonWidth} height={32} cornerRadius={24} fill={background}/>
      <Text name="image-stack-open" width={buttonWidth} height={32} align="center" verticalAlign="middle" text={label} fill={colorToHex(tokens.foreground)} fontSize={14} fontFamily={fontFamily}/>
    </Group>
  </Group>;
}
