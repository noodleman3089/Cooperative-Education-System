import type { PoolClient } from 'pg';
import pool from '../../backend/src/config/database';

/**
 * These tests assert against the database as well as the UI, which is the right
 * call — a workflow that renders a success banner but writes nothing is still
 * broken. What was not right is that every one of those checks spelled out its
 * own `pool.connect()` / `try` / `finally release()` dance: 71 of them, under
 * seventeen different variable names, with the release easy to forget on a new
 * one.
 */

/** Runs `fn` with a pooled client and always returns it to the pool. */
export async function withDb<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** The first row, or undefined. Most assertions here want exactly this. */
export async function dbRow<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
  return withDb(async (db) => (await db.query(sql, params)).rows[0] as T | undefined);
}

/** All rows. */
export async function dbRows<T = any>(sql: string, params?: any[]): Promise<T[]> {
  return withDb(async (db) => (await db.query(sql, params)).rows as T[]);
}

/** A single scalar — `dbValue('SELECT user_id FROM users WHERE email = $1', [e])`. */
export async function dbValue<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
  const row = await dbRow(sql, params);
  return row === undefined ? undefined : (Object.values(row)[0] as T);
}

/** Statement whose rows do not matter; returns the affected row count. */
export async function dbExec(sql: string, params?: any[]): Promise<number> {
  return withDb(async (db) => (await db.query(sql, params)).rowCount ?? 0);
}

/** Several statements in order, for arranging a scenario. */
export async function dbExecAll(statements: Array<string | [string, any[]]>): Promise<void> {
  await withDb(async (db) => {
    for (const s of statements) {
      if (typeof s === 'string') await db.query(s);
      else await db.query(s[0], s[1]);
    }
  });
}

/**
 * แถวแม่แบบเอกสารสำหรับจำลอง "เอกสารที่ออกไปแล้ว"
 *
 * แม่แบบ HTML ทั้งชุดถูกโละเมื่อ 2026-08-26 `db:setup` จึงไม่ seed
 * `document_templates` อีกแล้ว แต่ `official_documents.template_id` เป็น
 * FK RESTRICT ที่ยัง NOT NULL — เทสต์ที่ยัดเอกสารเก่าลงฐานเพื่อทดสอบการลงนาม
 * จึงต้องมีแถวแม่แบบของตัวเองก่อน · คืน template_id ที่ใช้ได้
 */
export async function ensureLegacyTemplate(): Promise<number> {
  return withDb(async (db) => {
    const existing = await db.query('SELECT template_id FROM document_templates LIMIT 1');
    if ((existing.rowCount ?? 0) > 0) return existing.rows[0].template_id as number;

    const inserted = await db.query(
      `INSERT INTO document_templates (name, file_path, type)
       VALUES ('แม่แบบเดิมสำหรับเอกสารที่ออกไปแล้ว (ทดสอบ)', 'secure_private/templates/legacy.html', 'cover_letter')
       RETURNING template_id`
    );
    return inserted.rows[0].template_id as number;
  });
}
