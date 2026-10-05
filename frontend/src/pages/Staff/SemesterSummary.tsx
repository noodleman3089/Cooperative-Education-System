import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import PageSkeleton from '../../components/ui/Skeleton';
import { Select } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';

/**
 * สรุปภาคเรียน — ตัวเลขของภาคที่เลือก เทียบกับภาคก่อนหน้า + เวลาที่ใช้ในแต่ละขั้น (เฟส 2 R2-2)
 *
 * ⛔ ทุกตัวเลขมาจาก `GET /api/staff/semester-summary` (คำนวณสดจากข้อมูลจริง) — หน้านี้แค่แสดงและส่งออก CSV
 * ⛔ ไม่มีค่าที่ "รู้ไม่ได้" ถูกแต่งเป็น 0 — ไม่มีให้เทียบ/ไม่มีเวลา = "—" · เวลาในแต่ละขั้นบอกจำนวนใบที่รู้เวลา (n) เสมอ
 * ⛔ "ผลประเมินครบ" ไม่ใช่ "ผ่าน" — อาจารย์เป็นผู้ตัดเกรด
 */

interface Metric {
  key: string;
  label: string;
  hint: string | null;
  unit: string;
  current: number | null;
  previous: number | null;
}

interface Duration {
  key: string;
  label: string;
  current_median_days: number | null;
  current_n: number;
  previous_median_days: number | null;
  previous_n: number;
}

interface Payload {
  today: string;
  semester: { semester_id: number; label: string; is_active: boolean; closed: boolean } | null;
  previous: { semester_id: number; label: string } | null;
  semesters: { semester_id: number; label: string; is_active: boolean; closed: boolean }[];
  metrics: Metric[];
  durations: Duration[];
}

const fmt = (v: number | null, unit = ''): string => (v === null ? '—' : `${v.toLocaleString('th-TH')}${unit === '%' ? '%' : ''}`);

const fmtDays = (v: number | null): string => (v === null ? '—' : `${v.toLocaleString('th-TH')} วัน`);

/** ส่วนต่าง · ไม่มีสองฝั่ง = null (ไม่แต่งเป็น 0) */
const delta = (cur: number | null, prev: number | null): number | null => (cur === null || prev === null ? null : cur - prev);

const deltaText = (d: number | null, unit: string): string => {
  if (d === null) return '—';
  if (d === 0) return 'เท่าเดิม';
  const suffix = unit === '%' ? ' จุด' : '';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('th-TH')}${suffix}`;
};

/** CSV ตาม RFC 4180 — ครอบด้วย " และซ้ำ " ทุกเซลล์ รวมหัวตาราง (ขึ้นต้นด้วย BOM ให้ Excel อ่านภาษาไทยถูก) */
const csvCell = (v: string | number | null): string => `"${String(v ?? '').replace(/"/g, '""')}"`;

export const SemesterSummary: React.FC = () => {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // '' = ค่าเริ่มต้นของเซิร์ฟเวอร์ (ภาคที่เปิดอยู่ / ภาคล่าสุด)
  const [semesterId, setSemesterId] = useState('');

  const load = useCallback(async (sem: string) => {
    try {
      setLoading(true);
      setError(null);
      setData(await api.get(`/staff/semester-summary${sem ? `?semester_id=${sem}` : ''}`));
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดสรุปภาคเรียนได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(semesterId);
  }, [load, semesterId]);

  if (loading && !data) return <PageSkeleton variant="table" />;

  if (!data) {
    return (
      <div className="space-y-4 page-enter">
        <AlertBanner variant="error" message={error || 'ไม่สามารถโหลดสรุปภาคเรียนได้'} />
      </div>
    );
  }

  const { semester, previous } = data;

  const exportCsv = () => {
    if (!semester) return;
    const head = ['ตัวชี้วัด', semester.label, previous?.label ?? 'ภาคก่อน', 'เปลี่ยนแปลง'].map(csvCell).join(',');
    const rows = data.metrics.map((m) =>
      [m.label, m.current, m.previous, delta(m.current, m.previous)].map(csvCell).join(',')
    );
    const durHead = ['เวลาที่ใช้ในแต่ละขั้น (มัธยฐาน วัน)', semester.label, 'จำนวนใบที่รู้เวลา', previous?.label ?? 'ภาคก่อน', 'จำนวนใบที่รู้เวลา']
      .map(csvCell)
      .join(',');
    const durs = data.durations.map((d) =>
      [d.label, d.current_median_days, d.current_n, d.previous_median_days, d.previous_n].map(csvCell).join(',')
    );
    const csv = '﻿' + [head, ...rows, '', durHead, ...durs].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `สรุปภาคเรียน-${semester.semester_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 page-enter" data-testid="semester-summary">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">สรุปภาคเรียน</h1>
          <p className="max-w-2xl text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
            ตัวเลขของภาคที่เลือกเทียบกับภาคก่อนหน้า และเวลาที่ใช้ในแต่ละขั้น — คำนวณสดจากข้อมูลจริง ภาคที่ปิดแล้วก็อ่านย้อนหลังได้
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            aria-label="เลือกภาคเรียน"
            value={semesterId || String(semester?.semester_id ?? '')}
            onChange={(e) => setSemesterId(e.target.value)}
            data-testid="summary-semester"
            className="!w-auto"
          >
            {data.semesters.map((s) => (
              <option key={s.semester_id} value={s.semester_id}>
                {s.label}
                {s.is_active ? ' (เปิดอยู่)' : s.closed ? ' (ปิดแล้ว)' : ''}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!semester} data-testid="summary-export">
            ส่งออก CSV
          </Button>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />

      {!semester ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          ยังไม่มีภาคเรียนในระบบ — สร้างที่เมนู “ภาคเรียน”
        </p>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <table className="w-full border-collapse text-left text-sm" data-testid="summary-metrics">
              <thead className="bg-gray-50 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                <tr>
                  <th className="p-3 font-semibold">ตัวชี้วัด</th>
                  <th className="p-3 text-right font-semibold">{semester.label}</th>
                  <th className="p-3 text-right font-semibold">{previous ? previous.label : 'ภาคก่อน'}</th>
                  <th className="p-3 text-right font-semibold">เปลี่ยนแปลง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.metrics.map((m) => (
                  <tr key={m.key} data-testid={`summary-metric-${m.key}`}>
                    <td className="p-3">
                      <span className="block font-semibold text-gray-900 dark:text-white">{m.label}</span>
                      {m.hint && <span className="block text-xs text-gray-600 dark:text-gray-400">{m.hint}</span>}
                    </td>
                    <td className="p-3 text-right text-base font-extrabold tabular-nums text-gray-900 dark:text-white" data-testid={`summary-current-${m.key}`}>
                      {fmt(m.current, m.unit)}
                    </td>
                    <td className="p-3 text-right tabular-nums text-gray-700 dark:text-gray-300" data-testid={`summary-previous-${m.key}`}>
                      {previous ? fmt(m.previous, m.unit) : '—'}
                    </td>
                    <td className="p-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {previous ? deltaText(delta(m.current, m.previous), m.unit) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!previous && (
              <p className="border-t border-gray-100 p-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                ภาคนี้เป็นภาคแรกในระบบ — ไม่มีภาคก่อนให้เทียบ
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="p-4 pb-2">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">เวลาที่ใช้ในแต่ละขั้น</h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                มัธยฐานของใบที่ระบบรู้เวลาทั้งต้นและปลายขั้น · “n” คือจำนวนใบที่นับได้ — ใบเก่าที่เกิดก่อนระบบเริ่มเก็บเวลาจะไม่ถูกนับ ไม่ได้ถูกเดาเป็น 0
              </p>
            </div>
            <table className="w-full border-collapse text-left text-sm" data-testid="summary-durations">
              <thead className="bg-gray-50 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                <tr>
                  <th className="p-3 font-semibold">ขั้น</th>
                  <th className="p-3 text-right font-semibold">{semester.label}</th>
                  <th className="p-3 text-right font-semibold">{previous ? previous.label : 'ภาคก่อน'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.durations.map((d) => (
                  <tr key={d.key} data-testid={`summary-duration-${d.key}`}>
                    <td className="p-3 text-gray-900 dark:text-white">{d.label}</td>
                    <td className="p-3 text-right tabular-nums text-gray-900 dark:text-white" data-testid={`summary-duration-current-${d.key}`}>
                      <span className="font-bold">{fmtDays(d.current_median_days)}</span>
                      <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">(n={d.current_n})</span>
                    </td>
                    <td className="p-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {previous ? (
                        <>
                          {fmtDays(d.previous_median_days)}
                          <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">(n={d.previous_n})</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
};

export default SemesterSummary;
