import React from 'react';
import Modal from './ui/Modal';

interface ResumePdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string;
  fileName: string;
}

const ResumePdfModal: React.FC<ResumePdfModalProps> = ({
  isOpen,
  onClose,
  pdfUrl,
  fileName,
}) => {
  if (!isOpen) return null;

  return (
    // No `title`: this dialog's header carries a download action as well, so it
    // draws its own. Escape, the scroll lock and the entrance still apply.
    <Modal onClose={onClose} size="5xl" className="overflow-hidden">
      <>
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-800 dark:text-white truncate">
                {fileName}
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400">ตัวอย่างเอกสารเรซูเม่ (PDF Preview)</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              ดาวน์โหลด
            </a>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body - Embedded PDF Viewer */}
        <div className="flex-1 p-4 bg-gray-100 dark:bg-gray-950 overflow-hidden flex items-center justify-center">
          <object
            data={pdfUrl}
            type="application/pdf"
            className="w-full h-[70vh] rounded-xl border border-gray-200 dark:border-gray-800 shadow-inner"
          >
            <div className="flex flex-col items-center justify-center py-12 text-center p-6 bg-white dark:bg-gray-900 rounded-xl">
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                เบราว์เซอร์ของคุณไม่รองรับการแสดงผล PDF ในหน้าเว็บบนอุปกรณ์นี้
              </p>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md"
              >
                คลิกที่นี่เพื่อเปิดไฟล์ในแท็บใหม่
              </a>
            </div>
          </object>
        </div>
      </>
    </Modal>
  );
};

export default ResumePdfModal;
