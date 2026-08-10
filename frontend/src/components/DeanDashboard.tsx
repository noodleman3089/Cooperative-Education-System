import React, { useEffect, useState, useRef } from 'react';
import PageSkeleton, { skeletonFor } from './ui/Skeleton';
import api, { API_BASE_URL } from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal from './ui/Modal';

interface DeanDashboardProps {
  activeMenu?: string;
  defaultTab?: string;
}

interface OfficialDocument {
  doc_id: number;
  type: string;
  student_id: number;
  company_id: number;
  template_id: number;
  generated_file_path: string | null;
  status: string;
  dean_signature_date: string | null;
  student_code: string;
  student_name?: string;
  company_name_th: string;
}

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

  // Fetch documents and profile signature
  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      
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
      setError('ไม่สามารถเรียกข้อมูลเอกสารหรือโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

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

  // Batch sign documents
  const handleBatchSign = async () => {
    if (selectedDocIds.length === 0) return;
    
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
      
      // If DocuSign mode is returned
      if (res.mode === 'docusign' && res.signing_urls && res.signing_urls.length > 0) {
        setSuccess(`สร้างลิ้งค์สำหรับลงนามแบบกลุ่มสำเร็จ (จำนวน ${res.signing_urls.length} รายการ) กำลังเปิดหน้าต่างลงนาม DocuSign...`);
        // Open DocuSign signing ceremony
        const url = res.signing_urls[0].signing_url;
        window.open(url, '_blank');
      } else {
        const signedCount = res.signed_count || 0;
        const failedCount = res.failed_documents?.length || 0;
        
        if (failedCount > 0) {
          setError(`ลงนามสำเร็จ ${signedCount} รายการ, ล้มเหลว ${failedCount} รายการ: ${res.failed_documents[0].error}`);
        } else {
          setSuccess(`ลงนามแบบกลุ่มสำเร็จเรียบร้อยแล้ว จำนวน ${signedCount} รายการ`);
        }
      }
      
      setSelectedDocIds([]);
      await loadDashboardData();
    } catch (err: any) {
      console.error('Batch sign error:', err);
      setError(err.response?.data?.message || 'การลงนามแบบกลุ่มล้มเหลว กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSigningInProgress(false);
    }
  };

  // Signature Pad Canvas drawing logic
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    let x = 0;
    let y = 0;

    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    
    setLastX(x);
    setLastY(y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    let x = 0;
    let y = 0;

    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
      // Prevent default scrolling behaviour on mobile/tablet touch move
      e.preventDefault();
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

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

  // Upload E-Signature to backend
  const handleSaveSignature = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check if canvas is blank
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    if (canvas.toDataURL() === blank.toDataURL()) {
      setError('กรุณาวาดลายมือชื่อของท่านลงบนกระดานก่อนบันทึก');
      return;
    }

    setIsSavingSig(true);
    setError(null);
    setSuccess(null);

    try {
      const dataUrl = canvas.toDataURL('image/png');
      const blob = dataURLtoBlob(dataUrl);

      const formData = new FormData();
      formData.append('signature', blob, 'signature.png');
      formData.append('major_id', '1'); // Fallback default major for Personnel

      const res = await api.put('/profile/personnel', formData);
      setSuccess('บันทึกลายเซ็นอิเล็กทรอนิกส์ของท่านเข้าสู่ระบบสำเร็จ');
      
      if (res.profile?.e_signature_file) {
        setSavedSigPath(res.profile.e_signature_file);
      }
    } catch (err: any) {
      console.error('Failed to save signature:', err);
      setError(err.response?.data?.message || 'การบันทึกลายเซ็นล้มเหลว กรุณาลองใหม่อีกครั้ง');
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
        <p className="text-xs text-gray-400 mt-1">
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
              <div className="absolute bottom-2 left-2 text-xs text-gray-400 pointer-events-none select-none">
                ลงลายมือชื่อภายในกรอบนี้
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4 text-xs">
                {/* Size */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">ขนาดหัวแปรง:</span>
                  <select
                    value={brushSize}
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
                  <span className="text-gray-400">สีแปรง:</span>
                  <div className="flex items-center gap-1.5">
                    {['#1e3a8a', '#000000', '#0f766e'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBrushColor(c)}
                        className={`h-5 w-5 rounded-full border-2 transition-all ${
                          brushColor === c ? 'border-brand-blue scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="py-1.5 px-3 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 text-xs font-bold transition-all dark:text-gray-300 dark:hover:bg-gray-800 dark:border-gray-700"
                >
                  ล้างหน้าจอ
                </button>
                <button
                  type="button"
                  onClick={handleSaveSignature}
                  disabled={isSavingSig}
                  className="py-1.5 px-4 rounded-lg bg-brand-blue text-white hover:bg-blue-600 text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                >
                  {isSavingSig ? 'กำลังบันทึก...' : 'บันทึกลายเซ็นลงระบบ'}
                </button>
              </div>
            </div>
          </div>

          {/* Current Signature Display */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">ลายมือชื่ออิเล็กทรอนิกส์ในระบบ</h3>
              <p className="text-xs text-gray-400">ภาพจำลองลายเซ็นจริงที่จะนำไปประทับบน PDF จดหมายออกส่งตัวนักศึกษา</p>
              
              <div className="mt-4 border border-gray-100 rounded-xl bg-gray-50/50 p-4 flex items-center justify-center h-[120px] dark:bg-gray-950 dark:border-gray-800">
                {savedSigPath ? (
                  <img
                    src={`${API_BASE_URL}/files/signatures/${savedSigPath.split('/').pop()}`}
                    alt="Dean Signature"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-gray-400">ยังไม่มีการบันทึกลายมือชื่อ</span>
                )}
              </div>
            </div>

            <div className="text-xs text-gray-400 mt-4 leading-relaxed">
              * ข้อมูลลายมือชื่อจะได้รับความคุ้มครองความปลอดภัยขั้นสูงสุด อนุญาตใช้งานเฉพาะในพิกัดเอกสารราชการที่กำหนดเท่านั้น
            </div>
          </div>
        </div>
      ) : (
        /* Sign Document Table Tab */
        <div className="space-y-6">
          {/* Stats widgets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-yellow-50 text-yellow-600 dark:bg-yellow-950/20 dark:text-yellow-400 flex items-center justify-center">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <span className="block text-xs text-gray-400">เอกสารที่ค้างรอการลงนาม</span>
                <span className="block text-xl font-bold text-gray-700 dark:text-white mt-0.5">{pendingDocs.length}</span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-green-50 text-green-600 dark:bg-green-950/20 dark:text-green-400 flex items-center justify-center">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <span className="block text-xs text-gray-400">เอกสารที่ลงนามอนุมัติแล้ว</span>
                <span className="block text-xl font-bold text-gray-700 dark:text-white mt-0.5">{signedDocs.length}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                รายการจดหมายขอความอนุเคราะห์/ส่งตัวนักศึกษา ({pendingDocs.length} รอลงนาม)
              </span>

              {pendingDocs.length > 0 && (
                <button
                  type="button"
                  onClick={handleBatchSign}
                  disabled={selectedDocIds.length === 0 || signingInProgress}
                  className={`py-1.5 px-4 rounded-xl text-white font-bold text-xs transition-all flex items-center gap-1.5 ${
                    selectedDocIds.length > 0 && !signingInProgress
                      ? 'bg-brand-blue hover:bg-blue-600 shadow-sm shadow-blue-500/10'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800'
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {signingInProgress ? 'กำลังลงนาม...' : `ลงนามแบบกลุ่มที่เลือก (${selectedDocIds.length})`}
                </button>
              )}
            </div>

            {pendingDocs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                      <th className="p-4 w-12 text-center">
                        <input
                          type="checkbox"
                          onChange={(e) => handleSelectAll(e.target.checked, pendingDocs)}
                          checked={selectedDocIds.length === pendingDocs.length && pendingDocs.length > 0}
                          className="rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700 dark:text-blue-400"
                        />
                      </th>
                      <th className="p-4 font-semibold">เลขที่อ้างอิงเอกสาร</th>
                      <th className="p-4 font-semibold">ประเภทจดหมาย</th>
                      <th className="p-4 font-semibold">รหัสนักศึกษา</th>
                      <th className="p-4 font-semibold">สถานประกอบการปลายทาง</th>
                      <th className="p-4 font-semibold text-center">สถานะ</th>
                      <th className="p-4 font-semibold text-right">เปิดดู</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {pendingDocs.map((doc) => {
                      const isChecked = selectedDocIds.includes(doc.doc_id);
                      return (
                        <tr key={doc.doc_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                          <td className="p-4 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleSelectRow(doc.doc_id)}
                              className="rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700 dark:text-blue-400"
                            />
                          </td>
                          <td className="p-4 font-bold text-gray-800 dark:text-gray-300">
                            #DOC-{doc.doc_id}
                          </td>
                          <td className="p-4 text-gray-600 dark:text-gray-400">
                            {getDocTypeLabel(doc.type)}
                          </td>
                          <td className="p-4 text-gray-700 dark:text-gray-300 font-medium">
                            {doc.student_code}
                          </td>
                          <td className="p-4 text-gray-600 dark:text-gray-400">
                            {doc.company_name_th}
                          </td>
                          <td className="p-4 text-center">
                            <span className="px-2 py-0.5 rounded-full font-bold text-xs bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400 animate-pulse">
                              รอคณบดีลงนาม
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                // Set document URL for embedding in an iframe/modal
                                // Since we don't have a direct route on the backend for document preview,
                                // we will update index.ts later or call it. We can preview using:
                                // /api/files/documents/:doc_id (we will map this in backend index.ts shortly!)
                                setPreviewDocUrl(`${API_BASE_URL}/files/documents/${doc.doc_id}`);
                              }}
                              className="p-1.5 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-800 dark:hover:text-blue-400"
                              title="แสดงหน้าเอกสารชั่วคราว"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              <div className="text-center py-12 text-gray-400 text-sm">
                ไม่มีเอกสารราชการที่รอการลงนามพิจารณาในขณะนี้
              </div>
            )}
          </div>
        </div>
      )}

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
