import React, { useState, useRef } from 'react';
import PageSkeleton, { skeletonFor } from './ui/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import Button from './ui/Button';
import { CheckCircle2 } from 'lucide-react';
import api, { API_BASE_URL } from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';
import { getErrorMessage } from '../utils/errors';

interface DeanDashboardProps {
  activeMenu?: string;
  defaultTab?: string;
}

interface OfficialDocument {
  doc_id: number;
  /** The official reference the dean signs under, e.g. "ศธ 0584.09/123". */
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
}

/**
 * `student_name` is declared on the type but `/api/documents` never sends it —
 * the query returns `first_name` and `last_name`. The signing queue therefore
 * showed a bare student code, so the dean signed official letters without ever
 * seeing whose they were. Fourth screen with this same bug.
 */
const docStudentName = (doc: OfficialDocument): string =>
  [doc.first_name, doc.last_name].filter(Boolean).join(' ').trim()
  || doc.student_name
  || doc.student_code;

const DeanDashboard: React.FC<DeanDashboardProps> = ({ activeMenu = 'dashboard', defaultTab }) => {
  // Navigation tabs internally if needed, or overridden by activeMenu
  const currentTab = defaultTab || (activeMenu === 'signature' ? 'signature' : 'dashboard');
  
  const [documents, setDocuments] = useState<OfficialDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [signingInProgress, setSigningInProgress] = useState(false);
  
  // Selection state
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [confirmSignOpen, setConfirmSignOpen] = useState(false);
  const [confirmReplaceSigOpen, setConfirmReplaceSigOpen] = useState(false);
  
  // Which of the two lists the table is showing.
  const [docView, setDocView] = useState<'pending' | 'signed'>('pending');

  // Preview PDF state
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null);

  // E-Signature Pad states
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastX, setLastX] = useState(0);
  const [lastY, setLastY] = useState(0);
  const [brushColor, setBrushColor] = useState('#1e3a8a'); // Navy Blue
  const [brushSize, setBrushSize] = useState(3);
  const [savedSigPath, setSavedSigPath] = useState<string | null>(null);
  const [isSavingSig, setIsSavingSig] = useState(false);

  /**
   * `isBackground` exists because refreshing after an action used to erase the
   * result of that action: this function begins by clearing `error`, and
   * handleBatchSign called it immediately after setting one. The message was
   * wiped in the same commit and never reached the screen, so a failed batch
   * looked exactly like nothing happening at all.
   */
  const loadDashboardData = async (isBackground = false) => {
    try {
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }

      const [docsData, profileData] = await Promise.all([
        api.get('/documents'),
        api.get('/profile/me')
      ]);
      
      setDocuments(docsData || []);
      
      if (profileData?.profile?.e_signature_file) {
        setSavedSigPath(profileData.profile.e_signature_file);
      }
    } catch (err) {
      console.error('Failed to load Dean dashboard data:', err);
      if (!isBackground) setError('ไม่สามารถเรียกข้อมูลเอกสารหรือโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  /**
   * This screen's whole job is waiting for staff to push documents into it, and
   * it was the one dashboard that never refreshed — a bare useEffect([]), so the
   * dean had to reload the page to find out there was work. Measured: zero
   * requests in fourteen seconds.
   */
  useDashboardData(loadDashboardData);

  // Handle individual row selection
  const handleSelectRow = (docId: number) => {
    setSelectedDocIds(prev => 
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  // Handle select all
  const handleSelectAll = (checked: boolean, filteredDocs: OfficialDocument[]) => {
    if (checked) {
      const ids = filteredDocs.map(d => d.doc_id);
      setSelectedDocIds(ids);
    } else {
      setSelectedDocIds([]);
    }
  };

  /**
   * Applies the dean's signature to official letters and releases them to the
   * companies. There is no way back from here, which is why it now asks first —
   * every other role in the system already confirms far smaller actions.
   */
  const handleBatchSign = async () => {
    if (selectedDocIds.length === 0) return;
    setConfirmSignOpen(false);

    // Check if e-signature is set up
    if (!savedSigPath) {
      setError('กรุณาตั้งค่าลายมือชื่อดิจิทัลก่อนลงนามเอกสาร');
      return;
    }

    setSigningInProgress(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await api.post('/documents/batch-sign', { doc_ids: selectedDocIds });

      const signedCount = res.signed_count || 0;
      const urls = res.signing_urls || [];
      const failed = res.failed_documents || [];

      // A batch can now come back mixed: some documents signed here, others
      // handed back as DocuSign ceremonies for the dean to complete.
      const parts: string[] = [];
      if (signedCount > 0) parts.push(`ลงนามแบบกลุ่มสำเร็จเรียบร้อยแล้ว จำนวน ${signedCount} รายการ`);
      if (urls.length > 0) parts.push(`สร้างลิ้งค์สำหรับลงนามแบบกลุ่มสำเร็จ (จำนวน ${urls.length} รายการ) กำลังเปิดหน้าต่างลงนาม DocuSign...`);

      if (parts.length > 0) setSuccess(parts.join(' · '));

      if (failed.length > 0) {
        setError(
          `ลงนามไม่สำเร็จ ${failed.length} รายการ: ` +
          failed.map((f: { doc_id: number; error: string }) => `#DOC-${f.doc_id} (${f.error})`).join(' · ')
        );
      }

      if (urls.length > 0) window.open(urls[0].signing_url, '_blank');

      setSelectedDocIds([]);
      // The bell counts pending documents and only recounts on this event.
      // Signing from here never fired it, so the badge kept the old number
      // while the table below it had already emptied.
      window.dispatchEvent(new CustomEvent('intent-updated'));
      // Background refresh: a foreground one clears `error` and swaps the page
      // for a skeleton, which is what used to eat the message just set above.
      await loadDashboardData(true);
    } catch (err) {
      console.error('Batch sign error:', err);
      setError(getErrorMessage(err, 'การลงนามแบบกลุ่มล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setSigningInProgress(false);
    }
  };

  /**
   * The pad's backing store is a fixed 500×220 while the element itself is
   * `w-full`, so a pointer position in CSS pixels is not a canvas coordinate.
   * Feeding one straight into the other drew the stroke in the wrong place —
   * measured 57px to the right of the cursor on a 613px-wide pad, with the
   * right-hand 113px unreachable entirely, and squashed into the left half on a
   * phone. Every position now goes through the pad's own scale.
   */
  const canvasPoint = (
    canvas: HTMLCanvasElement,
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  // Signature Pad Canvas drawing logic
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsDrawing(true);
    const { x, y } = canvasPoint(canvas, e);
    setLastX(x);
    setLastY(y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Prevent default scrolling behaviour on mobile/tablet touch move
    if ('touches' in e) e.preventDefault();
    const { x, y } = canvasPoint(canvas, e);

    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    setLastX(x);
    setLastY(y);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Convert Base64 Canvas data to Blob
  const dataURLtoBlob = (dataUrl: string): Blob => {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  /**
   * Checks the pad is not blank before asking anything. Replacing a stored
   * signature deletes the old image from disk on the server, so an existing one
   * is confirmed first — this is the image stamped onto every official letter.
   */
  const requestSaveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    if (canvas.toDataURL() === blank.toDataURL()) {
      setError('กรุณาวาดลายมือชื่อของท่านลงบนกระดานก่อนบันทึก');
      return;
    }

    setError(null);
    if (savedSigPath) {
      setConfirmReplaceSigOpen(true);
    } else {
      handleSaveSignature();
    }
  };

  // Upload E-Signature to backend
  const handleSaveSignature = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setConfirmReplaceSigOpen(false);

    setIsSavingSig(true);
    setError(null);
    setSuccess(null);

    try {
      const dataUrl = canvas.toDataURL('image/png');
      const blob = dataURLtoBlob(dataUrl);

      const formData = new FormData();
      formData.append('signature', blob, 'signature.png');
      // No major_id: this screen has nothing to do with departments. It used to
      // send a hardcoded '1', and because the model wrote major_id
      // unconditionally, saving a signature moved the dean into
      // "วิทยาการคอมพิวเตอร์" every single time.

      const res = await api.put('/profile/personnel', formData);
      setSuccess('บันทึกลายเซ็นอิเล็กทรอนิกส์ของท่านเข้าสู่ระบบสำเร็จ');
      
      if (res.profile?.e_signature_file) {
        setSavedSigPath(res.profile.e_signature_file);
      }
    } catch (err) {
      console.error('Failed to save signature:', err);
      setError(getErrorMessage(err, 'การบันทึกลายเซ็นล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSavingSig(false);
    }
  };

  const getDocTypeLabel = (type: string) => {
    if (type === 'cover_letter') return 'หนังสือขอความอนุเคราะห์';
    if (type === 'send_letter') return 'หนังสือส่งตัวนักศึกษา';
    return type;
  };

  const pendingDocs = documents.filter(d => d.status === 'pending_sign');
  const signedDocs = documents.filter(d => d.status === 'signed');

  /**
   * Signed letters used to be a number on a card and nothing else — the table
   * only ever listed what was still pending, so the moment the dean signed
   * something it disappeared from the screen for good, with no way to check
   * what had gone out. The two figures now switch the table between the lists
   * they count.
   */
  const visibleDocs = docView === 'pending' ? pendingDocs : signedDocs;

  if (loading) {
    return (
      <PageSkeleton variant={skeletonFor('dean', currentTab)} />
    );
  }

  return (
    <div className="space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">
          {currentTab === 'signature' ? 'ตั้งค่าลายเซ็นอิเล็กทรอนิกส์ (E-Signature Setup)' : 'พิจารณาอนุมัติลงนามกลุ่ม (Dean Document Signing)'}
        </h2>
        {/* gray-600 rather than gray-500: this line sits on the page's grey
            background, not on a white card, which costs it enough contrast to
            fall under AA. Same call as the staff screens. */}
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          {currentTab === 'signature'
            ? 'ลงนามลายเซ็นผ่านระบบวาด หรือสแกนอัปโหลดเพื่อประทับตราอนุมัติเอกสารเด็กอัตโนมัติ' 
            : 'ลงนามจดหมายขอความอนุเคราะห์และส่งตัวนักศึกษาสหกิจศึกษาคราวละหลายรายการ'}
        </p>
      </div>

      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={success} />

      {currentTab === 'signature' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Canvas Draw Block */}
          <div className="md:col-span-2 bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 space-y-4">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">กระดานวาดลายมือชื่อดิจิทัล</h3>
            
            <div className="relative border border-dashed border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-950">
              <canvas
                ref={canvasRef}
                width={500}
                height={220}
                className="w-full h-[220px] cursor-crosshair touch-none"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
              <div className="absolute bottom-2 left-2 text-xs text-gray-500 dark:text-gray-400 pointer-events-none select-none">
                ลงลายมือชื่อภายในกรอบนี้
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4 text-xs">
                {/* Size */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-400">ขนาดหัวแปรง:</span>
                  <select
                    value={brushSize}
                    aria-label="ขนาดหัวแปรงสำหรับวาดลายมือชื่อ"
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="p-1 rounded border border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  >
                    <option value={2}>บาง (2px)</option>
                    <option value={3}>ปกติ (3px)</option>
                    <option value={5}>หนา (5px)</option>
                  </select>
                </div>
                {/* Color */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-400">สีแปรง:</span>
                  <div className="flex items-center gap-1.5">
                    {/* Swatches carry no text, so without a name they are three
                        unlabelled buttons to anything that is not looking at
                        the colour. */}
                    {([
                      { value: '#1e3a8a', label: 'น้ำเงินเข้ม' },
                      { value: '#000000', label: 'ดำ' },
                      { value: '#0f766e', label: 'เขียวเข้ม' },
                    ] as const).map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setBrushColor(c.value)}
                        aria-label={`ใช้หมึกสี${c.label}`}
                        aria-pressed={brushColor === c.value}
                        title={c.label}
                        className={`h-5 w-5 rounded-full border-2 transition-all cursor-pointer ${
                          brushColor === c.value ? 'border-brand-blue scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={clearCanvas}>
                  ล้างหน้าจอ
                </Button>
                <Button size="sm" onClick={requestSaveSignature} loading={isSavingSig} loadingLabel="กำลังบันทึก...">
                  บันทึกลายเซ็นลงระบบ
                </Button>
              </div>
            </div>
          </div>

          {/* Current Signature Display */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">ลายมือชื่ออิเล็กทรอนิกส์ในระบบ</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">ภาพจำลองลายเซ็นจริงที่จะนำไปประทับบน PDF จดหมายออกส่งตัวนักศึกษา</p>
              
              <div className="mt-4 border border-gray-100 rounded-xl bg-gray-50/50 p-4 flex items-center justify-center h-[120px] dark:bg-gray-950 dark:border-gray-800">
                {savedSigPath ? (
                  <img
                    src={`${API_BASE_URL}/files/signatures/${savedSigPath.split('/').pop()}`}
                    alt="Dean Signature"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">ยังไม่มีการบันทึกลายมือชื่อ</span>
                )}
              </div>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 mt-4 leading-relaxed">
              * ข้อมูลลายมือชื่อจะได้รับความคุ้มครองความปลอดภัยขั้นสูงสุด อนุญาตใช้งานเฉพาะในพิกัดเอกสารราชการที่กำหนดเท่านั้น
            </div>
          </div>
        </div>
      ) : (
        /* Sign Document Table Tab */
        <div className="space-y-6">
          {/* Stats widgets. Real buttons, so the keyboard reaches them and the
              pressed one says which list is on screen. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([
              { view: 'pending', label: 'เอกสารที่ค้างรอการลงนาม', count: pendingDocs.length,
                tone: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-950/20 dark:text-yellow-400',
                icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
              { view: 'signed', label: 'เอกสารที่ลงนามอนุมัติแล้ว', count: signedDocs.length,
                tone: 'bg-green-50 text-green-600 dark:bg-green-950/20 dark:text-green-400',
                icon: 'M5 13l4 4L19 7' },
            ] as const).map((card) => (
              <button
                key={card.view}
                type="button"
                onClick={() => setDocView(card.view)}
                aria-pressed={docView === card.view}
                className={`p-4 rounded-2xl border text-left flex items-center gap-4 transition-all cursor-pointer ${
                  docView === card.view
                    ? 'bg-white border-brand-blue ring-1 ring-brand-blue dark:bg-gray-900 dark:border-blue-500 dark:ring-blue-500'
                    : 'bg-white border-gray-200 hover:border-gray-300 dark:bg-gray-900 dark:border-gray-800 dark:hover:border-gray-700'
                }`}
              >
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${card.tone}`}>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.icon} />
                  </svg>
                </div>
                <div>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{card.label}</span>
                  <span className="block text-xl font-bold text-gray-700 dark:text-white mt-0.5">{card.count}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                {docView === 'pending'
                  ? `รายการจดหมายขอความอนุเคราะห์/ส่งตัวนักศึกษา (${pendingDocs.length} รอลงนาม)`
                  : `เอกสารที่ลงนามไปแล้ว (${signedDocs.length} ฉบับ)`}
              </span>

              {docView === 'pending' && pendingDocs.length > 0 && (
                <Button
                  size="sm"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  onClick={() => setConfirmSignOpen(true)}
                  disabled={selectedDocIds.length === 0}
                  loading={signingInProgress}
                  loadingLabel="กำลังลงนาม..."
                >
                  {`ลงนามแบบกลุ่มที่เลือก (${selectedDocIds.length})`}
                </Button>
              )}
            </div>

            {visibleDocs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                      {docView === 'pending' && (
                        <th className="p-4 w-12 text-center">
                          <input
                            type="checkbox"
                            aria-label="เลือกเอกสารทั้งหมดที่รอลงนาม"
                            onChange={(e) => handleSelectAll(e.target.checked, pendingDocs)}
                            checked={selectedDocIds.length === pendingDocs.length && pendingDocs.length > 0}
                            className="rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700 dark:text-blue-400"
                          />
                        </th>
                      )}
                      <th className="p-4 font-semibold">เลขที่หนังสือ</th>
                      <th className="p-4 font-semibold">ประเภทจดหมาย</th>
                      <th className="p-4 font-semibold">นักศึกษา</th>
                      <th className="p-4 font-semibold">สถานประกอบการปลายทาง</th>
                      <th className="p-4 font-semibold text-center">{docView === 'pending' ? 'สถานะ' : 'วันที่ลงนาม'}</th>
                      <th className="p-4 font-semibold text-right">เปิดดู</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {visibleDocs.map((doc) => {
                      const isChecked = selectedDocIds.includes(doc.doc_id);
                      return (
                        <tr key={doc.doc_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                          {docView === 'pending' && (
                            <td className="p-4 text-center">
                              <input
                                type="checkbox"
                                aria-label={`เลือกเอกสารของ ${docStudentName(doc)}`}
                                checked={isChecked}
                                onChange={() => handleSelectRow(doc.doc_id)}
                                className="rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700 dark:text-blue-400"
                              />
                            </td>
                          )}
                          {/* The official number staff typed in, not the row id.
                              The column has always been labelled as the former
                              and shown the latter. */}
                          <td className="p-4 font-bold text-gray-800 dark:text-gray-300">
                            {doc.document_number || `#DOC-${doc.doc_id}`}
                          </td>
                          <td className="p-4 text-gray-600 dark:text-gray-400">
                            {getDocTypeLabel(doc.type)}
                          </td>
                          <td className="p-4 text-gray-700 dark:text-gray-300">
                            <span className="block font-medium">{docStudentName(doc)}</span>
                            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">รหัส: {doc.student_code}</span>
                          </td>
                          <td className="p-4 text-gray-600 dark:text-gray-400">
                            {doc.company_name_th}
                          </td>
                          <td className="p-4 text-center">
                            {docView === 'pending' ? (
                              /* Was animate-pulse on every row. A queue of twenty
                                 blinked twenty times over, forever. */
                              <span className="px-2 py-0.5 rounded-full font-bold text-xs bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400">
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
                              onClick={() => setPreviewDocUrl(`${API_BASE_URL}/files/documents/${doc.doc_id}`)}
                              className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-800 dark:hover:text-blue-400"
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
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {docView === 'pending'
                    ? 'ไม่มีเอกสารราชการที่รอการลงนามในขณะนี้'
                    : 'ยังไม่มีเอกสารที่ท่านลงนามไปแล้ว'}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {docView === 'pending'
                    ? 'เอกสารจะเข้ามาที่นี่เมื่อเจ้าหน้าที่สหกิจศึกษาออกหนังสือให้นักศึกษาที่ผ่านการอนุมัติจากหัวหน้าสาขาวิชาแล้ว'
                    : 'เอกสารที่ลงนามแล้วจะย้ายมาอยู่ในรายการนี้ และเปิดดูไฟล์ย้อนหลังได้ตลอด'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReplaceSigOpen}
        title="แทนที่ลายมือชื่อเดิม"
        message="ลายมือชื่อที่บันทึกไว้เดิมจะถูกลบออกจากระบบและใช้ลายมือชื่อใหม่แทนในการประทับเอกสารราชการทุกฉบับนับจากนี้ ยืนยันหรือไม่?"
        confirmLabel="แทนที่ลายมือชื่อ"
        destructive
        busy={isSavingSig}
        onConfirm={handleSaveSignature}
        onCancel={() => setConfirmReplaceSigOpen(false)}
      />

      <ConfirmDialog
        open={confirmSignOpen}
        title="ยืนยันการลงนามเอกสารราชการ"
        message={`ลงนามเอกสาร ${selectedDocIds.length} ฉบับด้วยลายมือชื่อของท่าน? ระบบจะประทับลายเซ็นลงบนไฟล์ PDF และแจ้งนักศึกษากับสถานประกอบการทันที การลงนามนี้ยกเลิกจากหน้านี้ไม่ได้`}
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

export default DeanDashboard;
