import { useEffect } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';

export function useAutoLock(): void {
  const status = useSessionStore((state) => state.status);
  const lock = useSessionStore((state) => state.lock);
  const minutes = useSettingsStore((state) => state.autoLockMinutes);

  useEffect(() => {
    if (status !== 'unlocked' || minutes <= 0) return;
    let timer = 0;
    const reset = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => {
          lock();
        },
        minutes * 60 * 1000,
      );
    };
    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'touchstart',
      'wheel',
      'focus',
    ];
    for (const event of events) {
      window.addEventListener(event, reset, { passive: true });
    }
    reset();
    return () => {
      window.clearTimeout(timer);
      for (const event of events) {
        window.removeEventListener(event, reset);
      }
    };
  }, [status, lock, minutes]);
}
