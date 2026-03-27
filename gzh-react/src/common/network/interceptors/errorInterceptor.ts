import type { AxiosError } from 'axios';
import { useAuthStore } from '../../state/authStore';

export function errorInterceptor(error: AxiosError) {
  if (error.response?.status === 401) {
    useAuthStore.getState().clearAuth();
  }
  return Promise.reject(error);
}
