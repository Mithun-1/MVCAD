import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileInput, Spline } from 'lucide-react';

export function CurveTools({
  disabled,
  onCreate,
  onImport,
}: {
  disabled: boolean;
  onCreate: () => void;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || disabled) return;
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, disabled]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <div className="point-tools curve-tools" ref={root}>
      <button
        className="point-tool-trigger curve-tool"
        title="Curve through points"
        disabled={disabled}
        onClick={() => {
          setOpen(false);
          onCreate();
        }}
      >
        <Spline size={16} />
        <span>Curve</span>
      </button>
      <button
        className="curve-menu-trigger"
        ref={trigger}
        aria-label="Curve options"
        title="Curve options"
        aria-haspopup="menu"
        aria-expanded={open && !disabled}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ChevronDown size={12} />
      </button>
      {open && !disabled && (
        <div
          className="point-tool-menu"
          role="menu"
          aria-label="Curve tools"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            } else if (event.key === 'Tab') {
              setOpen(false);
              trigger.current?.focus();
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              root.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
            }
          }}
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              onImport();
            }}
          >
            <FileInput size={16} />
            Import Curves
          </button>
        </div>
      )}
    </div>
  );
}
