import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
export function TabStrip({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = viewport.current!;
    const measure = () =>
      setEdges({
        left: el.scrollLeft > 2,
        right: el.scrollWidth - el.clientWidth - el.scrollLeft > 2,
      });
    const reveal = () => {
      const active = el.querySelector<HTMLElement>('.tab.active');
      if (active) {
        const a = active.getBoundingClientRect(),
          b = el.getBoundingClientRect();
        if (a.left < b.left) el.scrollLeft -= b.left - a.left;
        if (a.right > b.right) el.scrollLeft += a.right - b.right;
      }
      measure();
    };
    const resize = new ResizeObserver(reveal);
    resize.observe(el);
    const mutation = new MutationObserver(reveal);
    mutation.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    const wheel = (event: WheelEvent) => {
      if (el.scrollWidth > el.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        el.scrollLeft += event.deltaY;
      }
    };
    el.addEventListener('scroll', measure);
    el.addEventListener('wheel', wheel, { passive: false });
    reveal();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  return (
    <div className="tab-strip">
      <button
        className="icon tab-scroll"
        hidden={!edges.left && !edges.right}
        disabled={!edges.left}
        title="查看左侧标签"
        aria-label="查看左侧标签"
        onClick={() => viewport.current!.scrollBy({ left: -200, behavior: 'smooth' })}
      >
        <ChevronLeft size={14} />
      </button>
      <div className="tabs" ref={viewport}>
        {children}
      </div>
      <button
        className="icon tab-scroll"
        hidden={!edges.left && !edges.right}
        disabled={!edges.right}
        title="查看右侧标签"
        aria-label="查看右侧标签"
        onClick={() => viewport.current!.scrollBy({ left: 200, behavior: 'smooth' })}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
