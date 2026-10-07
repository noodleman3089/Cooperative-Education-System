import React, { useState, useRef, useCallback } from 'react';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import Button from '../../components/ui/Button';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Textarea } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';

interface DeanSignatureProps {
  onNavigate?: (menu: string) => void;
}

interface UserProfile {
  first_name?: string | null;
  last_name?: string | null;
  e_signature_file?: string | null;
  academic_title?: string | null;
  signing_position?: string | null;
}

const DeanSignature: React.FC<DeanSignatureProps> = ({ onNavigate }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [facultyName, setFacultyName] = useState<string>('คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ');
  const [savedSigPath, setSavedSigPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSavingSig, setIsSavingSig] = useState(false);
  const [confirmReplaceSigOpen, setConfirmReplaceSigOpen] = useState(false);
  // ตำแหน่งใต้ลายมือชื่อ — ช่องพิมพ์อิสระ ว่าง = "คณบดี…" (ถ้อยคำทางการผู้ลงนามพิมพ์เอง ไม่มีชุดสำเร็จรูป)
  const [positionDraft, setPositionDraft] = useState('');
  const positionTouchedRef = useRef(false);
  const [isSavingPosition, setIsSavingPosition] = useState(false);

  // Canvas drawing state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastX, setLastX] = useState(0);
  const [lastY, setLastY] = useState(0);
  const [brushColor, setBrushColor] = useState('#1E3A8A'); // Navy Blue
  const [brushSize, setBrushSize] = useState(3); // 2: บาง, 3: ปกติ, 5: หนา

  const loadData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }

      const [profileRes, masterRes] = await Promise.allSettled([
        api.get('/profile/me'),
        api.get('/master-data'),
      ]);

      if (profileRes.status === 'fulfilled') {
        const prof = profileRes.value?.profile;
        if (prof) {
          setProfile(prof);
          if (prof.e_signature_file) {
            setSavedSigPath(prof.e_signature_file);
          }
          // poll เบื้องหลังต้องไม่ทับสิ่งที่กำลังพิมพ์อยู่
          setPositionDraft((prev) => (positionTouchedRef.current ? prev : prof.signing_position || ''));
        }
      } else {
        console.error('Failed to load profile for dean signature:', profileRes.reason);
        if (!isBackground) setError('ไม่สามารถเรียกข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
      }

      if (masterRes.status === 'fulfilled') {
        const faculties = masterRes.value?.faculties;
        if (Array.isArray(faculties) && faculties.length > 0 && faculties[0].faculty_name_th) {
          setFacultyName(faculties[0].faculty_name_th);
        }
      }
    } catch (err) {
      console.error('Failed to load DeanSignature data:', err);
      if (!isBackground) setError(getErrorMessage(err, 'ไม่สามารถเรียกข้อมูลลายมือชื่อได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useDashboardData(loadData);

  /**
   * พิกัด canvas คำนวณตามสัดส่วนจริงของ backing store กับขนาดแสดงผล CSS
   * (ตรรกะเดิมที่แก้พิกัดเพี้ยนบนมือถือ/จอขยาย)
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
      // ⛔ ห้ามส่ง major_id: หน้านี้ไม่เกี่ยวกับสาขา การส่ง major_id จะย้ายสาขาคณบดีโดยไม่ตั้งใจ

      const res = await api.put('/profile/personnel', formData);
      setSuccess('บันทึกลายมือชื่อสำหรับหนังสือราชการเข้าสู่ระบบสำเร็จ');

      if (res?.profile?.e_signature_file) {
        setSavedSigPath(res.profile.e_signature_file);
        setProfile((prev) => (prev ? { ...prev, e_signature_file: res.profile.e_signature_file } : null));
      }

      window.dispatchEvent(new CustomEvent('intent-updated'));
      clearCanvas();
    } catch (err) {
      console.error('Failed to save signature:', err);
      setError(getErrorMessage(err, 'การบันทึกลายเซ็นล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSavingSig(false);
    }
  };

  const handleSavePosition = async () => {
    setIsSavingPosition(true);
    setError(null);
    setSuccess(null);
    try {
      const formData = new FormData();
      // ส่งแม้ว่าง = ล้างกลับเป็น "คณบดี…" · ⛔ ไม่ส่งช่องอื่น (ชื่อ/สาขา) — หน้านี้ไม่เกี่ยว
      formData.append('signing_position', positionDraft);
      const res = await api.put('/profile/personnel', formData);
      positionTouchedRef.current = false;
      const saved: string = res?.profile?.signing_position || '';
      setPositionDraft(saved);
      setProfile((prev) => (prev ? { ...prev, signing_position: saved || null } : prev));
      setSuccess(
        saved
          ? 'บันทึกตำแหน่งใต้ลายมือชื่อแล้ว · หนังสือที่ท่านลงนามนับจากนี้จะพิมพ์ตำแหน่งนี้'
          : 'ล้างตำแหน่งแล้ว · หนังสือจะพิมพ์ “คณบดี” ตามชื่อคณะ'
      );
    } catch (err) {
      setError(getErrorMessage(err, 'บันทึกตำแหน่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSavingPosition(false);
    }
  };

  const hasName = Boolean(profile?.first_name && profile?.last_name);
  const fullName = hasName ? `${profile?.academic_title ?? ''}${profile?.first_name} ${profile?.last_name}` : '';
  const savedPosition = profile?.signing_position || '';

  if (loading) {
    return <PageSkeleton variant={skeletonFor('dean', 'signature')} />;
  }

  return (
    <div className="space-y-6 page-enter pb-10">
      {/* Heading Block */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          ลายมือชื่อสำหรับหนังสือราชการ
        </h1>
        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
          วาดลายมือชื่อในกรอบ ระบบเก็บเป็นภาพพื้นหลังโปร่ง แล้วประทับลงหนังสือขอความอนุเคราะห์และหนังสือส่งตัวทุกฉบับที่ท่านลงนามนับจากนี้
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* Grid: 3fr and 2fr per DeanSignature.dc.html */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Left Column (3 cols): วาดลายมือชื่อ */}
        <div className="lg:col-span-3 bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            วาดลายมือชื่อ
          </h3>

          <div className="relative border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-950 flex items-center justify-center h-[240px]">
            <canvas
              ref={canvasRef}
              data-testid="dean-signature-pad"
              width={500}
              height={240}
              className="w-full h-[240px] cursor-crosshair touch-none"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
            <span className="absolute left-3.5 bottom-2.5 text-xs text-gray-600 dark:text-gray-400 pointer-events-none select-none">
              ลงลายมือชื่อภายในกรอบนี้
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-4 text-xs">
              {/* ความหนา */}
              <div className="flex items-center gap-1.5">
                <span className="text-gray-600 dark:text-gray-400 font-medium">ความหนา</span>
                <div className="flex items-center gap-1">
                  {[
                    { size: 2, label: 'บาง' },
                    { size: 3, label: 'ปกติ' },
                    { size: 5, label: 'หนา' },
                  ].map((p) => {
                    const isSelected = brushSize === p.size;
                    return (
                      <button
                        key={p.size}
                        type="button"
                        onClick={() => setBrushSize(p.size)}
                        className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                            : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* หมึก */}
              <div className="flex items-center gap-1.5 ml-2">
                <span className="text-gray-600 dark:text-gray-400 font-medium">หมึก</span>
                <div className="flex items-center gap-1.5">
                  {[
                    { value: '#1E3A8A', label: 'น้ำเงินเข้ม' },
                    { value: '#000000', label: 'ดำ' },
                  ].map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setBrushColor(c.value)}
                      aria-label={`ใช้หมึกสี${c.label}`}
                      aria-pressed={brushColor === c.value}
                      title={c.label}
                      className="-m-2 flex h-9 w-9 items-center justify-center rounded-full cursor-pointer"
                    >
                      {/* วงสียังเท่าเดิม 20px — ปุ่มที่ครอบขยายเป้าแตะเป็น 36px */}
                      <span
                        className={`h-5 w-5 rounded-full border-2 transition-all ${
                          brushColor === c.value
                            ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-600 dark:ring-blue-400 scale-110'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={clearCanvas}>
                ล้าง
              </Button>
              <Button
                size="sm"
                data-testid="dean-signature-save"
                onClick={requestSaveSignature}
                loading={isSavingSig}
                loadingLabel="กำลังบันทึก..."
              >
                บันทึกลายมือชื่อ
              </Button>
            </div>
          </div>
        </div>

        {/* Right Column (2 cols): ที่จะถูกพิมพ์ลงหนังสือ + คำเตือน */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Card 1: ที่จะถูกพิมพ์ลงหนังสือ */}
          <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col gap-3 shadow-sm">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              ที่จะถูกพิมพ์ลงหนังสือ
            </h3>

            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 bg-white dark:bg-gray-950 min-h-[140px]">
              {savedSigPath ? (
                <img
                  data-testid="dean-signature-current"
                  src={`${API_BASE_URL}/files/signatures/${savedSigPath.split('/').pop()}`}
                  alt="ลายมือชื่อคณบดี"
                  className="max-h-20 max-w-[220px] object-contain"
                />
              ) : (
                <div
                  data-testid="dean-signature-current"
                  className="text-xs text-gray-600 dark:text-gray-400 py-4"
                >
                  ยังไม่มีการบันทึกลายมือชื่อ
                </div>
              )}
              <span className="text-sm font-semibold text-gray-900 dark:text-white mt-1">
                ({fullName || 'ยังไม่ได้ระบุชื่อ'})
              </span>
              {savedPosition ? (
                savedPosition.split('\n').map((line, i) => (
                  <span key={i} data-testid="dean-signature-position" className="text-xs text-gray-600 dark:text-gray-400">
                    {line}
                  </span>
                ))
              ) : (
                <span data-testid="dean-signature-position" className="text-xs text-gray-600 dark:text-gray-400">
                  คณบดี{facultyName}
                </span>
              )}
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              ชื่อมาจากโปรไฟล์ แก้ได้ที่{' '}
              <button
                type="button"
                onClick={() => onNavigate?.('profile')}
                className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                การตั้งค่าโปรไฟล์
              </button>{' '}
              · เว้นตำแหน่งด้านล่างว่างไว้ = พิมพ์ “คณบดี” ต่อด้วยชื่อคณะในระบบ
            </p>
          </div>

          {/* Card: ตำแหน่งใต้ลายมือชื่อ — ผู้รักษาการแทน/ปฏิบัติราชการแทนพิมพ์เองด้วยบัญชีของตัวเอง */}
          <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col gap-3 shadow-sm">
            <label htmlFor="dean-position-input" className="text-base font-bold text-gray-900 dark:text-white">
              ตำแหน่งใต้ลายมือชื่อ
            </label>
            <Textarea
              id="dean-position-input"
              data-testid="dean-position-input"
              rows={2}
              maxLength={255}
              value={positionDraft}
              onChange={(e) => {
                positionTouchedRef.current = true;
                setPositionDraft(e.target.value);
              }}
            />
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              <strong>ถ้าท่านเป็นคณบดี เว้นว่างไว้</strong> — ระบบพิมพ์ “คณบดี{facultyName}” ให้เอง ·
              ถ้าท่านลงนามในฐานะอื่น (เช่น ผู้รักษาราชการแทน) พิมพ์ถ้อยคำตำแหน่งของท่านเองลงที่นี่
              ขึ้นบรรทัดใหม่ได้ · ระบบไม่มีถ้อยคำสำเร็จรูปให้เลือก
            </p>
            <div>
              <Button
                size="sm"
                data-testid="dean-position-save"
                onClick={handleSavePosition}
                loading={isSavingPosition}
                loadingLabel="กำลังบันทึก..."
                disabled={positionDraft === savedPosition}
              >
                บันทึกตำแหน่ง
              </Button>
            </div>
          </div>

          {/* Card 2: แทนที่ลายมือชื่อเดิม ต้องยืนยันก่อน (แสดงเมื่อมีลายมือชื่อเดิมแล้ว) */}
          {savedSigPath && (
            <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 flex flex-col gap-1">
              <span className="text-sm font-bold text-amber-900 dark:text-amber-300">
                แทนที่ลายมือชื่อเดิม ต้องยืนยันก่อน
              </span>
              <span className="text-xs leading-relaxed text-amber-800 dark:text-amber-400">
                ภาพเดิมถูกลบจากเซิร์ฟเวอร์ · หนังสือที่ลงนามไปแล้วไม่เปลี่ยน
              </span>
            </div>
          )}

          {/* Card 3: แดงเมื่อไม่มีชื่อในโปรไฟล์ */}
          {!hasName && (
            <div
              data-testid="dean-signature-name-missing"
              className="p-4 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 flex flex-col gap-1.5"
            >
              <span className="self-start px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
                โปรไฟล์ยังไม่มีชื่อ
              </span>
              <span className="text-xs leading-relaxed text-red-900 dark:text-red-200">
                <strong>ยังไม่มีชื่อ-นามสกุลในโปรไฟล์</strong> — บันทึกลายมือชื่อได้ แต่ระบบจะยังไม่ยอมให้ลงนามหนังสือจนกว่าจะกรอกชื่อ
                <button
                  type="button"
                  onClick={() => onNavigate?.('profile')}
                  className="ml-1 font-semibold text-red-800 dark:text-red-300 underline cursor-pointer"
                >
                  ไปที่การตั้งค่าโปรไฟล์
                </button>
              </span>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReplaceSigOpen}
        title="แทนที่ลายมือชื่อเดิม"
        message="ลายมือชื่อที่บันทึกไว้เดิมจะถูกลบออกจากระบบ และใช้ลายมือชื่อใหม่แทนในการประทับเอกสารราชการทุกฉบับนับจากนี้ ภาพเดิมถูกลบจากเซิร์ฟเวอร์ · หนังสือที่ลงนามไปแล้วไม่เปลี่ยน ยืนยันหรือไม่?"
        confirmLabel="แทนที่ลายมือชื่อ"
        destructive
        busy={isSavingSig}
        onConfirm={handleSaveSignature}
        onCancel={() => setConfirmReplaceSigOpen(false)}
      />
    </div>
  );
};

export default DeanSignature;
