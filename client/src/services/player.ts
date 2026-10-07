import { useSyncExternalStore } from 'react';

export interface PlayerTrack {
  id: string;
  title: string;
  url: string;
  creator?: string;
}

interface PlayerState {
  tracks: PlayerTrack[];
  currentId: string | null;
  playing: boolean;
}

let state: PlayerState = { tracks: [], currentId: null, playing: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(partial: Partial<PlayerState>) {
  state = { ...state, ...partial };
  emit();
}

export const playerStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  get() {
    return state;
  },
  addAndPlay(track: PlayerTrack) {
    const exists = state.tracks.some((t) => t.id === track.id);
    const tracks = exists ? state.tracks : [...state.tracks, track];
    set({ tracks, currentId: track.id, playing: true });
  },
  playTrack(id: string) {
    set({ currentId: id, playing: true });
  },
  toggle() {
    set({ playing: !state.playing });
  },
  setPlaying(playing: boolean) {
    set({ playing });
  },
  remove(id: string) {
    const tracks = state.tracks.filter((t) => t.id !== id);
    let currentId = state.currentId;
    if (currentId === id) {
      currentId = tracks.length ? tracks[0].id : null;
    }
    set({ tracks, currentId, playing: currentId ? state.playing : false });
  },
  clear() {
    set({ tracks: [], currentId: null, playing: false });
  },
};

export function usePlayer(): PlayerState {
  return useSyncExternalStore(playerStore.subscribe, playerStore.get);
}
