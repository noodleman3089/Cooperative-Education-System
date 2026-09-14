import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal, { ModalBody } from '../../components/ui/Modal';
import { Select, Textarea } from '../../components/ui/Input';
import PageSkeleton from '../../components/ui/Skeleton';
import { Check } from 'lucide-react';
import { getErrorMessage } from '../../utils/errors';
import type { JobPostRow } from '../../types/api';
import JobOfferSend from './JobOfferSend';
import JobOfferReview from './JobOfferReview';

export const JobOfferManager: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');

  // Active sub-tab: default to 'send' matching SurveySend.dc.html
  const activeTab = tabParam === 'posts' ? 'posts' : tabParam === 'review' || tabParam === 'all' ? 'review' : 'send';

  const setActiveTab = (nextTab: 'send' | 'review' | 'posts') => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextTab === 'send') next.delete('tab');
        else next.set('tab', nextTab);
        return next;
      },
      { replace: false }
    );
  };

  // Job Approval Queue state (original code from StaffDashboard)
  const [allJobs, setAllJobs] = useState<JobPostRow[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [publishingJobId, setPublishingJobId] = useState<number | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState<'all' | 'pending_approval' | 'published' | 'rejected' | 'closed'>('all');
  const [rejectingJob, setRejectingJob] = useState<JobPostRow | null>(null);
  const [jobRejectReason, setJobRejectReason] = useState('');
  const [jobRejectCustom, setJobRejectCustom] = useState('');
  const [jobRejectError, setJobRejectError] = useState<string | null>(null);
  const [isRejectingJob, setIsRejectingJob] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadAllJobs = async () => {
    try {
      setLoadingJobs(true);
      const jobsRes = await api.get('/jobs');
      setAllJobs(jobsRes || []);
    } catch (err) {
      console.error('Failed to load job posts:', err);
    } finally {
      setLoadingJobs(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'posts') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAllJobs();
    }
  }, [activeTab]);

  const handlePublishJob = async (jobId: number) => {
    try {
      setPublishingJobId(jobId);
      setError(null);
      await api.put(`/jobs/${jobId}/publish`);
      setSuccess('อนุมัติเผยแพร่ตำแหน่งงานเรียบร้อยแล้ว');
      await loadAllJobs();
    } catch (err) {
      console.error('Publish job error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถอนุมัติตำแหน่งงานได้'));
    } finally {
      setPublishingJobId(null);
    }
  };

  const handleRejectJob = async () => {
    const finalReason = (jobRejectReason === 'custom' ? jobRejectCustom : jobRejectReason).trim();
    if (!finalReason) {
      setJobRejectError('กรุณาเลือกหรือระบุเหตุผลที่ไม่อนุมัติ');
      return;
    }
    if (!rejectingJob) return;

    try {
      setIsRejectingJob(true);
      setJobRejectError(null);
      await api.put(`/jobs/${rejectingJob.job_id}/reject`, { reason: finalReason });
      setSuccess(`ไม่อนุมัติประกาศ "${rejectingJob.title}" แล้ว สถานประกอบการจะเห็นเหตุผลนี้ในหน้าประกาศของตนเอง`);
      setRejectingJob(null);
      setJobRejectReason('');
      setJobRejectCustom('');
      await loadAllJobs();
    } catch (err) {
      console.error('Reject job error:', err);
      setJobRejectError(getErrorMessage(err, 'ไม่สามารถบันทึกการไม่อนุมัติได้'));
    } finally {
      setIsRejectingJob(false);
    }
  };

  const runPendingConfirm = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      await pendingConfirm.run();
    } finally {
      setConfirmBusy(false);
      setPendingConfirm(null);
    }
  };

  const JOB_STATUS_ORDER: Record<string, number> = {
    pending_approval: 0,
    published: 1,
    rejected: 2,
    closed: 3,
  };

  const visibleJobs = allJobs
    .filter((j) => jobStatusFilter === 'all' || j.status === jobStatusFilter)
    .slice()
    .sort((a, b) => (JOB_STATUS_ORDER[a.status] ?? 9) - (JOB_STATUS_ORDER[b.status] ?? 9));

  return (
    <div className="space-y-6 page-enter">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          แบบเสนองานสหกิจศึกษา (สหกิจ 02)
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          คณะเป็นฝ่ายส่งแบบสำรวจไปถามล่วงหน้าหนึ่งภาคการศึกษา แล้วสถานประกอบการเป็นฝ่ายตอบกลับ — ในระบบนี้ไม่มีคำว่า “บริษัทลงประกาศรับสมัครงาน”
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* Sub tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 gap-6">
        <button
          type="button"
          data-testid="jobs-tab-send"
          onClick={() => setActiveTab('send')}
          className={`py-3 px-1 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'send'
              ? 'border-blue-600 text-blue-700 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          ส่งแบบสำรวจ
        </button>
        <button
          type="button"
          data-testid="jobs-tab-review"
          onClick={() => setActiveTab('review')}
          className={`py-3 px-1 font-bold text-sm border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'review'
              ? 'border-blue-600 text-blue-700 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          ตรวจแบบเสนองาน
        </button>
        <button
          type="button"
          data-testid="jobs-tab-posts"
          onClick={() => setActiveTab('posts')}
          className={`py-3 px-1 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'posts'
              ? 'border-blue-600 text-blue-700 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          ตำแหน่งงานรายรายการ (เดิม)
        </button>
      </div>

      {activeTab === 'send' ? (
        <JobOfferSend onNavigateTab={(tab) => setActiveTab(tab)} />
      ) : activeTab === 'review' ? (
        <JobOfferReview />
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex flex-col md:flex-row md:justify-between md:items-center gap-3">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                คิวตรวจสอบอนุมัติโพสต์รับสมัครงานของบริษัท
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                  รออนุมัติ: {allJobs.filter((j) => j.status === 'pending_approval').length} รายการ
                </span>
                <Select
                  value={jobStatusFilter}
                  onChange={(e) => setJobStatusFilter(e.target.value as typeof jobStatusFilter)}
                  aria-label="กรองตามสถานะประกาศ"
                  className="cursor-pointer"
                  size="sm"
                >
                  <option value="all">ทุกสถานะ ({allJobs.length})</option>
                  <option value="pending_approval">
                    รอตรวจอนุมัติ ({allJobs.filter((j) => j.status === 'pending_approval').length})
                  </option>
                  <option value="published">
                    เผยแพร่แล้ว ({allJobs.filter((j) => j.status === 'published').length})
                  </option>
                  <option value="rejected">
                    ไม่อนุมัติ ({allJobs.filter((j) => j.status === 'rejected').length})
                  </option>
                  <option value="closed">
                    ปิดรับสมัคร ({allJobs.filter((j) => j.status === 'closed').length})
                  </option>
                </Select>
              </div>
            </div>

            {loadingJobs ? (
              <PageSkeleton variant="table" />
            ) : visibleJobs.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleJobs.map((job) => (
                  <div
                    key={job.job_id}
                    className="p-6 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base text-gray-900 dark:text-white">{job.title}</span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            job.status === 'published'
                              ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400'
                              : job.status === 'pending_approval'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                              : job.status === 'rejected'
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}
                        >
                          {job.status === 'published'
                            ? 'เผยแพร่แล้ว'
                            : job.status === 'pending_approval'
                            ? 'รอเจ้าหน้าที่ตรวจอนุมัติ'
                            : job.status === 'rejected'
                            ? 'ไม่อนุมัติ'
                            : 'ปิดรับสมัคร'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        สถานประกอบการ:{' '}
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          {job.company_name_th || 'บริษัท'}
                        </span>{' '}
                        | โควตารับสมัคร:{' '}
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          {job.applied_count} / {job.quota} คน
                        </span>{' '}
                        | วันปิดรับสมัคร:{' '}
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          {job.expire_date ? new Date(job.expire_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">
                        {job.description}
                      </p>
                      {job.status === 'rejected' && job.reject_reason && (
                        <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                          เหตุผลที่ไม่อนุมัติ: {job.reject_reason}
                        </p>
                      )}
                    </div>

                    {job.status === 'pending_approval' && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="success"
                          size="sm"
                          icon={<Check className="h-3.5 w-3.5" />}
                          onClick={() =>
                            setPendingConfirm({
                              title: 'อนุมัติเผยแพร่ตำแหน่งงาน',
                              message: `เผยแพร่ "${job.title}" ของ ${
                                job.company_name_th || 'สถานประกอบการ'
                              } ขึ้นกระดานหางาน? นักศึกษาทุกคนจะเห็นและยื่นความจำนงได้ทันที`,
                              confirmLabel: 'อนุมัติเผยแพร่',
                              run: () => handlePublishJob(job.job_id),
                            })
                          }
                          loading={publishingJobId === job.job_id}
                          loadingLabel="กำลังอนุมัติ..."
                        >
                          อนุมัติเผยแพร่
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setRejectingJob(job);
                            setJobRejectReason('');
                            setJobRejectCustom('');
                            setJobRejectError(null);
                          }}
                          className="border-red-500 text-red-700 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
                        >
                          ไม่อนุมัติ
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : allJobs.length > 0 ? (
              <div className="text-center py-12 text-sm space-y-2">
                <p className="text-gray-500 dark:text-gray-400">ไม่มีประกาศที่ตรงกับตัวกรองนี้</p>
                <button
                  type="button"
                  onClick={() => setJobStatusFilter('all')}
                  className="text-xs font-bold text-brand-blue dark:text-blue-400 hover:underline"
                >
                  แสดงทุกสถานะ ({allJobs.length} รายการ)
                </button>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
                ไม่มีรายการตำแหน่งงานในขณะนี้
              </div>
            )}
          </div>

          {rejectingJob && (
            <Modal
              onClose={() => setRejectingJob(null)}
              size="md"
              closeOnBackdrop={false}
              title="ไม่อนุมัติประกาศรับสมัครงาน"
            >
              <ModalBody>
                <div className="space-y-4">
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs">
                    <div className="font-bold text-gray-800 dark:text-white">{rejectingJob.title}</div>
                    <div className="text-gray-500 dark:text-gray-400 mt-0.5">
                      โดย {rejectingJob.company_name_th || 'สถานประกอบการ'}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      เหตุผลที่ไม่อนุมัติ * (สถานประกอบการจะเห็นข้อความนี้)
                    </label>
                    <Select
                      value={jobRejectReason}
                      onChange={(e) => setJobRejectReason(e.target.value)}
                      className="cursor-pointer"
                    >
                      <option value="">-- เลือกเหตุผล --</option>
                      <option value="รายละเอียดงานไม่ครบถ้วน นักศึกษาใช้ตัดสินใจไม่ได้">
                        รายละเอียดงานไม่ครบถ้วน นักศึกษาใช้ตัดสินใจไม่ได้
                      </option>
                      <option value="ลักษณะงานไม่ตรงกับหลักสูตรสหกิจศึกษา">
                        ลักษณะงานไม่ตรงกับหลักสูตรสหกิจศึกษา
                      </option>
                      <option value="สถานประกอบการยังไม่ผ่านการตรวจสอบข้อมูลจากคณะ">
                        สถานประกอบการยังไม่ผ่านการตรวจสอบข้อมูลจากคณะ
                      </option>
                      <option value="จำนวนที่รับหรือวันปิดรับสมัครไม่สอดคล้องกับปฏิทินสหกิจศึกษา">
                        จำนวนที่รับหรือวันปิดรับสมัครไม่สอดคล้องกับปฏิทินสหกิจศึกษา
                      </option>
                      <option value="ประกาศซ้ำกับตำแหน่งที่เผยแพร่อยู่แล้ว">
                        ประกาศซ้ำกับตำแหน่งที่เผยแพร่อยู่แล้ว
                      </option>
                      <option value="custom">ระบุเหตุผลเอง</option>
                    </Select>
                  </div>

                  {jobRejectReason === 'custom' && (
                    <Textarea
                      rows={3}
                      value={jobRejectCustom}
                      onChange={(e) => setJobRejectCustom(e.target.value)}
                      placeholder="ระบุสิ่งที่สถานประกอบการต้องแก้ไขก่อนส่งประกาศเข้ามาใหม่"
                    />
                  )}

                  <AlertBanner variant="error" message={jobRejectError} />

                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <Button variant="secondary" size="sm" onClick={() => setRejectingJob(null)}>
                      ยกเลิก
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={handleRejectJob}
                      loading={isRejectingJob}
                      loadingLabel="กำลังบันทึก..."
                    >
                      ยืนยันไม่อนุมัติ
                    </Button>
                  </div>
                </div>
              </ModalBody>
            </Modal>
          )}

          <ConfirmDialog
            open={pendingConfirm !== null}
            title={pendingConfirm?.title ?? ''}
            message={pendingConfirm?.message ?? ''}
            confirmLabel={pendingConfirm?.confirmLabel}
            busy={confirmBusy}
            onConfirm={runPendingConfirm}
            onCancel={() => setPendingConfirm(null)}
          />
        </div>
      )}
    </div>
  );
};

export default JobOfferManager;
