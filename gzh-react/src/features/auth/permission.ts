import { useAuthStore } from '../../common/state/authStore';

export function canVisitHome() {
  return Boolean(useAuthStore.getState().token);
}
