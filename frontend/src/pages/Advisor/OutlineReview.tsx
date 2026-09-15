import React, { useState } from 'react';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api, { API_BASE_URL } from '../../services/api';
import { ExternalLink } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';
import type { ReportOutlineRow } from '../../types/api';
import ReportOutlineReviewModal from '../../components/ReportOutlineReviewModal';

const OUTLINE_STATUS: Record<string, { text: string; tone: string }> = {
  pending_mentor: {
    text: 'รอพี่เลี้ยงตรวจ',
    tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50',
  },
  pending_advisor: {
    text: 'รอที่ปรึกษาอนุมัติ',
    tone: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50',
  },
  approved: {
    text: 'อนุมัติเรียบร้อย',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50',
  },
  rejected: {
    text: 'ตีกลับแก้ไข',
    tone: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50',
  },
};

const OutlineReview: React.FC = () => {
  const [reportOutlines, setReportOutlines] = useState<ReportOutlineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Report Outline review modal state for Advisor
  const [reviewingOutline, setReviewingOutline] = useState<ReportOutlineRow | null>(null);
  const [outlineComment, setOutlineComment] = useState('');
  const [isSubmittingOutlineReview, setIsSubmittingOutlineReview] = useState(false);

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const outlinesRes = await api.get('/outlines/advisor').catch(() => ({ data: [] }));
      setReportOutlines(Array.isArray(outlinesRes) ? outlinesRes : (outlinesRes?.data || []));
    } catch (err) {
      console.error('Failed to load advisor outlines data:', err);
      if (!isBackground) setError('ไม่สามารถโหลดข้อมูลโครงร่างรายงานได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const handleReviewAdvisorOutline = async (status: 'approved' | 'rejected') => {
    if (!reviewingOutline) return;
    if (status === 'rejected' && !outlineComment.trim()) {
      setError('กรุณาระบุข้อเสนอแนะในการตีกลับแก้ไขโครงร่างรายงาน');
      return;
    }

    try {
      setIsSubmittingOutlineReview(true);
      setError(null);
      await api.put(`/outlines/${reviewingOutline.outline_id}/status`, {
        status,
        comment: outlineComment
      });

      setSuccess(
        status === 'approved'
          ? 'อนุมัติโครงร่างรายงานการปฏิบัติงาน (สหกิจ 11) สมบูรณ์เรียบร้อยแล้ว'
          : 'ตีกลับโครงร่างรายงานให้นักศึกษาแก้ไขเรียบร้อยแล้ว'
      );
      setReviewingOutline(null);
      setOutlineComment('');
      await loadData();
    } catch (err) {
      console.error('Advisor review outline error:', err);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการอนุมัติโครงร่างรายงาน'));
    } finally {
      setIsSubmittingOutlineReview(false);
    }
  };

  useDashboardData(loadData, []);

  if (loading) {
    return <PageSkeleton variant={skeletonFor('advisor', 'report_outlines')} />;
  }

  const pendingAdvisorCount = reportOutlines.filter(o => o.status === 'pending_advisor').length;

  return (
    <div className="space-y-6 page-enter">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">
            อนุมัติโครงร่างรายงานการปฏิบัติงาน (สหกิจ 11)
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            พิจารณาอนุมัติขั้นสุดท้ายสำหรับโครงร่างรายงานที่ผ่านการคัดกรองจากพี่เลี้ยงสถานประกอบการแล้ว
          </p>
        </div>
        <span className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-brand-blue/10 text-brand-navy dark:bg-blue-950/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800 self-start sm:self-auto">
          {pendingAdvisorCount} รายการรอที่ปรึกษาอนุมัติ
        </span>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        {reportOutlines.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 font-semibold">นักศึกษาในที่ปรึกษา</th>
                  <th className="p-4 font-semibold">สถานประกอบการ</th>
                  <th className="p-4 font-semibold">อัปโหลดล่าสุด</th>
                  <th className="p-4 font-semibold text-center">สถานะการอนุมัติ</th>
                  <th className="p-4 font-semibold text-right">ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {reportOutlines.map((item) => (
                  <tr key={item.outline_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="p-4">
                      <div className="font-bold text-gray-800 dark:text-gray-200">
                        {item.first_name ? `${item.first_name} ${item.last_name}` : `รหัส: ${item.student_code}`}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        รหัส: <span className="font-mono">{item.student_code}</span> ({item.major_name_th})
                      </div>
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-400 font-medium">
                      {item.company_name_th}
                    </td>
                    <td className="p-4 text-gray-500 font-mono text-xs dark:text-gray-400">
                      {item.latest_submitted_at
                        ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.latest_submitted_at))
                        : '-'}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${
                        OUTLINE_STATUS[item.status]?.tone
                          ?? 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                      }`}
                      title={OUTLINE_STATUS[item.status] ? undefined : `สถานะที่ยังไม่ได้กำหนดคำอธิบาย: ${item.status}`}>
                        {OUTLINE_STATUS[item.status]?.text ?? item.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {item.latest_file_path && (
                          <a
                            href={`${API_BASE_URL}/files/${item.latest_file_path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all active:scale-[0.97] dark:border-gray-800 dark:hover:text-blue-400"
                            title="เปิดอ่านไฟล์ PDF โครงร่าง"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReviewingOutline(item);
                            setOutlineComment(item.latest_rejection_comment || '');
                          }}
                          className="py-1.5 px-3 rounded-lg bg-brand-blue text-white hover:bg-blue-600 font-bold text-xs transition-all active:scale-[0.97] shadow-sm shadow-blue-500/10"
                        >
                          {item.status === 'pending_advisor' ? 'เปิดตรวจอนุมัติ' : 'ดูประวัติ/ผลตรวจ'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-600 dark:text-gray-400 text-sm">
            ไม่พบข้อมูลโครงร่างรายงาน (สหกิจ 11) ของนักศึกษาในที่ปรึกษา
          </div>
        )}
      </div>

      <ReportOutlineReviewModal
        outline={reviewingOutline}
        reviewer="advisor"
        comment={outlineComment}
        onCommentChange={setOutlineComment}
        onClose={() => setReviewingOutline(null)}
        onDecision={(decision) =>
          handleReviewAdvisorOutline(decision === 'approve' ? 'approved' : 'rejected')
        }
        submitting={isSubmittingOutlineReview}
      />
    </div>
  );
};

export default OutlineReview;
