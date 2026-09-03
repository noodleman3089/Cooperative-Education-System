import React, { useEffect, useState } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import api from '../../services/api';
import { getErrorMessage } from '../../utils/errors';

/**
 * สหกิจ 13 — แบบบันทึกการนิเทศงานสหกิจศึกษา (อาจารย์นิเทศเป็นผู้กรอก)
 *
 * ⛔ **ระบบล้วน ไม่มีปุ่มพิมพ์** — เจ้าของเคาะ 2026-09-02 (*"ระบบมันก็เหมือนซองปิดผนึก
 * ลับอยู่แล้ว"*) และคู่มือหน้า 51 ข้อ 8 ระบุว่าคณะเป็นคนปริ้นใบ 13/15 ให้นักศึกษาเอง
 *
 * ⛔ **หัวข้อทั้ง 37 ข้อมาจากเซิร์ฟเวอร์** (`GET /supervision-records/form`)
 * หน้าจอไม่ประกาศซ้ำ — แหล่งความจริงเดียวคือ `config/supervisionRubric.ts`
 * (บรรทัดฐานเดียวกับปฏิทินสหกิจที่ส่ง label มาจากเซิร์ฟเวอร์)
 *
 * ⛔ **ไม่บังคับให้ตอบครบทุกข้อ** — ต่างจากฟอร์ม สหกิจ 15/16 ที่บังคับครบ
 * เพราะสเกลของใบนี้มี `-` (ไม่มีข้อมูล/ไม่ประเมิน) ซึ่งเป็นคำตอบที่ถูกต้องได้จริง
 */

interface RubricItem {
  key: string;
  label: string;
}
interface RubricGroup {
  heading: string;
  items: RubricItem[];
}
interface FormMeta {
  scale: Record<string, string>;
  visits: number[];
  company_section: RubricGroup[];
  student_section: RubricGroup[];
  document_items: RubricItem[];
}

interface SupervisedStudent {
  student_id: number;
  student_code?: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}

interface SavedRecord {
  record_id: number;
  visit_number: number;
  visit_date: string;
  scores: Record<string, number | null>;
  remarks: Record<string, string> | null;
  documents_required: Record<string, boolean> | null;
  additional_notes: string | null;
  submitted_at: string;
  supervisor_first_name: string | null;
  supervisor_last_name: string | null;
}

/** ตัวเลือกบนกระดาษเรียง 5→1 แล้วปิดท้ายด้วย `-` */
const SCORE_CHOICES = ['5', '4', '3', '2', '1', '-'];

const SupervisionRecord: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [students, setStudents] = useState<SupervisedStudent[]>([]);
  const [studentId, setStudentId] = useState<number | ''>('');
  const [visitNumber, setVisitNumber] = useState(1);
  const [visitDate, setVisitDate] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [documents, setDocuments] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState<SavedRecord[]>([]);

  const bootstrap = async () => {
    try {
      const [formMeta, list] = await Promise.all([
        api.get('/supervision-records/form'),
        api.get('/personnel/supervised-students').catch(() => []),
      ]);
      setMeta(formMeta);
      // นักศึกษาคนเดียวกันอาจมีหลายแถว (หลายใบความจำนง) — ยุบให้เหลือคนละแถว
      const unique = new Map<number, SupervisedStudent>();
      for (const row of (list || []) as SupervisedStudent[]) {
        if (!unique.has(row.student_id)) unique.set(row.student_id, row);
      }
      setStudents([...unique.values()]);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถเปิดแบบบันทึกการนิเทศได้'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // โหลดครั้งเดียวตอนเปิดหน้า · ไม่ต้องปิดกฎ `set-state-in-effect` ที่นี่เพราะ
    // `bootstrap()` เริ่มด้วย `await` ทันที ไม่มี setState แบบซิงโครนัสในตัว effect
    bootstrap();
  }, []);

  /** ดึงบันทึกเดิมของนักศึกษาคนที่เลือก แล้วเติมลงฟอร์มถ้าเคยบันทึกครั้งนี้ไว้ */
  const loadStudentRecords = async (id: number, visit: number) => {
    try {
      const rows: SavedRecord[] = await api.get(`/supervision-records/student/${id}`);
      setSaved(rows);
      const current = rows.find((r) => r.visit_number === visit);
      if (current) {
        const nextScores: Record<string, string> = {};
        for (const [key, value] of Object.entries(current.scores || {})) {
          nextScores[key] = value === null ? '-' : String(value);
        }
        setScores(nextScores);
        setRemarks(current.remarks || {});
        setDocuments(current.documents_required || {});
        setNotes(current.additional_notes || '');
        setVisitDate(current.visit_date || '');
      } else {
        setScores({});
        setRemarks({});
        setDocuments({});
        setNotes('');
        setVisitDate('');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถดึงบันทึกเดิมได้'));
    }
  };

  const pickStudent = async (value: string) => {
    const id = value ? Number(value) : '';
    setStudentId(id);
    setSuccess(null);
    setError(null);
    if (id !== '') await loadStudentRecords(id, visitNumber);
  };

  const pickVisit = async (value: number) => {
    setVisitNumber(value);
    setSuccess(null);
    if (studentId !== '') await loadStudentRecords(studentId, value);
  };

  const handleSubmit = async () => {
    if (studentId === '') {
      setError('กรุณาเลือกนักศึกษาที่ไปนิเทศ');
      return;
    }
    if (!visitDate) {
      setError('กรุณาระบุวันที่นิเทศ');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // `-` บนหน้าจอ = null ในฐาน (ไม่ประเมิน ไม่ใช่ 0) · ช่องที่ยังไม่แตะไม่ต้องส่ง
      const payloadScores: Record<string, number | null> = {};
      for (const [key, value] of Object.entries(scores)) {
        if (value === '') continue;
        payloadScores[key] = value === '-' ? null : Number(value);
      }

      const res = await api.put(`/supervision-records/student/${studentId}`, {
        visit_number: visitNumber,
        visit_date: visitDate,
        scores: payloadScores,
        remarks,
        documents_required: documents,
        additional_notes: notes,
      });
      setSuccess(res.message || 'บันทึกเรียบร้อยแล้ว');
      await loadStudentRecords(studentId, visitNumber);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกการนิเทศได้'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSkeleton variant="form" />;

  const scoreRow = (item: RubricItem) => (
    <div
      key={item.key}
      data-testid="sv-item"
      className="grid grid-cols-1 gap-2 border-b border-gray-100 py-3 last:border-0 sm:grid-cols-12 sm:items-center dark:border-gray-800"
    >
      <label
        htmlFor={`sv-score-${item.key}`}
        className="text-xs text-gray-700 sm:col-span-7 dark:text-gray-300"
      >
        {item.label}
      </label>
      <div className="sm:col-span-2">
        <Select
          id={`sv-score-${item.key}`}
          size="sm"
          data-testid={`sv-score-${item.key}`}
          value={scores[item.key] ?? ''}
          onChange={(e) => setScores((s) => ({ ...s, [item.key]: e.target.value }))}
        >
          <option value="">ยังไม่เลือก</option>
          {SCORE_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </Select>
      </div>
      <div className="sm:col-span-3">
        <Input
          size="sm"
          aria-label={`หมายเหตุของ ${item.label}`}
          data-testid={`sv-remark-${item.key}`}
          placeholder="หมายเหตุ"
          value={remarks[item.key] || ''}
          onChange={(e) => setRemarks((r) => ({ ...r, [item.key]: e.target.value }))}
        />
      </div>
    </div>
  );

  const section = (title: string, note: string, groups: RubricGroup[]) => (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-lg font-bold text-gray-800 dark:text-white">{title}</h3>
      <p className="mb-4 text-xs text-gray-600 dark:text-gray-400">{note}</p>
      {groups.map((group) => (
        <div key={group.heading} className="mb-4">
          <p className="mb-1 text-xs font-bold text-gray-800 dark:text-gray-200">{group.heading}</p>
          {group.items.map(scoreRow)}
        </div>
      ))}
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">
          แบบบันทึกการนิเทศงานสหกิจศึกษา (สหกิจ 13)
        </h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          บันทึกอยู่ในระบบอย่างเดียว ไม่ต้องพิมพ์ — คณะเป็นผู้จัดพิมพ์เอกสารให้นักศึกษาเอง
          · <strong>ข้อไหนไม่มีข้อมูลให้เลือก “-”</strong> ไม่ต้องตอบครบทุกข้อ
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* หัวใบ */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="sv-student" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              นักศึกษาที่ไปนิเทศ
            </label>
            <Select
              id="sv-student"
              data-testid="sv-student"
              value={studentId === '' ? '' : String(studentId)}
              onChange={(e) => pickStudent(e.target.value)}
            >
              <option value="">-- เลือกนักศึกษา --</option>
              {students.map((s) => (
                <option key={s.student_id} value={s.student_id}>
                  {[s.first_name, s.last_name].filter(Boolean).join(' ')} ({s.student_code})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="sv-visit" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              การนิเทศครั้งที่
            </label>
            <Select
              id="sv-visit"
              data-testid="sv-visit"
              value={String(visitNumber)}
              onChange={(e) => pickVisit(Number(e.target.value))}
            >
              {(meta?.visits || [1, 2]).map((v) => (
                <option key={v} value={v}>
                  ครั้งที่ {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="sv-date" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              วันที่นิเทศ
            </label>
            <Input
              id="sv-date"
              type="date"
              data-testid="sv-date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </div>
        </div>

        {saved.length > 0 && (
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-400" data-testid="sv-saved-summary">
            บันทึกไว้แล้ว:{' '}
            {saved
              .map(
                (r) =>
                  `ครั้งที่ ${r.visit_number} (${r.visit_date}) โดย ${[r.supervisor_first_name, r.supervisor_last_name].filter(Boolean).join(' ')}`
              )
              .join(' · ')}
          </p>
        )}
      </section>

      {meta && studentId !== '' && (
        <>
          {section(
            'ส่วนที่ 1 — ประเมินสถานประกอบการ',
            'ความเห็นของอาจารย์นิเทศต่อสถานประกอบการ · สถานประกอบการไม่มีทางเห็นส่วนนี้',
            meta.company_section
          )}

          {section(
            'ส่วนที่ 2 — ประเมินนักศึกษา',
            'ความเห็นของอาจารย์นิเทศต่อตัวนักศึกษา',
            meta.student_section
          )}

          {/* เอกสารที่อาจารย์สั่งให้นักศึกษาส่ง */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-lg font-bold text-gray-800 dark:text-white">
              เอกสารที่นักศึกษาต้องส่ง
            </h3>
            <p className="mb-4 text-xs text-gray-600 dark:text-gray-400">
              ติ๊กเฉพาะที่ท่านต้องการให้นักศึกษาดำเนินการ — เป็นดุลยพินิจของอาจารย์ผู้นิเทศ
              ไม่ใช่สถานะที่ระบบคำนวณเอง
            </p>
            <div className="space-y-2">
              {meta.document_items.map((doc) => (
                <label
                  key={doc.key}
                  className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300"
                >
                  <input
                    type="checkbox"
                    data-testid={`sv-doc-${doc.key}`}
                    checked={documents[doc.key] === true}
                    onChange={(e) =>
                      setDocuments((d) => ({ ...d, [doc.key]: e.target.checked }))
                    }
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700"
                  />
                  <span>{doc.label}</span>
                </label>
              ))}
            </div>

            <div className="mt-6">
              <label htmlFor="sv-notes" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                ข้อมูลเพิ่มเติม
              </label>
              <Textarea
                id="sv-notes"
                data-testid="sv-notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </section>

          <div className="flex justify-end pb-8">
            <Button data-testid="sv-submit" loading={saving} onClick={handleSubmit}>
              บันทึกการนิเทศครั้งที่ {visitNumber}
            </Button>
          </div>
        </>
      )}

      {studentId === '' && (
        <AlertBanner
          variant="info"
          message="เลือกนักศึกษาด้านบนเพื่อเริ่มบันทึกการนิเทศ"
        />
      )}
    </div>
  );
};

export default SupervisionRecord;
