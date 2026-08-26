import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFFont, PDFPage, RGB, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * เอกสารราชการภาษาไทย วาดเองด้วย `pdf-lib` — ไม่ต้องมีแม่แบบและไม่ต้องมีเบราว์เซอร์
 *
 * ต้นแบบมาจากตัวสร้างใบยินยอมผู้ปกครองเดิม (`git show 4926474^:backend/src/index.ts`
 * บรรทัด 148-190) ซึ่งถูกลบไปพร้อมใบยินยอม · **ของเดิมใช้พิกัดคงที่ทั้งไฟล์**
 * (`y: 770, 740, 660, 450 …`) ซึ่งใช้ได้เฉพาะกับเอกสารที่เนื้อหายาวเท่ากันทุกใบ
 *
 * ⛔ คลาสนี้ตั้งใจให้ **ไม่มีใครต้องนับพิกัดเอง** — เขียนบรรทัดแล้ว cursor เลื่อนลงเอง
 * และ `cursorY` อ่านได้ตลอดเวลา นี่คือเหตุผลที่มันมีอยู่: จุดวางลายเซ็นคณบดีต้องมา
 * จากบรรทัดสุดท้ายจริง ไม่ใช่ตัวเลขที่เดาไว้ล่วงหน้า ที่อยู่สถานประกอบการยาว 3 บรรทัด
 * แทน 1 เมื่อไหร่ ลายเซ็นที่ใช้พิกัดตายตัวจะไปทับข้อความทันที
 */

const A4: [number, number] = [595.28, 841.89];
const FONT_PATH = () => path.join(process.cwd(), 'secure_private', 'fonts', 'Srabun-Regular.ttf');

export interface ThaiPdfOptions {
  /** ระยะขอบซ้าย-ขวา (pt) */
  margin?: number;
  /** ระยะขอบบน (pt) */
  top?: number;
  /** ขอบล่างที่ห้ามเขียนล้ำ — ถึงตรงนี้แล้วขึ้นหน้าใหม่ */
  bottom?: number;
}

export class ThaiPdf {
  private constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly opts: Required<ThaiPdfOptions>
  ) {
    this.page = doc.addPage(A4);
    this.y = A4[1] - this.opts.top;
  }

  private page: PDFPage;
  private y: number;

  static async create(options: ThaiPdfOptions = {}): Promise<ThaiPdf> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);

    const fontPath = FONT_PATH();
    if (!fs.existsSync(fontPath) || fs.statSync(fontPath).size === 0) {
      // ฟอนต์หายคือปัญหาที่ต้องแก้ที่การติดตั้ง ไม่ใช่ปล่อยให้ออกเอกสารที่อ่านไม่ออก
      // (pdf-lib จะ throw ตอน drawText ภาษาไทยด้วยฟอนต์มาตรฐานอยู่แล้ว — ข้อความนี้
      //  บอกสาเหตุจริงแทนที่จะเป็น 'WinAnsi cannot encode')
      throw new Error(
        `ไม่พบฟอนต์ภาษาไทยสำหรับออกเอกสารที่ ${fontPath} — ตรวจว่าไฟล์ Srabun-Regular.ttf อยู่ครบ`
      );
    }
    const font = await doc.embedFont(fs.readFileSync(fontPath));

    return new ThaiPdf(doc, font, {
      margin: options.margin ?? 70,
      top: options.top ?? 70,
      bottom: options.bottom ?? 70,
    });
  }

  /** ตำแหน่งแนวตั้งปัจจุบัน — ใช้เมื่อต้องวางอะไรต่อจากเนื้อหาจริง */
  get cursorY(): number {
    return this.y;
  }

  get currentPage(): PDFPage {
    return this.page;
  }

  get pageWidth(): number {
    return A4[0];
  }

  /** ขึ้นหน้าใหม่เมื่อพื้นที่ที่ต้องใช้ไม่พอ — เรียกก่อนบล็อกที่ห้ามขาดกลาง */
  ensureSpace(needed: number): void {
    if (this.y - needed < this.opts.bottom) {
      this.page = this.doc.addPage(A4);
      this.y = A4[1] - this.opts.top;
    }
  }

  /** เว้นบรรทัดเปล่า */
  space(amount = 14): void {
    this.y -= amount;
  }

  /**
   * เขียนหนึ่งบรรทัด แล้วเลื่อน cursor ลง
   * @param align ตำแหน่งแนวนอน — `left` ตามขอบ, `center` กลางหน้า, หรือระบุ x เอง
   */
  line(
    text: string,
    options: {
      size?: number;
      align?: 'left' | 'center';
      x?: number;
      gap?: number;
      color?: RGB;
    } = {}
  ): void {
    const size = options.size ?? 15;
    const gap = options.gap ?? size + 9;
    this.ensureSpace(gap);

    const width = this.font.widthOfTextAtSize(text, size);
    const x =
      options.x ??
      (options.align === 'center' ? (A4[0] - width) / 2 : this.opts.margin);

    this.page.drawText(text, {
      x,
      y: this.y,
      size,
      font: this.font,
      color: options.color ?? rgb(0, 0, 0),
    });
    this.y -= gap;
  }

  /**
   * เขียนย่อหน้าที่ตัดบรรทัดเองตามความกว้างจริงของตัวอักษร
   *
   * ตัดด้วยการวัด `widthOfTextAtSize` ไม่ใช่การนับตัวอักษร เพราะภาษาไทยกับตัวเลข
   * กว้างไม่เท่ากัน · **ตัดที่ช่องว่างเท่านั้น** — ภาษาไทยไม่มีช่องว่างระหว่างคำ
   * การตัดกลางคำจะได้ข้อความที่อ่านผิดความหมาย จึงยอมให้บรรทัดยาวเกินขอบเล็กน้อย
   * ดีกว่าตัดคำผิด (ข้อความในหนังสือราชการชุดนี้มีช่องว่างคั่นวลีอยู่แล้ว)
   */
  paragraph(text: string, options: { size?: number; indent?: number } = {}): void {
    const size = options.size ?? 15;
    const indent = options.indent ?? 0;
    const maxWidth = A4[0] - this.opts.margin * 2 - indent;

    const words = text.split(' ');
    let current = '';
    let first = true;

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && this.font.widthOfTextAtSize(candidate, size) > maxWidth) {
        this.line(current, { size, x: this.opts.margin + (first ? indent : 0) });
        current = word;
        first = false;
      } else {
        current = candidate;
      }
    }
    if (current) this.line(current, { size, x: this.opts.margin + (first ? indent : 0) });
  }

  /**
   * วางรูป (ลายเซ็น) โดย **รักษาสัดส่วนเดิม** — กำหนดความสูง ความกว้างคิดตามจริง
   *
   * ของเดิมบังคับ `width: 100, height: 50` ทุกกรณี ลายเซ็นที่สัดส่วนไม่ใช่ 2:1
   * จึงถูกยืดหรือบีบ · คืนความสูงที่ใช้จริงเพื่อให้ผู้เรียกเลื่อน cursor ต่อได้ถูก
   */
  async drawImageKeepingRatio(
    bytes: Buffer,
    options: { x: number; y: number; height: number }
  ): Promise<{ width: number; height: number }> {
    const isPng =
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const image = isPng ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);

    const scaled = image.scale(1);
    const ratio = scaled.width / scaled.height;
    const width = options.height * ratio;

    this.page.drawImage(image, {
      x: options.x,
      y: options.y,
      width,
      height: options.height,
    });
    return { width, height: options.height };
  }

  async save(): Promise<Buffer> {
    return Buffer.from(await this.doc.save());
  }
}
