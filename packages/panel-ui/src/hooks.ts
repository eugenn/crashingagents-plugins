import { useEffect, useRef, useState } from 'react';

/** A clock that re-renders once a second while mounted. */
export function useNow(active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Remaining share of a deadline, measured from when this client first saw it. */
export function useCountdown(deadline: number | undefined, now: number) {
  const first = useRef<{ deadline: number; total: number } | null>(null);
  if (deadline && first.current?.deadline !== deadline) {
    first.current = { deadline, total: Math.max(1000, deadline - now) };
  }
  if (!deadline || !first.current) return null;
  const left = Math.max(0, deadline - now);
  return { seconds: Math.ceil(left / 1000), share: left / first.current.total };
}
