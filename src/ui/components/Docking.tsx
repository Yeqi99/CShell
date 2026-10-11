import type { Preferences } from '../../shared/contracts';
import { GripVertical } from 'lucide-react';
import { useI18n } from '../i18n';
export const panelDragType = 'application/x-cshell-panel';
export type PanelId = Preferences['layout']['order'][number];
export function DockGrip({
  panel,
  label,
  layout,
  onChange,
}: {
  panel: PanelId;
  label: string;
  layout: Preferences['layout'];
  onChange: (layout: Preferences['layout']) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      className="dock-grip icon"
      draggable
      data-tooltip={`${label} · ${t('dragPanel')}`}
      aria-label={`${label} · ${t('dragPanel')}`}
      onDragStart={(e) => {
        e.dataTransfer.setData(panelDragType, panel);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onKeyDown={(e) => {
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          const order = [...layout.order],
            index = order.indexOf(panel),
            next = index + (e.key === 'ArrowLeft' ? -1 : 1);
          if (next >= 0 && next < order.length) {
            [order[index], order[next]] = [order[next], order[index]];
            onChange({ ...layout, order });
          }
        }
      }}
    >
      <GripVertical size={13} />
    </button>
  );
}
export function PanelResizer({
  panel,
  width,
  onChange,
  reverse,
}: {
  panel: 'servers' | 'files';
  width: number;
  onChange: (width: number) => void;
  reverse: boolean;
}) {
  const { t } = useI18n();
  const minimum = panel === 'servers' ? 170 : 240,
    maximum = panel === 'servers' ? 500 : 600;
  return (
    <div
      className={`panel-resizer ${reverse ? 'on-left' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={t('resizePanel')}
      data-tooltip={t('resizePanel')}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      onPointerDown={(event) => {
        const element = event.currentTarget,
          start = event.clientX;
        let next = width;
        element.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => {
          next = Math.max(
            minimum,
            Math.min(maximum, width + (e.clientX - start) * (reverse ? -1 : 1)),
          );
          element.parentElement!.style.width = `${next}px`;
        };
        const finish = () => {
          element.removeEventListener('pointermove', move);
          element.removeEventListener('pointerup', finish);
          element.removeEventListener('pointercancel', finish);
          onChange(next);
        };
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', finish);
        element.addEventListener('pointercancel', finish);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(
            Math.max(
              minimum,
              Math.min(maximum, width + (e.key === 'ArrowRight' ? 10 : -10) * (reverse ? -1 : 1)),
            ),
          );
        }
      }}
    />
  );
}
