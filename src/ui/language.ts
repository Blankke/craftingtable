// 使用示例：在组件中调用 useLanguage() 获取当前语言和翻译函数；设置保存在 Electron 会话的本地配置中。
import { create } from 'zustand';

export type Language = 'zh-CN' | 'en';
type LanguageState = { language: Language; setLanguage(language: Language): void };

function savedLanguage(): Language {
  try { return localStorage.getItem('workbench-language') === 'en' ? 'en' : 'zh-CN'; }
  catch { return 'zh-CN'; }
}

const initialLanguage = savedLanguage();
document.documentElement.lang = initialLanguage;
document.title = initialLanguage === 'en' ? 'Media Planning Workbench' : '音视频创作策划工作台';

const useLanguageStore = create<LanguageState>(set => ({
  language: initialLanguage,
  setLanguage(language) {
    try { localStorage.setItem('workbench-language', language); } catch { /* 存储不可用时仍切换当前界面 */ }
    document.documentElement.lang = language;
    document.title = language === 'en' ? 'Media Planning Workbench' : '音视频创作策划工作台';
    set({ language });
  }
}));

export function useLanguage() {
  const language = useLanguageStore(state => state.language);
  const setLanguage = useLanguageStore(state => state.setLanguage);
  return { language, setLanguage, t: (zh: string, en: string) => language === 'en' ? en : zh };
}
