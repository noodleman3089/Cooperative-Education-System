import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload, Save } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import type { ImportSummary } from '../../types/api';

/**
 * E6 · รายชื่อนักศึกษา & ผลการเรียน (ImportScreening.dc.html)
 *
 * ไฟล์นี้บอกสองอย่าง: **เกรดจากทะเบียน** และ **อีเมลที่ใช้ผูกรหัสนักศึกษาเข้ากับบัญชี**
 *
 * ⛔ **ไม่มีเรื่องสิทธิ์สหกิจอีกแล้ว** (ตัดออก 2026-09-14 · SEC-02) — ระบบไม่ตรวจว่าใคร
 *    มีสิทธิ์หรือผ่านคัดกรอง อาจารย์จัดการนอกระบบ · คอลัมน์ `is_eligible` / `ผ่านเกณฑ์`
 *    ในไฟล์เดิมจะถูกเมินเงียบ ๆ (ไม่ตีเป็นแถวเสีย เพราะไฟล์เก่าของคณะยังมีคอลัมน์นั้นอยู่)
 *
 * SEC-05: แก้ทะเบียนรายคน (PUT /students/:id/registry)
 */

interface ParsedStudent {
  student_code: string;
  cumulative_gpa: string;
  email: string;
}

interface StudentRegistryRow {
  student_id: number;
  student_code: string;
  first_name: string;
  last_name: string;
  cumulative_gpa: number | string | null;
  advisor_email?: string;
  supervisor_email?: string;
  major_id?: number;
  major_name_th?: string;
  email?: string;
}

interface MajorOption {
  major_id: number;
  major_name_th: string;
  major_code: string;
}

export const ImportScreening: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam === 'manual' ? 'manual' : tabParam === 'registry' ? 'registry' : 'bulk';

  const setTab = (nextTab: 'bulk' | 'manual' | 'registry') => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextTab === 'bulk') next.delete('tab');
        else next.set('tab', nextTab);
        return next;
      },
      { replace: false }
    );
  };

  const [dragOver, setDragOver] = useState(false);
  const [parsedStudents, setParsedStudents] = useState<ParsedStudent[]>([]);
  const [rejectedRows, setRejectedRows] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  // Registry students list & master data
  const [registeredStudents, setRegisteredStudents] = useState<StudentRegistryRow[]>([]);
  const [majors, setMajors] = useState<MajorOption[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Manual student add state
  const [manualStudentCode, setManualStudentCode] = useState('');
  const [manualStudentGpa, setManualStudentGpa] = useState('');
  const [manualStudentEmail, setManualStudentEmail] = useState('');
  const [isAddingStudent, setIsAddingStudent] = useState(false);

  // SEC-05 Edit single registry state
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [registryMajorId, setRegistryMajorId] = useState<number | null>(null);
  const [registryGpa, setRegistryGpa] = useState('');
  const [isUpdatingRegistry, setIsUpdatingRegistry] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [studentsRes, masterRes] = await Promise.all([
        api.get('/students').catch(() => []),
        api.get('/master-data').catch(() => ({ majors: [] })),
      ]);
      const list = Array.isArray(studentsRes) ? studentsRes : [];
      setRegisteredStudents(list);
      setMajors((masterRes?.majors ?? []) as MajorOption[]);
      if (list.length > 0 && selectedStudentId === null) {
        setSelectedStudentId(list[0].student_id);
        setRegistryMajorId(list[0].major_id ?? null);
        setRegistryGpa(list[0].cumulative_gpa ? String(list[0].cumulative_gpa) : '');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingData(false);
    }
  }, [selectedStudentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleSelectStudentForEdit = (studentId: number) => {
    setSelectedStudentId(studentId);
    const s = registeredStudents.find((st) => st.student_id === studentId);
    if (s) {
      setRegistryMajorId(s.major_id ?? null);
      setRegistryGpa(s.cumulative_gpa ? String(s.cumulative_gpa) : '');
    }
  };

  const handleUpdateRegistry = async () => {
    if (!selectedStudentId) return;
    setIsUpdatingRegistry(true);
    setError(null);
    setSuccess(null);
    try {
      const s = registeredStudents.find((st) => st.student_id === selectedStudentId);
      await api.put(`/students/${selectedStudentId}/registry`, {
        student_code: s?.student_code,
        major_id: registryMajorId,
        cumulative_gpa: registryGpa ? parseFloat(registryGpa) : null,
      });
      setSuccess(`บันทึกข้อมูลทะเบียนของนักศึกษารหัส ${s?.student_code} เรียบร้อยแล้ว`);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถปรับปรุงข้อมูลทะเบียนนักศึกษาได้'));
    } finally {
      setIsUpdatingRegistry(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setError(null);
    setSuccess(null);
    setImportSummary(null);

    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccess(null);
    setImportSummary(null);

    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) return;

        const XLSX = await import('xlsx');
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
        const formatted: ParsedStudent[] = [];
        const rejected: string[] = [];

        rawRows.forEach((row, idx) => {
          const rowNo = idx + 2;
          const student_code = String(row.student_code || row['รหัสนักศึกษา'] || '').trim();

          if (!student_code) {
            rejected.push(`แถวที่ ${rowNo}: ไม่พบรหัสนักศึกษา`);
            return;
          }

          const rawGpa = row.cumulative_gpa ?? row['เกรดเฉลี่ย'] ?? row['GPAX'];
          const cumulative_gpa =
            rawGpa === undefined || rawGpa === null || String(rawGpa).trim() === ''
              ? ''
              : String(rawGpa).trim();

          if (cumulative_gpa !== '') {
            const gpaNum = Number(cumulative_gpa);
            if (isNaN(gpaNum) || gpaNum < 0 || gpaNum > 4) {
              rejected.push(`${student_code}: เกรดเฉลี่ย '${cumulative_gpa}' ต้องอยู่ระหว่าง 0.00-4.00`);
              return;
            }
          }

          const email = String(row.email ?? row['อีเมล'] ?? '').trim().toLowerCase();

          const offending = [student_code, cumulative_gpa, email].find((v) => /[",\r\n]/.test(v));
          if (offending !== undefined) {
            rejected.push(`${student_code}: มีเครื่องหมายที่ไม่รองรับ`);
            return;
          }

          formatted.push({ student_code, cumulative_gpa, email });
        });

        if (formatted.length === 0) {
          throw new Error(
            rejected.length > 0
              ? `ไม่มีแถวที่นำเข้าได้เลย · ${rejected.slice(0, 3).join(' · ')}`
              : 'ไม่พบข้อมูลนักศึกษาในไฟล์'
          );
        }

        setParsedStudents(formatted);
        setRejectedRows(rejected);
        setSuccess(`อ่านไฟล์สำเร็จ พบข้อมูลนักศึกษา ${formatted.length} รายการ (ตรวจสอบผลด้านขวา)`);
      } catch (err) {
        console.error('File parsing error:', err);
        setError(`ไม่สามารถอ่านไฟล์ได้: ${getErrorMessage(err, 'โครงสร้างไฟล์ไม่ถูกต้อง')}`);
        setParsedStudents([]);
        setRejectedRows([]);
      }
    };

    reader.onerror = () => {
      setError('เกิดข้อผิดพลาดในการอ่านไฟล์');
    };

    reader.readAsBinaryString(file);
  };

  const handleConfirmImport = async () => {
    if (parsedStudents.length === 0) return;

    setIsImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const csvHeader = 'student_code,cumulative_gpa,email';
      const csvLines = parsedStudents.map((s) => `${s.student_code},${s.cumulative_gpa},${s.email}`);
      const csvString = [csvHeader, ...csvLines].join('\n');

      const res = await api.post('/students/import', { csv: csvString });
      setImportSummary(res.summary);
      setSuccess('นำเข้ารายชื่อนักศึกษาและเกรดเรียบร้อยแล้ว');
      setParsedStudents([]);
      setRejectedRows([]);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'การส่งข้อมูลไปยังฐานข้อมูลล้มเหลว'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleManualStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualStudentCode.trim()) {
      setError('กรุณากรอกรหัสนักศึกษา');
      return;
    }

    setIsAddingStudent(true);
    setError(null);
    setSuccess(null);

    try {
      const csvString = `student_code,cumulative_gpa,email\n${manualStudentCode.trim()},${manualStudentGpa.trim()},${manualStudentEmail.trim().toLowerCase()}`;
      await api.post('/students/import', { csv: csvString });

      setSuccess(`เพิ่มรายชื่อนักศึกษา ${manualStudentCode} สำเร็จเรียบร้อยแล้ว`);
      setManualStudentCode('');
      setManualStudentGpa('');
      setManualStudentEmail('');
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลนักศึกษาได้'));
    } finally {
      setIsAddingStudent(false);
    }
  };

  if (loadingData) return <PageSkeleton variant="table" />;

  return (
    <div className="max-w-[1300px] mx-auto space-y-4 pb-12">
      {/* 1. Header Bar matching ImportScreening.dc.html */}
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          รายชื่อนักศึกษา &amp; ผลการเรียน
        </h1>
        <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
          ไฟล์นี้บอกสองอย่างคือ <strong className="font-bold text-gray-800 dark:text-gray-200">เกรดที่ทะเบียนแจ้งมา</strong> และ <strong className="font-bold text-gray-800 dark:text-gray-200">อีเมลที่ใช้ผูกรหัสนักศึกษาเข้ากับบัญชี</strong> — ระบบไม่ได้ใช้ไฟล์นี้ตัดสินว่าใครมีสิทธิ์ออกสหกิจ</p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* 3. Tab Bar */}
      <div className="flex items-center gap-6 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setTab('bulk')}
          className={`py-2.5 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'bulk'
              ? 'border-blue-600 text-blue-900 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          อัปโหลดไฟล์
        </button>
        <button
          type="button"
          onClick={() => setTab('manual')}
          className={`py-2.5 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'manual'
              ? 'border-blue-600 text-blue-900 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          เพิ่มทีละคน
        </button>
        <button
          type="button"
          onClick={() => setTab('registry')}
          className={`py-2.5 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'registry'
              ? 'border-blue-600 text-blue-900 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          รายชื่อในทะเบียนกลาง ({registeredStudents.length})
        </button>
      </div>

      {/* Tab: Bulk Import & Screening */}
      {activeTab === 'bulk' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left: Drag & Drop + Expected Columns */}
          <div className="lg:col-span-6 card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-all ${
                dragOver
                  ? 'border-blue-600 bg-blue-50/20 dark:bg-blue-950/20'
                  : 'border-blue-200 dark:border-blue-900/40 bg-[#EFF6FF] dark:bg-blue-950/10'
              }`}
            >
              <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400 mb-2" />
              <span className="text-[15px] font-bold text-blue-900 dark:text-blue-200">
                ลากไฟล์ CSV หรือ Excel มาวางที่นี่
              </span>
              <label
                htmlFor="screening-file-input"
                className="text-xs text-blue-700 dark:text-blue-400 underline cursor-pointer mt-1"
              >
                หรือ เลือกไฟล์จากเครื่อง
              </label>
              <input
                id="screening-file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-bold text-gray-900 dark:text-white block">
                คอลัมน์ที่ระบบอ่าน
              </span>
              <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-bold">
                    <tr>
                      <th className="p-2.5">คอลัมน์</th>
                      <th className="p-2.5">จำเป็น</th>
                      <th className="p-2.5">ค่าที่รับได้</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-200">
                    <tr>
                      <td className="p-2.5 font-mono text-blue-600 dark:text-blue-400">student_code</td>
                      <td className="p-2.5 font-semibold text-emerald-600">ใช่</td>
                      <td className="p-2.5">รหัสนักศึกษา (12-1 หลัก)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-mono text-blue-600 dark:text-blue-400">cumulative_gpa</td>
                      <td className="p-2.5 text-gray-500">ไม่</td>
                      <td className="p-2.5">ตัวเลข เช่น 3.24</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-mono text-blue-600 dark:text-blue-400">email</td>
                      <td className="p-2.5 text-gray-500">ไม่</td>
                      <td className="p-2.5">อีเมลมหาวิทยาลัย</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <span className="hint text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed block">
                <strong className="font-bold text-gray-800 dark:text-gray-200">ช่องเกรดว่าง = “ไฟล์นี้ไม่ได้บอกเกรด”</strong> — เกรดเดิมในระบบไม่ถูกแตะ · ค่าที่อ่านไม่ออกจะถูกรายงานเป็นแถวที่ตกไป · คอลัมน์อื่นในไฟล์ (เช่น ผ่านเกณฑ์) ระบบเมิน
              </span>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1">
              <span className="text-[13px] font-bold text-gray-900 dark:text-white block">
                ทำไมต้องมีคอลัมน์อีเมล
              </span>
              <span className="hint text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed block">
                อีเมลผูกรหัสนักศึกษาเข้ากับบัญชีหนึ่งบัญชี — แถวที่ไม่มีอีเมล เพื่อนร่วมรุ่นจะอ้างรหัสนั้นเพื่อสืบเกรดแทนไม่ได้ <strong className="font-bold text-gray-800 dark:text-gray-200">แต่เจ้าของรหัสก็ผูกบัญชีไม่ได้เหมือนกัน</strong>
              </span>
            </div>
          </div>

          {/* Right Column: Preview/Summary & SEC-05 Edit Registry */}
          <div className="lg:col-span-6 space-y-4">
            {/* ตรวจทานก่อนบันทึก */}
            <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-3.5">
              <span className="text-[17px] font-extrabold text-gray-900 dark:text-white block">
                {parsedStudents.length > 0
                  ? `ตรวจทานก่อนบันทึก · ${parsedStudents.length + rejectedRows.length} แถว`
                  : importSummary
                  ? `ผลการนำเข้าล่าสุด · ${importSummary.totalProcessed} แถว`
                  : 'ตรวจทานก่อนบันทึก'}
              </span>

              {/* 3 Stat Badges */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="border border-emerald-200 dark:border-emerald-800 bg-[#F0FDF4] dark:bg-emerald-950/30 rounded-xl p-3">
                  <div className="text-2xl font-extrabold text-[#15803D] dark:text-emerald-400">
                    {parsedStudents.length > 0 ? parsedStudents.length : importSummary ? importSummary.importedCount : 0}
                  </div>
                  <div className="text-[12px] font-semibold text-[#15803D] dark:text-emerald-400">
                    เพิ่มใหม่
                  </div>
                </div>
                <div className="border border-blue-200 dark:border-blue-800 bg-[#EFF6FF] dark:bg-blue-950/30 rounded-xl p-3">
                  <div className="text-2xl font-extrabold text-[#1E3A8A] dark:text-blue-300">
                    {importSummary ? importSummary.updatedCount : 0}
                  </div>
                  <div className="text-[12px] font-semibold text-[#1E3A8A] dark:text-blue-300">
                    อัปเดตค่าเดิม
                  </div>
                </div>
                <div className="border border-amber-200 dark:border-amber-800 bg-[#FFFBEB] dark:bg-amber-950/30 rounded-xl p-3">
                  <div className="text-2xl font-extrabold text-[#B45309] dark:text-amber-400">
                    {rejectedRows.length}
                  </div>
                  <div className="text-[12px] font-semibold text-[#B45309] dark:text-amber-400">
                    ตกไป
                  </div>
                </div>
              </div>

              {/* Reasons for rejected rows */}
              {rejectedRows.length > 0 && (
                <div className="border border-amber-200 dark:border-amber-800 bg-[#FFFBEB] dark:bg-amber-950/30 rounded-xl p-3.5 space-y-1.5 text-amber-900 dark:text-amber-200">
                  <span className="text-[13px] font-bold block">
                    {rejectedRows.length} แถวที่ตกไป และเพราะอะไร:
                  </span>
                  <div className="text-xs space-y-1 max-h-32 overflow-y-auto font-mono">
                    {rejectedRows.map((rej, idx) => (
                      <div key={idx}>• {rej}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              {parsedStudents.length > 0 ? (
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={isImporting}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {isImporting ? 'กำลังบันทึก...' : `บันทึก ${parsedStudents.length} แถว`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedStudents([]);
                      setRejectedRows([]);
                    }}
                    className="px-4 py-2.5 rounded-xl font-bold text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <span className="hint text-[12px] text-gray-400">
                  ลากไฟล์หรือเลือกไฟล์ด้านซ้ายเพื่อตรวจทานก่อนบันทึก
                </span>
              )}
            </div>

            {/* แก้ทะเบียนรายคน (SEC-05) */}
            <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-3">
              <span className="text-[16px] font-bold text-gray-900 dark:text-white block">
                แก้ทะเบียนรายคน (SEC-05)
              </span>
              <span className="hint text-[12px] text-gray-500 dark:text-gray-400">
                รหัสนักศึกษา · สาขาวิชา · เกรดสะสม เป็น <strong className="font-bold text-gray-800 dark:text-gray-200">ฟิลด์ของเซิร์ฟเวอร์</strong> — นักศึกษาแก้เองไม่ได้ หน้าโปรไฟล์แสดงแบบอ่านอย่างเดียว · เจ้าหน้าที่แก้ที่นี่และทุกครั้งลง audit log
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="reg-student-select" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    นักศึกษา
                  </label>
                  <select
                    id="reg-student-select"
                    value={selectedStudentId ?? ''}
                    onChange={(e) => handleSelectStudentForEdit(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {registeredStudents.map((st) => (
                      <option key={st.student_id} value={st.student_id}>
                        {st.first_name} {st.last_name} · {st.student_code}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="reg-major-select" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    สาขาวิชา
                  </label>
                  <select
                    id="reg-major-select"
                    value={registryMajorId ?? ''}
                    onChange={(e) => setRegistryMajorId(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {majors.map((m) => (
                      <option key={m.major_id} value={m.major_id}>
                        {m.major_name_th} ({m.major_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="reg-gpa-input" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    เกรดเฉลี่ยสะสม
                  </label>
                  <input
                    id="reg-gpa-input"
                    type="number"
                    step="0.01"
                    min="0"
                    max="4"
                    value={registryGpa}
                    onChange={(e) => setRegistryGpa(e.target.value)}
                    className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="border border-amber-200 dark:border-amber-900/40 bg-[#FFFBEB] dark:bg-amber-950/20 rounded-xl p-3 text-[12px] leading-relaxed text-amber-900 dark:text-amber-300">
                <strong className="font-bold">เกรดที่นักศึกษากรอกในใบสมัครสหกิจเป็นคนละค่ากับช่องนี้</strong> — ค่านั้นเป็น “เกรดที่แจ้ง” และจะถูกคัดลอกเข้าทะเบียนก็ต่อเมื่อหัวหน้าสาขาวิชากดอนุมัติ เพราะตัวเลขนี้ถูกพิมพ์ลงหนังสือราชการที่คณบดีลงนาม
              </div>

              <button
                type="button"
                onClick={handleUpdateRegistry}
                disabled={isUpdatingRegistry || !selectedStudentId}
                className="btn inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {isUpdatingRegistry ? 'กำลังบันทึก...' : 'บันทึกทะเบียน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Manual Add Student */}
      {activeTab === 'manual' && (
        <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm max-w-xl space-y-4">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            เพิ่มรายชื่อนักศึกษาทีละคน
          </h3>
          <form onSubmit={handleManualStudentSubmit} className="space-y-3">
            <div>
              <label htmlFor="manual-code" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                รหัสนักศึกษา *
              </label>
              <input
                id="manual-code"
                type="text"
                placeholder="เช่น 256410100101-2"
                value={manualStudentCode}
                onChange={(e) => setManualStudentCode(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="manual-gpa" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                เกรดเฉลี่ยสะสม (GPAX)
              </label>
              <input
                id="manual-gpa"
                type="text"
                placeholder="เช่น 3.25"
                value={manualStudentGpa}
                onChange={(e) => setManualStudentGpa(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="manual-email" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                อีเมลผูกบัญชี (มหาวิทยาลัย)
              </label>
              <input
                id="manual-email"
                type="email"
                placeholder="student@rmutto.ac.th"
                value={manualStudentEmail}
                onChange={(e) => setManualStudentEmail(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={isAddingStudent}
              className="btn px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {isAddingStudent ? 'กำลังบันทึก...' : 'เพิ่มนักศึกษา'}
            </button>
          </form>
        </div>
      )}

      {/* 4. Bottom Table: รายชื่อในทะเบียนกลาง matching ImportScreening.dc.html */}
      <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 sm:px-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span className="text-[16px] font-bold text-gray-900 dark:text-white">
            รายชื่อในทะเบียนกลาง
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {registeredStudents.length} คน
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300">
                <th className="p-3 sm:px-4">รหัสนักศึกษา</th>
                <th className="p-3 sm:px-4">ชื่อ - นามสกุล</th>
                <th className="p-3 sm:px-4">สาขาวิชา</th>
                <th className="p-3 sm:px-4">เกรดจากทะเบียน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 text-xs">
              {registeredStudents.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-600 dark:text-gray-400">
                    ยังไม่มีข้อมูลนักศึกษาในทะเบียน
                  </td>
                </tr>
              ) : (
                registeredStudents.map((st) => (
                  <tr
                    key={st.student_id}
                    className="hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="p-3 sm:px-4 font-mono font-medium text-gray-900 dark:text-white">
                      {st.student_code}
                    </td>
                    <td className="p-3 sm:px-4 text-gray-800 dark:text-gray-200">
                      {st.first_name} {st.last_name}
                    </td>
                    <td className="p-3 sm:px-4 text-gray-600 dark:text-gray-300">
                      {st.major_name_th || '—'}
                    </td>
                    <td className="p-3 sm:px-4 font-mono text-gray-800 dark:text-gray-200">
                      {st.cumulative_gpa ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ImportScreening;
