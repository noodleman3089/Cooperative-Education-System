import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Pin } from 'lucide-react';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';
import type { Announcement } from '../../types/api';

/**
 * E10 · ข่าวประชาสัมพันธ์ (Announcements.dc.html)
 *
 * ขึ้นเป็นแบนเนอร์บนหน้าแรกของนักศึกษา · ข่าวที่ปักหมุดขึ้นก่อนเสมอ
 * Layout: 2 คอลัมน์ (ฟอร์มเขียนข่าว 440px ทางซ้าย, รายการข่าวที่เผยแพร่แล้วทางขวา)
 *
 * ข้อความสำคัญด้านล่าง:
 * ⛔ ไม่มีระบบแจ้งเตือนกลางและไม่มีกระดิ่ง
 * ข่าวที่นี่ + อีเมลเดิม + รายการค้างบนหน้าแรกของแต่ละฝ่าย คือทั้งหมดของการแจ้งเตือนในระบบนี้
 */

export const AnnouncementsManager: React.FC = () => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annImage, setAnnImage] = useState('');
  const [annPinned, setAnnPinned] = useState(false);
  const [isSubmittingAnn, setIsSubmittingAnn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    try {
      setLoadingAnnouncements(true);
      const res = await api.get('/announcements');
      setAnnouncements(res?.data || []);
    } catch (err) {
      console.error('Failed to load announcements:', err);
    } finally {
      setLoadingAnnouncements(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAnnouncements();
  }, [loadAnnouncements]);

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annContent.trim()) return;

    try {
      setIsSubmittingAnn(true);
      setError(null);
      await api.post('/announcements', {
        title: annTitle.trim(),
        content: annContent.trim(),
        image_url: annImage.trim() || null,
        is_pinned: annPinned,
      });
      setSuccess('เผยแพร่ข่าวประชาสัมพันธ์เรียบร้อยแล้ว');
      setAnnTitle('');
      setAnnContent('');
      setAnnImage('');
      setAnnPinned(false);
      await loadAnnouncements();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถสร้างข่าวประชาสัมพันธ์ได้'));
    } finally {
      setIsSubmittingAnn(false);
    }
  };

  const handleResetForm = () => {
    setAnnTitle('');
    setAnnContent('');
    setAnnImage('');
    setAnnPinned(false);
  };

  const handleTogglePin = async (id: number) => {
    try {
      await api.patch(`/announcements/${id}/pin`);
      await loadAnnouncements();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถเปลี่ยนสถานะการปักหมุดได้'));
    }
  };

  const handleDeleteAnnouncement = async () => {
    if (!pendingDeleteId) return;
    try {
      setDeleteBusy(true);
      await api.delete(`/announcements/${pendingDeleteId}`);
      setSuccess('ลบข่าวประชาสัมพันธ์เรียบร้อยแล้ว');
      setPendingDeleteId(null);
      await loadAnnouncements();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถลบข่าวประชาสัมพันธ์ได้'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const targetToDelete = announcements.find((a) => a.announcement_id === pendingDeleteId);

  return (
    <div className="max-w-[1360px] mx-auto space-y-4 pb-12">
      {/* 1. Header Bar matching Announcements.dc.html */}
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          ข่าวประชาสัมพันธ์
        </h1>
        <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
          ขึ้นเป็นแบนเนอร์บนหน้าแรกของนักศึกษา · ข่าวที่ปักหมุดขึ้นก่อนเสมอ
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* 2. Grid 2 Columns matching Announcements.dc.html (440px / 1fr) */}
      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-4 items-start">
        {/* Left Column: Form Card */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 space-y-3.5 shadow-xs">
          <h2 className="text-[17px] font-extrabold text-gray-900 dark:text-white">
            เขียนข่าวใหม่
          </h2>

          <form onSubmit={handleCreateAnnouncement} className="space-y-3.5 text-xs">
            <div>
              <label htmlFor="ann-title" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                หัวข้อ
              </label>
              <input
                id="ann-title"
                type="text"
                required
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="เช่น ประกาศผลการคัดเลือกสหกิจศึกษา ภาคเรียนที่ 1/2570"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-300 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="ann-content" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                เนื้อหา
              </label>
              <textarea
                id="ann-content"
                required
                rows={7}
                value={annContent}
                onChange={(e) => setAnnContent(e.target.value)}
                placeholder="กรอกรายละเอียดข่าว กำหนดการ สถานที่ หรือสิ่งที่นักศึกษาต้องเตรียมตัว..."
                className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-300 focus:outline-none focus:border-blue-500 resize-y"
              />
            </div>

            <div>
              <label htmlFor="ann-image" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ลิงก์รูปประกอบ (ถ้ามี)
              </label>
              <input
                id="ann-image"
                type="url"
                value={annImage}
                onChange={(e) => setAnnImage(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-300 focus:outline-none focus:border-blue-500"
              />
              <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-normal">
                ใส่เป็น URL · ระบบไม่รับอัปโหลดไฟล์ที่หน้านี้
              </span>
            </div>

            {/*
              สวิตช์ปักหมุด — ⛔ ต้องเป็น <button role="switch"> ไม่ใช่ <div onClick>
              ของเดิมเป็น div ซึ่งกด Tab ไปไม่ถึงและโปรแกรมอ่านจอไม่รู้ว่าเปิดหรือปิดอยู่
            */}
            <button
              type="button"
              role="switch"
              aria-checked={annPinned}
              data-testid="ann-pin-toggle"
              onClick={() => setAnnPinned(!annPinned)}
              className="w-full flex items-center gap-2.5 p-2.5 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors text-left"
            >
              <div
                className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                  annPinned ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.5 ${
                    annPinned ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </div>
              <span className="text-xs font-semibold text-gray-900 dark:text-white select-none">
                ปักหมุดไว้บนสุด
              </span>
            </button>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSubmittingAnn}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
              >
                {isSubmittingAnn ? 'กำลังเผยแพร่...' : 'เผยแพร่'}
              </button>
              <button
                type="button"
                onClick={handleResetForm}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                ล้างฟอร์ม
              </button>
            </div>

            <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 pt-1">
              เผยแพร่แล้วนักศึกษาเห็นทันที ไม่มีขั้นตอนอนุมัติ · แก้ถ้อยคำภายหลังไม่ได้ ต้องลบแล้วเขียนใหม่
            </p>
          </form>
        </div>

        {/* Right Column: News Cards List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900 dark:text-white">
              ข่าวที่เผยแพร่แล้ว · {announcements.length} เรื่อง
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              ปักหมุดได้ไม่จำกัด แต่หน้าแรกนักศึกษาแสดง 3 เรื่องแรก
            </span>
          </div>

          {loadingAnnouncements ? (
            <div className="p-8 text-center text-xs text-gray-600 dark:text-gray-400">
              กำลังโหลดข่าวประชาสัมพันธ์...
            </div>
          ) : announcements.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-8 text-center text-xs text-gray-500 dark:text-gray-400">
              ยังไม่มีข่าวประชาสัมพันธ์ในขณะนี้
            </div>
          ) : (
            announcements.map((ann) => {
              const isPinned = !!ann.is_pinned;
              return (
                <div
                  key={ann.announcement_id}
                  data-testid={`announcement-card-${ann.announcement_id}`}
                  className={`bg-white dark:bg-gray-800 border rounded-2xl p-4 sm:p-5 flex items-start gap-4 shadow-xs transition-colors ${
                    isPinned
                      ? 'border-blue-300 dark:border-blue-800/80'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="flex-grow space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      {isPinned && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#EFF6FF] text-[#1E3A8A] dark:bg-blue-950/60 dark:text-blue-300">
                          <Pin className="w-2.5 h-2.5 fill-current" />
                          ปักหมุด
                        </span>
                      )}
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        {formatThaiDate(ann.created_at)}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-gray-900 dark:text-white break-words">
                      {ann.title}
                    </h3>

                    <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed break-words whitespace-pre-line">
                      {ann.content}
                    </p>

                    {ann.image_url && (
                      <div className="pt-2">
                        <img
                          src={ann.image_url}
                          alt={ann.title}
                          className="max-h-48 rounded-xl object-cover border border-gray-100 dark:border-gray-700"
                        />
                      </div>
                    )}
                  </div>

                  {/* Actions vertical stack */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTogglePin(ann.announcement_id)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap"
                    >
                      {isPinned ? 'เลิกปักหมุด' : 'ปักหมุด'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(ann.announcement_id)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-900/60 bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors whitespace-nowrap"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {/* Bottom Notice Card matching Announcements.dc.html */}
          <div className="p-4 sm:p-5 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 space-y-1.5">
            <div className="text-xs font-bold text-gray-900 dark:text-white">
              ⛔ ไม่มีระบบแจ้งเตือนกลางและไม่มีกระดิ่ง
            </div>
            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
              ข่าวที่นี่ + อีเมลเดิม + รายการค้างบนหน้าแรกของแต่ละฝ่าย คือทั้งหมดของการแจ้งเตือนในระบบนี้ · อย่าเสนอตาราง notification ใหม่
            </p>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="ยืนยันการลบข่าวประชาสัมพันธ์"
        message={`ต้องการลบข่าว "${targetToDelete?.title ?? ''}" ออกจากระบบใช่หรือไม่? เมื่อลบแล้วข่าวจะหายไปจากหน้าแรกของนักศึกษาทันที`}
        confirmLabel="ลบข่าวประชาสัมพันธ์"
        destructive
        busy={deleteBusy}
        onConfirm={handleDeleteAnnouncement}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
};

export default AnnouncementsManager;
