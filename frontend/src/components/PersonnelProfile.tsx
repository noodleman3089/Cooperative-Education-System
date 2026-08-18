import React, { useEffect, useState, useRef } from 'react';
import PageSkeleton from './ui/Skeleton';
import api, { API_BASE_URL } from '../services/api';
import AlertBanner from './ui/AlertBanner';
import { getErrorMessage } from '../utils/errors';
import { Input, Select } from './ui/Input';

interface Major {
  major_id: number;
  major_code: string;
  major_name_th: string;
}

const PersonnelProfile: React.FC = () => {
  const [profile, setProfile] = useState<{ status?: string; e_signature_file?: string | null } | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [majors, setMajors] = useState<Major[]>([]);
  
  const [selectedMajorId, setSelectedMajorId] = useState<number | ''>('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [birthDate, setBirthDate] = useState('');

  // E-Signature Pad states
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastX, setLastX] = useState(0);
  const [lastY, setLastY] = useState(0);
  const [brushColor, setBrushColor] = useState('#1e3a8a'); // Navy Blue
  const [brushSize, setBrushSize] = useState(3);
  const [savedSigPath, setSavedSigPath] = useState<string | null>(null);
  
  // Upload mode
  const [uploadMode, setUploadMode] = useState<'draw' | 'file'>('draw');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [profileData, masterData] = await Promise.all([
        api.get('/profile/me'),
        api.get('/master-data')
      ]);

      setRoles(profileData.roles || []);
      setMajors(masterData.majors || []);

      const prof = profileData.profile;
      if (prof) {
        setProfile(prof);
        setSelectedMajorId(prof.major_id || '');
        setSavedSigPath(prof.e_signature_file || null);
        setFirstName(prof.first_name || '');
        setLastName(prof.last_name || '');
        setBirthDate(prof.birth_date ? prof.birth_date.split('T')[0] : '');
      }
    } catch (err) {
      console.error('Failed to load personnel profile:', err);
      setError('ไม่สามารถเรียกข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  // Signature Pad drawing logic
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
      e.preventDefault(); // Prevent scrolling on mobile
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

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (selectedMajorId === '') {
      setError('กรุณาเลือกสาขาวิชาที่สังกัด');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('major_id', String(selectedMajorId));
      formData.append('birth_date', birthDate);

      if (!roles.includes('staff')) {
        formData.append('first_name', firstName);
        formData.append('last_name', lastName);
      }

      if (roles.includes('dean')) {
        if (uploadMode === 'draw') {
          const canvas = canvasRef.current;
          if (canvas) {
            // Check if canvas is not blank
            const blank = document.createElement('canvas');
            blank.width = canvas.width;
            blank.height = canvas.height;
            if (canvas.toDataURL() !== blank.toDataURL()) {
              const dataUrl = canvas.toDataURL('image/png');
              const blob = dataURLtoBlob(dataUrl);
              formData.append('signature', blob, 'signature.png');
            }
          }
        } else if (uploadMode === 'file' && signatureFile) {
          formData.append('signature', signatureFile);
        }
      }

      const res = await api.put('/profile/personnel', formData);
      setSuccess('บันทึกการแก้ไขข้อมูลโปรไฟล์สำเร็จเรียบร้อย');
      
      if (res.profile) {
        setProfile(res.profile);
        setSavedSigPath(res.profile.e_signature_file || null);
      }
      
      // Clear states
      clearCanvas();
      setSignatureFile(null);
      
    } catch (err) {
      console.error('Failed to update personnel profile:', err);
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'advisor': return 'อาจารย์ที่ปรึกษา (Advisor)';
      case 'dept_head': return 'หัวหน้าสาขาวิชา / หัวหน้าภาค (Department Head)';
      case 'dean': return 'คณบดี (Dean)';
      case 'staff': return 'เจ้าหน้าที่ประสานงานสหกิจ (Coop Staff)';
      default: return role;
    }
  };

  if (loading) {
    return (
      <PageSkeleton variant='form' />
    );
  }

  return (
    <div className="max-w-2xl bg-white p-8 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 page-enter">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">การตั้งค่าโปรไฟล์บุคลากร</h2>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          จัดการข้อมูลสาขาวิชาที่สังกัด และตั้งค่าลายมือชื่อดิจิทัลสำหรับประทับตราอนุมัติเอกสาร
        </p>
      </div>

      <AlertBanner variant="error" message={error} className="mb-4" />

      <AlertBanner variant="success" message={success} className="mb-4" />

      <form onSubmit={handleUpdate} className="space-y-5">
        {/* บทบาทในระบบ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              บทบาทปฏิบัติหน้าที่ในระบบ
            </label>
            <div className="w-full px-4 py-2.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 font-medium">
              {roles.map(r => getRoleLabel(r)).join(', ')}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              สถานะการลงทะเบียนโปรไฟล์
            </label>
            <div className={`w-full px-4 py-2.5 text-sm rounded-lg border border-gray-200 font-medium ${
              profile?.status === 'approved' 
                ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-900 dark:text-green-400'
                : 'bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-950/20 dark:border-yellow-900 dark:text-yellow-400'
            }`}>
              {profile?.status === 'approved' ? 'อนุมัติเรียบร้อยแล้ว' : 'รอการอนุมัติบัญชี'}
            </div>
          </div>
        </div>

        {/* ชื่อจริง และนามสกุล (ยกเว้นบทบาทเจ้าหน้าที่) */}
        {!roles.includes('staff') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                ชื่อจริง
              </label>
              <Input
                type="text"
                required
                disabled={isSubmitting}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                นามสกุล
              </label>
              <Input
                type="text"
                required
                disabled={isSubmitting}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* เลือกสาขาวิชา */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            สาขาวิชาที่สังกัด / ดูแล
          </label>
          <Select
            required
            disabled={isSubmitting}
            value={selectedMajorId}
            onChange={(e) => setSelectedMajorId(Number(e.target.value))}
          >
            <option value="">-- เลือกสาขาวิชา --</option>
            {majors.map((m) => (
              <option key={m.major_id} value={m.major_id}>
                [{m.major_code}] {m.major_name_th}
              </option>
            ))}
          </Select>
        </div>

        {/* วันเดือนปีเกิด (Birth Date) */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            วันเดือนปีเกิด (Birth Date) *
          </label>
          <Input
            type="date"
            required
            disabled={isSubmitting}
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            className="cursor-pointer"
          />
        </div>

        {/* ตั้งค่าลายเซ็นดิจิทัล (แสดงเฉพาะคณบดี) */}
        {roles.includes('dean') && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                ลายมือชื่ออิเล็กทรอนิกส์ (Digital Signature)
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                ลายเซ็นนี้จะใช้สำหรับนำไปวางประทับตราบนเอกสารใบคำร้องต่างๆ ของนักศึกษาโดยอัตโนมัติ
              </p>
            </div>

            {/* แสดงลายเซ็นปัจจุบัน */}
            {savedSigPath && (
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-800/80 inline-block">
                <span className="block text-xs text-gray-600 dark:text-gray-400 mb-1">ลายเซ็นปัจจุบันในระบบ:</span>
                <img
                  src={`${API_BASE_URL}/files/signatures/${savedSigPath.split('/').pop()}`}
                  alt="Digital Signature"
                  className="h-16 object-contain bg-white dark:bg-gray-900 rounded p-1"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}

            {/* สลับแท็บ วิธีการส่งลายเซ็น */}
            <div className="flex gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg max-w-xs text-xs">
              <button
                type="button"
                onClick={() => setUploadMode('draw')}
                className={`flex-1 py-1.5 rounded-md text-center font-medium transition-all ${
                  uploadMode === 'draw'
                    ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                วาดลายมือชื่อสด
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('file')}
                className={`flex-1 py-1.5 rounded-md text-center font-medium transition-all ${
                  uploadMode === 'file'
                    ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                อัปโหลดไฟล์ภาพลายเซ็น
              </button>
            </div>

            {uploadMode === 'draw' ? (
              <div className="space-y-3">
                {/* ตัวควบคุมปากกา */}
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span>สีปากกา:</span>
                      <input 
                        type="color" 
                        value={brushColor} 
                        onChange={(e) => setBrushColor(e.target.value)}
                        className="w-5 h-5 rounded cursor-pointer border-none bg-transparent"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>ขนาด:</span>
                      <Select
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))} size="sm"
                      >
                        <option value="2">บาง (2px)</option>
                        <option value="3">ปกติ (3px)</option>
                        <option value="5">หนา (5px)</option>
                      </Select>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="text-red-500 hover:text-red-600 transition-colors font-medium"
                  >
                    ล้างกระดานวาด
                  </button>
                </div>

                {/* กระดาน Canvas วาดภาพ */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-950">
                  <canvas
                    ref={canvasRef}
                    width={560}
                    height={180}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full cursor-crosshair block bg-transparent"
                    style={{ touchAction: 'none' }}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  ไฟล์ภาพลายเซ็น (PNG/JPG แนะนำพื้นหลังโปร่งใส)
                </label>
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/jpg"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setSignatureFile(e.target.files[0]);
                    }
                  }}
                  className="w-full text-xs text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-gray-100 file:text-gray-600 hover:file:bg-gray-200 dark:file:bg-gray-800 dark:file:text-gray-300 cursor-pointer"
                />
              </div>
            )}
          </div>
        )}

        {/* ปุ่มบันทึกข้อมูล */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 rounded-xl bg-brand-blue text-white text-sm font-semibold hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-800 transition-all flex items-center gap-2"
          >
            {isSubmitting ? 'กำลังบันทึกข้อมูล...' : 'บันทึกข้อมูลตั้งค่า'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PersonnelProfile;
