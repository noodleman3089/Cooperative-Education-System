import React from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal, { ModalBody, ModalFooter } from './Modal';
import Button from './Button';

interface ConfirmDialogProps {
  /** Rendered only when set. Hold the pending action in state at the call site. */
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTestId?: string;
  cancelTestId?: string;
  /** Red confirm button, for deletions and anything that cannot be undone. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Replaces window.confirm. The browser dialog is fine mechanically, but it
 * announces itself as "localhost:5173 says", cannot be styled, ignores the
 * page's language and theme, and puts an OK/Cancel pair on a decision like
 * deleting a user account. On a university records system that reads as an
 * unfinished page, which is most of the reason this pass exists.
 *
 * It is also blocking: window.confirm freezes the whole tab, so nothing could
 * show a spinner while the request it guards was in flight.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  confirmTestId,
  cancelTestId,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <Modal onClose={onCancel} size="md" title={title}>
      <ModalBody>
        <div className="flex items-start gap-3">
          <div
            className={`shrink-0 rounded-full p-2 ${
              destructive
                ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{message}</div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy} data-testid={cancelTestId}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          size="sm"
          onClick={onConfirm}
          loading={busy}
          data-testid={confirmTestId}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ConfirmDialog;
