import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * ข้อมูลที่อยู่ที่ถูกย่อ ต้องยังเป็นข้อมูลเดิมทุกรายการ
 *
 * `thai_address.json` (431 KB) ถูกสร้างจาก `thai_geography.source.json` (2 MB)
 * ด้วย `scripts/build-thai-address.mjs` — การมีไฟล์ต้นทาง/ปลายทางแยกกันแปลว่ามัน
 * ไม่ตรงกันได้ แบบเดียวกับ schema.sql กับ migrations/ ในรอบก่อน:
 * อัปเดตต้นฉบับแล้วลืมรันสคริปต์ หรือแก้ไฟล์ผลลัพธ์ด้วยมือ
 *
 * เทสต์นี้จึงสร้างผลลัพธ์ใหม่จากต้นฉบับแล้วเทียบกับไฟล์ที่ commit ไว้แบบตัวต่อตัว
 * ไม่ใช้ browser และไม่แตะฐานข้อมูล
 */

const DATA_DIR = path.resolve(__dirname, '../../frontend/src/data');
const SOURCE = path.join(DATA_DIR, 'thai_geography.source.json');
const BUILT = path.join(DATA_DIR, 'thai_address.json');

type Built = { name: string; districts: { name: string; subdistricts: { name: string; zipcode: string }[] }[] }[];

const built: Built = JSON.parse(fs.readFileSync(BUILT, 'utf8'));

test.describe('ข้อมูลที่อยู่ประเทศไทย', () => {
  test('ไฟล์ที่ใช้จริงตรงกับผลของสคริปต์ที่รันจากต้นฉบับ', () => {
    test.setTimeout(60_000);

    const before = fs.readFileSync(BUILT, 'utf8');
    execSync('node scripts/build-thai-address.mjs', {
      cwd: path.resolve(__dirname, '../../frontend'),
      stdio: 'pipe',
    });
    const after = fs.readFileSync(BUILT, 'utf8');

    expect(
      after,
      'thai_address.json ไม่ตรงกับต้นฉบับ — อัปเดต .source.json แล้วลืมรันสคริปต์ หรือแก้ไฟล์ผลลัพธ์ด้วยมือ'
    ).toBe(before);
  });

  test('จำนวนจังหวัด/อำเภอ/ตำบล ครบเท่าต้นฉบับ', () => {
    const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8')) as any[];

    const sourceDistricts = source.reduce((n, p) => n + (p.districts || []).length, 0);
    const sourceSubs = source.reduce(
      (n, p) => n + (p.districts || []).reduce((m: number, d: any) => m + (d.sub_districts || []).length, 0),
      0
    );

    const builtDistricts = built.reduce((n, p) => n + p.districts.length, 0);
    const builtSubs = built.reduce(
      (n, p) => n + p.districts.reduce((m, d) => m + d.subdistricts.length, 0),
      0
    );

    expect(built.length).toBe(source.length);
    expect(builtDistricts).toBe(sourceDistricts);
    expect(builtSubs).toBe(sourceSubs);

    // ตัวเลขที่รู้อยู่ ณ วันย่อข้อมูล — เปลี่ยนเมื่อไหร่แปลว่าต้นฉบับเปลี่ยน ให้ตั้งใจแก้
    expect(built.length).toBe(77);
    expect(builtDistricts).toBe(930);
    expect(builtSubs).toBe(7452);
  });

  test('รหัสไปรษณีย์ยังอยู่ครบและเป็นตัวเลข 5 หลัก', () => {
    const missing: string[] = [];
    const malformed: string[] = [];

    for (const province of built) {
      for (const district of province.districts) {
        for (const sub of district.subdistricts) {
          if (!sub.zipcode) missing.push(`${province.name}/${district.name}/${sub.name}`);
          else if (!/^\d{5}$/.test(sub.zipcode)) malformed.push(`${sub.name}=${sub.zipcode}`);
        }
      }
    }

    expect(malformed).toEqual([]);
    // ต้นฉบับเองมีบางตำบลที่ไม่มีรหัส — ยอมได้ แต่ต้องไม่ใช่จำนวนมาก
    expect(missing.length, `ตำบลที่ไม่มีรหัสไปรษณีย์: ${missing.slice(0, 5).join(', ')}`).toBeLessThan(50);
  });

  test('ข้อมูลตัวอย่างที่ตรวจด้วยตาได้ ยังถูกต้อง', () => {
    const bangkok = built.find((p) => p.name === 'กรุงเทพมหานคร');
    expect(bangkok).toBeDefined();

    const phraNakhon = bangkok!.districts.find((d) => d.name === 'เขตพระนคร');
    expect(phraNakhon).toBeDefined();
    expect(
      phraNakhon!.subdistricts.find((s) => s.name === 'พระบรมมหาราชวัง')?.zipcode
    ).toBe('10200');

    // จังหวัดของมหาวิทยาลัย ต้องมีอยู่จริง
    const chonburi = built.find((p) => p.name === 'ชลบุรี');
    expect(chonburi).toBeDefined();
    expect(chonburi!.districts.length).toBeGreaterThan(5);
  });

  test('ไฟล์ที่ผู้ใช้ต้องดาวน์โหลดต้องไม่โตกลับไปเป็นเมกะไบต์', () => {
    const builtKb = fs.statSync(BUILT).size / 1024;
    // 431 KB ณ วันย่อ · เผื่อไว้ถึง 600 KB สำหรับข้อมูลที่เพิ่มขึ้นตามจริง
    expect(builtKb, `thai_address.json โตเป็น ${builtKb.toFixed(0)} KB`).toBeLessThan(600);

    // ต้นฉบับต้องไม่ถูก import เข้าโค้ด ไม่งั้นมันจะกลับเข้า bundle
    // (คอมเมนต์ที่พูดถึงชื่อไฟล์ไม่นับ — จับเฉพาะ import จริง)
    const imports = execSync(
      `git grep -nE "(from|import\\()\\s*['\\"][^'\\"]*thai_geography\\.source" -- frontend/src || true`,
      { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }
    ).trim();
    expect(imports, `ต้นฉบับ 2 MB ถูก import เข้าโค้ด: ${imports}`).toBe('');
  });
});
