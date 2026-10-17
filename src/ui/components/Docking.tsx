import type { Preferences } from '../../shared/contracts';
import { useEffect, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { useI18n } from '../i18n';
export const panelDragType = 'application/x-cshell-panel';
export type PanelId = Preferences['layout']['order'][number];
let draggedPanel: PanelId | null = null;
let dragImage: HTMLDivElement | null = null;
const clearDrag = () => {
  draggedPanel = null;
  dragImage?.remove();
  dragImage = null;
  window.dispatchEvent(new Event('cshell:panel-drag-end'));
};

export function usePanelDrop(
  layout: Preferences['layout'],
  onChange: (layout: Preferences['layout']) => void,
) {
  const { t, locale } = useI18n();
  const [preview, setPreview] = useState<{
    source: PanelId;
    target: PanelId;
    before: boolean;
    order: PanelId[];
    x: number;
    y: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    const clear = () => setPreview(null);
    window.addEventListener('cshell:panel-drag-end', clear);
    return () => window.removeEventListener('cshell:panel-drag-end', clear);
  }, []);
  const locate = (event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedPanel || !event.dataTransfer.types.includes(panelDragType)) return null;
    const element = (event.target as Element).closest<HTMLElement>('[data-panel]');
    const target = element?.dataset.panel as PanelId;
    if (!element || !layout.order.includes(target) || target === draggedPanel) return null;
    const rect = element.getBoundingClientRect(),
      container = event.currentTarget.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    const order = layout.order.filter((id) => id !== draggedPanel);
    order.splice(order.indexOf(target) + (before ? 0 : 1), 0, draggedPanel);
    if (order.join() === layout.order.join()) return null;
    return {
      source: draggedPanel,
      target,
      before,
      order,
      x: (before ? rect.left : rect.right) - container.left,
      y: rect.top - container.top,
      height: rect.height,
    };
  };
  const labels = { servers: t('allServers'), terminal: t('terminal'), files: t('files') };
  return {
    events: {
      onDragOver(event: React.DragEvent<HTMLDivElement>) {
        if (!event.dataTransfer.types.includes(panelDragType)) return;
        const next = locate(event);
        event.preventDefault();
        event.dataTransfer.dropEffect = next ? 'move' : 'none';
        setPreview(next);
      },
      onDragLeave(event: React.DragEvent<HTMLDivElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setPreview(null);
      },
      onDrop(event: React.DragEvent<HTMLDivElement>) {
        const next = locate(event);
        if (!event.dataTransfer.types.includes(panelDragType)) return;
        event.preventDefault();
        clearDrag();
        if (next) onChange({ ...layout, order: next.order });
      },
    },
    overlay: preview && (
      <div className="dock-drop-preview" aria-live="polite">
        <div
          className="dock-drop-line"
          style={{ left: Math.max(2, preview.x - 2), top: preview.y, height: preview.height }}
        />
        <div className="dock-drop-summary">
          <strong>
            {locale === 'zh-CN' ? '移动' : 'Move'} {labels[preview.source]}
          </strong>
          <span>{preview.order.map((id) => labels[id]).join('  |  ')}</span>
        </div>
      </div>
    ),
  };
}
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
        draggedPanel = panel;
        dragImage = document.createElement('div');
        dragImage.className = 'dock-drag-image';
        dragImage.textContent = label;
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 20, 16);
        e.dataTransfer.setData(panelDragType, panel);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={clearDrag}
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
  panel: 'servers' | 'files' | 'agent';
  width: number;
  onChange: (width: number) => void;
  reverse: boolean;
}) {
  const { t } = useI18n();
  const minimum = panel === 'agent' ? 320 : panel === 'servers' ? 170 : 240,
    maximum = panel === 'agent' ? 900 : panel === 'servers' ? 500 : 600;
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
        if (event.button !== 0) return;
        const element = event.currentTarget,
          start = event.clientX,
          initialWidth = element.parentElement!.getBoundingClientRect().width;
        let next = initialWidth;
        element.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => {
          next = Math.max(
            minimum,
            Math.min(maximum, initialWidth + (e.clientX - start) * (reverse ? -1 : 1)),
          );
          element.parentElement!.style.width = `${next}px`;
        };
        const finish = (e: PointerEvent) => {
          element.removeEventListener('pointermove', move);
          element.removeEventListener('pointerup', finish);
          element.removeEventListener('pointercancel', finish);
          if (e.type === 'pointercancel') element.parentElement!.style.width = `${width}px`;
          else onChange(next);
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
