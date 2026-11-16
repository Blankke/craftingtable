// 启动画面：使用原组件指定字体生成的本地路径，离线也能按同样节奏描绘 Hello。
import { useEffect, useRef, useState } from 'react';
import { helloPath, helloViewBox } from './helloPath';

export function SplashScreen() {
  const pathRef = useRef<SVGPathElement | null>(null);
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    // 设置开启后优先播放开屏；默认仍尊重系统的“减少动态效果”偏好。
    const reduced = document.documentElement.dataset.forceMotion !== 'true' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const path = pathRef.current;
    if (!path) { setFading(true); return; }
    if (reduced) {
      path.style.strokeDasharray = 'none';
      const fade = setTimeout(() => setFading(true), 120);
      const remove = setTimeout(() => setGone(true), 570);
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
    const remove = setTimeout(() => setGone(true), delay + duration + 450);
    return () => { cancelAnimationFrame(raf); clearTimeout(fade); clearTimeout(remove); };
  }, []);
  if (gone) return null;
  return <div className={`splash${fading ? ' splash-fade' : ''}`} aria-hidden={fading}>
    <svg className="splash-svg" width="320" height="160" viewBox={helloViewBox} role="presentation">
      <path ref={pathRef} className="splash-title" d={helloPath} fill="none" stroke="#f43f5e" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>;
}
