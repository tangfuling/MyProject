import { create } from 'zustand';

type AppState = {
  pageTitle: string;
  setPageTitle: (title: string) => void;
};

export const useAppStore = create<AppState>((set) => ({
  pageTitle: 'Niuma Demo',
  setPageTitle: (title) => set({ pageTitle: title }),
}));
