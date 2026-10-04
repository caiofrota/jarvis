import { useEffect, useState } from 'react';
export function useCardGrid(primary: boolean, count: number) {
  const [size, setSize] = useState({ width: 1440, height: 900 });
  const [page, setPage] = useState(0);
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight });
    resize();
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, []);
  const compact = size.width <= 850;
  const columns = primary && !compact ? 2 : size.width >= 1100 ? 3 : size.width >= 650 ? 2 : 1;
  const available = Math.max(150, size.height - 220);
  const rows = Math.max(1, Math.min(3, Math.floor(available / 180)));
  const capacity = columns * rows;
  const pages = Math.max(1, Math.ceil(count / capacity));
  const current = Math.min(page, pages - 1);
  const start = current * capacity;
  return { compact, columns, capacity, current, pages, start, setPage };
}
