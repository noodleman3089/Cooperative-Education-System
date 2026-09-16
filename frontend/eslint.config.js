import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // ขีดล่างนำหน้า = 'ตั้งใจไม่ใช้' — ตรงกับ backend/eslint.config.mjs
      // ใช้ตอน destructure เพื่อ 'ตัดฟิลด์นี้ออก' เช่น const { body: _rawBody, ...rest }
      /**
       * ⛔ fail-open — `.catch()` ที่กลืน error แล้วคืนค่าว่าง
       *
       * กฎนี้เคยเป็นร้อยแก้วในใบสั่งงาน (`ใบสั่ง F ข้อ 5.1`) แล้วหลุดซ้ำทุกก้อน จน
       * มีรอบที่เขียนคอมเมนต์ว่า "ลบ .catch(() => []) แล้ว" ไว้เหนือบรรทัดที่ยังมีอยู่จริง
       * — ย้ายมาเป็นด่านของ lint ซึ่งทุกคนรันอยู่แล้วก่อนส่งงาน
       *
       * โหลดพัง = ต้องขึ้น error ให้ผู้ใช้เห็น (`getErrorMessage`) ไม่ใช่กลายเป็น
       * "ไม่มีข้อมูล" ซึ่งอ่านไม่ออกว่าระบบพังหรือว่างจริง
       */
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name="catch"] > ArrowFunctionExpression[body.type="ArrayExpression"]',
          message:
            'fail-open: .catch(() => []) กลืน error แล้วทำให้จอบอกว่า "ไม่มีข้อมูล" — ให้ตั้ง error ด้วย getErrorMessage แทน',
        },
        {
          selector:
            'CallExpression[callee.property.name="catch"] > ArrowFunctionExpression[body.type="ObjectExpression"]',
          message:
            'fail-open: .catch(() => ({...})) คืนค่าปลอมแทนคำตอบจริง — ให้ตั้ง error ด้วย getErrorMessage แทน',
        },
        {
          selector:
            'CallExpression[callee.property.name="catch"] > ArrowFunctionExpression[body.type="Literal"]',
          message:
            'fail-open: .catch(() => null) กลืน error เงียบ — ให้ตั้ง error ด้วย getErrorMessage แทน',
        },
        {
          selector:
            'CallExpression[callee.property.name="catch"] > ArrowFunctionExpression[body.type="Identifier"][body.name="undefined"]',
          message:
            'fail-open: .catch(() => undefined) กลืน error เงียบ — ให้ตั้ง error ด้วย getErrorMessage แทน',
        },
        {
          selector:
            'CallExpression[callee.property.name="catch"] > ArrowFunctionExpression[body.type="BlockStatement"][body.body.length=0]',
          message:
            'fail-open: .catch(() => {}) ว่างเปล่า — ถ้าตั้งใจข้ามจริง ให้เขียนคอมเมนต์เหตุผลและ log ไว้อย่างน้อยหนึ่งบรรทัด',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
])
