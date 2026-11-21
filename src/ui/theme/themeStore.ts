// 用法：useTheme() 读取当前主题与模式；store 变更时自动把 Token 写入 CSS 变量。
// 主题/模式/收藏/自定义持久化到 localStorage（键 workbench-theme）。
import { create } from 'zustand';
import { defaultThemeId, themeById, themes, type ColorTokens, type Theme, type ModeTokens } from '../../core/theme';

export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  activeThemeId: string;
  mode: ThemeMode;
  /** 开启时覆盖系统“减少动态效果”，使界面始终播放过渡动画。 */
  forceMotion: boolean;
  favorites: string[];
  customThemes: Theme[];
  customColors: string[];
  setTheme(id: string): void;
  setMode(mode: ThemeMode): void;
  setForceMotion(forceMotion: boolean): void;
  toggleMode(): void;
  toggleFavorite(id: string): void;
  addCustomTheme(theme: Theme): void;
  addCustomColor(color: string): void;
  removeCustomColor(color: string): void;
}

const storageKey = 'workbench-theme';

function loadSaved(): Pick<ThemeState, 'activeThemeId' | 'mode' | 'forceMotion' | 'favorites' | 'customThemes' | 'customColors'> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { activeThemeId: defaultThemeId, mode: 'light', forceMotion: false, favorites: [], customThemes: [], customColors: [] };
    const parsed = JSON.parse(raw) as Partial<ReturnType<typeof loadSaved>>;
    const themeIds = new Set([...themes.map(theme => theme.id), ...(parsed.customThemes ?? []).map(theme => theme.id)]);
    return {
      activeThemeId: parsed.activeThemeId && themeIds.has(parsed.activeThemeId) ? parsed.activeThemeId : defaultThemeId,
      mode: parsed.mode === 'dark' ? 'dark' : 'light',
      forceMotion: parsed.forceMotion === true,
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter(themeIds.has.bind(themeIds)) : [],
      customThemes: Array.isArray(parsed.customThemes) ? parsed.customThemes : [],
      customColors: Array.isArray(parsed.customColors) ? parsed.customColors : []
    };
  } catch {
    return { activeThemeId: defaultThemeId, mode: 'light', forceMotion: false, favorites: [], customThemes: [], customColors: [] };
  }
}

const tokenVarMap: Record<keyof ColorTokens, string> = {
  background: '--wb-background', foreground: '--wb-foreground', primary: '--wb-primary', primaryForeground: '--wb-primary-foreground',
  secondary: '--wb-secondary', accent: '--wb-accent', muted: '--wb-muted', mutedForeground: '--wb-muted-foreground',
  card: '--wb-card', border: '--wb-border', ring: '--wb-ring', destructive: '--wb-destructive',
  surface: '--wb-surface', surfaceAlt: '--wb-surface-alt', input: '--wb-input', selection: '--wb-selection', hover: '--wb-hover', grid: '--wb-grid'
};

export function applyCssVars(theme: Theme, mode: ThemeMode): void {
  const root = document.documentElement;
  const active = theme[mode];
  root.style.setProperty('--wb-radius', theme.radius);
  root.style.setProperty('--wb-font', theme.fontFamily);
  root.style.setProperty('--wb-base-font-size', `${theme.baseFontSize}px`);
  for (const [token, variable] of Object.entries(tokenVarMap)) root.style.setProperty(variable, active.tokens[token as keyof ColorTokens]);
  active.trackPalette.forEach((color, index) => root.style.setProperty(`--wb-track-${index + 1}`, color));
  root.style.colorScheme = mode;
  root.dataset.theme = `${theme.id}-${mode}`;
}

function resolveTheme(id: string, customThemes: Theme[]): Theme {
  return customThemes.find(theme => theme.id === id) ?? themeById(id);
}

function persist(state: Pick<ThemeState, 'activeThemeId' | 'mode' | 'forceMotion' | 'favorites' | 'customThemes' | 'customColors'>): void {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* 存储不可用时仅影响下次启动的记忆 */ }
}

const saved = loadSaved();
applyCssVars(resolveTheme(saved.activeThemeId, saved.customThemes), saved.mode);
document.documentElement.dataset.forceMotion = String(saved.forceMotion);

export const useThemeStore = create<ThemeState>(set => ({
  ...saved,
  setTheme: id => set(state => {
    const next = { ...state, activeThemeId: id };
    applyCssVars(resolveTheme(id, next.customThemes), next.mode); persist(next); return next;
  }),
  setMode: mode => set(state => {
    const next = { ...state, mode };
    applyCssVars(resolveTheme(next.activeThemeId, next.customThemes), mode); persist(next); return next;
  }),
  setForceMotion: forceMotion => set(state => {
    const next = { ...state, forceMotion };
    document.documentElement.dataset.forceMotion = String(forceMotion);
    persist(next); return { forceMotion };
  }),
  toggleMode: () => {
    const next = { ...useThemeStore.getState() };
    next.mode = next.mode === 'light' ? 'dark' : 'light';
    applyCssVars(resolveTheme(next.activeThemeId, next.customThemes), next.mode); persist(next);
    useThemeStore.setState({ mode: next.mode });
  },
  toggleFavorite: id => set(state => {
    const favorites = state.favorites.includes(id) ? state.favorites.filter(item => item !== id) : [...state.favorites, id];
    persist({ ...state, favorites }); return { favorites };
  }),
  addCustomTheme: theme => set(state => {
    const customThemes = [...state.customThemes.filter(item => item.id !== theme.id), theme];
    persist({ ...state, customThemes }); return { customThemes };
  }),
  addCustomColor: color => set(state => {
    const customColors = [color, ...state.customColors.filter(item => item !== color)].slice(0, 40);
    persist({ ...state, customColors }); return { customColors };
  }),
  removeCustomColor: color => set(state => {
    const customColors = state.customColors.filter(item => item !== color);
    persist({ ...state, customColors }); return { customColors };
  })
}));

export interface ActiveTheme {
  theme: Theme;
  mode: ThemeMode;
  tokens: ColorTokens;
  trackPalette: string[];
  radius: string;
  fontFamily: string;
  baseFontSize: number;
}

export function useTheme(): ActiveTheme {
  const activeThemeId = useThemeStore(state => state.activeThemeId);
  const mode = useThemeStore(state => state.mode);
  const customThemes = useThemeStore(state => state.customThemes);
  const theme = resolveTheme(activeThemeId, customThemes);
  const active = theme[mode];
  return { theme, mode, tokens: active.tokens, trackPalette: active.trackPalette, radius: theme.radius, fontFamily: theme.fontFamily, baseFontSize: theme.baseFontSize };
}
