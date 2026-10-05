import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';

/**
 * รายชื่อรุ่นของภาคเรียนหนึ่ง — ดู · ถอดคนที่ใส่ผิด · ยกยอดจากภาคก่อน (เฟส 1 R1-2)
 *
 * ⛔ รายชื่อนี้ไม่ใช่การตัดสินสิทธิ์ (SEC-02) — เป็นตัวหารของแดชบอร์ด "นักศึกษาตอนนี้" เท่านั้น
 * ⛔ ถอดได้เฉพาะคนที่ยังไม่มีใบคำร้องในภาคนี้ (ปุ่มถูกปิดพร้อมเหตุผล ไม่ซ่อน) — เซิร์ฟเวอร์ตัดสินซ้ำอีกชั้น
 * ⛔ ยกยอด = เจ้าหน้าที่กดเอง · ไม่แตะใบหรือรายชื่อของภาคเดิม · เอาเฉพาะคนที่ภาคเดิมไม่ได้ที่ฝึก (ไม่ยื่น/บริษัทไม่รับ)
 */

interface Member {
  student_code: string;
  source: 'import' | 'carry_over';
  first_name: string | null;
  last_name: string | null;
  major_name_th: string | null;
  has_form: boolean;
}

interface Props {
  semester: { semester_id: number; label: string };
  /** ภาคทั้งหมดเรียงใหม่→เก่า (ใช้เลือกภาคต้นทางของการยกยอด) */
  all: { semester_id: number; label: string }[];
  onClose: () => void;
  onChanged: () => void;
}

const SemesterCohortModal: React.FC<Props> = ({ semester, all, onClose, onChanged }) => {
  const sources = all.filter((s) => s.semester_id !== semester.semester_id);
  // ค่าเริ่มต้น = ภาคที่อยู่ถัดจากภาคนี้ในลำดับ (ภาคก่อนหน้า)
  const idx = all.findIndex((s) => s.semester_id === semester.semester_id);
  const [from, setFrom] = useState<string>(String(all[idx + 1]?.semester_id ?? sources[0]?.semester_id ?? ''));
  const [members, setMembers] = useState<Member[] | null>(null);
  const [candidates, setCandidates] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = (await api.get(`/semesters/${semester.semester_id}/cohort`)) as { members: Member[] };
      setMembers(res.members);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดรายชื่อรุ่นได้'));
    }
  }, [semester.semester_id]);

  const loadCandidates = useCallback(async () => {
    if (!from) {
      setCandidates(null);
      return;
    }
    try {
      const res = (await api.get(`/semesters/${semester.semester_id}/cohort/carry-over?from=${from}`)) as { candidates: number };
      setCandidates(res.candidates);
    } catch {
      setCandidates(null);
    }
  }, [semester.semester_id, from]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCandidates();
  }, [loadCandidates]);

  const remove = async (code: string) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.delete(`/semesters/${semester.semester_id}/cohort/${encodeURIComponent(code)}`);
      setSuccess(`ถอด ${code} ออกจากรายชื่อรุ่นแล้ว`);
      await Promise.all([load(), loadCandidates()]);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'ถอดรายชื่อไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const carryOver = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = (await api.post(`/semesters/${semester.semester_id}/cohort/carry-over`, { from_semester_id: Number(from) })) as {
        added: number;
      };
      setSuccess(`ยกยอดเข้ารุ่นแล้ว ${res.added} คน`);
      await Promise.all([load(), loadCandidates()]);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'ยกยอดไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const fromLabel = sources.find((s) => String(s.semester_id) === from)?.label ?? '';

  return (
    <Modal onClose={onClose} size="3xl" title={`รายชื่อรุ่น · ${semester.label}`}>
      <ModalBody className="space-y-4">
        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={success} />

        <section className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">ยกยอดจากภาคก่อน</h3>
          <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            เอานักศึกษาที่ภาคเดิมยังไม่ได้ที่ฝึก (ไม่ได้ยื่น หรือบริษัทไม่รับ/คำร้องไม่ผ่าน) เข้ารุ่นของภาคนี้ · ไม่ยกคนที่ยังมีใบเดินอยู่หรือได้ที่ฝึกแล้ว ·
            ไม่แตะใบหรือรายชื่อของภาคเดิม
          </p>
          {sources.length === 0 ? (
            <p className="text-xs text-gray-600 dark:text-gray-400">ยังไม่มีภาคอื่นให้ยกยอด</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                size="sm"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="ภาคต้นทางของการยกยอด"
                data-testid="cohort-carry-from"
                className="!w-auto"
              >
                {sources.map((s) => (
                  <option key={s.semester_id} value={s.semester_id}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                onClick={carryOver}
                loading={busy}
                disabled={!from || candidates === 0}
                data-testid="cohort-carry-submit"
              >
                {candidates === null ? 'ยกยอด' : `ยกยอด ${candidates} คน`}
              </Button>
              {candidates === 0 && (
                <span className="text-xs text-gray-600 dark:text-gray-400" data-testid="cohort-carry-none">
                  ไม่มีใครต้องยกยอดจาก {fromLabel}
                </span>
              )}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-white" data-testid="cohort-count">
            {members === null ? 'กำลังโหลด…' : `ในรุ่น ${members.length} คน`}
          </h3>
          <div className="max-h-[45vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <tr>
                  <th className="p-2.5 font-semibold">รหัสนักศึกษา</th>
                  <th className="p-2.5 font-semibold">ชื่อ</th>
                  <th className="p-2.5 font-semibold">สาขา</th>
                  <th className="p-2.5 font-semibold">ที่มา</th>
                  <th className="p-2.5 text-right font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {members?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-gray-600 dark:text-gray-400">
                      ยังไม่มีรายชื่อ — นำเข้าที่เมนู “รายชื่อนักศึกษา &amp; เกรด” หรือยกยอดจากภาคก่อน
                    </td>
                  </tr>
                )}
                {members?.map((m) => (
                  <tr key={m.student_code} data-testid={`cohort-row-${m.student_code}`} className="text-gray-800 dark:text-gray-200">
                    <td className="p-2.5 font-mono">{m.student_code}</td>
                    <td className="p-2.5">{[m.first_name, m.last_name].filter(Boolean).join(' ') || 'ยังไม่เข้าระบบ'}</td>
                    <td className="p-2.5">{m.major_name_th ?? '—'}</td>
                    <td className="p-2.5">{m.source === 'carry_over' ? 'ยกยอด' : 'นำเข้า'}</td>
                    <td className="p-2.5 text-right">
                      {m.has_form ? (
                        <span className="text-gray-600 dark:text-gray-400" data-testid={`cohort-locked-${m.student_code}`}>
                          มีใบคำร้องแล้ว
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => remove(m.student_code)}
                          data-testid={`cohort-remove-${m.student_code}`}
                        >
                          ถอดออก
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          ปิด
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default SemesterCohortModal;
