export default class Logger {
  static info(message: string) {
    if (import.meta.env.DEV) {
      console.info(`[INFO] ${message}`);
    }
  }

  static error(message: string, error?: unknown) {
    console.error(`[ERROR] ${message}`, error);
  }
}
