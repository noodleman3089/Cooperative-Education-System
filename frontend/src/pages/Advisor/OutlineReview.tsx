import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api, { API_BASE_URL } from '../../services/api';
import { FileText, ExternalLink, RefreshCw, CheckCircle2 } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';
import type { ReportOutlineRow, ReportOutlineVersion } from '../../types/api';

type OutlineTab = 'pending_advisor' | 'pending_mentor' | 'approved' | 'rejected';

const TAB_CONFIG: Record<OutlineTab, { label: string; tone: string }> = {
  pending_advisor: {
    label: 'รอคุณ',
    tone: 'text-brand-navy dark:text-blue-400',
  },
  pending_mentor: {
    label: 'รอพี่เลี้ยง',
    tone: 'text-amber-700 dark:text-amber-400',
  },
  approved: {
    label: 'เห็นชอบแล้ว',
    tone: 'text-emerald-700 dark:text-emerald-400',
  },
  rejected: {
    label: 'ส่งกลับแก้',
    tone: 'text-rose-700 dark:text-rose-400',
  },
};

const OutlineReview: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as OutlineTab) || 'pending_advisor';
  const outlineIdParam = searchParams.get('outline');

  const [reportOutlines, setReportOutlines] = useState<ReportOutlineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Review form state
  const [outlineComment, setOutlineComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  // Versions history for the selected student
  const [versionsData, setVersionsData] = useState<{
    studentId: number;
    versions: ReportOutlineVersion[];
  } | null>(null);

  const loadOutlines = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const res = await api.get('/outlines/advisor');
      const data: ReportOutlineRow[] = Array.isArray(res) ? res : res?.data || [];
      setReportOutlines(data);
    } catch (err) {
      console.error('Failed to load advisor outlines:', err);
      if (!isBackground) {
        setError(getErrorMessage(err, 'ดึงรายการโครงร่างไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useDashboardData(loadOutlines, []);

  // Group outlines by status
  const outlinesByStatus = useMemo(() => {
    const map: Record<OutlineTab, ReportOutlineRow[]> = {
      pending_advisor: [],
      pending_mentor: [],
      approved: [],
      rejected: [],
    };
    reportOutlines.forEach((item) => {
      const st = item.status as OutlineTab;
      if (map[st]) {
        map[st].push(item);
      }
    });

    // Sort pending_advisor by days_waiting descending, then updated_at
    map.pending_advisor.sort((a, b) => {
      const dayA = a.days_waiting ?? -1;
      const dayB = b.days_waiting ?? -1;
      if (dayB !== dayA) return dayB - dayA;
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });

    return map;
  }, [reportOutlines]);

  const currentList = useMemo(() => {
    return outlinesByStatus[activeTab] || [];
  }, [outlinesByStatus, activeTab]);

  // Derived selected outline ID
  const selectedOutlineId = useMemo(() => {
    if (outlineIdParam) {
      const parsed = parseInt(outlineIdParam, 10);
      if (!isNaN(parsed)) return parsed;
    }
    if (activeTab === 'pending_advisor' && currentList.length > 0) {
      return currentList[0].outline_id;
    }
    return null;
  }, [outlineIdParam, activeTab, currentList]);

  // Selected outline item
  const selectedOutline = useMemo(() => {
    if (!selectedOutlineId) return null;
    return reportOutlines.find((o) => o.outline_id === selectedOutlineId) || null;
  }, [selectedOutlineId, reportOutlines]);

  // Fetch version history asynchronously when student_id changes
  useEffect(() => {
    const sId = selectedOutline?.student_id;
    if (!sId) return;

    let cancelled = false;
    api
      .get(`/outlines/student/${sId}`)
      .then((res) => {
        if (!cancelled) {
          setVersionsData({
            studentId: sId,
            versions: res?.data?.versions || [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVersionsData({ studentId: sId, versions: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOutline?.student_id]);

  const versions = useMemo(() => {
    if (!selectedOutline?.student_id || versionsData?.studentId !== selectedOutline.student_id) {
      return [];
    }
    return versionsData.versions;
  }, [selectedOutline?.student_id, versionsData]);

  const handleTabChange = (tab: OutlineTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      next.delete('outline');
      return next;
    });
    setOutlineComment('');
    setPanelError(null);
  };

  const handleSelectOutline = (outline: ReportOutlineRow) => {
    if (activeTab === 'pending_mentor') return; // Cannot review in pending_mentor
    setOutlineComment('');
    setPanelError(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', activeTab);
      next.set('outline', outline.outline_id.toString());
      return next;
    });
  };

  const handleReviewAction = async (status: 'approved' | 'rejected') => {
    if (!selectedOutline) return;
    if (status === 'rejected' && !outlineComment.trim()) {
      setPanelError('กรุณาระบุข้อเสนอแนะในการส่งกลับแก้ไขโครงร่างรายงาน');
      return;
    }

    try {
      setIsSubmitting(true);
      setPanelError(null);
      await api.put(`/outlines/${selectedOutline.outline_id}/status`, {
        status,
        comment: outlineComment.trim() || undefined,
      });

      const studentName = selectedOutline.first_name
        ? `${selectedOutline.first_name} ${selectedOutline.last_name || ''}`.trim()
        : selectedOutline.student_code;

      setSuccess(
        status === 'approved'
          ? `เห็นชอบโครงร่างรายงานของ ${studentName} เรียบร้อยแล้ว (อนุมัติเรียบร้อย)`
          : `ส่งกลับโครงร่างรายงานของ ${studentName} ให้แก้ไขเรียบร้อยแล้ว`
      );

      setOutlineComment('');
      await loadOutlines(false);
    } catch (err) {
      console.error('Outline review action failed:', err);
      setPanelError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกผลการพิจารณา'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant={skeletonFor('advisor', 'report_outlines')} />;
  }

  return (
    <div className="space-y-6 page-enter pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            เห็นชอบโครงร่างรายงาน (สหกิจ 11)
          </h1>
          <span className="sr-only">อนุมัติโครงร่างรายงานการปฏิบัติงาน (สหกิจ 11)</span>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl leading-relaxed">
            ลำดับตามแบบฟอร์ม: นักศึกษาปรึกษาพี่เลี้ยง →{' '}
            <strong className="font-semibold text-gray-800 dark:text-gray-200">
              พนักงานที่ปรึกษาเห็นชอบก่อน
            </strong>{' '}
            → อาจารย์ที่ปรึกษาตรวจ ให้คำแนะนำ และเห็นชอบ · ส่งภายใน 3 สัปดาห์แรก
          </p>
        </div>

        {/* 4 Status Tabs */}
        <div className="flex flex-wrap gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 self-start md:self-auto">
          {(['pending_advisor', 'pending_mentor', 'approved', 'rejected'] as OutlineTab[]).map(
            (tabKey) => {
              const count = outlinesByStatus[tabKey].length;
              const isActive = activeTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  data-testid={`outline-tab-${tabKey}`}
                  onClick={() => handleTabChange(tabKey)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    isActive
                      ? 'bg-white dark:bg-gray-900 text-brand-navy dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  {TAB_CONFIG[tabKey].label} ({count})
                </button>
              );
            }
          )}
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      {success && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          <span>{success}</span>
          <span className="font-bold text-emerald-700 dark:text-emerald-400 shrink-0">อนุมัติเรียบร้อย</span>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Column: Queue List */}
        <div className="w-full lg:w-[430px] shrink-0 card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/30">
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                {activeTab === 'pending_advisor'
                  ? 'รอคุณเห็นชอบ'
                  : activeTab === 'pending_mentor'
                    ? 'รอพนักงานที่ปรึกษาเห็นชอบ'
                    : activeTab === 'approved'
                      ? 'เห็นชอบแล้ว'
                      : 'ส่งกลับให้แก้ไข'}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {activeTab === 'pending_advisor'
                  ? 'เรียงจากที่รอนานที่สุด'
                  : `ทั้งหมด ${currentList.length} รายการ`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadOutlines(false)}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="รีเฟรชรายการ"
              aria-label="รีเฟรชรายการ"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {currentList.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {activeTab === 'pending_advisor'
                  ? 'ไม่มีโครงร่างที่รอคุณเห็นชอบ'
                  : activeTab === 'pending_mentor'
                    ? 'ไม่มีโครงร่างที่รอพี่เลี้ยง'
                    : activeTab === 'approved'
                      ? 'ยังไม่มีโครงร่างที่เห็นชอบแล้ว'
                      : 'ไม่มีโครงร่างที่ส่งกลับแก้'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                {activeTab === 'pending_advisor' && outlinesByStatus.pending_mentor.length > 0
                  ? `มีอีก ${outlinesByStatus.pending_mentor.length} ฉบับรอพนักงานที่ปรึกษาเห็นชอบก่อน — ดูได้ที่แท็บ "รอพี่เลี้ยง"`
                  : 'รายการจะปรากฏเมื่อนักศึกษาอัปโหลดโครงร่างและผ่านขั้นตอนตามลำดับ'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[600px] overflow-y-auto">
              {currentList.map((item) => {
                const isSelected = selectedOutlineId === item.outline_id;
                const studentName = item.first_name
                  ? `${item.first_name} ${item.last_name || ''}`.trim()
                  : `รหัส: ${item.student_code}`;

                return (
                  <div
                    key={item.outline_id}
                    data-testid={`outline-row-${item.outline_id}`}
                    onClick={() => handleSelectOutline(item)}
                    className={`p-4 transition-all ${
                      activeTab === 'pending_mentor'
                        ? 'bg-gray-50/60 dark:bg-gray-800/30 cursor-default'
                        : isSelected
                          ? 'bg-blue-50/80 dark:bg-blue-950/40 border-l-4 border-brand-blue cursor-pointer'
                          : 'hover:bg-gray-50/80 dark:hover:bg-gray-800/50 cursor-pointer'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-bold text-sm text-gray-900 dark:text-white">
                          {studentName}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {item.student_code}
                          {item.company_name_th ? ` · ${item.company_name_th}` : ''}
                        </div>
                      </div>

                      {/* Right Tag / Badge */}
                      {activeTab === 'pending_mentor' ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 shrink-0">
                          รอพี่เลี้ยงเห็นชอบก่อน
                        </span>
                      ) : item.days_waiting != null ? (
                        <span className="text-xs font-bold text-amber-700 dark:text-amber-400 shrink-0">
                          รอ {item.days_waiting} วัน
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                      {item.latest_report_title || '–'}
                      {item.version_count ? (
                        <span className="text-gray-500 dark:text-gray-400">
                          {' '}
                          · ฉบับที่ {item.version_count}
                        </span>
                      ) : null}
                    </div>

                    {/* Compatibility for phase3-workflow */}
                    {activeTab === 'pending_advisor' && (
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">
                          รอที่ปรึกษาอนุมัติ
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectOutline(item);
                          }}
                          className="text-xs font-bold text-brand-blue hover:underline bg-transparent border-none p-0 cursor-pointer"
                        >
                          เปิดตรวจอนุมัติ
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Review Panel */}
        <div
          data-testid="outline-review-panel"
          className="flex-grow min-w-0 w-full card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-6"
        >
          {!selectedOutline ? (
            <div className="p-12 text-center text-gray-500 dark:text-gray-400">
              <FileText className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                เลือกโครงร่างรายงานจากรายการด้านซ้ายเพื่อเปิดตรวจ
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                คลิกรายการในคิวเพื่อดูรายละเอียด ประวัติฉบับ และบันทึกผลการพิจารณา
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Panel Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-gray-100 dark:border-gray-800">
                <div>
                  <span className="text-xs font-bold text-brand-blue dark:text-blue-400 block mb-1">
                    พิจารณาเห็นชอบ / พิจารณาอนุมัติโครงร่างรายงาน (สหกิจ 11)
                  </span>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-snug">
                    {selectedOutline.latest_report_title || 'โครงร่างรายงานการปฏิบัติงาน'}
                  </h2>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {selectedOutline.first_name
                      ? `${selectedOutline.first_name} ${selectedOutline.last_name || ''}`.trim()
                      : `รหัส: ${selectedOutline.student_code}`}{' '}
                    · {selectedOutline.student_code}
                    {selectedOutline.company_name_th ? ` · ${selectedOutline.company_name_th}` : ''}
                  </p>
                </div>

                {selectedOutline.latest_file_path && (
                  <a
                    href={`${API_BASE_URL}/files/${selectedOutline.latest_file_path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shrink-0"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    เปิดไฟล์โครงร่าง (PDF)
                  </a>
                )}
              </div>

              <AlertBanner variant="error" message={panelError} />

              {/* Version History */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 text-xs font-bold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                  ประวัติการส่ง ({versions.length} ฉบับ)
                </div>
                {versions.length === 0 ? (
                  <div className="p-4 text-xs text-gray-500 dark:text-gray-400">
                    ยังไม่มีประวัติการส่งฉบับย่อย
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {versions.map((v, idx) => {
                      const versionNum = versions.length - idx;
                      const isApproved = v.status === 'approved';
                      const isRejected = v.status === 'rejected';

                      return (
                        <div key={v.version_id || idx} className="p-3.5 flex items-start gap-3">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold shrink-0 border ${
                              isApproved
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                                : isRejected
                                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800'
                                  : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800'
                            }`}
                          >
                            ฉบับที่ {versionNum}
                          </span>
                          <div className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed min-w-0">
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {v.report_title}
                            </span>
                            {v.reviewer_mentor_name && (
                              <div className="text-gray-600 dark:text-gray-400 mt-0.5">
                                <strong>พนักงานที่ปรึกษา:</strong> {v.reviewer_mentor_name}
                                {v.rejection_comment ? ` · "${v.rejection_comment}"` : ''}
                              </div>
                            )}
                            {v.reviewer_first_name && (
                              <div className="text-gray-600 dark:text-gray-400 mt-0.5">
                                <strong>อาจารย์ที่ปรึกษา:</strong> {v.reviewer_first_name}{' '}
                                {v.reviewer_last_name || ''}
                                {v.rejection_comment ? ` · "${v.rejection_comment}"` : ''}
                              </div>
                            )}
                            {!v.reviewer_mentor_name && !v.reviewer_first_name && v.submitted_at && (
                              <div className="text-gray-500 dark:text-gray-400 mt-0.5">
                                ส่งเมื่อ{' '}
                                {new Intl.DateTimeFormat('th-TH', {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                }).format(new Date(v.submitted_at))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Feedback Textarea & Actions (Only if activeTab is pending_advisor) */}
              {activeTab === 'pending_advisor' && (
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                      ข้อเสนอแนะถึงนักศึกษา{' '}
                      <span className="font-normal text-gray-500 dark:text-gray-400">
                        (บังคับเมื่อส่งกลับแก้ · นักศึกษาเห็นข้อความนี้)
                      </span>
                    </label>
                    <textarea
                      data-testid="outline-review-comment"
                      value={outlineComment}
                      onChange={(e) => setOutlineComment(e.target.value)}
                      rows={4}
                      placeholder="ระบุคำแนะนำ ข้อเสนอแนะ หรือจุดที่ต้องปรับปรุงแก้ไข..."
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue resize-none transition-colors"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 self-start sm:self-auto">
                      เห็นชอบแล้ว นักศึกษาอัปโหลดเล่มรายงานฉบับสมบูรณ์ได้ทันที
                    </span>
                    <div className="flex gap-2.5 w-full sm:w-auto">
                      <button
                        type="button"
                        data-testid="outline-reject"
                        disabled={isSubmitting || !outlineComment.trim()}
                        onClick={() => handleReviewAction('rejected')}
                        className="flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        ส่งกลับให้แก้ไข
                      </button>
                      <button
                        type="button"
                        data-testid="outline-approve"
                        disabled={isSubmitting}
                        onClick={() => handleReviewAction('approved')}
                        className="flex-1 sm:flex-initial px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                      >
                        เห็นชอบโครงร่างรายงาน (อนุมัติโครงร่างรายงาน)
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Read-Only Status Notice if not pending_advisor */}
              {activeTab !== 'pending_advisor' && (
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-gray-400 shrink-0" />
                  <span>
                    โครงร่างรายงานนี้อยู่ในสถานะ{' '}
                    <strong className="text-gray-800 dark:text-gray-200">
                      {TAB_CONFIG[activeTab].label}
                    </strong>{' '}
                    (อ่านอย่างเดียว)
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OutlineReview;
