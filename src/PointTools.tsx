import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Crosshair, Move3D } from 'lucide-react';

export function PointTools({ disabled, onOffset }: { disabled: boolean; onOffset: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div className="point-tools" ref={root}>
      <button
        ref={trigger}
        className="point-tool-trigger"
        aria-label="Point"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Crosshair size={22} />
        <span>
          Point <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Point tools"
          className="point-tool-menu"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || e.key === 'Tab') {
              e.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const items = [
                ...root.current!.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'),
              ];
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const index =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? items.length - 1
                    : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[index]?.focus();
            }
          }}
        >
          <button role="menuitem" disabled title="Other point placement methods will be added later">
            <Crosshair size={16} />
            Point
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOffset();
            }}
          >
            <Move3D size={16} />
            Offset Coordinate System
          </button>
        </div>
      )}
    </div>
  );
}
