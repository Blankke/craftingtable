// 启动画面：使用原组件指定字体生成的本地路径，离线也能按同样节奏描绘 Hello World。
// 开屏是 Electron 渲染会话内的一次性状态：创建/打开项目立即结束，之后不再显示。
import { useEffect, useRef, useState } from 'react';
import { helloPath, helloViewBox } from './helloPath';
import { useSplashStore } from './splashStore';

export function SplashScreen() {
  const visible = useSplashStore(state => state.visible);
  const dismiss = useSplashStore(state => state.dismiss);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!visible) return;
    // 设置开启后优先播放开屏；默认仍尊重系统的“减少动态效果”偏好。
    const reduced = document.documentElement.dataset.forceMotion !== 'true' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const path = pathRef.current;
    if (!path) { setFading(true); return; }
    if (reduced) {
      path.style.strokeDasharray = 'none';
      const fade = setTimeout(() => setFading(true), 120);
      const remove = setTimeout(() => dismiss(), 570);
      return () => { clearTimeout(fade); clearTimeout(remove); };
    }
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    const raf = requestAnimationFrame(() => {
      // 以原字形路径描绘；首页在遮罩下提前挂载。
      path.style.strokeDashoffset = '0';
    });
    const duration = 2500;
    const delay = 500;
    const fade = setTimeout(() => setFading(true), delay + duration);
    const remove = setTimeout(() => dismiss(), delay + duration + 450);
    return () => { cancelAnimationFrame(raf); clearTimeout(fade); clearTimeout(remove); };
  }, [visible, dismiss]);
  // 开屏不拦截首页的首次操作：捕获阶段结束动画，事件仍可落到用户实际点击的按钮。
  useEffect(() => {
    if (!visible) return;
    const skip = () => dismiss();
    const skipByKeyboard = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') skip(); };
    addEventListener('pointerdown', skip, { capture: true, once: true });
    addEventListener('keydown', skipByKeyboard, { capture: true });
    return () => { removeEventListener('pointerdown', skip, true); removeEventListener('keydown', skipByKeyboard, true); };
  }, [visible, dismiss]);
  if (!visible) return null;
  return <div className={`splash${fading ? ' splash-fade' : ''}`} aria-hidden="true">
    <svg className="splash-svg" width="320" height="160" viewBox={helloViewBox} role="presentation">
      <path ref={pathRef} className="splash-title" d={helloPath} fill="none" stroke="#f43f5e" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>;
}
