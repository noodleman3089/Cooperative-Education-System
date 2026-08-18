import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * เทียบเคียง frontend/eslint.config.js แต่ตัดสิ่งที่ backend ไม่มี:
 * ไม่มี React จึงไม่มี react-hooks / react-refresh · globals เป็น node ไม่ใช่ browser
 *
 * ⛔ ไฟล์นี้ต้องเป็น .mjs ไม่ใช่ .js — backend/package.json ไม่มี "type": "module"
 * (และห้ามใส่ เพราะ tsconfig ตั้ง module: node16 ไว้ให้ emit CommonJS)
 *
 * ⛔ จงใจไม่เปิด type-aware linting (projectService) — pool.query() คืน QueryResult<any>
 * และ req.body ของ express เป็น any → no-unsafe-member-access จะยิงใส่ทุก controller
 * ในโปรเจคหลายร้อยจุด ซึ่งแก้จริงไม่ได้ถ้าไม่ generate type จาก schema ทั้งฐาน
 * · tsc มี strict + noImplicitAny เปิดครบอยู่แล้ว สิ่งที่ต้องการเพิ่มคือ no-explicit-any
 * ซึ่งอยู่ใน recommended แบบ syntax-only อยู่แล้ว
 */
export default defineConfig([
  globalIgnores(['dist', 'uploads', 'secure_private']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      // ขีดล่างนำหน้า = "ตั้งใจไม่ใช้" ซึ่งเป็นธรรมเนียมที่โค้ดนี้ใช้อยู่แล้ว
      // (_req/_file ของ multer · _next ของ error middleware ที่ express บังคับให้มี 4 อาร์กิวเมนต์
      //  · const { password_hash: _omitted, ...safeUser } ที่ตัดรหัสผ่านออกจาก response)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // types/index.ts ต้องใช้ namespace จริง — เป็นวิธีเดียวที่ augment Express.Request ได้
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
]);
