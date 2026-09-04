import React, { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '5xl';

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '5xl': 'max-w-5xl',
};

/** Nested dialogs must not let the inner one restore scrolling on its way out. */
let openModalCount = 0;

interface ModalProps {
  onClose: () => void;
  /** Renders the standard header. Omit for dialogs that draw their own. */
  title?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
  /** Extra classes for the panel — height and layout, not appearance. */
  className?: string;
  /** Off for dialogs where a stray click would lose typed input. */
  closeOnBackdrop?: boolean;
}

/**
 * The shell every dialog sits in. There were fourteen hand-written ones, and
 * they had drifted on every axis at once: seven different backdrop colours
 * across four neutral families, blur on some and not others, z-50 in thirteen
 * and z-[100] in the fourteenth, radius 2xl in thirteen and 3xl in the last.
 *
 * More to the point, none of the fourteen closed on Escape, none set a dialog
 * role, and none stopped the page behind from scrolling under them. Those are
 * the kind of thing nobody adds to fourteen files one at a time, which is why
 * none of them had it.
 */
export const Modal: React.FC<ModalProps> = ({
  onClose,
  title,
  size = 'lg',
  children,
  className = '',
  closeOnBackdrop = true,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // ponytail: hold onClose in a ref so inline arrow functions passed from callers
  // do not trigger useEffect re-runs on every keystroke, which was stealing focus via panelRef.focus()
  //
  // ⛔ อัปเดต ref **ใน effect ไม่ใช่ระหว่าง render** — การเขียน ref ตอน render
  //    ผิดกฎ React (จับได้ด้วย lint `Cannot access refs during render`) เพราะ
  //    render อาจถูกทิ้งหรือรันซ้ำได้ใน concurrent mode แล้ว ref จะค้างค่าที่ไม่เคยถูกใช้จริง
  //    · effect ตัวนี้จงใจไม่มี dependency array ให้รันทุกครั้งหลัง render
  //      ซึ่งไม่กระทบ effect ข้างล่างที่ผูก `[]` ไว้ — focus จึงยังไม่ถูกแย่ง
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    openModalCount += 1;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      openModalCount -= 1;
      if (openModalCount === 0) document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 backdrop-blur-sm p-4 animate-fade-in"
      onMouseDown={(e) => {
        // mousedown, not click: a drag that starts inside the panel and ends on
        // the backdrop should not count as clicking away.
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`w-full ${SIZES[size]} max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl outline-none overflow-hidden animate-scale-in ${className}`.trim()}
      >
        {title && (
          <div className="flex items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800 px-6 py-4 shrink-0">
            <h3 className="text-base font-bold text-gray-800 dark:text-white">{title}</h3>
            {/* gray-500, not -400: the × is a graphic, and WCAG 1.4.11 asks 3:1
                of a control's icon against its background. gray-400 measured
                2.6:1 on the modal's white panel — it passed in dark mode only.
                Dark mode already overrides the colour, so this touches light. */}
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="p-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

/** Padded, scrollable body. Separate so a dialog can opt out — a PDF viewer
 *  wants its iframe flush to the edges. */
export const ModalBody: React.FC<{ children: ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`px-6 py-5 overflow-y-auto flex-1 min-h-0 ${className}`.trim()}>
    {children}
  </div>
);

/** Actions row. Always the last child, always right-aligned. */
export const ModalFooter: React.FC<{ children: ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={`flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800 px-6 py-4 shrink-0 ${className}`.trim()}
  >
    {children}
  </div>
);

export default Modal;
