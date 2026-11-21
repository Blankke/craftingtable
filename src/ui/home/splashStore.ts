// 用法：开屏只在 Electron 渲染会话内显示一次；创建/打开项目时调用 dismiss() 立即结束。
// 标记写入 sessionStorage，React 重挂载、首次进入笔记和模式切换都不会再次出现开屏。
import { create } from 'zustand';

const storageKey = 'workbench-splash-shown';
function shownBefore(): boolean {
  try { return sessionStorage.getItem(storageKey) === '1'; } catch { return false; }
}

export const useSplashStore = create<{ visible: boolean; dismiss(): void }>(() => ({
  visible: !shownBefore(),
  dismiss: () => {
    try { sessionStorage.setItem(storageKey, '1'); } catch { /* 会话存储不可用时仍结束本次开屏 */ }
    useSplashStore.setState({ visible: false });
  }
}));
