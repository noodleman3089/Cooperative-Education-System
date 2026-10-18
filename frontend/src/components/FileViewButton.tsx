import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import Modal from './ui/Modal';
import AlertBanner from './ui/AlertBanner';

interface FileViewButtonProps {
  /** URL เต็มของไฟล์ (ต้องเป็นของ API ที่ใช้ cookie session) */
  src: string;
  /** ชื่อกล่องและป้ายกำกับปุ่ม เช่น "แบบคำร้องที่ส่งไป" */
  title: string;
  /** มีค่า = ปุ่มข้อความพร้อมไอคอน (เช่น "ดูเรซูเม่") แทนไอคอนดวงตาเล็ก ๆ */
  label?: string;
  'data-testid'?: string;
}

/**
 * ปุ่มรูปดวงตาที่เปิดไฟล์ในกล่องหน้าเว็บ แทนลิงก์ที่พาไปแท็บใหม่แล้วให้เบราว์เซอร์โหลดไฟล์ลงเครื่อง
 * ดึงไฟล์ด้วย cookie แล้วแสดงจาก blob — เปิดดูได้เลยทั้ง PDF และรูป ไม่มีไฟล์ค้างในเครื่อง
 */
const FileViewButton: React.FC<FileViewButtonProps> = ({ src, title, label, 'data-testid': testId }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ url: string; isImage: boolean } | null>(null);

  const openViewer = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      // `api` แปลงคำตอบเป็น JSON เสมอ — เส้นนี้ตอบเป็นไฟล์ จึงเรียก fetch ตรง (session เป็น cookie เหมือนกัน)
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      setFile({ url: URL.createObjectURL(blob), isImage: blob.type.startsWith('image/') });
    } catch {
      setError('เปิดไฟล์ไม่สำเร็จ ลองกดอีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    if (file) URL.revokeObjectURL(file.url);
    setFile(null);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={openViewer}
        title={`ดู${title}`}
        aria-label={`ดู${title}`}
        data-testid={testId}
        className={
          label
            ? 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 text-xs font-bold text-brand-blue transition-colors hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-900/40'
            : 'inline-flex items-center rounded p-1 text-brand-blue transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40'
        }
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>

      {open && (
        // h-[...] ที่แผง ไม่ใช่ที่เนื้อหา — แผงเป็น flex-col และเนื้อหา flex-1 จะเมินความสูงของตัวเอง
        // ไม่ใส่ความสูงที่แผง iframe จะเหลือ 150px (ค่าเริ่มต้นของ iframe)
        <Modal onClose={close} size="5xl" title={title} className="h-[calc(100vh-3.5rem)]">
          <div className="flex min-h-0 flex-1 items-stretch">
            {loading && <p className="m-auto text-sm text-gray-600 dark:text-gray-400">กำลังเปิดไฟล์…</p>}
            {error && <AlertBanner variant="error" message={error} className="m-6" />}
            {file &&
              (file.isImage ? (
                <img src={file.url} alt={title} className="m-auto max-h-full max-w-full object-contain" />
              ) : (
                // ซ่อนแถบเครื่องมือของตัวอ่าน PDF ในเบราว์เซอร์ (รูปแบบเดียวกับ DeanSignQueue)
                <iframe title={title} src={`${file.url}#toolbar=0&navpanes=0&view=FitH`} className="w-full bg-white" />
              ))}
          </div>
        </Modal>
      )}
    </>
  );
};

export default FileViewButton;
