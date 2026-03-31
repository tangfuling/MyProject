import { create } from 'zustand';
import { RoutePath } from '../router/RoutePath';

type LoginModalState = {
  open: boolean;
  redirect: string;
  openModal: (redirect?: string) => void;
  closeModal: () => void;
};

export const useLoginModalStore = create<LoginModalState>((set) => ({
  open: false,
  redirect: RoutePath.WORKSPACE,
  openModal: (redirect) => {
    set({
      open: true,
      redirect: redirect || RoutePath.WORKSPACE,
    });
  },
  closeModal: () => {
    set({ open: false });
  },
}));
