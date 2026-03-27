import type { NavigateFunction, NavigateOptions } from 'react-router-dom';

class RouterManager {
  private navigateFn: NavigateFunction | null = null;

  bind(navigate: NavigateFunction) {
    this.navigateFn = navigate;
  }

  navigate(path: string, options?: NavigateOptions) {
    this.navigateFn?.(path, options);
  }

  back() {
    this.navigateFn?.(-1);
  }
}

export default new RouterManager();
