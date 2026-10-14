import { useEffect, useRef } from 'react';
import { Pencil, CircleSlash, Spline } from 'lucide-react';
export function PointActions({
  x,
  y,
  onEdit,
  onSuppress,
  onCurve,
  onClose,
}: {
  x: number;
  y: number;
  onEdit: () => void;
  onSuppress: () => void;
  onCurve: () => void;
  onClose: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return (
    <div
      ref={popup}
      role="toolbar"
      aria-label="Point shortcuts"
      className="point-shortcuts"
      style={{
        left: Math.max(8, Math.min(x + 12, window.innerWidth - 100)),
        top: Math.max(8, Math.min(y + 12, window.innerHeight - 110)),
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      <div>
        <button aria-label="Edit feature" title="Edit feature" onClick={onEdit}>
          <Pencil size={18} />
        </button>
        <button aria-label="Suppress" title="Suppress point set" onClick={onSuppress}>
          <CircleSlash size={18} />
        </button>
      </div>
      <div>
        <button aria-label="Curve through points" title="Curve through points" onClick={onCurve}>
          <Spline size={19} />
        </button>
      </div>
    </div>
  );
}
