import { useAuthStore } from '../../common/state/authStore';

export function isAuthed() {
  return Boolean(useAuthStore.getState().token);
}
