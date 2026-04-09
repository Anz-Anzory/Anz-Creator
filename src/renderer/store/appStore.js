import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAppStore = create(
  persist(
    (set, get) => ({
      // State
      apiKeys: [],
      settings: {
        defaultPlatform: 'tiktok',
        defaultClipCount: 10,
        autoRemoveWatermark: false,
        saveLocation: null
      },
      recentVideos: [],
      
      // Actions
      setApiKeys: (keys) => set({ apiKeys: keys }),
      addApiKey: (key) => set((state) => ({ 
        apiKeys: [...state.apiKeys, key] 
      })),
      removeApiKey: (index) => set((state) => ({
        apiKeys: state.apiKeys.filter((_, i) => i !== index)
      })),
      
      updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
      })),
      
      addRecentVideo: (video) => set((state) => ({
        recentVideos: [video, ...state.recentVideos.slice(0, 9)]
      })),
      
      clearRecentVideos: () => set({ recentVideos: [] })
    }),
    {
      name: 'anz-video-publisher-storage'
    }
  )
);
