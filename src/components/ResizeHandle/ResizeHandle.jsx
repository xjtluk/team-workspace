import { useRef, useEffect, useCallback } from 'preact/hooks';

const MIN_RIGHT = 320;
const MAX_RIGHT = 750;
const DEFAULT_RIGHT = 520;
const STORAGE_KEY = 'bks_workspace_right_width';

export function ResizeHandle({ onChange }) {
  const handleRef = useRef(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e) => {
    isDragging.current = true;
    startX.current = e.clientX;
    const currentWidth = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--ws-right-width').trim()
    ) || DEFAULT_RIGHT;
    startWidth.current = currentWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = startX.current - e.clientX;
      const newWidth = Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, startWidth.current + dx));
      document.documentElement.style.setProperty('--ws-right-width', `${newWidth}px`);
      localStorage.setItem(STORAGE_KEY, newWidth);
      onChange?.(newWidth);
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onChange]);

  // 恢复保存的宽度
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      document.documentElement.style.setProperty('--ws-right-width', `${saved}px`);
    }
  }, []);

  return (
    <div
      ref={handleRef}
      class="resize-handle"
      onMouseDown={onMouseDown}
      title="拖动调整面板宽度"
    >
      <div class="resize-handle-grip" />
    </div>
  );
}
