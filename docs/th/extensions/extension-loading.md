---
title: การโหลดส่วนขยาย (โมดูล TypeScript/JavaScript)
description: >-
  ไปป์ไลน์การโหลดโมดูล TypeScript และ JavaScript สำหรับส่วนขยาย
  พร้อมด้วยการค้นหา การตรวจสอบ และการแคช
sidebar:
  order: 2
  label: การโหลดส่วนขยาย
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# การโหลดส่วนขยาย (โมดูล TypeScript/JavaScript)

เอกสารนี้ครอบคลุมวิธีที่ coding agent ค้นพบและโหลด**โมดูลส่วนขยาย** (`.ts`/`.js`) ในขณะเริ่มต้นระบบ

เอกสารนี้**ไม่**ครอบคลุมส่วนขยาย manifest ของ `gemini-extension.json` (ซึ่งมีเอกสารแยกต่างหาก)

## สิ่งที่ระบบย่อยนี้ทำ

การโหลดส่วนขยายจะสร้างรายการไฟล์ entry ของโมดูล นำเข้าแต่ละโมดูลด้วย Bun รันค่า factory และส่งคืน:

- คำนิยามส่วนขยายที่โหลดแล้ว
- ข้อผิดพลาดในการโหลดแยกตามพาธ (โดยไม่หยุดการโหลดทั้งหมด)
- อ็อบเจกต์ runtime ของส่วนขยายที่ใช้ร่วมกัน ซึ่งจะถูกใช้ในภายหลังโดย `ExtensionRunner`

## ไฟล์การใช้งานหลัก

- `src/extensibility/extensions/loader.ts` — การค้นพบพาธ + การนำเข้า/การรัน
- `src/extensibility/extensions/index.ts` — การส่งออกสาธารณะ
- `src/extensibility/extensions/runner.ts` — การรัน runtime/event หลังการโหลด
- `src/discovery/builtin.ts` — ผู้ให้บริการค้นพบอัตโนมัติแบบ native สำหรับโมดูลส่วนขยาย
- `src/config/settings.ts` — โหลดการตั้งค่า `extensions` / `disabledExtensions` ที่รวมแล้ว

---

## อินพุตสำหรับการโหลดส่วนขยาย

### 1) โมดูลส่วนขยาย native ที่ค้นพบอัตโนมัติ

`discoverAndLoadExtensions()` จะขอรายการความสามารถ `extension-module` จากผู้ให้บริการค้นพบก่อน จากนั้นเก็บเฉพาะรายการจากผู้ให้บริการ `native`

ตำแหน่ง native ที่มีผล:

- โปรเจกต์: `<cwd>/.xcsh/extensions`
- ผู้ใช้: `~/.xcsh/agent/extensions`

รากของพาธมาจาก native provider (`SOURCE_PATHS.native`)

หมายเหตุ:

- การค้นพบอัตโนมัติแบบ native ในปัจจุบันใช้ `.xcsh` เป็นฐาน
- ไลเกซี `.pi` ยังคงรองรับในคีย์ manifest ของ `package.json` (`pi.extensions`) แต่ไม่ใช่ในฐานะ native root ที่นี่

### 2) พาธที่กำหนดค่าไว้อย่างชัดเจน

หลังจากการค้นพบอัตโนมัติ พาธที่กำหนดค่าไว้จะถูกเพิ่มต่อท้ายและแก้ไข

แหล่งพาธที่กำหนดค่าในเส้นทางเริ่มต้น session หลัก (`sdk.ts`):

1. พาธที่ให้มาผ่าน CLI (`--extension/-e` และ `--hook` ก็ถือเป็นพาธส่วนขยายด้วย)
2. อาร์เรย์ `extensions` ในการตั้งค่า (การตั้งค่าทั่วไปและโปรเจกต์ที่รวมแล้ว)

ไฟล์การตั้งค่าทั่วไป:

- `~/.xcsh/agent/config.yml` (หรือไดเรกทอรี agent กำหนดเองผ่าน `PI_CODING_AGENT_DIR`)

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

## การควบคุมการเปิด/ปิดใช้งาน

### ปิดการค้นพบ

- CLI: `--no-extensions`
- SDK option: `disableExtensionDiscovery`

พฤติกรรมที่แยกกัน:

- SDK: เมื่อ `disableExtensionDiscovery=true` ยังคงโหลด `additionalExtensionPaths` ผ่าน `loadExtensions()`
- การสร้างพาธ CLI (`main.ts`) ในปัจจุบันจะล้างพาธส่วนขยาย CLI เมื่อตั้ง `--no-extensions` ดังนั้น `-e/--hook` อย่างชัดเจนจะไม่ถูกส่งต่อในโหมดนั้น

### ปิดใช้งานโมดูลส่วนขยายเฉพาะ

การตั้งค่า `disabledExtensions` กรองตามรูปแบบ id ของส่วนขยาย:

- `extension-module:<derivedName>`

`derivedName` มาจากพาธ entry (`getExtensionNameFromPath`) ตัวอย่างเช่น:

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

1. ทำให้ช่องว่าง unicode เป็นมาตรฐาน
2. ขยาย `~`
3. หากเป็นพาธสัมพัทธ์ ให้แก้ไขตาม `cwd` ปัจจุบัน

### หากพาธที่กำหนดค่าเป็นไฟล์

ใช้โดยตรงเป็นตัวเลือก entry ของโมดูล

### หากพาธที่กำหนดค่าเป็นไดเรกทอรี

ลำดับการแก้ไข:

1. `package.json` ในไดเรกทอรีนั้นที่มี `xcsh.extensions` (หรือไลเกซี `pi.extensions`) -> ใช้ entry ที่ประกาศไว้
2. `index.ts`
3. `index.js`
4. มิฉะนั้น สแกนหนึ่งระดับสำหรับ entry ส่วนขยาย:
   - `*.ts` / `*.js` โดยตรง
   - `index.ts` / `index.js` ในไดเรกทอรีย่อย
   - `package.json` ในไดเรกทอรีย่อยที่มี `xcsh.extensions` / `pi.extensions`

กฎและข้อจำกัด:

- ไม่มีการค้นพบแบบ recursive เกินหนึ่งระดับไดเรกทอรีย่อย
- entry manifest ของ `extensions` ที่ประกาศไว้จะถูกแก้ไขสัมพัทธ์กับไดเรกทอรีแพ็กเกจนั้น
- entry ที่ประกาศจะถูกรวมเฉพาะเมื่อไฟล์มีอยู่/การเข้าถึงได้รับอนุญาต
- ในคู่ `*/index.{ts,js}` TypeScript จะได้รับความสำคัญเหนือ JavaScript
- symlink ถือว่าเป็นไฟล์/ไดเรกทอรีที่ใช้ได้

### พฤติกรรมการละเว้นแตกต่างกันตามแหล่ง

- การค้นพบอัตโนมัติแบบ native (`discoverExtensionModulePaths` ในตัวช่วยค้นพบ) ใช้ native glob ที่มี `gitignore: true` และ `hidden: false`
- การสแกนไดเรกทอรีที่กำหนดค่าอย่างชัดเจนใน `loader.ts` ใช้กฎ `readdir` และ**ไม่**ใช้การกรอง gitignore

---

## ลำดับการโหลดและลำดับความสำคัญ

`discoverAndLoadExtensions()` สร้างรายการที่เรียงลำดับหนึ่งรายการ จากนั้นเรียก `loadExtensions()`

ลำดับ:

1. โมดูลที่ค้นพบอัตโนมัติแบบ native
2. พาธที่กำหนดค่าอย่างชัดเจน (ตามลำดับที่ให้มา)

ใน `sdk.ts` ลำดับที่กำหนดค่าคือ:

1. พาธเพิ่มเติมจาก CLI
2. `extensions` ในการตั้งค่า

การลบรายการซ้ำ:

- อ้างอิงตามพาธสัมบูรณ์
- พาธที่พบครั้งแรกจะชนะ
- รายการซ้ำในภายหลังจะถูกละเว้น

ผลที่ตามมา: หากพาธโมดูลเดียวกันถูกทั้งค้นพบอัตโนมัติและกำหนดค่าอย่างชัดเจน จะถูกโหลดครั้งเดียวที่ตำแหน่งแรก (ขั้นตอนการค้นพบอัตโนมัติ)

---

## การนำเข้าโมดูลและสัญญาของ factory

พาธตัวเลือกแต่ละพาธจะถูกโหลดด้วย dynamic import:

- `await import(resolvedPath)`
- factory คือ `module.default ?? module`
- factory ต้องเป็นฟังก์ชัน (`ExtensionFactory`)

หากการส่งออกไม่ใช่ฟังก์ชัน พาธนั้นจะล้มเหลวพร้อมข้อผิดพลาดที่มีโครงสร้าง และการโหลดจะดำเนินต่อไป

---

## การจัดการข้อผิดพลาดและการแยกออกจากกัน

### ระหว่างการโหลด

สำหรับแต่ละพาธส่วนขยาย ข้อผิดพลาดจะถูกบันทึกเป็น `{ path, error }` และไม่หยุดพาธอื่นจากการโหลด

กรณีทั่วไป:

- ความล้มเหลวในการนำเข้า / ไฟล์ไม่พบ
- การส่งออก factory ไม่ถูกต้อง (ไม่ใช่ฟังก์ชัน)
- มีข้อยกเว้นเกิดขึ้นขณะรัน factory

### รูปแบบการแยกออกจากกันระหว่าง runtime

- ส่วนขยาย**ไม่ได้**ถูก sandbox (กระบวนการ/runtime เดียวกัน)
- ส่วนขยายใช้ `EventBus` หนึ่งตัวและ `ExtensionRuntime` หนึ่งอินสแตนซ์ร่วมกัน
- ระหว่างการโหลด เมธอด action ของ runtime จะโยน `ExtensionRuntimeNotInitializedError` โดยเจตนา โดยการเชื่อมต่อ action จะเกิดขึ้นในภายหลังใน `ExtensionRunner.initialize()`

### หลังการโหลด

เมื่อ event ทำงานผ่าน `ExtensionRunner` ข้อยกเว้นของ handler จะถูกดักจับและส่งออกเป็น extension error แทนที่จะทำให้ runner loop หยุดทำงาน

---

## ตัวอย่างโครงสร้างผู้ใช้/โปรเจกต์ขั้นต่ำ

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

คีย์ manifest ไลเกซียังคงรองรับ:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
