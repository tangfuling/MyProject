import type { NavigateFunction } from 'react-router-dom';

class RouterManager {
  private navigateFn: NavigateFunction | null = null;

  bind(navigate: NavigateFunction) {
    this.navigateFn = navigate;
  }

  navigate(path: string) {
    this.navigateFn?.(path);
  }

  back() {
    this.navigateFn?.(-1);
  }
}

export default new RouterManager();
