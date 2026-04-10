import { create } from 'zustand';

// FIX: Hapus persist middleware karena localStorage tidak tersedia di Electron secara konsisten
// Data API key sudah disimpan terenkripsi di backend via KeyStorage
export const useAppStore = create((set, get) => ({
  // State
  settings: {
    defaultPlatform: 'tiktok',
    defaultClipCount: 10,
    autoRemoveWatermark: false,
    saveLocation: null
  },
  recentVideos: [],
  
  // Actions
  updateSettings: (newSettings) => set((state) => ({
    settings: { ...state.settings, ...newSettings }
  })),
  
  addRecentVideo: (video) => set((state) => ({
    recentVideos: [video, ...state.recentVideos.slice(0, 9)]
  })),
  
  clearRecentVideos: () => set({ recentVideos: [] })
}));
