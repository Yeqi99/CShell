import { createPortal } from 'react-dom';
import { useState } from 'react';

type Mode = 'daily' | 'weekly' | 'total';

export function ActivityCalendar({ counts, end, start, locale, title, unit }: {
  counts: Map<string, number>; end: string; start: string; locale: string; title: string; unit: string;
}) {
  const [mode, setMode] = useState<Mode>('daily');
  const [hint, setHint] = useState<{ date: string; value: string; x: number; y: number } | null>(null);
  const cn = locale === 'zh-CN';
  const last = new Date(end + 'T12:00:00Z');
  const first = new Date(last);
  first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7 - 51 * 7);
  const months = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  let total = 0;
  const weeks = Array.from({ length: 52 }, (_, week) => {
    const cells = Array.from({ length: 7 }, (_, day) => {
      const time = new Date(first.getTime() + (week * 7 + day) * 86400000);
      const key = time.toISOString().slice(0, 10);
      const count = counts.get(key) || 0;
      total += count;
      return { key, count, total, available: key >= start && key <= end, time };
    });
    return { cells, sum: cells.reduce((n, c) => n + c.count, 0) };
  });
  const values = weeks.flatMap(w => mode === 'weekly' ? [w.sum] : w.cells.map(c => mode === 'daily' ? c.count : c.total));
  const peak = Math.max(1, ...values);
  return <section className="activity-calendar" onPointerLeave={() => setHint(null)} onWheel={() => setHint(null)}>
    <div className="calendar-heading"><h2>{title}</h2><div>
      {(['daily', 'weekly', 'total'] as const).map((id, i) =>
        <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>
          {(cn ? ['每天', '每周', '累计总量'] : ['Daily', 'Weekly', 'Cumulative'])[i]}
        </button>)}
    </div></div>
    <div className="calendar-scroll" tabIndex={0}><div className="calendar-year">
      {weeks.map(({cells, sum}, i) => {
        const month = cells.find(c => c.time.getUTCDate() === 1 && c.key <= end);
        const valid = cells.filter(c => c.available);
        const tiles = mode === 'weekly' ? [cells[0]] : cells;
        return <div className="calendar-week" key={cells[0].key}>
          {tiles.map(c => {
            const value = mode === 'weekly' ? sum : mode === 'total' ? c.total : c.count;
            const visible = mode === 'weekly' ? valid.length > 0 : c.available;
            const label = mode === 'weekly' && valid.length ? valid[0].key + ' – ' + valid[valid.length-1].key : c.key;
            return <span key={c.key} onPointerEnter={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHint({ date: label, value: value.toLocaleString(locale) + ' ' + unit,
                  x: Math.min(window.innerWidth - 110, Math.max(110, rect.left + rect.width / 2)),
                  y: rect.top > 68 ? rect.top - 60 : rect.bottom + 6 });
              }} onPointerLeave={() => setHint(null)}
              className="calendar-cell" style={{ visibility: visible ? 'visible' : 'hidden', background: value ? 'color-mix(in srgb, #0879df ' + (27 + 73 * Math.sqrt(value / peak)) + '%, var(--panel))' : undefined }} />;
          })}
          <small>{month && i < 51 ? months.format(month.time) : ''}</small>
        </div>;
      })}
    </div></div>
    {hint && createPortal(<div className="activity-hover-detail" role="tooltip"
      style={{ left: hint.x, top: hint.y }}><span>{hint.date}</span><strong>{hint.value}</strong></div>, document.body)}
  </section>;
}
