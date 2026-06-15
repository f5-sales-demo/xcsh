---
title: การโหลดส่วนขยาย (โมดูล TypeScript/JavaScript)
description: >-
  ไปป์ไลน์การโหลดโมดูล TypeScript และ JavaScript สำหรับส่วนขยาย พร้อมการแก้ไขพาธ
  การตรวจสอบ และการแคช
sidebar:
  order: 2
  label: การโหลดส่วนขยาย
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# การโหลดส่วนขยาย (โมดูล TypeScript/JavaScript)

เอกสารนี้ครอบคลุมวิธีที่ตัวแทนการเขียนโค้ดค้นพบและโหลด**โมดูลส่วนขยาย** (`.ts`/`.js`) เมื่อเริ่มต้นทำงาน

เอกสารนี้**ไม่ครอบคลุม**ส่วนขยายไฟล์ manifest `gemini-extension.json` (มีเอกสารแยกต่างหาก)

## หน้าที่ของระบบย่อยนี้

การโหลดส่วนขยายจะสร้างรายการไฟล์ entry ของโมดูล นำเข้าแต่ละโมดูลด้วย Bun รันฟังก์ชัน factory และส่งคืน:

- คำจำกัดความส่วนขยายที่โหลดแล้ว
- ข้อผิดพลาดการโหลดต่อพาธ (โดยไม่หยุดการโหลดทั้งหมด)
- อ็อบเจกต์ runtime ของส่วนขยายที่ใช้ร่วมกัน ซึ่ง `ExtensionRunner` จะใช้ในภายหลัง

## ไฟล์ implementation หลัก

- `src/extensibility/extensions/loader.ts` — การค้นพบพาธ + การนำเข้า/การรัน
- `src/extensibility/extensions/index.ts` — การส่งออกสาธารณะ
- `src/extensibility/extensions/runner.ts` — การรัน runtime/event หลังการโหลด
- `src/discovery/builtin.ts` — ผู้ให้บริการค้นพบอัตโนมัติแบบ native สำหรับโมดูลส่วนขยาย
- `src/config/settings.ts` — โหลดการตั้งค่า `extensions` / `disabledExtensions` ที่ผสานแล้ว

---

## ข้อมูลนำเข้าสำหรับการโหลดส่วนขยาย

### 1) โมดูลส่วนขยาย native ที่ค้นพบอัตโนมัติ

`discoverAndLoadExtensions()` จะสอบถามผู้ให้บริการค้นพบก่อนสำหรับรายการที่มีความสามารถ `extension-module` จากนั้นเก็บเฉพาะรายการที่เป็น provider `native`

ตำแหน่ง native ที่มีผล:

- โปรเจกต์: `<cwd>/.xcsh/extensions`
- ผู้ใช้: `~/.xcsh/agent/extensions`

รูทของพาธมาจาก native provider (`SOURCE_PATHS.native`)

หมายเหตุ:

- การค้นพบอัตโนมัติแบบ native ใช้ `.xcsh` เป็นฐาน
- Legacy `.pi` ยังคงรองรับในคีย์ manifest ของ `package.json` (`pi.extensions`) แต่ไม่ใช่ในฐานะ native root ที่นี่

### 2) พาธที่กำหนดค่าไว้อย่างชัดเจน

หลังการค้นพบอัตโนมัติ พาธที่กำหนดค่าไว้จะถูกผนวกและแก้ไข

แหล่งพาธที่กำหนดค่าไว้ในพาธเริ่มต้น session หลัก (`sdk.ts`):

1. พาธที่ระบุผ่าน CLI (`--extension/-e` และ `--hook` จะถูกถือว่าเป็นพาธส่วนขยายด้วย)
2. อาร์เรย์ `extensions` ของการตั้งค่า (การตั้งค่าส่วนกลาง + โปรเจกต์ที่ผสานแล้ว)

ไฟล์การตั้งค่าส่วนกลาง:

- `~/.xcsh/agent/config.yml` (หรือไดเรกทอรี agent แบบกำหนดเองผ่าน `PI_CODING_AGENT_DIR`)

ไฟล์การตั้งค่าโปรเจกต์:

- `<cwd>/.xcsh/settings.json`

ตัวอย่าง:

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## ตัวควบคุมการเปิดใช้งาน/ปิดใช้งาน

### ปิดใช้งานการค้นพบ

- CLI: `--no-extensions`
- ตัวเลือก SDK: `disableExtensionDiscovery`

การแบ่งพฤติกรรม:

- SDK: เมื่อ `disableExtensionDiscovery=true` ยังคงโหลด `additionalExtensionPaths` ผ่าน `loadExtensions()`
- การสร้างพาธของ CLI (`main.ts`) จะล้างพาธส่วนขยาย CLI เมื่อตั้งค่า `--no-extensions` ดังนั้น `-e/--hook` อย่างชัดเจนจะไม่ถูกส่งต่อในโหมดนั้น

### ปิดใช้งานโมดูลส่วนขยายเฉพาะ

การตั้งค่า `disabledExtensions` กรองตามรูปแบบ extension id:

- `extension-module:<derivedName>`

`derivedName` อ้างอิงจากพาธ entry (`getExtensionNameFromPath`) ตัวอย่างเช่น:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

ตัวอย่าง:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## การแก้ไขพาธและ entry

### การทำให้พาธเป็นมาตรฐาน

สำหรับพาธที่กำหนดค่าไว้:

1. ทำให้ unicode spaces เป็นมาตรฐาน
2. ขยาย `~`
3. หากเป็นพาธสัมพัทธ์ ให้แก้ไขเทียบกับ `cwd` ปัจจุบัน

### หากพาธที่กำหนดค่าไว้เป็นไฟล์

จะถูกใช้โดยตรงเป็นตัวเลือก module entry

### หากพาธที่กำหนดค่าไว้เป็นไดเรกทอรี

ลำดับการแก้ไข:

1. `package.json` ในไดเรกทอรีนั้นที่มี `xcsh.extensions` (หรือ legacy `pi.extensions`) -> ใช้ entries ที่ประกาศไว้
2. `index.ts`
3. `index.js`
4. มิฉะนั้นสแกนหนึ่งระดับเพื่อหา extension entries:
   - `*.ts` / `*.js` โดยตรง
   - `index.ts` / `index.js` ใน subdir
   - `package.json` ใน subdir ที่มี `xcsh.extensions` / `pi.extensions`

กฎและข้อจำกัด:

- ไม่มีการค้นพบแบบ recursive เกินหนึ่งระดับ subdirectory
- entries ที่ประกาศไว้ใน manifest `extensions` จะถูกแก้ไขเทียบกับไดเรกทอรีแพ็กเกจนั้น
- entries ที่ประกาศไว้จะถูกรวมเฉพาะเมื่อไฟล์มีอยู่/อนุญาตให้เข้าถึงได้
- ในคู่ `*/index.{ts,js}` TypeScript จะถูกเลือกมากกว่า JavaScript
- symlinks ถูกถือว่าเป็นไฟล์/ไดเรกทอรีที่ใช้ได้

### พฤติกรรมการละเว้นแตกต่างกันตามแหล่งที่มา

- การค้นพบอัตโนมัติแบบ native (`discoverExtensionModulePaths` ใน discovery helpers) ใช้ native glob ที่มี `gitignore: true` และ `hidden: false`
- การสแกนไดเรกทอรีที่กำหนดค่าไว้อย่างชัดเจนใน `loader.ts` ใช้กฎ `readdir` และ**ไม่**ใช้การกรอง gitignore

---

## ลำดับการโหลดและลำดับความสำคัญ

`discoverAndLoadExtensions()` สร้างรายการลำดับเดียวแล้วเรียก `loadExtensions()`

ลำดับ:

1. โมดูลที่ค้นพบอัตโนมัติแบบ native
2. พาธที่กำหนดค่าไว้อย่างชัดเจน (ตามลำดับที่ระบุ)

ใน `sdk.ts` ลำดับที่กำหนดค่าไว้คือ:

1. พาธเพิ่มเติมจาก CLI
2. `extensions` ของการตั้งค่า

การขจัดข้อมูลซ้ำ:

- อ้างอิงจากพาธสัมบูรณ์
- พาธที่พบก่อนจะชนะ
- รายการซ้ำที่ตามมาจะถูกละเว้น

ผลที่ตามมา: หากโมดูลพาธเดียวกันถูกค้นพบอัตโนมัติและกำหนดค่าไว้อย่างชัดเจน จะถูกโหลดครั้งเดียวที่ตำแหน่งแรก (ขั้นตอนการค้นพบอัตโนมัติ)

---

## การนำเข้าโมดูลและข้อกำหนด factory

แต่ละพาธที่เป็นตัวเลือกจะถูกโหลดด้วย dynamic import:

- `await import(resolvedPath)`
- factory คือ `module.default ?? module`
- factory ต้องเป็นฟังก์ชัน (`ExtensionFactory`)

หากการส่งออกไม่ใช่ฟังก์ชัน พาธนั้นจะล้มเหลวพร้อมข้อผิดพลาดที่มีโครงสร้าง และการโหลดจะดำเนินต่อไป

---

## การจัดการความล้มเหลวและการแยกส่วน

### ระหว่างการโหลด

ต่อพาธส่วนขยาย ความล้มเหลวจะถูกจับเก็บเป็น `{ path, error }` และไม่หยุดไม่ให้พาธอื่นโหลด

กรณีทั่วไป:

- การนำเข้าล้มเหลว / ไม่พบไฟล์
- การส่งออก factory ไม่ถูกต้อง (ไม่ใช่ฟังก์ชัน)
- ข้อยกเว้นที่เกิดขึ้นระหว่างการรัน factory

### โมเดลการแยกส่วน runtime

- ส่วนขยาย**ไม่ถูก sandbox** (กระบวนการ/runtime เดียวกัน)
- ส่วนขยายใช้ `EventBus` หนึ่งตัวและ `ExtensionRuntime` instance หนึ่งตัวร่วมกัน
- ระหว่างการโหลด เมธอด action ของ runtime จะ throw `ExtensionRuntimeNotInitializedError` โดยตั้งใจ โดย action wiring จะเกิดขึ้นในภายหลังใน `ExtensionRunner.initialize()`

### หลังการโหลด

เมื่อ events ทำงานผ่าน `ExtensionRunner` ข้อยกเว้นของ handler จะถูกจับและส่งออกเป็น extension errors แทนที่จะทำให้ runner loop พัง

---

## ตัวอย่าง layout ผู้ใช้/โปรเจกต์ขั้นต่ำ

### ระดับผู้ใช้

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### ระดับโปรเจกต์

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`:

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

คีย์ manifest แบบ legacy ยังคงรองรับ:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
