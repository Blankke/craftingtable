// 用法：<WorkspaceModeSwitch mode={mode} onModeChange={setMode}/>。固定在主顶栏撤销按钮左侧的笔记/画布切换器。
// 灰色选区与小球分别平移；小球内层用 CSS 绘制双眼和笑脸，向右顺时针、向左逆时针各转满一圈，快速反向从当前值接续。
import { useState } from 'react';
import { useLanguage } from './language';

export type WorkspaceMode = 'notes' | 'canvas';

export function WorkspaceModeSwitch({ mode, onModeChange }: { mode: WorkspaceMode; onModeChange(mode: WorkspaceMode): void }) {
  const { t } = useLanguage();
  // 累计旋转角：切到笔记 +360°，切回画布 -360°；CSS 过渡从当前计算角度接续。
  const [rotation, setRotation] = useState(0);
  const selectionOffset = mode === 'canvas' ? 76 : 0;
  // 小球停靠在左侧“记”字右边或右侧“画”字左边，不与选区整体同幅移动。
  const ballOffset = mode === 'canvas' ? 28 : 0;
  const change = (next: WorkspaceMode) => {
    if (next === mode) return;
    setRotation(value => value + (next === 'canvas' ? 360 : -360));
    onModeChange(next);
  };
  return <div className="mode-switch" role="group" aria-label={t('工作台模式', 'Workspace mode')}>
    <button type="button" className="mode-switch-btn" aria-pressed={mode === 'notes'} onClick={() => change('notes')}>{t('笔记', 'Notes')}</button>
    <button type="button" className="mode-switch-btn" aria-pressed={mode === 'canvas'} onClick={() => change('canvas')}>{t('画布', 'Canvas')}</button>
    <div className="mode-switch-thumb" style={{ transform: `translateX(${selectionOffset}px)` }} aria-hidden="true" />
    <div className="mode-switch-ball" style={{ transform: `translateX(${ballOffset}px)` }} aria-hidden="true"><div className="mode-switch-ball-face" style={{ transform: `rotate(${rotation}deg)` }} /></div>
  </div>;
}
