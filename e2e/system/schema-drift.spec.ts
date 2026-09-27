import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * กันหน้าตาฐานข้อมูลสองทางไม่ตรงกัน
 *
 * ระบบนี้สร้างฐานได้สองทาง และทั้งคู่จำเป็น:
 *   - `schema.sql`      → ฐานใหม่ (dev, E2E) เร็วเพราะสร้างทีเดียวจบ
 *   - `migrations/`     → ฐานที่มีข้อมูลจริงอยู่แล้ว (production) เพิ่มทีละก้อน
 *
 * ราคาของการมีสองทางคือมันจะไม่ตรงกันสักวัน: เพิ่มคอลัมน์ใน migration แล้วลืม
 * แก้ schema.sql → production มีคอลัมน์ เครื่องเราไม่มี → เทสต์เขียวแต่ของจริงพัง
 * (หรือกลับกัน) เทสต์นี้สร้างฐานชั่วคราวสองตัวจากคนละทาง แล้วเทียบกันทีละคอลัมน์
 *
 * ไม่ใช้ browser และไม่แตะฐานของ dev — สร้างฐานชื่อ `coop_drift_*` ขึ้นมาแล้วลบทิ้ง
 */

const DB_DIR = path.resolve(__dirname, '../../backend/src/db');
const MIGRATIONS_DIR = path.join(DB_DIR, 'migrations');

const ADMIN_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: 'postgres',
};

const DB_FROM_SCHEMA = 'coop_drift_schema';
const DB_FROM_MIGRATIONS = 'coop_drift_migrations';
const DB_FOR_RUNNER = 'coop_drift_runner';

/**
 * เรียก `ts-node src/db/migrate.ts` เป็นโปรเซสแยกโดยชี้ไปฐานทดสอบ
 *
 * ต้องแยกโปรเซสจริงๆ เพราะ pool ของแอปถูกสร้างตอน import และชี้ไปฐานของ dev
 * การ import ตัว runner เข้ามาในเทสต์จะทำให้มันไปรันกับฐานผิดตัว
 */
function runMigrateCli(
  database: string,
  args: string[] = []
): { status: number; output: string } {
  const backendDir = path.resolve(__dirname, '../../backend');
  // ต้องผ่าน shell บน Windows — npx เป็น .cmd ซึ่งเรียกตรงๆ ไม่ได้ (จะได้ ENOENT
  // พร้อม output ว่าง ซึ่งทำให้เทสต์ที่ตรวจข้อความเข้าใจผิดว่า guard ทำงานอยู่)
  try {
    const stdout = execSync(`npx ts-node src/db/migrate.ts ${args.join(' ')}`.trim(), {
      cwd: backendDir,
      env: { ...process.env, DB_DATABASE: database },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output: stdout };
  } catch (err: any) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

async function withAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client(ADMIN_CONFIG);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(name: string): Promise<void> {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  });
}

async function dropDatabase(name: string): Promise<void> {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  });
}

async function withDatabase<T>(name: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ ...ADMIN_CONFIG, database: name });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** หน้าตาของฐาน: คอลัมน์ทุกตัว + ข้อจำกัด + ดัชนี เรียงให้เทียบกันได้ */
async function describeDatabase(client: Client) {
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable,
           column_default, character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `);

  const constraints = await client.query(`
    SELECT tc.table_name, tc.constraint_type, kcu.column_name
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_type, kcu.column_name
  `);

  const indexes = await client.query(`
    SELECT tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexdef
  `);

  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows.map((r: { indexdef: string }) => r.indexdef),
  };
}

test.describe('Schema drift: schema.sql กับ migrations/ ต้องให้ผลเหมือนกัน', () => {
  test.afterAll(async () => {
    await dropDatabase(DB_FROM_SCHEMA);
    await dropDatabase(DB_FROM_MIGRATIONS);
    await dropDatabase(DB_FOR_RUNNER);
  });

  test('ฐานที่สร้างจาก schema.sql เท่ากับฐานที่สร้างจาก migration ทุกไฟล์', async () => {
    test.setTimeout(120_000);

    // ทาง A: schema.sql ทีเดียวจบ
    await recreateDatabase(DB_FROM_SCHEMA);
    const fromSchema = await withDatabase(DB_FROM_SCHEMA, async (client) => {
      await client.query(fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8'));
      return describeDatabase(client);
    });

    // ทาง B: baseline แล้วต่อด้วย migration ทีละไฟล์ตามลำดับเลข
    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    expect(migrationFiles[0]).toBe('000_baseline.sql');

    await recreateDatabase(DB_FROM_MIGRATIONS);
    const fromMigrations = await withDatabase(DB_FROM_MIGRATIONS, async (client) => {
      for (const file of migrationFiles) {
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      }
      return describeDatabase(client);
    });

    // เทียบคอลัมน์ก่อน เพราะ diff ของมันอ่านง่ายที่สุดเวลาพัง
    expect(fromMigrations.columns).toEqual(fromSchema.columns);
    expect(fromMigrations.constraints).toEqual(fromSchema.constraints);
    expect(fromMigrations.indexes).toEqual(fromSchema.indexes);
  });

  test('db:migrate สร้างฐานเปล่าได้ และรันซ้ำแล้วไม่ทำอะไรเพิ่ม', async () => {
    test.setTimeout(180_000);

    await recreateDatabase(DB_FOR_RUNNER);

    const first = runMigrateCli(DB_FOR_RUNNER);
    expect(first.status).toBe(0);
    expect(first.output).toContain('000_baseline.sql');

    await withDatabase(DB_FOR_RUNNER, async (client) => {
      const tables = await client.query(
        // ⛔ เดิมเช็ค coop_applications — ตารางนั้นถูกลบใน migration 032 (สหกิจ 01 ตัดทั้งชุด)
        //    ฐานที่ migrate ครบจึงต้อง *ไม่มี* มัน และต้องมีตารางหลักที่ baseline สร้างไว้
        `SELECT to_regclass('public.users') AS t, to_regclass('public.intent_forms') AS i,
                to_regclass('public.coop_applications') AS a`
      );
      expect(tables.rows[0].t).not.toBeNull();
      expect(tables.rows[0].i).not.toBeNull();
      expect(tables.rows[0].a).toBeNull();

      const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version');
      expect(applied.rows[0].version).toBe('000_baseline.sql');
    });

    // รันซ้ำต้องไม่แตะอะไรอีก — ไม่งั้น baseline (ที่มี DROP TABLE) จะลบข้อมูลทิ้ง
    const second = runMigrateCli(DB_FOR_RUNNER);
    expect(second.status).toBe(0);
    expect(second.output).toContain('already up to date');
  });

  test('db:migrate ปฏิเสธฐานที่มีตารางอยู่แล้วแต่ไม่มีประวัติ migration', async () => {
    test.setTimeout(180_000);

    // ฐานแบบนี้มีจริง: เครื่องที่ตั้งไว้ก่อนระบบ migration จะมี แต่ไม่มี schema_migrations
    // ถ้า runner รันต่อ baseline จะ DROP ทุกตารางทิ้งพร้อมข้อมูลของคณะ
    await recreateDatabase(DB_FOR_RUNNER);
    await withDatabase(DB_FOR_RUNNER, async (client) => {
      await client.query(fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8'));
      await client.query(
        `INSERT INTO users (email, password_hash) VALUES ('someone@rmutto.ac.th', 'x')`
      );
    });

    const blocked = runMigrateCli(DB_FOR_RUNNER);
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('--baseline');

    // ข้อมูลต้องยังอยู่ครบ
    await withDatabase(DB_FOR_RUNNER, async (client) => {
      const rows = await client.query('SELECT COUNT(*)::int AS n FROM users');
      expect(rows.rows[0].n).toBe(1);
    });

    // ประทับตราแล้วจึงใช้งานต่อได้ตามปกติ โดยข้อมูลไม่หาย
    const stamped = runMigrateCli(DB_FOR_RUNNER, ['--baseline']);
    expect(stamped.status).toBe(0);

    const afterStamp = runMigrateCli(DB_FOR_RUNNER);
    expect(afterStamp.status).toBe(0);
    expect(afterStamp.output).toContain('already up to date');

    await withDatabase(DB_FOR_RUNNER, async (client) => {
      const rows = await client.query('SELECT COUNT(*)::int AS n FROM users');
      expect(rows.rows[0].n).toBe(1);
    });
  });
});
