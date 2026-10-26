import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * A wall clock that ticks while the app is in the foreground.
 *
 * "Last seen 12 min ago" has to advance while the map sits open, but a timer
 * running in the background would wake the CPU for a screen nobody is
 * looking at. The interval is torn down on background and the clock is
 * refreshed immediately on return, so the first frame back is already right.
 */
export const useNow = (intervalMs = 60_000): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      setNow(Date.now());
      timer ??= setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === 'active') start();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, [intervalMs]);

  return now;
};
