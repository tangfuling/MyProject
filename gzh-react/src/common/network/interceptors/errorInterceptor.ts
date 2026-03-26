import type { AxiosError } from 'axios';
import { useAuthStore } from '../../state/authStore';

export function errorInterceptor(error: AxiosError) {
  if (error.response?.status === 401) {
    useAuthStore.getState().setToken(null);
  }
  return Promise.reject(error);
}
