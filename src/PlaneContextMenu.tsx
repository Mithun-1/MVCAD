import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Layers2,
  LocateFixed,
  Pencil,
  Trash2,
  CircleSlash,
  Play,
  FolderPlus,
  FolderOpen,
  Eye,
  EyeOff,
} from 'lucide-react';

type Props = {
  name: string;
  x: number;
  y: number;
  disabled: boolean;
  onGroup?: () => void;
  onUngroup?: () => void;
  onToggleVisibility?: () => void;
  visible?: boolean;
  multiple?: boolean;
  onCreate?: () => void;
  onEdit?: () => void;
  onNormal?: () => void;
  onDelete?: () => void;
  onSuppress?: () => void;
  suppressed?: boolean;
  deleteDisabled: boolean;
  deleteHint?: string;
  renameDisabled: boolean;
  onRename: () => void;
  onClose: (restoreFocus: boolean) => void;
};

export function PlaneContextMenu({
  name,
  x,
  y,
  disabled,
  onGroup,
  onUngroup,
  onToggleVisibility,
  visible,
  multiple,
  onCreate,
  onEdit,
  onNormal,
  onDelete,
  onSuppress,
  suppressed,
  deleteDisabled,
  deleteHint,
  renameDisabled,
  onRename,
  onClose,
}: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const element = menu.current!;
    const bounds = element.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)),
    });
    (element.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? element).focus();
  }, [x, y]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose(false);
    };
    const dismiss = () => onClose(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={`${name} actions`}
      tabIndex={-1}
      className="plane-context-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        // Menu shortcuts must not reach the model or cancel an existing plane draft.
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          onClose(true);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          if (!items.length) return;
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[index].focus();
        } else if (event.key === 'F2' && !renameDisabled) {
          event.preventDefault();
          onRename();
        } else if (
          event.key === 'Delete' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          if (!deleteDisabled) onDelete?.();
        }
      }}
    >
      <div className="context-menu-title" role="presentation">
        {name}
      </div>
      {onGroup && (
        <button role="menuitem" disabled={disabled} onClick={onGroup}>
          <FolderPlus size={16} /> Group selected
        </button>
      )}
      {onUngroup && (
        <button role="menuitem" disabled={disabled} onClick={onUngroup}>
          <FolderOpen size={16} /> Ungroup
        </button>
      )}
      {onToggleVisibility && (
        <button role="menuitem" disabled={disabled} onClick={onToggleVisibility}>
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          {visible ? 'Hide group' : 'Show group'}
        </button>
      )}
      {!multiple && (
        <>
          {onCreate && (
            <button role="menuitem" disabled={disabled} onClick={onCreate}>
              <Layers2 size={16} /> Create reference plane
            </button>
          )}
          {onEdit && (
            <button role="menuitem" disabled={disabled} onClick={onEdit}>
              <Pencil size={16} /> Edit feature
            </button>
          )}
          <button role="menuitem" aria-keyshortcuts="F2" disabled={renameDisabled} onClick={onRename}>
            <Pencil size={16} />
            Rename
            <kbd aria-hidden="true">F2</kbd>
          </button>
          {onNormal && (
            <button role="menuitem" onClick={onNormal}>
              <LocateFixed size={16} /> View normal
            </button>
          )}
          {onDelete && (
            <button
              role="menuitem"
              className="context-menu-delete"
              aria-keyshortcuts="Delete"
              disabled={deleteDisabled}
              title={deleteHint}
              onClick={onDelete}
            >
              <Trash2 size={16} /> Delete
              <kbd aria-hidden="true">Del</kbd>
            </button>
          )}
          {onSuppress && (
            <button role="menuitem" disabled={renameDisabled} onClick={onSuppress}>
              {suppressed ? <Play size={16} /> : <CircleSlash size={16} />}
              {suppressed ? 'Resume' : 'Suppress'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
