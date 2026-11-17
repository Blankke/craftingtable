// 用法：<WorkspaceModeSwitch mode={mode} onModeChange={setMode}/>。固定在主顶栏撤销按钮左侧的笔记/画布切换器。
// 选中底与笑脸球共用一个滑动层，切换时保持位置同步；球心偏置点旋转一圈表现滚动。
import { useState } from 'react';
import { useLanguage } from './language';

export type WorkspaceMode = 'notes' | 'canvas';

export function WorkspaceModeSwitch({ mode, onModeChange }: { mode: WorkspaceMode; onModeChange(mode: WorkspaceMode): void }) {
  const { t } = useLanguage();
  // 使用累计角度，让快速反向切换从当前角度自然接续。
  const [rotation, setRotation] = useState(0);
  const change = (next: WorkspaceMode) => {
    if (next === mode) return;
    setRotation(value => value + (next === 'canvas' ? 360 : -360));
    onModeChange(next);
  };
  return <div className={`mode-switch${mode === 'canvas' ? ' is-canvas' : ' is-notes'}`} role="group" aria-label={t('工作台模式', 'Workspace mode')}>
    <button type="button" className="mode-switch-btn" aria-pressed={mode === 'notes'} onClick={() => change('notes')}>{t('笔记', 'Notes')}</button>
    <button type="button" className="mode-switch-btn" aria-pressed={mode === 'canvas'} onClick={() => change('canvas')}>{t('画布', 'Canvas')}</button>
    <div className="mode-switch-thumb" aria-hidden="true">
      <div className="mode-switch-ball"><div className="mode-switch-ball-face" style={{ transform: `rotate(${rotation}deg)` }} /></div>
    </div>
  </div>;
}
