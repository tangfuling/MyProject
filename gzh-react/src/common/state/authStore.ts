import { create } from 'zustand';

export type AuthProfile = {
  id: number;
  phone: string;
  displayName?: string;
  mpAccountName?: string;
  avatarUrl?: string;
  balance: number;
  freeQuota: number;
  aiModel: string;
};

type AuthState = {
  token: string | null;
  profile: AuthProfile | null;
  setAuth: (token: string, profile: AuthProfile) => void;
  clearAuth: () => void;
  updateProfile: (partial: Partial<AuthProfile>) => void;
};

const TOKEN_KEY = 'gzh_token';
const PROFILE_KEY = 'gzh_profile';
const LOGOUT_FLAG_KEY = 'gzh_logout_flag';

function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function loadProfile(): AuthProfile | null {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as AuthProfile;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: loadToken(),
  profile: loadProfile(),
  setAuth: (token, profile) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    localStorage.removeItem(LOGOUT_FLAG_KEY);
    set({ token, profile });
  },
  clearAuth: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
    localStorage.setItem(LOGOUT_FLAG_KEY, String(Date.now()));
    set({ token: null, profile: null });
  },
  updateProfile: (partial) => {
    const current = get().profile;
    if (!current) {
      return;
    }
    const next = { ...current, ...partial };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    set({ profile: next });
  },
}));
