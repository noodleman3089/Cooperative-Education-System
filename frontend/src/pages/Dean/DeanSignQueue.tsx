import React, { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import Button from '../../components/ui/Button';
import { CheckCircle2, AlertCircle, Eye, ExternalLink, X, FileText } from 'lucide-react';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const docView = (searchParams.get('view') === 'signed' ? 'signed' : 'pending') as 'pending' | 'signed';
  const previewDocIdParam = searchParams.get('doc');

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

  const pendingDocs = useMemo(() => documents.filter((d) => d.status === 'pending_sign'), [documents]);
  const signedDocs = useMemo(() => documents.filter((d) => d.status === 'signed'), [documents]);
  const visibleDocs = docView === 'pending' ? pendingDocs : signedDocs;

  // Selected document for preview panel
  const previewDoc = useMemo(() => {
    if (!previewDocIdParam) return null;
    const id = Number(previewDocIdParam);
    return documents.find((d) => d.doc_id === id) || null;
  }, [previewDocIdParam, documents]);

  const isReadyToSign = hasSignature && hasName;

  const handleViewChange = (newView: 'pending' | 'signed') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newView === 'signed') {
        next.set('view', 'signed');
      } else {
        next.delete('view');
      }
      return next;
    });
  };

  const handleSetPreviewDoc = (docId: number | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (docId === null) {
        next.delete('doc');
      } else {
        next.set('doc', String(docId));
      }
      return next;
    });
  };

  const handleSelectRow = (docId: number) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const ids = pendingDocs.map((d) => d.doc_id);
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

      const signedCount = res?.signed_count ?? 0;
      const failed = res?.failed_documents ?? [];

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

  // Grouping pending docs by type
  const pendingGroups = useMemo(() => {
    const coverLetters = pendingDocs.filter((d) => d.type === 'cover_letter');
    const sendLetters = pendingDocs.filter((d) => d.type === 'send_letter');
    const others = pendingDocs.filter((d) => d.type !== 'cover_letter' && d.type !== 'send_letter');

    const groups: Array<{ key: string; label: string; docs: OfficialDocument[] }> = [];
    if (coverLetters.length > 0) {
      groups.push({ key: 'cover_letter', label: `หนังสือขอความอนุเคราะห์รับนักศึกษา · ${coverLetters.length}`, docs: coverLetters });
    }
    if (sendLetters.length > 0) {
      groups.push({ key: 'send_letter', label: `หนังสือส่งตัวนักศึกษา · ${sendLetters.length}`, docs: sendLetters });
    }
    if (others.length > 0) {
      groups.push({ key: 'others', label: `หนังสือราชการอื่นๆ · ${others.length}`, docs: others });
    }
    return groups;
  }, [pendingDocs]);

  // Selected docs for ConfirmDialog details
  const selectedDocsDetailText = useMemo(() => {
    const selected = pendingDocs.filter((d) => selectedDocIds.includes(d.doc_id));
    if (selected.length === 0) return '';
    const maxShow = 5;
    const shown = selected.slice(0, maxShow).map((d) => {
      const num = d.document_number || `#DOC-${d.doc_id}`;
      const name = docStudentName(d);
      return `${num} (${name})`;
    });

    if (selected.length > maxShow) {
      return `${shown.join(' · ')} และอีก ${selected.length - maxShow} ฉบับ`;
    }
    return shown.join(' · ');
  }, [pendingDocs, selectedDocIds]);

  if (loading) {
    return <PageSkeleton variant={skeletonFor('dean', 'dashboard')} />;
  }

  return (
    <div className="space-y-6 page-enter pb-10">
      {/* Header Block */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            หนังสือรอลงนาม
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            พิจารณาอนุมัติลงนามกลุ่ม (Dean Document Signing)
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
            เจ้าหน้าที่ตรวจคำร้องและออกเลขที่หนังสือแล้ว · ลงนามแล้วระบบประทับลายมือชื่อลงไฟล์ และแจ้งนักศึกษาให้มารับหนังสือไปยื่นเอง (ระบบไม่ส่งอีเมลถึงบริษัท)
          </p>
        </div>

        {/* View Switcher: Pending vs Signed */}
        <div className="flex gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl self-start sm:self-auto shrink-0">
          <button
            type="button"
            data-testid="dean-view-pending"
            onClick={() => handleViewChange('pending')}
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
            onClick={() => handleViewChange('signed')}
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

      {/* ══ แถบความพร้อมก่อนลงนาม (Spec H ข้อ 2) ══ */}
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
              {isReadyToSign ? 'พร้อมลงนาม' : 'ยังลงนามไม่ได้'}:
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
                  ? `ชื่อที่พิมพ์ใต้ลายมือชื่อ: ${deanFullName}`
                  : 'ยังไม่มีชื่อ-นามสกุลในโปรไฟล์'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!hasSignature && (
              <button
                type="button"
                onClick={() => onNavigate?.('signature')}
                className="text-xs font-bold text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300 cursor-pointer"
              >
                ตั้งค่าลายมือชื่อ
              </button>
            )}
            {!hasName && (
              <button
                type="button"
                onClick={() => onNavigate?.('profile')}
                className="text-xs font-bold text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300 cursor-pointer"
              >
                กรอกชื่อในโปรไฟล์
              </button>
            )}
            {isReadyToSign && (
              <button
                type="button"
                onClick={() => onNavigate?.('signature')}
                className="text-xs font-semibold text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 underline cursor-pointer"
              >
                เปลี่ยนลายมือชื่อ
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area: Split View if preview is active */}
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        {/* Table Container */}
        <div className="flex-1 min-w-0 w-full bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
          {/* Table Toolbar Header */}
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="text-sm text-gray-800 dark:text-gray-200">
              {docView === 'pending' ? (
                <span>
                  <strong>เลือกอยู่ {selectedDocIds.length} ฉบับ</strong> จาก {pendingDocs.length}
                </span>
              ) : (
                <span className="font-bold">
                  เอกสารที่ลงนามไปแล้ว ({signedDocs.length} ฉบับ)
                </span>
              )}
            </div>

            {docView === 'pending' && pendingDocs.length > 0 && (
              <div className="flex items-center gap-3 self-end sm:self-auto flex-wrap">
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

          {/* Table Content */}
          {visibleDocs.length === 0 ? (
            <div className="text-center py-16 px-6">
              <FileText className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-base font-bold text-gray-800 dark:text-gray-200">
                {docView === 'pending' ? 'ไม่มีหนังสือรอลงนาม' : 'ยังไม่มีเอกสารที่ท่านลงนามไปแล้ว'}
              </p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
                {docView === 'pending'
                  ? 'หนังสือจะเข้ามาเมื่อเจ้าหน้าที่รับคำร้องของนักศึกษา หรือออกหนังสือส่งตัวแล้ว · ดูฉบับที่ลงนามไปแล้วได้ที่แท็บ “ลงนามแล้ว”'
                  : 'เอกสารที่ลงนามแล้วจะย้ายมาอยู่ในรายการนี้ และเปิดดูไฟล์ย้อนหลังได้ตลอด'}
              </p>
            </div>
          ) : docView === 'pending' ? (
            /* ══ รอลงนาม: แบ่งกลุ่มตาม type (Spec H ข้อ 2) ══ */
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                    <th className="p-4 w-12 text-center">
                      <input
                        type="checkbox"
                        aria-label="เลือกเอกสารทั้งหมดที่รอลงนาม"
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        checked={selectedDocIds.length === pendingDocs.length && pendingDocs.length > 0}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 cursor-pointer"
                      />
                    </th>
                    <th className="p-4 font-semibold">เลขที่หนังสือ</th>
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">ถึงสถานประกอบการ</th>
                    <th className="p-4 font-semibold">ส่งมาเมื่อ</th>
                    <th className="p-4 font-semibold text-right">เปิดดู</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingGroups.map((group) => (
                    <React.Fragment key={group.key}>
                      <tr className="bg-gray-50/80 dark:bg-gray-800/40 border-y border-gray-200 dark:border-gray-800">
                        <td
                          colSpan={6}
                          className="px-4 py-2 font-bold text-gray-700 dark:text-gray-300 text-[11px]"
                        >
                          {group.label}
                        </td>
                      </tr>
                      {group.docs.map((doc) => {
                        const isChecked = selectedDocIds.includes(doc.doc_id);
                        const isPreviewing = previewDoc?.doc_id === doc.doc_id;

                        // วันที่และค้างกี่วัน (SB-H1)
                        const createdAtFormatted = doc.created_at
                          ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(doc.created_at))
                          : 'ไม่ทราบ';
                        const daysPending = doc.days_pending;

                        return (
                          <tr
                            key={doc.doc_id}
                            data-testid={`dean-doc-row-${doc.doc_id}`}
                            className={`border-b border-gray-100 dark:border-gray-800 transition-colors ${
                              isPreviewing
                                ? 'bg-blue-50/60 dark:bg-blue-950/30'
                                : isChecked
                                  ? 'bg-blue-50/30 dark:bg-blue-950/10'
                                  : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/20'
                            }`}
                          >
                            <td className="p-4 text-center align-top">
                              <input
                                type="checkbox"
                                aria-label={`เลือกเอกสารของ ${docStudentName(doc)}`}
                                checked={isChecked}
                                onChange={() => handleSelectRow(doc.doc_id)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 cursor-pointer"
                              />
                            </td>
                            <td className="p-4 font-bold text-gray-900 dark:text-white align-top">
                              {doc.document_number || `#DOC-${doc.doc_id}`}
                            </td>
                            <td className="p-4 text-gray-800 dark:text-gray-200 align-top">
                              <span className="block font-medium">{docStudentName(doc)}</span>
                              <span className="block text-xs text-gray-600 dark:text-gray-400 font-mono mt-0.5">
                                {doc.student_code}
                              </span>
                            </td>
                            <td className="p-4 text-gray-700 dark:text-gray-300 align-top">
                              {doc.company_name_th}
                            </td>
                            <td className="p-4 align-top text-gray-700 dark:text-gray-300 whitespace-nowrap">
                              <span>{createdAtFormatted}</span>
                              {doc.created_at === null ? (
                                <span className="block text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">
                                  ออกก่อนระบบเก็บวันที่
                                </span>
                              ) : daysPending !== null && daysPending !== undefined ? (
                                <span
                                  className={`block text-[11px] font-semibold mt-0.5 ${
                                    daysPending === 0
                                      ? 'text-gray-600 dark:text-gray-400'
                                      : daysPending >= 3
                                        ? 'text-red-700 dark:text-red-400'
                                        : 'text-amber-700 dark:text-amber-400'
                                  }`}
                                >
                                  {daysPending === 0 ? 'วันนี้' : `ค้าง ${daysPending} วัน`}
                                </span>
                              ) : null}
                            </td>
                            <td className="p-4 text-right align-top whitespace-nowrap">
                              <button
                                type="button"
                                data-testid="dean-doc-preview"
                                onClick={() => handleSetPreviewDoc(doc.doc_id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-blue-500 hover:text-blue-600 text-gray-700 dark:border-gray-700 dark:text-gray-300 dark:hover:text-blue-400 transition-colors cursor-pointer"
                                aria-label={`เปิดดูตัวอย่างเอกสารของ ${docStudentName(doc)}`}
                                title="เปิดดูไฟล์ PDF ของเอกสารนี้"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>เปิดดู</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* ══ ลงนามแล้ว: ตารางประวัติ (Spec H ข้อ 2) ══ */
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                    <th className="p-4 font-semibold">เลขที่หนังสือ</th>
                    <th className="p-4 font-semibold">ประเภทหนังสือ</th>
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">สถานประกอบการ</th>
                    <th className="p-4 font-semibold">วันที่ลงนาม</th>
                    <th className="p-4 font-semibold text-right">เปิดดู</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {signedDocs.map((doc) => (
                    <tr
                      key={doc.doc_id}
                      data-testid={`dean-doc-row-${doc.doc_id}`}
                      className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors"
                    >
                      <td className="p-4 font-bold text-gray-900 dark:text-white align-top">
                        {doc.document_number || `#DOC-${doc.doc_id}`}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-400 align-top">
                        {getDocTypeLabel(doc.type)}
                      </td>
                      <td className="p-4 text-gray-800 dark:text-gray-200 align-top">
                        <span className="block font-medium">{docStudentName(doc)}</span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 font-mono mt-0.5">
                          {doc.student_code}
                        </span>
                      </td>
                      <td className="p-4 text-gray-700 dark:text-gray-300 align-top">
                        {doc.company_name_th}
                      </td>
                      <td className="p-4 text-gray-700 dark:text-gray-300 align-top whitespace-nowrap">
                        {doc.dean_signature_date
                          ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(doc.dean_signature_date))
                          : '–'}
                      </td>
                      <td className="p-4 text-right align-top whitespace-nowrap">
                        <button
                          type="button"
                          data-testid="dean-doc-preview"
                          onClick={() => handleSetPreviewDoc(doc.doc_id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-blue-500 hover:text-blue-600 text-gray-700 dark:border-gray-700 dark:text-gray-300 dark:hover:text-blue-400 transition-colors cursor-pointer"
                          aria-label={`เปิดดูเอกสารของ ${docStudentName(doc)}`}
                          title="เปิดดูไฟล์ PDF ของเอกสารนี้"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>เปิดดู</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ══ แผงตัวอย่างหนังสือ (?doc=) ══ */}
        {previewDoc && (
          <div className="w-full xl:w-[460px] shrink-0 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="font-bold text-sm text-gray-900 dark:text-white">
                  {previewDoc.document_number || `#DOC-${previewDoc.doc_id}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`${API_BASE_URL}/files/documents/${previewDoc.doc_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <span>เปิดแท็บใหม่</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => handleSetPreviewDoc(null)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                  aria-label="ปิดแผงตัวอย่าง"
                  title="ปิดแผงตัวอย่าง"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="text-xs text-gray-600 dark:text-gray-400">
              <span>นักศึกษา: {docStudentName(previewDoc)}</span>
              <span className="mx-1.5">·</span>
              <span>{getDocTypeLabel(previewDoc.type)}</span>
            </div>

            {/* Embedded PDF iframe per spec H ข้อ 2 */}
            <div className="h-[520px] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 relative">
              <iframe
                src={`${API_BASE_URL}/files/documents/${previewDoc.doc_id}`}
                title={`ตัวอย่างเอกสาร ${previewDoc.document_number || previewDoc.doc_id}`}
                className="w-full h-full border-0"
              />
            </div>
          </div>
        )}
      </div>

      {/* ══ ConfirmDialog สำหรับการลงนามแบบกลุ่ม ══ */}
      <ConfirmDialog
        open={confirmSignOpen}
        title="ยืนยันการลงนามเอกสารราชการ"
        message={`ลงนามเอกสาร ${selectedDocIds.length} ฉบับด้วยลายมือชื่อของท่าน: ${selectedDocsDetailText} — ระบบจะประทับลายเซ็นลงบนไฟล์ PDF และแจ้งนักศึกษาให้มารับหนังสือ การลงนามนี้ยกเลิกจากหน้านี้ไม่ได้`}
        confirmLabel={`ลงนาม ${selectedDocIds.length} ฉบับ`}
        busy={signingInProgress}
        onConfirm={handleBatchSign}
        onCancel={() => setConfirmSignOpen(false)}
      />
    </div>
  );
};

export default DeanSignQueue;
