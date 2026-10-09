import React, { useContext, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api, { API_BASE_URL } from '../../services/api';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ReportOutlineReviewModal from '../../components/ReportOutlineReviewModal';
import { useDashboardData } from '../../hooks/useDashboardData';
import { getErrorMessage } from '../../utils/errors';

/**
 * โครงร่างรายงานการปฏิบัติงานสหกิจศึกษา (สหกิจ 11)
 *
 * ใช้ร่วมกันระหว่าง role `mentor` และ `company` — เดิมอยู่ใน `CompanyDashboard.tsx`
 * ปนกับฟอร์มลงประกาศงานที่ตายแล้วและหน้าโปรไฟล์บริษัท เลยแยกออกมาเป็นหน้าจอของตัวเอง
 * (spec-D 14.1)
 *
 * ⛔ บัญชี `company` เห็นชอบ/ตีกลับแทนพี่เลี้ยงไม่ได้อีกต่อไป — ปุ่มเปลี่ยนเป็นข้อความ
 * "รอพนักงานที่ปรึกษาเป็นผู้พิจารณา" และ modal ที่เปิดดูก็เป็น readOnly เสมอ
 * (backend ปฏิเสธ 403 ที่ PUT /outlines/:id/status อยู่แล้ว — หน้าจอแค่ไม่เสนอปุ่มที่กดแล้วพัง)
 * ⛔ ห้ามซ่อนรายการจาก company — ฝ่ายบุคคลต้องรู้ว่ามีอะไรค้างอยู่ที่พี่เลี้ยง
 */

interface ReportOutlineItem {
  outline_id: number;
  student_id: number;
  student_code: string;
  first_name: string | null;
  last_name: string | null;
  major_name_th: string;
  status: string;
  created_at: string;
  updated_at: string;
  latest_file_path: string | null;
  latest_submitted_at: string | null;
  latest_rejection_comment: string | null;
}

const ReportOutlineQueue: React.FC = () => {
  const auth = useContext(AuthContext);
  const hasMentorRole = auth?.user?.roles?.includes('mentor') ?? false;

  const [outlines, setOutlines] = useState<ReportOutlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [reviewingOutline, setReviewingOutline] = useState<ReportOutlineItem | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }
      const res = await api.get('/outlines/company');
      const list = Array.isArray(res) ? res : (res?.data || []);
      setOutlines(list);
    } catch (err) {
      console.error('Failed to load report outline queue:', err);
      if (!isBackground) setError(getErrorMessage(err, 'ไม่สามารถโหลดรายการโครงร่างรายงานได้'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(loadData, []);

  const handleReviewOutline = async (status: 'pending_advisor' | 'rejected') => {
    if (!reviewingOutline) return;
    if (status === 'rejected' && !reviewComment.trim()) {
      setError('กรุณาระบุข้อเสนอแนะในการตีกลับแก้ไขโครงร่างรายงาน');
      return;
    }

    try {
      setIsSubmittingReview(true);
      setError(null);
      await api.put(`/outlines/${reviewingOutline.outline_id}/status`, {
        status,
        comment: reviewComment,
      });

      setSuccess(
        status === 'pending_advisor'
          ? 'อนุมัติโครงร่างรายงาน (สหกิจ 11) และส่งต่อให้อาจารย์นิเทศพิจารณาเรียบร้อยแล้ว'
          : 'ตีกลับโครงร่างรายงานให้นักศึกษาแก้ไขเรียบร้อยแล้ว'
      );
      setReviewingOutline(null);
      setReviewComment('');
      await loadData();
    } catch (err) {
      console.error('Review outline error:', err);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการตรวจอนุมัติโครงร่าง'));
    } finally {
      setIsSubmittingReview(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant="table" />;
  }

  return (
    <div className="space-y-6 page-enter">
      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">
              โครงร่างรายงานการปฏิบัติงานสหกิจศึกษา (สหกิจ 11)
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              ตรวจสอบความถูกต้องของหัวข้อวัตถุประสงค์และแผนการทำรายงานของนักศึกษาฝึกงาน
            </p>
          </div>
          <span className="px-3 py-1 bg-brand-blue/10 text-brand-navy rounded-full text-xs font-bold dark:text-blue-400">
            {outlines.filter((o) => o.status === 'pending_mentor').length} รายการรอพี่เลี้ยงตรวจ
          </span>
        </div>

        {outlines.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 font-semibold">นักศึกษา</th>
                  <th className="p-4 font-semibold">สาขาวิชา</th>
                  <th className="p-4 font-semibold">วันที่อัปโหลดล่าสุด</th>
                  <th className="p-4 font-semibold text-center">สถานะโครงร่าง</th>
                  <th className="p-4 font-semibold text-right">เอกสาร & ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {outlines.map((item) => (
                  <tr key={item.outline_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="p-4">
                      <div className="font-bold text-gray-800 dark:text-gray-200">
                        {item.first_name ? `${item.first_name} ${item.last_name}` : `รหัสนักศึกษา: ${item.student_code}`}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{item.student_code}</div>
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-400">{item.major_name_th}</td>
                    <td className="p-4 text-gray-500 text-xs dark:text-gray-400">
                      {item.latest_submitted_at
                        ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.latest_submitted_at))
                        : '-'}
                    </td>
                    <td className="p-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${
                          item.status === 'pending_mentor'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900'
                            : item.status === 'pending_advisor'
                            ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900'
                            : item.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900'
                            : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900'
                        }`}
                      >
                        {item.status === 'pending_mentor'
                          ? 'รอพี่เลี้ยงตรวจ'
                          : item.status === 'pending_advisor'
                          ? 'พี่เลี้ยงอนุมัติแล้ว (รอ อ.นิเทศ)'
                          : item.status === 'approved'
                          ? 'อนุมัติสมบูรณ์'
                          : 'ตีกลับแก้ไข'}
                      </span>
                    </td>
                    <td className="p-4 text-right flex items-center justify-end gap-2">
                      {item.latest_file_path && (
                        <a
                          href={`${API_BASE_URL}/files/${item.latest_file_path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all active:scale-[0.97] dark:border-gray-800 dark:hover:text-blue-400"
                          title="เปิดไฟล์ PDF โครงร่าง"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </a>
                      )}

                      <Button
                        size="sm"
                        data-testid={`outline-action-${item.outline_id}`}
                        variant={item.status === 'pending_mentor' && hasMentorRole ? 'primary' : 'secondary'}
                        onClick={() => {
                          setReviewingOutline(item);
                          setReviewComment(item.latest_rejection_comment || '');
                        }}
                      >
                        {item.status === 'pending_mentor'
                          ? hasMentorRole
                            ? 'ตรวจอนุมัติ'
                            : 'รอพนักงานที่ปรึกษาเป็นผู้พิจารณา'
                          : 'ดูรายละเอียด/ผลตรวจ'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            ยังไม่มีนักศึกษายื่นโครงร่างรายงานเข้ามา
          </div>
        )}
      </div>

      <ReportOutlineReviewModal
        outline={reviewingOutline}
        reviewer="mentor"
        readOnly={!hasMentorRole}
        comment={reviewComment}
        onCommentChange={setReviewComment}
        onClose={() => setReviewingOutline(null)}
        onDecision={(decision) => handleReviewOutline(decision === 'approve' ? 'pending_advisor' : 'rejected')}
        submitting={isSubmittingReview}
      />
    </div>
  );
};

export default ReportOutlineQueue;
