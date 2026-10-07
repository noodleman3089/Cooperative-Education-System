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
export const FONT_PATH = () => path.join(process.cwd(), 'secure_private', 'fonts', 'THSarabunNew.ttf');
export const FONT_BOLD_PATH = () =>
  path.join(process.cwd(), 'secure_private', 'fonts', 'THSarabunNew Bold.ttf');

export interface ThaiPdfOptions {
  /** ระยะขอบซ้าย-ขวา (pt) */
  margin?: number;
  /** ระยะขอบขวา เมื่อไม่เท่าขอบซ้าย (หนังสือราชการ: ซ้าย 3 ซม. ขวา 2 ซม.) — ไม่ระบุ = เท่า `margin` */
  marginRight?: number;
  /** ระยะขอบบน (pt) */
  top?: number;
  /** ขอบล่างที่ห้ามเขียนล้ำ — ถึงตรงนี้แล้วขึ้นหน้าใหม่ */
  bottom?: number;
  /**
   * ฝังฟอนต์ตัวหนาด้วย — เปิดเฉพาะเอกสารที่มีบรรทัดตัวหนาจริง (ฝังทั้งไฟล์ ~360 KB ต่อ PDF)
   * ไม่เปิดแล้วสั่ง `bold: true` = throw ไม่ถอยไปใช้ตัวปกติเงียบ ๆ
   */
  bold?: boolean;
}

/** ตัวที่ห้ามขึ้นต้นบรรทัด — ไม้ยมก ไปยาลน้อย และวรรคตอนปิด ต้องติดกับคำข้างหน้า */
const NO_LINE_START = /^[ๆฯ)\]}.,;:!?”’]/;

export class ThaiPdf {
  private constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly boldFont: PDFFont | null,
    private readonly opts: Required<Omit<ThaiPdfOptions, 'bold'>>
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
        `ไม่พบฟอนต์ภาษาไทยสำหรับออกเอกสารที่ ${fontPath} — ตรวจว่าไฟล์ THSarabunNew.ttf อยู่ครบ`
      );
    }
    const font = await doc.embedFont(fs.readFileSync(fontPath));

    let boldFont: PDFFont | null = null;
    if (options.bold) {
      const boldPath = FONT_BOLD_PATH();
      if (!fs.existsSync(boldPath) || fs.statSync(boldPath).size === 0) {
        throw new Error(
          `ไม่พบฟอนต์ภาษาไทยตัวหนาสำหรับออกเอกสารที่ ${boldPath} — ตรวจว่าไฟล์ THSarabunNew Bold.ttf อยู่ครบ`
        );
      }
      boldFont = await doc.embedFont(fs.readFileSync(boldPath));
    }

    const margin = options.margin ?? 70;
    return new ThaiPdf(doc, font, boldFont, {
      margin,
      marginRight: options.marginRight ?? margin,
      top: options.top ?? 70,
      bottom: options.bottom ?? 70,
    });
  }

  private fontFor(bold?: boolean): PDFFont {
    if (!bold) return this.font;
    if (!this.boldFont) throw new Error('เอกสารนี้ไม่ได้เปิดใช้ฟอนต์ตัวหนา (ThaiPdf.create({ bold: true }))');
    return this.boldFont;
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

  /**
   * ขึ้นหน้าใหม่ทันทีโดยไม่สนว่าที่เหลือพอหรือไม่
   *
   * มีไว้สำหรับ**แบบฟอร์มที่ต้นฉบับกำหนดจำนวนหน้าไว้แล้ว** (ใบ สหกิจ 03 พิมพ์
   * "หน้าที่ ๑/๓" ไว้ท้ายกระดาษ) — หน้าต้องขึ้นตรงที่ฟอร์มบอก ไม่ใช่ตรงที่เนื้อหาเต็ม
   * ⛔ อย่าใช้กับหนังสือที่เนื้อหายืดหดได้ ตรงนั้นปล่อยให้ `ensureSpace` ตัดสิน
   */
  newPage(): void {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - this.opts.top;
  }

  /** ขึ้นหน้าใหม่เมื่อพื้นที่ที่ต้องใช้ไม่พอ — เรียกก่อนบล็อกที่ห้ามขาดกลาง */
  ensureSpace(needed: number): void {
    if (this.y - needed < this.opts.bottom) {
      this.newPage();
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
      /** จัดกึ่งกลางรอบแกนตั้งที่ระบุ (บล็อกลงนาม: ชื่อ · ตำแหน่ง อยู่กลางแนวเดียวกัน) — ชนะ `x` และ `align` */
      centerX?: number;
      gap?: number;
      color?: RGB;
      bold?: boolean;
    } = {}
  ): void {
    const size = options.size ?? 16;
    const gap = options.gap ?? size + 6;
    this.ensureSpace(gap);

    const font = this.fontFor(options.bold);
    const width = font.widthOfTextAtSize(text, size);
    const x =
      options.centerX !== undefined
        ? options.centerX - width / 2
        : (options.x ?? (options.align === 'center' ? (A4[0] - width) / 2 : this.opts.margin));

    this.page.drawText(text, {
      x,
      y: this.y,
      size,
      font,
      color: options.color ?? rgb(0, 0, 0),
    });
    this.y -= gap;
  }

  /** ความกว้างจริงของข้อความที่ขนาดหนึ่ง — ใช้คำนวณว่าต้องเติมจุดอีกกี่ตัว */
  textWidth(text: string, size = 16, bold = false): number {
    return this.fontFor(bold).widthOfTextAtSize(text, size);
  }

  /**
   * เขียนข้อความที่พิกัดสัมบูรณ์ **โดยไม่ขยับ cursor**
   *
   * ตัวนี้เป็นข้อยกเว้นของคลาสนี้โดยตั้งใจ — ทุกเมธอดอื่นมีไว้เพื่อไม่ให้ใครต้อง
   * นับพิกัดเอง แต่ **แบบฟอร์มที่มีกรอบและตาราง** (เอกสารหมายเลข ๒) วางข้อความ
   * ตามช่องของกรอบ ไม่ได้ไหลตามเนื้อหา จึงต้องบอกพิกัดตรงๆ
   *
   * ⛔ อย่าใช้กับหนังสือที่เนื้อหายืดหดได้ (หนังสือขาออก · บันทึกข้อความ) —
   * นั่นคือกับดักพิกัดตายตัวที่คลาสนี้ถูกเขียนขึ้นมาเพื่อกำจัด
   */
  drawAt(text: string, x: number, y: number, size = 16, color?: RGB, bold = false): void {
    this.page.drawText(text, { x, y, size, font: this.fontFor(bold), color: color ?? rgb(0, 0, 0) });
  }

  /**
   * เขียนย่อหน้าที่ตัดบรรทัดเองตามความกว้างจริงของตัวอักษร
   *
   * ตัดด้วยการวัด `widthOfTextAtSize` ไม่ใช่การนับตัวอักษร เพราะภาษาไทยกับตัวเลข
   * กว้างไม่เท่ากัน · **ตัดที่ช่องว่างเท่านั้น** — ภาษาไทยไม่มีช่องว่างระหว่างคำ
   * การตัดกลางคำจะได้ข้อความที่อ่านผิดความหมาย จึงยอมให้บรรทัดยาวเกินขอบเล็กน้อย
   * ดีกว่าตัดคำผิด (ข้อความในหนังสือราชการชุดนี้มีช่องว่างคั่นวลีอยู่แล้ว)
   */
  paragraph(
    text: string,
    options: { size?: number; indent?: number; gap?: number; thaiWrap?: boolean } = {}
  ): void {
    if (options.thaiWrap) {
      this.paragraphThai(text, options);
      return;
    }
    const size = options.size ?? 16;
    const indent = options.indent ?? 0;
    const maxWidth = A4[0] - this.opts.margin - this.opts.marginRight - indent;

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
   * ย่อหน้าแบบหนังสือราชการ: **บรรทัดแรกย่อหน้า บรรทัดถัดไปชิดขอบซ้าย** และตัดบรรทัดตาม "คำไทย"
   *
   * `paragraph()` ตัวเดิมตัดที่ช่องว่างเท่านั้น ซึ่งพอสำหรับข้อความที่มีวรรคถี่ · เนื้อความของหนังสือ
   * ขอความอนุเคราะห์เป็นประโยคยาวที่แทบไม่เว้นวรรค ตัดที่ช่องว่างจะได้บรรทัดสั้นยาวไม่เท่ากันมาก
   * จึงใช้ `Intl.Segmenter('th')` (พจนานุกรมคำไทยของ ICU ที่มากับ Node) หาขอบคำ — ไม่ตัดกลางคำ
   * ⚠️ ไม่ได้กระจายบรรทัดให้เต็มขอบขวา (ต้นฉบับจาก Word กระจายแบบไทย) — ขอบขวาจึงไม่เรียบเท่าต้นฉบับ
   */
  private paragraphThai(
    text: string,
    options: { size?: number; indent?: number; gap?: number }
  ): void {
    const size = options.size ?? 16;
    const indent = options.indent ?? 0;
    const fullWidth = A4[0] - this.opts.margin - this.opts.marginRight;

    const lines = this.wrapThai(text, size, (i) => fullWidth - (i === 0 ? indent : 0));
    lines.forEach((out, i) =>
      this.line(out, { size, gap: options.gap, x: this.opts.margin + (i === 0 ? indent : 0) })
    );
  }

  /**
   * ข้อความที่ตัดบรรทัดตามคำไทย วางเป็นก้อนที่ตำแหน่ง `x` ถึงขอบขวาของหน้า — ทุกบรรทัดเริ่มที่ `x` เดียวกัน
   * (ข้อความหลังป้าย "เรียน" ที่ยาวเกินบรรทัด ต้องขึ้นบรรทัดใหม่ตรงแนวเดิม ไม่ใช่กลับไปชิดขอบซ้าย)
   */
  block(text: string, options: { x: number; size?: number; gap?: number; bold?: boolean }): void {
    const size = options.size ?? 16;
    const width = A4[0] - this.opts.marginRight - options.x;
    // ชื่อเฉพาะ (สถานประกอบการ · ผู้รับ · สาขา) ตัดที่วรรคก่อน — พจนานุกรมไม่รู้จักคำทับศัพท์ จะตัดกลางคำ
    for (const out of this.wrapThai(text, size, () => width, options.bold, true)) {
      this.line(out, { size, gap: options.gap, x: options.x, bold: options.bold });
    }
  }

  /**
   * แบ่งข้อความเป็นบรรทัดตามขอบคำไทย · `widthOf(i)` = ความกว้างที่บรรทัดที่ i ใช้ได้
   * `preferSpaces` = ตัดที่ช่องว่างก่อน ใช้ขอบคำไทยเฉพาะก้อนที่ยาวเกินบรรทัดเอง
   * (public เพราะแบบฟอร์มที่วางข้อความตามพิกัดเอง — เอกสารหมายเลข ๒ — ต้องตัดบรรทัดลงช่องเส้นประ)
   */
  wrapThai(
    text: string,
    size: number,
    widthOf: (lineIndex: number) => number,
    bold = false,
    preferSpaces = false
  ): string[] {
    const font = this.fontFor(bold);
    const words = (s: string): string[] =>
      [...new Intl.Segmenter('th', { granularity: 'word' }).segment(s)].map((x) => x.segment);
    const pieces = preferSpaces
      ? text
          .split(/(\s+)/)
          .flatMap((chunk) => (font.widthOfTextAtSize(chunk, size) > widthOf(1) ? words(chunk) : [chunk]))
      : words(text);

    // รวมตัวที่ห้ามขึ้นต้นบรรทัดเข้ากับคำข้างหน้า
    const tokens: string[] = [];
    for (const segment of pieces) {
      if (!segment) continue;
      if (tokens.length > 0 && NO_LINE_START.test(segment)) tokens[tokens.length - 1] += segment;
      else tokens.push(segment);
    }

    const lines: string[] = [];
    let current = '';
    for (const token of tokens) {
      const fits = font.widthOfTextAtSize((current + token).trimEnd(), size) <= widthOf(lines.length);
      if (current && !fits) {
        lines.push(current.trimEnd());
        // ช่องว่างที่ตกมาอยู่ต้นบรรทัดใหม่ทิ้งได้ ไม่งั้นบรรทัดจะเยื้องเข้าไปหนึ่งเคาะ
        current = token.trimStart();
      } else {
        current += token;
      }
    }
    if (current.trim()) lines.push(current.trimEnd());
    return lines;
  }

  /**
   * วางรูป (ลายเซ็น) โดย **รักษาสัดส่วนเดิม** — กำหนดความสูง ความกว้างคิดตามจริง
   *
   * ของเดิมบังคับ `width: 100, height: 50` ทุกกรณี ลายเซ็นที่สัดส่วนไม่ใช่ 2:1
   * จึงถูกยืดหรือบีบ · คืนความสูงที่ใช้จริงเพื่อให้ผู้เรียกเลื่อน cursor ต่อได้ถูก
   */
  async drawImageKeepingRatio(
    bytes: Buffer,
    options: { x: number; y: number; height: number; centered?: boolean }
  ): Promise<{ width: number; height: number }> {
    const isPng =
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const image = isPng ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);

    const scaled = image.scale(1);
    const ratio = scaled.width / scaled.height;
    const width = options.height * ratio;

    this.page.drawImage(image, {
      // `centered` = `x` คือแกนกลางของรูป (ครุฑกลางหน้า · ลายมือชื่อกลางบล็อกลงนาม) — ความกว้างจริงรู้หลังอ่านรูป
      x: options.centered ? options.x - width / 2 : options.x,
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
