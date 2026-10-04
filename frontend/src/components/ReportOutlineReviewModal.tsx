import React from 'react';
import { ExternalLink } from 'lucide-react';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import AlertBanner from './ui/AlertBanner';
import { Textarea } from './ui/Input';
import { API_BASE_URL } from '../services/api';

/**
 * โมดัลตรวจโครงร่างรายงาน (สหกิจ 11) — ใช้ร่วมกันระหว่างพี่เลี้ยงกับอาจารย์ที่ปรึกษา
 *
 * เดิมโมดัลนี้ถูกเขียนไว้สองที่ (`AdvisorDashboard` กับ `CompanyDashboard`) ซึ่ง
 * เหมือนกันราว 85% แต่ค่อยๆ ห่างกันขึ้นเรื่อยๆ — ไอคอนเปิดไฟล์ฝั่งหนึ่งใช้ lucide
 * อีกฝั่งเป็น SVG เขียนมือ, ข้อความ label ไม่ตรงกัน, และการแก้เรื่องเดียว
 * (เช่น contrast) ต้องแก้สองที่โดยไม่มีอะไรเตือนว่ามีที่สอง
 *
 * ลำดับการตรวจจริง: นักศึกษาส่ง → `pending_mentor` → พี่เลี้ยงเห็นชอบ →
 * `pending_advisor` → อาจารย์อนุมัติ → `approved` (ตีกลับได้ทั้งสองขั้น)
 * ปุ่มจึงต่างกันตามผู้ตรวจ ส่วนที่เหลือเป็นของเดียวกัน
 */

export interface OutlineForReview {
  outline_id: number;
  student_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  major_name_th?: string | null;
  company_name_th?: string | null;
  latest_file_path?: string | null;
  status?: string;
}

interface ReportOutlineReviewModalProps {
  /** null = ปิดอยู่ */
  outline: OutlineForReview | null;
  reviewer: 'advisor' | 'mentor';
  comment: string;
  onCommentChange: (value: string) => void;
  onClose: () => void;
  onDecision: (decision: 'approve' | 'reject') => void;
  submitting: boolean;
  readOnly?: boolean;
}

/**
 * พี่เลี้ยงกดได้เฉพาะตอนที่โครงร่างอยู่ในขั้นของตัวเองจริงๆ — `reportOutline.ts`
 * ตอบ 400 ให้สถานะอื่นทั้งหมด การเปิดดูย้อนหลังจึงต้องเป็นแบบอ่านอย่างเดียว
 * ไม่ใช่ปุ่มที่กดแล้วได้ error
 */
const mentorStatusMessage: Record<string, string> = {
  pending_advisor:
    'ท่านได้ให้ความเห็นชอบโครงร่างฉบับนี้แล้ว ขณะนี้อยู่ระหว่างการพิจารณาของอาจารย์ที่ปรึกษา',
  approved: 'โครงร่างฉบับนี้ได้รับการอนุมัติสมบูรณ์จากอาจารย์ที่ปรึกษาแล้ว',
  rejected:
    'โครงร่างฉบับนี้ถูกตีกลับให้นักศึกษาแก้ไข เมื่อนักศึกษาส่งฉบับใหม่จะกลับเข้ามาให้ท่านพิจารณาอีกครั้ง',
};

const ReportOutlineReviewModal: React.FC<ReportOutlineReviewModalProps> = ({
  outline,
  reviewer,
  comment,
  onCommentChange,
  onClose,
  onDecision,
  submitting,
  readOnly = false,
}) => {
  if (!outline) return null;

  const isMentor = reviewer === 'mentor';
  const canReview = !readOnly && (isMentor ? outline.status === 'pending_mentor' : true);

  const studentLabel =
    outline.first_name || outline.last_name
      ? `${outline.first_name ?? ''} ${outline.last_name ?? ''}`.trim()
      : outline.student_code;

  return (
    <Modal
      onClose={onClose}
      size="lg"
      closeOnBackdrop={false}
      title={
        isMentor
          ? 'พิจารณาโครงร่างรายงาน (สหกิจ 11)'
          : 'พิจารณาอนุมัติโครงร่างรายงาน (สหกิจ 11)'
      }
    >
      <ModalBody className="space-y-4">
        <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
          <p>
            <span className="font-semibold text-gray-600 dark:text-gray-400">นักศึกษา:</span>{' '}
            {studentLabel} ({outline.student_code})
          </p>
          <p>
            <span className="font-semibold text-gray-600 dark:text-gray-400">สาขาวิชา:</span>{' '}
            {outline.major_name_th}
          </p>
          {/* พี่เลี้ยงรู้อยู่แล้วว่าเป็นบริษัทตัวเอง บรรทัดนี้จึงมีค่าเฉพาะฝั่งอาจารย์ */}
          {!isMentor && outline.company_name_th && (
            <p>
              <span className="font-semibold text-gray-600 dark:text-gray-400">
                สถานประกอบการ:
              </span>{' '}
              {outline.company_name_th}
            </p>
          )}
          {outline.latest_file_path && (
            <div className="pt-2">
              <a
                href={`${API_BASE_URL}/files/${outline.latest_file_path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-blue text-brand-blue dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 font-bold transition-all"
              >
                <ExternalLink className="h-4 w-4" />
                คลิกเพื่อเปิดอ่านไฟล์ PDF โครงร่างรายงาน
              </a>
            </div>
          )}
        </div>

        {!canReview && (
          <AlertBanner
            variant="info"
            message={
              readOnly && outline.status === 'pending_mentor'
                ? 'รอพนักงานที่ปรึกษาเป็นผู้พิจารณาโครงร่างรายงานฉบับนี้'
                : (mentorStatusMessage[outline.status ?? ''] ?? 'โครงร่างฉบับนี้ไม่ได้อยู่ในขั้นตอนที่ท่านพิจารณาได้')
            }
          />
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            {canReview
              ? 'ความคิดเห็น / ข้อแนะนำการแก้ไข (จำเป็นกรณีตีกลับแก้ไข)'
              : 'ความคิดเห็นล่าสุดที่บันทึกไว้'}
          </label>
          <Textarea
            rows={4}
            size="sm"
            readOnly={!canReview}
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            className="read-only:opacity-70"
            placeholder={
              canReview
                ? isMentor
                  ? 'กรอกข้อเสนอแนะในการปรับปรุงหัวข้อ วัตถุประสงค์ หรือโครงสร้างรายงาน...'
                  : 'กรอกคำแนะนำของอาจารย์ที่ปรึกษาเพิ่มเติม...'
                : 'ไม่มีความคิดเห็นบันทึกไว้'
            }
          />
        </div>
      </ModalBody>

      <ModalFooter>
        {canReview ? (
          <>
            <Button
              variant="danger"
              size="sm"
              loading={submitting}
              loadingLabel="กำลังส่งข้อมูล..."
              onClick={() => onDecision('reject')}
            >
              ตีกลับให้นักศึกษาแก้ไข
            </Button>
            <Button
              variant="success"
              size="sm"
              loading={submitting}
              loadingLabel="กำลังส่งข้อมูล..."
              onClick={() => onDecision('approve')}
            >
              {isMentor ? 'อนุมัติและส่งต่ออาจารย์ที่ปรึกษา' : 'อนุมัติโครงร่างรายงาน'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>
            ปิดหน้าต่าง
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default ReportOutlineReviewModal;
