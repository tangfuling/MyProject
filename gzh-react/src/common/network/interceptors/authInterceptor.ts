import type { InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../../state/authStore';

export function authInterceptor(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}
