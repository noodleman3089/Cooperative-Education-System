import React, { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';
import { Search, FileText, ExternalLink, RefreshCw } from 'lucide-react';
import type { StudentMemoItem } from '../../types/api';

interface MemoTypeInfo {
  key: string;
  label: string;
  subject?: string;
  intent?: string;
  hint?: string;
}

const TONE_BY_TYPE: Record<string, string> = {
  early_departure: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  change_company: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50',
  terminated: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50',
  late_submission: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50',
};

interface FacultyMemosProps {
  showMajorFilter?: boolean;
}

const FacultyMemos: React.FC<FacultyMemosProps> = ({ showMajorFilter = false }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedType = searchParams.get('type') || 'all';
  const selectedMajor = searchParams.get('major') || 'all';

  const [memos, setMemos] = useState<StudentMemoItem[]>([]);
  const [memoTypes, setMemoTypes] = useState<MemoTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);

      const [memosRes, typesRes] = await Promise.all([
        api.get('/memos'),
        api.get('/memos/types'),
      ]);

      const memoList: StudentMemoItem[] = Array.isArray(memosRes)
        ? memosRes
        : memosRes?.data || [];
      setMemos(memoList);

      const rawTypes = typesRes?.types;
      if (Array.isArray(rawTypes)) {
        setMemoTypes(rawTypes);
      } else if (rawTypes && typeof rawTypes === 'object') {
        const mapped = Object.entries(rawTypes).map(([k, v]) => ({
          key: k,
          label: typeof v === 'string' ? v : (v as { label?: string }).label || k,
        }));
        setMemoTypes(mapped);
      }
    } catch (err) {
      console.error('Failed to load faculty memos:', err);
      if (!isBackground) {
        setError(getErrorMessage(err, 'ดึงรายการบันทึกข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useDashboardData(loadData, []);

  const typeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    memoTypes.forEach((t) => {
      map[t.key] = t.label;
    });
    return map;
  }, [memoTypes]);

  const handleTypeSelect = (typeKey: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (typeKey === 'all') {
        next.delete('type');
      } else {
        next.set('type', typeKey);
      }
      return next;
    });
  };

  const availableMajors = useMemo(() => {
    const majors = new Set<string>();
    memos.forEach((m) => {
      if (m.major_name_th) majors.add(m.major_name_th);
    });
    return Array.from(majors).sort();
  }, [memos]);

  // Filtered memos
  const filteredMemos = useMemo(() => {
    return memos.filter((item) => {
      if (selectedType !== 'all' && item.memo_type !== selectedType) {
        return false;
      }
      if (showMajorFilter && selectedMajor !== 'all' && item.major_name_th !== selectedMajor) {
        return false;
      }
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase();
        const fullName = `${item.first_name || ''} ${item.last_name || ''}`.toLowerCase();
        const code = (item.student_code || '').toLowerCase();
        const reason = (item.reason || '').toLowerCase();
        const major = (item.major_name_th || '').toLowerCase();
        if (!fullName.includes(query) && !code.includes(query) && !reason.includes(query) && !major.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [memos, selectedType, selectedMajor, showMajorFilter, searchTerm]);

  // Counts by memo_type
  const countsByType = useMemo(() => {
    const counts: Record<string, number> = { all: memos.length };
    memos.forEach((m) => {
      counts[m.memo_type] = (counts[m.memo_type] || 0) + 1;
    });
    return counts;
  }, [memos]);

  if (loading) {
    return <PageSkeleton variant={skeletonFor('advisor', 'memos')} />;
  }

  return (
    <div className="space-y-6 page-enter pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            บันทึกข้อความนักศึกษา
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
            บันทึกกรณียกเว้นที่นักศึกษายื่นถึงคณบดี (ออกก่อนกำหนด · เปลี่ยนสถานประกอบการ ·
            ยุติการปฏิบัติงาน · ส่งเอกสารล่าช้า) ·{' '}
            <strong className="font-semibold text-gray-800 dark:text-gray-200">อ่านอย่างเดียว</strong>{' '}
            — การลงนามเสนอต่ออยู่บนกระดาษที่นักศึกษาพิมพ์ออกไป
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadData(false)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors self-start md:self-auto cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          รีเฟรช
        </button>
      </div>

      <AlertBanner variant="error" message={error} />

      {/* Main Table Card */}
      <div className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
        {/* Filters and Search Bar */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 flex-wrap bg-gray-50/50 dark:bg-gray-800/30">
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาชื่อ รหัส หรือเหตุผล..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              data-testid="memo-type-filter-all"
              onClick={() => handleTypeSelect('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                selectedType === 'all'
                  ? 'bg-brand-navy text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              ทุกหัวข้อ ({countsByType.all || 0})
            </button>

            {memoTypes.map((t) => {
              const count = countsByType[t.key] || 0;
              const isSelected = selectedType === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  data-testid={`memo-type-filter-${t.key}`}
                  onClick={() => handleTypeSelect(t.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-brand-navy text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {t.label} ({count})
                </button>
              );
            })}
          </div>

          {showMajorFilter && availableMajors.length > 0 && (
            <div className="flex items-center gap-1.5 ml-auto sm:ml-0">
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">สาขาวิชา:</span>
              <select
                data-testid="memo-major-filter"
                aria-label="ตัวกรองสาขาวิชา"
                value={selectedMajor}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    if (val === 'all') {
                      next.delete('major');
                    } else {
                      next.set('major', val);
                    }
                    return next;
                  });
                }}
                className="px-2.5 py-1 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-blue cursor-pointer"
              >
                <option value="all">ทุกสาขาวิชา</option>
                {availableMajors.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Table Content */}
        {filteredMemos.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <FileText className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              ยังไม่มีนักศึกษายื่นบันทึกข้อความ
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              รายการจะขึ้นเมื่อนักศึกษาในสาขายื่นจากเมนู &ldquo;บันทึกถึงคณบดี&rdquo;
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                  <th className="p-4 font-semibold">นักศึกษา</th>
                  <th className="p-4 font-semibold">หัวข้อ</th>
                  <th className="p-4 font-semibold w-[44%]">เหตุผลที่นักศึกษาเขียน</th>
                  <th className="p-4 font-semibold">ยื่นเมื่อ</th>
                  <th className="p-4 font-semibold text-right">ไฟล์</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredMemos.map((item) => {
                  const studentName = item.first_name
                    ? `${item.first_name} ${item.last_name || ''}`.trim()
                    : `รหัส: ${item.student_code}`;
                  const typeLabel = typeLabels[item.memo_type] || item.memo_type;
                  const tone =
                    TONE_BY_TYPE[item.memo_type] ||
                    'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';

                  const dateFormatted = item.created_at
                    ? new Intl.DateTimeFormat('th-TH', {
                        dateStyle: 'medium',
                      }).format(new Date(item.created_at))
                    : '–';

                  return (
                    <tr
                      key={item.memo_id}
                      data-testid={`memo-row-${item.memo_id}`}
                      className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="p-4 align-top">
                        <div className="font-bold text-gray-900 dark:text-white">
                          {studentName}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                          {item.student_code}
                        </div>
                        {item.major_name_th && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">
                            {item.major_name_th}
                          </div>
                        )}
                      </td>

                      <td className="p-4 align-top">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${tone}`}
                        >
                          {typeLabel}
                        </span>
                      </td>

                      <td className="p-4 align-top text-gray-700 dark:text-gray-300 leading-relaxed">
                        {item.reason}
                      </td>

                      <td className="p-4 align-top text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {dateFormatted}
                      </td>

                      <td className="p-4 align-top text-right whitespace-nowrap">
                        <a
                          href={`${API_BASE_URL}/memos/${item.memo_id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`memo-pdf-${item.memo_id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          เปิด PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3 Info / Scope Cards per StudentMemos.dc.html */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <div className="card p-4 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50">
          <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300 mb-2">
            สามบทบาทใช้หน้าจอเดียวกัน
          </span>
          <p className="text-xs text-purple-900 dark:text-purple-300 leading-relaxed">
            อาจารย์และหัวหน้าสาขา = นักศึกษาในสาขาของตัวเอง · คณบดี = ทั้งคณะ (เพิ่มตัวกรองสาขา) ·
            ขอบเขตมาจากเซิร์ฟเวอร์ (<code className="font-mono text-[11px]">GET /memos</code>)
          </p>
        </div>

        <div className="card p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
          <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 mb-2">
            การเสนอต่อ
          </span>
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
            นักศึกษาจะนำแบบบันทึกข้อความที่พิมพ์ออกจากระบบมาเสนอให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาลงลายมือชื่อตามลำดับ
          </p>
        </div>

        <div className="card p-4 rounded-2xl bg-white dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-800">
          <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 mb-2">
            ไม่มีโดยตั้งใจ
          </span>
          <h4 className="text-xs font-bold text-gray-800 dark:text-gray-200 mb-1">
            ปุ่มอนุมัติ · ตีกลับ · สถานะ &ldquo;รอคณบดี&rdquo;
          </h4>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            ระบบไม่รู้ว่าใบไหนเซ็นแล้ว — ห้ามแต่งสถานะที่ข้อมูลไม่มี (ตามกฎ 5.3)
          </p>
        </div>
      </div>
    </div>
  );
};

export default FacultyMemos;
