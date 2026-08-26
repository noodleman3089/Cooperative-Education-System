/**
 * ป้ายภาษาไทยของแบบประเมินสองใบที่พนักงานที่ปรึกษา (พี่เลี้ยง) เป็นผู้กรอก
 *
 * ⚠️ **รายชื่อคีย์ต้องตรงกับ `backend/src/config/evaluationRubric.ts` เป๊ะ**
 * ไฟล์นั้นเก็บ *กติกา* (คีย์ · เพดานคะแนน · ค่า enum) ส่วนไฟล์นี้เก็บ *ป้ายที่ผู้ใช้เห็น*
 * แยกกันเพราะ backend ต้อง validate ได้เองแบบ fail closed และ frontend ไม่ควรต้อง
 * ยิง API เพิ่มอีกหนึ่งคำขอเพียงเพื่อขอ array ที่ไม่เคยเปลี่ยน (ฟอร์มปรับปรุงล่าสุด
 * 30 เม.ย. 57)
 *
 * อยู่ที่ `config/` ไม่ใช่ `pages/Company/` เพราะมีผู้อ่านสองฝั่งแล้ว — หน้าที่พี่เลี้ยง
 * กรอก (`pages/Company/MentorEvaluation.tsx`) และหน้าที่นักศึกษาดูผลของตัวเอง
 * (`pages/Student/EvaluationResult.tsx`)
 *
 * พิมพ์คีย์ผิดเมื่อไหร่ backend ตอบ 400 พร้อมชื่อคีย์ทันทีที่กดส่ง — ดังกัง ไม่เงียบ
 * **เพิ่ม/ลบข้อที่นี่ ต้องแก้ฝั่ง backend ด้วยเสมอ**
 */

export interface RubricItem {
  key: string;
  /** เลขข้อบนกระดาษ เช่น "1.1" — ใช้บอกผู้ใช้ว่าข้อไหนยังไม่ได้ให้คะแนน */
  no: string;
  label: string;
  desc?: string;
  max: number;
}

export interface RubricSection {
  no: number;
  title: string;
  max: number;
  items: RubricItem[];
}

/** สหกิจ 15 — 18 ข้อ 4 หมวด รวม 100 คะแนน */
export const SAHATKIT_15_SECTIONS: RubricSection[] = [
  {
    no: 1,
    title: 'ผลสำเร็จของงาน (Work Achievement)',
    max: 20,
    items: [
      {
        key: 'work_quantity',
        no: '1.1',
        label: 'ปริมาณงาน (Quantity of work)',
        desc: 'ปริมาณงานที่ปฏิบัติสำเร็จตามหน้าที่หรือตามที่ได้รับมอบหมายภายในระยะเวลาที่กำหนด',
        max: 10,
      },
      {
        key: 'work_quality',
        no: '1.2',
        label: 'คุณภาพงาน (Quality of work)',
        desc: 'ผลงานถูกต้องครบถ้วนสมบูรณ์ ประณีตเรียบร้อย งานไม่ติดค้าง เสร็จทันเวลาหรือก่อนกำหนด',
        max: 10,
      },
    ],
  },
  {
    no: 2,
    title: 'ความรู้ความสามารถ (Knowledge and Ability)',
    max: 40,
    items: [
      {
        key: 'academic_ability',
        no: '2.1',
        label: 'ความรู้ความสามารถทางวิชาการ (Academic ability)',
        desc: 'มีความรู้ทางวิชาการเพียงพอที่จะทำงานตามที่ได้รับมอบหมาย',
        max: 5,
      },
      {
        key: 'learn_and_apply',
        no: '2.2',
        label: 'ความสามารถในการเรียนรู้และประยุกต์วิชาการ (Ability to learn and apply knowledge)',
        desc: 'ความรวดเร็วในการเรียนรู้ เข้าใจข้อมูลข่าวสารและวิธีทำงาน และนำความรู้ไปประยุกต์ใช้',
        max: 5,
      },
      {
        key: 'practical_ability',
        no: '2.3',
        label: 'ความรู้ความชำนาญด้านปฏิบัติการ (Practical ability)',
        desc: 'หลังสอนงานครั้งแรก ครั้งต่อไปปฏิบัติงานได้ถูกต้องโดยไม่ต้องคุมงาน',
        max: 5,
      },
      {
        key: 'judgment_decision',
        no: '2.4',
        label: 'วิจารณญาณและการตัดสินใจ (Judgment and decision making)',
        desc: 'วิเคราะห์ข้อมูลและปัญหาอย่างรอบคอบ แก้ปัญหาเฉพาะหน้าได้ดี ไว้วางใจให้ตัดสินใจเองได้',
        max: 5,
      },
      {
        key: 'organization_planning',
        no: '2.5',
        label: 'การจัดการและวางแผน (Organization and planning)',
        desc: 'จัดลำดับความสำคัญของงานและวางแผนดำเนินงานได้อย่างมีประสิทธิภาพ',
        max: 5,
      },
      {
        key: 'communication_skills',
        no: '2.6',
        label: 'ทักษะการสื่อสาร (Communication skills)',
        desc: 'พูด เขียน และนำเสนอได้ชัดเจน ถูกต้อง รัดกุม รู้จักสอบถามและชี้แจงผลการปฏิบัติงาน',
        max: 5,
      },
      {
        key: 'foreign_language_culture',
        no: '2.7',
        label: 'การพัฒนาด้านภาษาและวัฒนธรรมต่างประเทศ (Foreign language and cultural development)',
        desc: 'ใช้ภาษาต่างประเทศในการปฏิบัติงานและติดต่อสื่อสาร ปรับตัวเข้ากับการทำงานกับชาวต่างประเทศ',
        max: 5,
      },
      {
        key: 'job_suitability',
        no: '2.8',
        label: 'ความเหมาะสมต่อตำแหน่งงานที่ได้รับมอบหมาย (Suitability for job position)',
        desc: 'พัฒนาตนเองให้ปฏิบัติงานตามตำแหน่งงานและลักษณะงานที่ได้รับมอบหมายได้อย่างเหมาะสม',
        max: 5,
      },
    ],
  },
  {
    no: 3,
    title: 'ความรับผิดชอบต่อหน้าที่',
    max: 20,
    items: [
      {
        key: 'responsibility_dependability',
        no: '3.1',
        label: 'ความรับผิดชอบและเป็นผู้ที่ไว้วางใจได้ (Responsibility and dependability)',
        desc: 'ทำงานให้สำเร็จโดยคำนึงถึงเป้าหมาย ยอมรับผลอย่างมีเหตุผล ไว้วางใจให้รับงานที่ยากขึ้นได้',
        max: 5,
      },
      {
        key: 'interest_in_work',
        no: '3.2',
        label: 'ความสนใจ อุตสาหะในการทำงาน (Interest in work)',
        desc: 'กระตือรือร้น มีความอุตสาหะ ตั้งใจทำงานให้สำเร็จ ไม่ย่อท้อต่อปัญหาและอุปสรรค',
        max: 5,
      },
      {
        key: 'initiative_self_starter',
        no: '3.3',
        label: 'ความสามารถเริ่มต้นทำงานได้ด้วยตนเอง (Initiative or self starter)',
        desc: 'เริ่มทำงานได้เองโดยไม่ต้องรอคำสั่ง เสนอตัวขอเข้าช่วยงานนอกเหนือจากงานประจำ',
        max: 5,
      },
      {
        key: 'response_to_supervision',
        no: '3.4',
        label: 'การตอบสนองต่อการสั่งการ (Response to supervision)',
        desc: 'ยินดีรับคำสั่ง คำแนะนำ คำวิจารณ์ และปรับตัวตามข้อเสนอแนะได้รวดเร็ว',
        max: 5,
      },
    ],
  },
  {
    no: 4,
    title: 'ลักษณะส่วนบุคคล (Personality)',
    max: 20,
    items: [
      {
        key: 'personality',
        no: '4.1',
        label: 'บุคลิกภาพและการวางตัว (Personality)',
        desc: 'ทัศนคติดี มีวุฒิภาวะ อ่อนน้อมถ่อมตน แต่งกายสุภาพ ตรงต่อเวลา ปรับตัวเข้ากับองค์กรได้',
        max: 5,
      },
      {
        key: 'interpersonal_skills',
        no: '4.2',
        label: 'มนุษยสัมพันธ์ (Interpersonal skills)',
        desc: 'ร่วมงานกับผู้อื่นและทำงานเป็นทีมได้ดี ช่วยก่อให้เกิดความร่วมมือประสานงาน',
        max: 5,
      },
      {
        key: 'discipline_adaptability',
        no: '4.3',
        label: 'ความมีระเบียบวินัย ปฏิบัติตามวัฒนธรรมขององค์กร (Discipline and adaptability)',
        desc: 'ปฏิบัติตามระเบียบบริหารงานบุคลากร กฎความปลอดภัย และการควบคุมคุณภาพ 5 ส.',
        max: 5,
      },
      {
        key: 'ethics_morality',
        no: '4.4',
        label: 'คุณธรรมและจริยธรรม (Ethics and morality)',
        desc: 'ซื่อสัตย์สุจริต มีจิตสาธารณะ รู้จักเสียสละ ช่วยเหลือผู้อื่น และรักษาความลับขององค์กร',
        max: 5,
      },
    ],
  },
];

export const SAHATKIT_15_ITEMS: RubricItem[] = SAHATKIT_15_SECTIONS.flatMap((s) => s.items);

/** สหกิจ 16 — 14 ข้อ ระดับ 1-5 รวม 70 คะแนน */
export const SAHATKIT_16_ITEMS: RubricItem[] = [
  { key: 'topic_selection', no: '1', label: 'เลือกหัวข้อมีความเหมาะสมในระดับใด', max: 5 },
  { key: 'chapter1', no: '2', label: 'เนื้อหารายละเอียดบทที่ 1', max: 5 },
  { key: 'chapter2', no: '3', label: 'เนื้อหารายละเอียดบทที่ 2', max: 5 },
  { key: 'chapter3', no: '4', label: 'เนื้อหารายละเอียดบทที่ 3', max: 5 },
  { key: 'chapter4', no: '5', label: 'เนื้อหารายละเอียดบทที่ 4', max: 5 },
  { key: 'content_overall', no: '6', label: 'ความเหมาะสมของเนื้อหาโดยภาพรวม', max: 5 },
  { key: 'language_use', no: '7', label: 'การใช้ภาษามีความเหมาะสม', max: 5 },
  { key: 'table_of_contents', no: '8', label: 'ความสมบูรณ์ของรายงาน ในส่วนสารบัญ', max: 5 },
  {
    key: 'bibliography_citation',
    no: '9',
    label: 'ความสมบูรณ์ของรายงาน ในส่วนบรรณานุกรม การอ้างอิง',
    max: 5,
  },
  { key: 'completeness', no: '10', label: 'ความสมบูรณ์ของรายงาน', max: 5 },
  { key: 'format_correctness', no: '11', label: 'ความถูกต้องของรูปแบบที่กำหนด', max: 5 },
  { key: 'time_appropriateness', no: '12', label: 'ความเหมาะสมของระยะเวลาในการทำรายงาน', max: 5 },
  { key: 'illustrations', no: '13', label: 'การใช้ภาพประกอบสอดคล้องกับเนื้อหา', max: 5 },
  { key: 'overall_report', no: '14', label: 'โดยภาพรวมของการจัดทำรายงานสหกิจ', max: 5 },
];

/** คำอธิบายมาตรวัดของ สหกิจ 16 ตามที่พิมพ์อยู่บนกระดาษ */
export const SAHATKIT_16_SCALE = '5 = เหมาะสมที่สุด · 4 = เหมาะสมมาก · 3 = เหมาะสมปานกลาง · 2 = เหมาะสมน้อย · 1 = เหมาะสมน้อยที่สุด';

export const WOULD_HIRE_CHOICES = [
  { value: 'accept', label: 'รับ / Yes' },
  { value: 'unsure', label: 'ไม่แน่ใจ / Not sure' },
  { value: 'reject', label: 'ไม่รับ / No' },
] as const;
