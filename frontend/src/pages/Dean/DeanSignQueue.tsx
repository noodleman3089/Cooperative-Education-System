import React, { useState, useCallback } from 'react';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import Button from '../../components/ui/Button';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { getErrorMessage } from '../../utils/errors';

interface DeanSignQueueProps {
  onNavigate?: (menu: string) => void;
}

interface OfficialDocument {
  doc_id: number;
  document_number: string | null;
  type: string;
  student_id: number;
  company_id: number;
  template_id: number;
  generated_file_path: string | null;
  status: string;
  dean_signature_date: string | null;
  student_code: string;
  student_name?: string;
  first_name?: string;
  last_name?: string;
  company_name_th: string;
  created_at?: string | null;
  days_pending?: number | null;
}

const docStudentName = (doc: OfficialDocument): string =>
  [doc.first_name, doc.last_name].filter(Boolean).join(' ').trim()
  || doc.student_name
  || doc.student_code;

const DeanSignQueue: React.FC<DeanSignQueueProps> = ({ onNavigate }) => {
  const [documents, setDocuments] = useState<OfficialDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [signingInProgress, setSigningInProgress] = useState(false);

  // Profile readiness state
  const [hasSignature, setHasSignature] = useState(false);
  const [hasName, setHasName] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [deanFullName, setDeanFullName] = useState<string>('');

  // Selection state
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [confirmSignOpen, setConfirmSignOpen] = useState(false);

  // View state: pending vs signed
  const [docView, setDocView] = useState<'pending' | 'signed'>('pending');

  // Preview PDF state
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null);

  const loadDashboardData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }

      const [docsData, profileRes] = await Promise.allSettled([
        api.get('/documents'),
        api.get('/profile/me'),
      ]);

      if (docsData.status === 'fulfilled') {
        const d = docsData.value;
        setDocuments(Array.isArray(d) ? d : d?.data || []);
      } else {
        console.error('Failed to load documents:', docsData.reason);
        if (!isBackground) setError('ไม่สามารถเรียกข้อมูลเอกสารราชการได้ กรุณาลองใหม่อีกครั้ง');
      }

      if (profileRes.status === 'fulfilled') {
        const prof = profileRes.value?.profile;
        setProfileLoaded(true);
        const sigOk = Boolean(prof?.e_signature_file);
        const nameOk = Boolean(prof?.first_name && prof?.last_name);
        setHasSignature(sigOk);
        setHasName(nameOk);
        setDeanFullName(nameOk ? `${prof.first_name} ${prof.last_name}` : '');
      } else {
        console.error('Failed to load profile:', profileRes.reason);
      }
    } catch (err) {
      console.error('Failed to load Dean queue data:', err);
      if (!isBackground) setError(getErrorMessage(err, 'ไม่สามารถเรียกข้อมูลเอกสารหรือโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useDashboardData(loadDashboardData);

  const handleSelectRow = (docId: number) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const handleSelectAll = (checked: boolean, filteredDocs: OfficialDocument[]) => {
    if (checked) {
      const ids = filteredDocs.map((d) => d.doc_id);
      setSelectedDocIds(ids);
    } else {
      setSelectedDocIds([]);
    }
  };

  const handleBatchSign = async () => {
    if (selectedDocIds.length === 0) return;
    setConfirmSignOpen(false);

    if (!hasSignature || !hasName) {
      setError('ไม่สามารถลงนามได้ กรุณาตั้งค่าลายมือชื่อและชื่อ-นามสกุลในโปรไฟล์ให้ครบถ้วนก่อน');
      return;
    }

    setSigningInProgress(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await api.post('/documents/batch-sign', { doc_ids: selectedDocIds });

      const signedCount = res.signed_count || 0;
      const failed = res.failed_documents || [];

      if (signedCount > 0) {
        setSuccess(`ลงนามแบบกลุ่มสำเร็จเรียบร้อยแล้ว จำนวน ${signedCount} รายการ`);
      }

      if (failed.length > 0) {
        setError(
          `ลงนามไม่สำเร็จ ${failed.length} รายการ: ` +
            failed.map((f: { doc_id: number; error: string }) => `#DOC-${f.doc_id} (${f.error})`).join(' · ')
        );
      }

      setSelectedDocIds([]);
      window.dispatchEvent(new CustomEvent('intent-updated'));
      await loadDashboardData(true);
    } catch (err) {
      console.error('Batch sign error:', err);
      setError(getErrorMessage(err, 'การลงนามแบบกลุ่มล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setSigningInProgress(false);
    }
  };

  const getDocTypeLabel = (type: string) => {
    if (type === 'cover_letter') return 'หนังสือขอความอนุเคราะห์';
    if (type === 'send_letter') return 'หนังสือส่งตัวนักศึกษา';
    return type;
  };

  const pendingDocs = documents.filter((d) => d.status === 'pending_sign');
  const signedDocs = documents.filter((d) => d.status === 'signed');
  const visibleDocs = docView === 'pending' ? pendingDocs : signedDocs;

  const isReadyToSign = hasSignature && hasName;

  if (loading) {
    return <PageSkeleton variant={skeletonFor('dean', 'dashboard')} />;
  }

  return (
    <div className="space-y-6 page-enter pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            หนังสือรอลงนาม
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            พิจารณาอนุมัติลงนามกลุ่ม (Dean Document Signing)
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            เจ้าหน้าที่ตรวจคำร้องและออกเลขที่หนังสือแล้ว · ลงนามแล้วระบบประทับลายมือชื่อลงไฟล์ และแจ้งนักศึกษาให้มารับหนังสือไปยื่นเอง (ระบบไม่ส่งอีเมลถึงบริษัท)
          </p>
        </div>

        {/* View Switcher: Pending vs Signed */}
        <div className="flex gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl self-start sm:self-auto">
          <button
            type="button"
            data-testid="dean-view-pending"
            onClick={() => setDocView('pending')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              docView === 'pending'
                ? 'bg-white text-blue-900 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            รอลงนาม ({pendingDocs.length})
          </button>
          <button
            type="button"
            data-testid="dean-view-signed"
            onClick={() => setDocView('signed')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              docView === 'signed'
                ? 'bg-white text-blue-900 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            ลงนามแล้ว ({signedDocs.length})
          </button>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* แถบความพร้อมก่อนลงนาม (Spec H ข้อ 2) */}
      {profileLoaded && (
        <div
          className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
            isReadyToSign
              ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50'
              : 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900/50'
          }`}
        >
          <div className="flex items-center gap-6 flex-wrap text-xs">
            <span className="font-bold text-gray-800 dark:text-gray-200">
              ความพร้อมในการลงนาม:
            </span>

            {/* Signature Status */}
            <div
              data-testid="dean-ready-signature"
              data-ok={hasSignature ? 'true' : 'false'}
              className={`flex items-center gap-1.5 font-medium ${
                hasSignature
                  ? 'text-emerald-800 dark:text-emerald-300'
                  : 'text-red-800 dark:text-red-300'
              }`}
            >
              {hasSignature ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <span>
                {hasSignature ? 'ลายมือชื่อในระบบพร้อมใช้งาน' : 'ยังไม่มีลายมือชื่อในระบบ'}
              </span>
            </div>

            {/* Name Status */}
            <div
              data-testid="dean-ready-name"
              data-ok={hasName ? 'true' : 'false'}
              className={`flex items-center gap-1.5 font-medium ${
                hasName
                  ? 'text-emerald-800 dark:text-emerald-300'
                  : 'text-red-800 dark:text-red-300'
              }`}
            >
              {hasName ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <span>
                {hasName
                  ? `ชื่อที่จะพิมพ์ใต้ลายมือชื่อ: ${deanFullName}`
                  : 'ยังไม่มีชื่อ-นามสกุลในโปรไฟล์'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!hasSignature && (
              <button
                type="button"
                onClick={() => onNavigate?.('signature')}
                className="text-xs font-bold text-blue-700 dark:text-blue-400 underline hover:text-blue-900 cursor-pointer"
              >
                ไปตั้งค่าลายมือชื่อ
              </button>
            )}
            {!hasName && (
              <button
                type="button"
                onClick={() => onNavigate?.('profile')}
                className="text-xs font-bold text-blue-700 dark:text-blue-400 underline hover:text-blue-900 cursor-pointer"
              >
                ไปตั้งค่าโปรไฟล์
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
            {docView === 'pending'
              ? `รายการหนังสือรอลงนาม (${pendingDocs.length} ฉบับ)`
              : `เอกสารที่ลงนามไปแล้ว (${signedDocs.length} ฉบับ)`}
          </span>

          {docView === 'pending' && pendingDocs.length > 0 && (
            <div className="flex items-center gap-3">
              {!isReadyToSign && (
                <span className="text-xs text-red-700 dark:text-red-400 font-medium">
                  ลงนามไม่ได้: {!hasSignature ? 'ขาดลายมือชื่อ' : 'ขาดชื่อในโปรไฟล์'}
                </span>
              )}
              <Button
                size="sm"
                data-testid="dean-sign-selected"
                icon={<CheckCircle2 className="h-4 w-4" />}
                onClick={() => setConfirmSignOpen(true)}
                disabled={selectedDocIds.length === 0 || !isReadyToSign}
                loading={signingInProgress}
                loadingLabel="กำลังลงนาม..."
              >
                {`ลงนามแบบกลุ่มที่เลือก (${selectedDocIds.length})`}
              </Button>
            </div>
          )}
        </div>

        {visibleDocs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                  {docView === 'pending' && (
                    <th className="p-4 w-12 text-center">
                      <input
                        type="checkbox"
                        aria-label="เลือกเอกสารทั้งหมดที่รอลงนาม"
                        onChange={(e) => handleSelectAll(e.target.checked, pendingDocs)}
                        checked={selectedDocIds.length === pendingDocs.length && pendingDocs.length > 0}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="p-4 font-semibold">เลขที่หนังสือ</th>
                  <th className="p-4 font-semibold">ประเภทหนังสือ</th>
                  <th className="p-4 font-semibold">นักศึกษา</th>
                  <th className="p-4 font-semibold">สถานประกอบการ</th>
                  <th className="p-4 font-semibold text-center">
                    {docView === 'pending' ? 'สถานะ' : 'วันที่ลงนาม'}
                  </th>
                  <th className="p-4 font-semibold text-right">เปิดดู</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleDocs.map((doc) => {
                  const isChecked = selectedDocIds.includes(doc.doc_id);
                  return (
                    <tr
                      key={doc.doc_id}
                      data-testid={`dean-doc-row-${doc.doc_id}`}
                      className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors"
                    >
                      {docView === 'pending' && (
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            aria-label={`เลือกเอกสารของ ${docStudentName(doc)}`}
                            checked={isChecked}
                            onChange={() => handleSelectRow(doc.doc_id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="p-4 font-bold text-gray-900 dark:text-white">
                        {doc.document_number || `#DOC-${doc.doc_id}`}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">
                        {getDocTypeLabel(doc.type)}
                      </td>
                      <td className="p-4 text-gray-800 dark:text-gray-200">
                        <span className="block font-medium">{docStudentName(doc)}</span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 font-mono mt-0.5">
                          รหัส: {doc.student_code}
                        </span>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400">
                        {doc.company_name_th}
                      </td>
                      <td className="p-4 text-center">
                        {docView === 'pending' ? (
                          <span className="px-2.5 py-0.5 rounded-full font-bold text-xs bg-yellow-50 text-yellow-800 border border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-900/50">
                            รอคณบดีลงนาม
                          </span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400">
                            {doc.dean_signature_date
                              ? new Date(doc.dean_signature_date).toLocaleDateString('th-TH')
                              : '-'}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <button
                          type="button"
                          data-testid="dean-doc-preview"
                          onClick={() => setPreviewDocUrl(`${API_BASE_URL}/files/documents/${doc.doc_id}`)}
                          className="p-1.5 rounded-lg border border-gray-200 hover:border-blue-500 hover:text-blue-600 transition-all dark:border-gray-700 dark:hover:text-blue-400 cursor-pointer"
                          aria-label={`เปิดดูเอกสารของ ${docStudentName(doc)}`}
                          title="เปิดดูไฟล์ PDF ของเอกสารนี้"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 px-6">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {docView === 'pending'
                ? 'ไม่มีเอกสารราชการที่รอการลงนามในขณะนี้'
                : 'ยังไม่มีเอกสารที่ท่านลงนามไปแล้ว'}
            </p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {docView === 'pending'
                ? 'เอกสารจะเข้ามาที่นี่เมื่อเจ้าหน้าที่สหกิจศึกษารับคำร้องของนักศึกษาและออกเลขที่หนังสือแล้ว'
                : 'เอกสารที่ลงนามแล้วจะย้ายมาอยู่ในรายการนี้ และเปิดดูไฟล์ย้อนหลังได้ตลอด'}
            </p>
          </div>
        )}
      </div>

      {/* Confirm Dialog for Batch Signing */}
      <ConfirmDialog
        open={confirmSignOpen}
        title="ยืนยันการลงนามเอกสารราชการ"
        message={`ลงนามเอกสาร ${selectedDocIds.length} ฉบับด้วยลายมือชื่อของท่าน? ระบบจะประทับลายเซ็นลงบนไฟล์ PDF และแจ้งนักศึกษาให้มารับหนังสือไปยื่นสถานประกอบการเอง การลงนามนี้ยกเลิกจากหน้านี้ไม่ได้`}
        confirmLabel={`ลงนาม ${selectedDocIds.length} ฉบับ`}
        busy={signingInProgress}
        onConfirm={handleBatchSign}
        onCancel={() => setConfirmSignOpen(false)}
      />

      {/* Embedded PDF Preview Modal */}
      {previewDocUrl && (
        <Modal
          onClose={() => setPreviewDocUrl(null)}
          size="5xl"
          className="h-[85vh]"
          title="เปิดตรวจสอบตัวอย่างจดหมายราชการ (PDF Preview)"
        >
          <div className="flex-1 m-6 mt-4 bg-gray-50 dark:bg-gray-950 rounded-xl overflow-hidden relative">
            <iframe
              src={previewDocUrl}
              title="Document PDF Preview"
              className="w-full h-full border-0"
            />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default DeanSignQueue;
