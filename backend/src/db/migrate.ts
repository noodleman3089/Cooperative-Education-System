import fs from 'fs';
import path from 'path';
import pool from '../config/database';

/**
 * ตัวรัน migration — จำเป็นตั้งแต่วันแรกที่มีข้อมูลจริง
 *
 * `db:setup` สร้างฐานใหม่จาก `schema.sql` ซึ่งขึ้นต้นด้วย DROP TABLE 29 ตาราง
 * ดีสำหรับ dev และ E2E แต่พอมีข้อมูลของคณะจริงแล้ว การเพิ่มคอลัมน์หนึ่งช่อง
 * ไม่ควรแลกกับการล้างข้อมูลทั้งหมด ไฟล์นี้คือทางที่สอง: เก็บการเปลี่ยนแปลง
 * เป็นไฟล์ทีละก้อนแล้วรันเฉพาะก้อนที่ฐานนั้นยังไม่เคยรัน
 *
 * กติกาที่ต้องรักษา (มีเทสต์คุมที่ `e2e/schema-drift.spec.ts`):
 *   แก้ schema เมื่อไหร่ ต้องเขียน **สองที่** —
 *     1. `schema.sql`            สำหรับฐานที่สร้างใหม่ (dev, E2E)
 *     2. `migrations/NNN_*.sql`  สำหรับฐานที่มีข้อมูลอยู่แล้ว (production)
 *   ถ้าสองอันไม่ตรงกัน เทสต์ drift จะแดง
 *
 * `000_baseline.sql` คือสำเนาของ `schema.sql` ณ วันที่เริ่มใช้ระบบนี้ (2026-08-17)
 * **ห้ามแก้ไฟล์นั้นอีก** — มันคือจุดตั้งต้นที่ migration ทุกตัวต่อยอดจากมัน
 */

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** ตารางบันทึกว่ารันไฟล์ไหนไปแล้ว — ชื่อไฟล์คือ version */
const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

type Client = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** ไฟล์ migration ทั้งหมด เรียงตามชื่อ (จึงต้องตั้งชื่อขึ้นต้นด้วยเลข) */
export function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * บันทึกว่า migration ทุกตัวถูกใช้ไปแล้ว โดยไม่รันมัน
 *
 * ใช้ตอน `db:setup` เพราะฐานที่เพิ่งสร้างจาก `schema.sql` มีทุกอย่างครบอยู่แล้ว
 * ถ้าไม่ประทับตราไว้ การรัน `db:migrate` ครั้งถัดไปจะพยายามรันซ้ำทั้งหมด
 */
export async function stampAllMigrations(client: Client): Promise<void> {
  await client.query(CREATE_TRACKING_TABLE);
  for (const version of listMigrationFiles()) {
    await client.query(
      `INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
      [version]
    );
  }
}

/**
 * รัน migration ที่ยังไม่เคยรันกับฐานนี้ ทีละไฟล์ใน transaction ของตัวเอง
 *
 * @returns รายชื่อไฟล์ที่รันไปจริงในครั้งนี้
 */
export async function runMigrations(quiet = false): Promise<string[]> {
  const log = quiet ? () => undefined : console.log;
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query(CREATE_TRACKING_TABLE);

    const doneRes = await client.query('SELECT version FROM schema_migrations');
    const done = new Set<string>(doneRes.rows.map((r: { version: string }) => r.version));
    const files = listMigrationFiles();

    // กันอุบัติเหตุที่ทำให้ข้อมูลจริงหาย: ฐานที่มีตารางอยู่แล้วแต่ไม่เคยถูกประทับตรา
    // (เช่นฐาน dev ที่สร้างก่อนมีระบบนี้) จะโดน 000_baseline.sql ซึ่งมี DROP TABLE
    // ลบทุกอย่างทิ้ง — ต้องหยุดแล้วให้คนตัดสินใจเอง ไม่ใช่รันต่อ
    if (done.size === 0) {
      const existing = await client.query(
        `SELECT to_regclass('public.users') AS users_table`
      );
      if (existing.rows[0].users_table !== null) {
        throw new Error(
          'ฐานข้อมูลนี้มีตารางอยู่แล้วแต่ไม่มีประวัติ migration — การรันต่อจะลบข้อมูลทั้งหมด\n' +
            'ถ้าฐานนี้ตรงกับ schema.sql ปัจจุบันอยู่แล้ว ให้ประทับตราก่อนด้วย:\n' +
            '  npm run db:migrate -- --baseline'
        );
      }
    }

    for (const file of files) {
      if (done.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`Applying migration: ${file}`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        // ล้มกลางทางแล้วหยุดทันที — migration ตัวถัดไปมักพึ่งตัวก่อนหน้า
        // การรันต่อจะได้ error กองพะเนินที่หาต้นเหตุยากกว่าเดิม
        throw new Error(`Migration failed and was rolled back: ${file}\n${(err as Error).message}`, { cause: err });
      }
    }

    if (applied.length === 0) {
      log('Database is already up to date. No migrations to apply.');
    } else {
      log(`Applied ${applied.length} migration(s).`);
    }

    return applied;
  } finally {
    client.release();
  }
}

/** ประทับตราอย่างเดียว ไม่รันอะไร — สำหรับฐานที่ตรงกับ schema.sql อยู่แล้ว */
export async function baselineExistingDatabase(quiet = false): Promise<void> {
  const log = quiet ? () => undefined : console.log;
  const client = await pool.connect();
  try {
    await stampAllMigrations(client);
    log(`Stamped ${listMigrationFiles().length} migration(s) as applied without running them.`);
  } finally {
    client.release();
  }
}

// รันตรงจาก CLI: `ts-node src/db/migrate.ts [--baseline]`
if (require.main === module) {
  const isBaseline = process.argv.includes('--baseline');
  const task = isBaseline ? baselineExistingDatabase() : runMigrations();

  task
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err instanceof Error ? err.message : err);
      await pool.end();
      process.exit(1);
    });
}
