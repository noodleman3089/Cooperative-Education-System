# รายงานสรุปงานสำหรับ Claude (Session Handoff Report)

> **วันที่บันทึก**: 2026-09-04  
> **ผู้จัดทำ**: Antigravity (Pair Programmer)  
> **สำหรับ**: Claude / Claude Code และผู้ดูแลระบบ  
> **สถานะ Repository**: Working tree สะอาดบน `main` (ไม่มีการ git push ตามกฎ `git-guard.js`)

---

## 📌 ภาพรวมงานทั้งหมดใน Session นี้

ในเซสชันนี้มีการแก้ไขและปรับปรุงระบบไปทั้งหมด **4 งานหลัก** เพื่อให้ตรงกับกระบวนการจริงของมหาวิทยาลัย และแก้บั๊กสำคัญด้าน UI/UX:

| หัวข้อ | Commit | ไฟล์หลักที่เกี่ยวข้อง | สรุปผล |
|---|---|---|---|
| **1. เอกสารหมายเลข 1 (แบบคำร้องเปล่า PDF 2 หน้า)** | `5d17c20` | `backend/src/controllers/intent.ts`<br>`backend/secure_private/templates/request_form_template.pdf` | เสิร์ฟแบบฟอร์มเปล่าทางการตรงตามต้นฉบับ Word 100% |
| **2. แก้ปัญหา Modal เพิ่มสถานประกอบการ UI ตกขอบล่าง** | `d404dda` | `frontend/src/components/ui/Modal.tsx`<br>`frontend/src/pages/Staff/CompanyDirectory.tsx`<br>`frontend/src/pages/Advisor/ApplicationReview.tsx` | แก้ Flex chain หลุด ทำให้ ModalBody สกรอลล์ได้ และปุ่ม Footer ไม่หลุดจอ |
| **3. ข้ามขั้นตอน สหกิจ 01 สู่การเลือกสถานประกอบการทันที** | `2e0fc86` | `frontend/src/components/Sidebar.tsx`<br>`frontend/src/components/StudentWelcomeGuide.tsx`<br>`backend/src/middlewares/validation.ts`<br>`backend/src/models/student.ts`, `backend/src/controllers/profile.ts`<br>`backend/src/db/schema.sql`, `backend/src/db/setup.ts` | ซ่อนกระบวนการ สหกิจ 01 ออกจาก UI และให้สิทธิ์นักศึกษาผ่านเกณฑ์อัตโนมัติ |
| **4. แก้บั๊กพิมพ์ Input ได้ทีละ 1 ตัวอักษรแล้วหลุด Focus** | `49e4a59` | `frontend/src/components/ui/Modal.tsx` | แก้ `useEffect` ใน Modal ที่แย่ง Focus กลับไปที่ตัวกล่องทุกครั้งที่กดแป้นพิมพ์ |

---

## 🔍 รายละเอียด สาเหตุ และเหตุผลในการแก้ไขแต่ละส่วน

---

### 1. เอกสารหมายเลข 1 (แบบคำร้องขอหนังสือขอความอนุเคราะห์ / Request Form)
* **Commit**: `5d17c20`
* **บริบทและปัญหาเดิม**:
  * เดิมระบบใช้วิธีดึงข้อมูลมาแสดงเป็น HTML preview แล้วแปลงเป็นเอกสาร ซึ่งจัดหน้าไม่ตรงกับเอกสารทางการของมหาวิทยาลัย ขาดตราสัญลักษณ์ครุฑ และมีปัญหาหน้าล้น/ขึ้นหน้าผิด
  * เจ้าของโปรเจกต์ต้องการให้ดาวน์โหลดเป็น **"แบบฟอร์มเปล่า 2 หน้าตามไฟล์ต้นฉบับเดิมของมหาวิทยาลัย"** จากไฟล์ `เอกสาร/เอกสารสำหรับเทมเพลต/เอกสารหมายเลข-1-แบบคำร้องขอหนังสือขอความอนุเคราะห์นักศึกษาสหกิจศึกษา.doc`
* **สิ่งที่ทำ**:
  * แปลงไฟล์ต้นฉบับ Word เป็น PDF มาตรฐาน 2 หน้าอย่างประณีต เก็บไว้ที่ `backend/secure_private/templates/request_form_template.pdf` (คงตราครุฑและตารางตามระเบียบมหาวิทยาลัยครบถ้วน)
  * ปรับ `backend/src/controllers/intent.ts` ฟังก์ชัน `getRequestForm` ให้ส่งไฟล์ `request_form_template.pdf` เป็น `application/pdf` โดยค่าเริ่มต้น และมี `?format=html` เป็น fallback เพื่อรองรับ test suite เดิม
* **เหตุผล**: นักศึกษาต้องพิมพ์แบบฟอร์มเปล่าที่มีตราครุฑและตารางทางการ 2 หน้าไปกรอกด้วยมือและเดินเรื่องให้ที่ปรึกษาและหัวหน้าสาขาลงนามกระดาษจริง
* **ผลการทดสอบ**: ผ่าน E2E `e2e/document-01-request.spec.ts` (14/14 tests) และ `e2e/business-rules.spec.ts` (4/4 tests)

---

### 2. แก้ปัญหา Modal "เพิ่มสถานประกอบการ" ของเจ้าหน้าที่ UI ตกขอบล่าง
* **Commit**: `d404dda`
* **บริบทและปัญหาเดิม**:
  * ในหน้า `frontend/src/pages/Staff/CompanyDirectory.tsx` เมื่อเจ้าหน้าที่กดปุ่ม "เพิ่มสถานประกอบการ" หรือ "แก้ไขข้อมูล" แบบฟอร์มมีช่องกรอกจำนวนมาก (~700px)
  * ตัวฟอร์มล้นทะลุความสูงของ Modal ทำให้ส่วน `<ModalFooter>` ซึ่งมีปุ่ม **"ยกเลิก"** และ **"บันทึกข้อมูล"** หลุดขอบล่างของหน้าจอไปเลย (ตกขอบ) ผู้ใช้มองไม่เห็นและไม่สามารถกดส่งข้อมูลได้
* **สาเหตุ (Root Cause)**:
  * ใน `frontend/src/components/ui/Modal.tsx` กำหนดกล่องหลักเป็น `max-h-[90vh] flex flex-col`
  * แต่ใน `CompanyDirectory.tsx` แท็ก `<form onSubmit={handleSubmit}>` อยู่คั่นกลางระหว่าง `Modal` กับ `ModalBody` โดยไม่มีการใส่ CSS class (`display: block` ตามปกติ)
  * Flex chain จึงขาดช่วง ทำให้ `<ModalBody>` ที่มี `overflow-y-auto` ไม่รู้ขอบเขตความสูงของตัวเอง จึงขยายเต็มความสูงและไม่เกิดการสกรอลล์
  * ตัว Modal เองก็ไม่มี `overflow-hidden` เนื้อหาจึงทะลักออกนอกกล่อง
* **สิ่งที่ทำ**:
  * **`frontend/src/components/ui/Modal.tsx`**:
    * เพิ่ม `overflow-hidden` ที่ตัว Panel
    * เพิ่ม `flex-1 min-h-0` ให้กับ `ModalBody` โดยปริยาย
  * **`frontend/src/pages/Staff/CompanyDirectory.tsx`**:
    * ใส่ `className="flex flex-col flex-1 min-h-0 overflow-hidden"` ให้แท็ก `<form>`
    * ขยายขนาดจาก `size="lg"` (512px) เป็น `size="xl"` (576px) เพื่อให้แบบฟอร์ม 2 คอลัมน์ดูโปร่งตา ไม่บีบแน่น
  * **`frontend/src/pages/Advisor/ApplicationReview.tsx`**:
    * ใส่ class เดียวกันให้กับ `<form>` เพื่อป้องกันปัญหาในหน้าประเมินของอาจารย์

---

### 3. ข้ามขั้นตอน "สหกิจ 01" (Program Enrollment) สู่การเลือกสถานประกอบการทันที
* **Commit**: `2e0fc86`
* **บริบทและปัญหาเดิม**:
  * เดิมในระบบมีขั้นตอน "สมัครเข้าโครงการสหกิจศึกษา (สหกิจ 01)" โดยให้นักศึกษากรอก GPA ที่แจ้ง, พื้นที่ที่อยากไป, ทักษะ แล้วส่งให้อาจารย์ที่ปรึกษาประเมิน 3 ด้าน และให้หัวหน้าสาขาอนุมัติ ถึงจะได้สถานะ `is_eligible = true`
  * **ข้อเท็จจริงจากเจ้าของโปรเจกต์**: *"ไอขั้นตอน สมัครเข้าโครงการ (สหกิจ 01) มันไม่มีอยู่จริงในระบบ เพราะนักศึกษายังไงก็ต้องได้รับเข้าสหกิจอยู่แล้ว ซ่อนส่วนนี้ได้มั้ยโดยไม่กระทบ แล้วข้ามไปขั้นตอนจริงๆ นั่นคือการขอหนังสือขอความอนุเคราะห์"*
* **แนวทางแก้ไข (Non-destructive & Backwards-compatible)**:
  * **ไม่ลบตารางหรือ endpoint**: ตาราง `coop_applications` และ endpoint `/api/applications` ยังอยู่ครบ ไม่ทำลายโครงสร้าง
  * **ซ่อนเมนูจาก UI**:
    * `frontend/src/components/Sidebar.tsx`: ซ่อนเมนู `application` ของนักศึกษา และเมนู `applications` ของอาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชา
    * `frontend/src/components/StudentWelcomeGuide.tsx`: ปรับลำดับการแนะนำจาก 3 ขั้นตอน ให้เหลือ 2 ขั้นตอนจริง:
      1. กรอกประวัตินักศึกษาให้ครบถ้วน (`profile`)
      2. เลือกสถานประกอบการและยื่นแบบแจ้งความจำนง (`jobs`) เพื่อออกหนังสือขอความอนุเคราะห์
  * **ปลดล็อกสิทธิ์อัตโนมัติ (Auto-grant Eligibility)**:
    * `backend/src/middlewares/validation.ts` (`checkStudentEligibility`): นักศึกษาที่มีโปรไฟล์ในระบบถือว่าได้รับสิทธิ์สหกิจศึกษาและผ่านการปฐมนิเทศอัตโนมัติ หาก flag ในฐานข้อมูลยังไม่เป็นจริง ระบบจะอัปเดตให้เป็น `TRUE` ทันที ไม่ส่ง 403 บล็อกการยื่นคำร้องอีกต่อไป
    * `backend/src/models/student.ts` & `backend/src/controllers/profile.ts`: ปรับ default เมื่อสร้างนักศึกษาใหม่ให้ `is_eligible = TRUE` และ `is_orientation_passed = TRUE`
    * `backend/src/db/schema.sql` & `backend/src/db/setup.ts`: ปรับ DEFAULT ในตารางเป็น `TRUE` และเพิ่มคำสั่งอัปเดตข้อมูลนักศึกษาทั้งหมดใน DB ตอน setup

---

### 4. แก้บั๊กพิมพ์ Input ได้ทีละ 1 ตัวอักษรแล้วหลุด Focus (Focus Stealing)
* **Commit**: `49e4a59`
* **บริบทและปัญหาเดิม**:
  * ในหน้าจอตรวจคำร้องของเจ้าหน้าที่ (`frontend/src/components/StaffDashboard.tsx`) เวลาเจ้าหน้าที่พิมพ์ชื่ออาจารย์ที่ปรึกษาผู้ลงนาม (`advisor_signer_name`) พิมพ์แป้นพิมพ์ได้เพียง 1 ตัวอักษร แล้วเคอร์เซอร์หลุด Focus ทันที ต้องเอาเมาส์ไปคลิกที่ช่อง Input ใหม่ทุกตัวอักษร
* **สาเหตุ (Root Cause)**:
  * ใน `frontend/src/components/ui/Modal.tsx` มี `useEffect` สำหรับจับปุ่ม Escape และใน effect มีคำสั่ง:
    ```tsx
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    ```
  * แต่ `useEffect` ตัวนี้ตั้ง dependency ไว้ที่ `[onClose]`!
  * ใน `StaffDashboard.tsx` บรรทัดที่ 2493 ส่งฟังก์ชันแบบ inline arrow function:
    ```tsx
    <Modal onClose={() => setReviewingRequest(null)} ...>
    ```
  * **สิ่งที่เกิดขึ้นในทุก Keypress**:
    1. ผู้ใช้กดแป้นพิมพ์ 1 ตัว → `setOfficerForm` อัปเดต state
    2. คอมโพเนนต์แม่ `StaffDashboard` เกิดการ **Re-render**
    3. ฟังก์ชัน `() => setReviewingRequest(null)` ถูกสร้างขึ้นมาใหม่เป็นคนละ reference
    4. `Modal` เห็นว่าค่าใน dependency `[onClose]` เปลี่ยน จึงรัน cleanup และรัน `useEffect` ใหม่
    5. คำสั่ง `panelRef.current?.focus()` จึง **แย่ง Focus** หลุดออกจาก `<input>` ไปโฟกัสที่ตัวกล่องหน้าต่าง Modal ทันที!
* **สิ่งที่ทำ**:
  * ปรับ `frontend/src/components/ui/Modal.tsx` ให้เก็บ `onClose` ไว้ใน `onCloseRef = useRef(onClose)`
  * ปรับ dependency array ของ `useEffect` เป็น `[]` (ทำงานเฉพาะตอน Mount/Unmount ครั้งเดียว)
  * **ผลลัพธ์**: Re-render ในคอมโพเนนต์แม่จะไม่ไปกระตุ้น effect ของ Modal อีกต่อไป ช่อง Input จึงคง Focus ไว้อย่างมั่นคง พิมพ์ข้อความภาษาไทยและอังกฤษได้อย่างต่อเนื่องเป็นปกติ 100%

---

## 🛠️ รายการคำสั่งสำหรับรันและทดสอบระบบ

### 1. รัน Database Setup
```bash
npm run db:setup
```

### 2. รันเซิร์ฟเวอร์
* **Backend API (Port 5000)**:
  ```bash
  npm run dev:backend
  ```
* **Frontend Vite (Port 5173)**:
  ```bash
  npm run dev:frontend
  ```

### 3. รันตรวจสอบ Typecheck & Build
```bash
npm.cmd --prefix frontend run build
npx playwright test e2e/typecheck.spec.ts
```

---

## 🔒 กฎเหล็กที่ยังคงรักษาอย่างเคร่งครัด
1. **Never git push**: ไม่มีคำสั่ง push ใดๆ ทั้งสิ้น (เจ้าของโปรเจกต์เป็นผู้ push เองเท่านั้น)
2. **No AI trailers**: คอมมิตเมสเสจไม่มีข้อความอัตโนมัติของ AI
3. **Lazy Senior Dev (Ponytail Mode)**: เขียนโค้ดให้น้อยที่สุด แก้ที่ต้นเหตุโดยไม่เพิ่ม abstraction ที่ไม่จำเป็น
