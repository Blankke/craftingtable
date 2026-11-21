import { create } from 'zustand';

export type Playback = { mediaId: string; timeUs: number; play: boolean } | null;

type PlaybackState = {
  playback: Playback;
  seekVersion: number;
  pendingSeek: { mediaId: string; timeUs: number } | null;
  setPlayback(value: Playback): void;
  updateFromMedia(mediaId: string, timeUs: number, outUs: number): boolean;
};

// 外部定位与媒体自身的时间事件分开处理，旧时间事件不能覆盖刚发出的定位和播放命令。
export const usePlaybackStore = create<PlaybackState>(set => ({
  playback: null,
  seekVersion: 0,
  pendingSeek: null,
  setPlayback: playback => set(state => ({ playback, seekVersion: state.seekVersion + 1, pendingSeek: playback ? { mediaId: playback.mediaId, timeUs: playback.timeUs } : null })),
  updateFromMedia: (mediaId, timeUs, outUs) => {
    let accepted = false;
    set(state => {
      const current = state.playback;
      if (current?.mediaId !== mediaId) return state;
      const pending = state.pendingSeek;
      if (pending?.mediaId === mediaId && Math.abs(timeUs - pending.timeUs) > 50_000) return state;
      accepted = true;
      return { playback: { ...current, timeUs: Math.min(timeUs, outUs), play: timeUs >= outUs ? false : current.play }, pendingSeek: null };
    });
    return accepted;
  }
}));
