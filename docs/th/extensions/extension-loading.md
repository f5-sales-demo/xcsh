---
title: การโหลดส่วนขยาย (โมดูล TypeScript/JavaScript)
description: >-
  ไปป์ไลน์การโหลดโมดูล TypeScript และ JavaScript สำหรับส่วนขยาย พร้อมการค้นหา
  การตรวจสอบ และการแคช
sidebar:
  order: 2
  label: การโหลดส่วนขยาย
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# การโหลดส่วนขยาย (โมดูล TypeScript/JavaScript)

เอกสารนี้ครอบคลุมวิธีที่ coding agent ค้นพบและโหลด**โมดูลส่วนขยาย** (`.ts`/`.js`) ตอนเริ่มต้นทำงาน

เอกสารนี้**ไม่**ครอบคลุมส่วนขยายแบบ manifest `gemini-extension.json` (มีเอกสารแยกต่างหาก)

## สิ่งที่ระบบย่อยนี้ทำ

การโหลดส่วนขยายจะสร้างรายการไฟล์ entry ของโมดูล นำเข้าแต่ละโมดูลด้วย Bun รัน factory ของมัน และคืนค่า:

- คำจำกัดความของส่วนขยายที่โหลดแล้ว
- ข้อผิดพลาดในการโหลดต่อแต่ละ path (โดยไม่หยุดการโหลดทั้งหมด)
- อ็อบเจกต์ extension runtime ที่ใช้ร่วมกัน ซึ่ง `ExtensionRunner` จะใช้ในภายหลัง

## ไฟล์การนำไปใช้งานหลัก

- `src/extensibility/extensions/loader.ts` — การค้นหา path + การนำเข้า/รัน
- `src/extensibility/extensions/index.ts` — การ export สาธารณะ
- `src/extensibility/extensions/runner.ts` — การรัน runtime/event หลังการโหลด
- `src/discovery/builtin.ts` — ตัวให้บริการค้นหาอัตโนมัติแบบ native สำหรับโมดูลส่วนขยาย
- `src/config/settings.ts` — โหลดการตั้งค่า `extensions` / `disabledExtensions` ที่รวมแล้ว

---

## อินพุตสำหรับการโหลดส่วนขยาย

### 1) โมดูลส่วนขยาย native ที่ค้นพบอัตโนมัติ

`discoverAndLoadExtensions()` จะถามตัวให้บริการค้นหาก่อนสำหรับรายการความสามารถ `extension-module` จากนั้นเก็บเฉพาะรายการของตัวให้บริการ `native`

ตำแหน่ง native ที่มีผล:

- โปรเจกต์: `<cwd>/.xcsh/extensions`
- ผู้ใช้: `~/.xcsh/agent/extensions`

รากของ path มาจากตัวให้บริการ native (`SOURCE_PATHS.native`)

หมายเหตุ:

- การค้นพบอัตโนมัติแบบ native ในปัจจุบันใช้ `.xcsh` เป็นฐาน
- `.pi` แบบเก่ายังคงยอมรับในคีย์ manifest ของ `package.json` (`pi.extensions`) แต่ไม่ใช่ในฐานะรากของ native ที่นี่

### 2) Path ที่กำหนดค่าอย่างชัดเจน

หลังจากการค้นพบอัตโนมัติ path ที่กำหนดค่าจะถูกเพิ่มต่อท้ายและแก้ไข

แหล่งที่มาของ path ที่กำหนดค่าใน path เริ่มต้นเซสชันหลัก (`sdk.ts`):

1. Path ที่ให้ผ่าน CLI (`--extension/-e` และ `--hook` จะถูกถือว่าเป็น path ส่วนขยายด้วย)
2. อาร์เรย์ `extensions` ในการตั้งค่า (การตั้งค่ารวมระดับ global + โปรเจกต์)

ไฟล์การตั้งค่าระดับ global:

- `~/.xcsh/agent/config.yml` (หรือไดเรกทอรี agent ที่กำหนดเองผ่าน `PI_CODING_AGENT_DIR`)

ไฟล์การตั้งค่าระดับโปรเจกต์:

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

## การควบคุมเปิด/ปิดการใช้งาน

### ปิดการค้นพบอัตโนมัติ

- CLI: `--no-extensions`
- ตัวเลือก SDK: `disableExtensionDiscovery`

พฤติกรรมแยกตาม:

- SDK: เมื่อ `disableExtensionDiscovery=true` จะยังคงโหลด `additionalExtensionPaths` ผ่าน `loadExtensions()`
- การสร้าง path ของ CLI (`main.ts`) ในปัจจุบันจะล้าง path ส่วนขยายของ CLI เมื่อตั้ง `--no-extensions` ดังนั้น `-e/--hook` ที่ระบุอย่างชัดเจนจะไม่ถูกส่งต่อในโหมดนั้น

### ปิดการใช้งานโมดูลส่วนขยายเฉพาะ

การตั้งค่า `disabledExtensions` จะกรองตามรูปแบบ extension id:

- `extension-module:<derivedName>`

`derivedName` จะอิงตาม entry path (`getExtensionNameFromPath`) ตัวอย่างเช่น:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

ตัวอย่าง:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## การแก้ไข path และ entry

### การทำให้ path เป็นมาตรฐาน

สำหรับ path ที่กำหนดค่า:

1. ทำให้ช่องว่าง unicode เป็นมาตรฐาน
2. ขยาย `~`
3. ถ้าเป็น relative ให้แก้ไขเทียบกับ `cwd` ปัจจุบัน

### ถ้า path ที่กำหนดค่าเป็นไฟล์

จะถูกใช้โดยตรงเป็นตัวเลือก module entry

### ถ้า path ที่กำหนดค่าเป็นไดเรกทอรี

ลำดับการแก้ไข:

1. `package.json` ในไดเรกทอรีนั้นที่มี `xcsh.extensions` (หรือ `pi.extensions` แบบเก่า) -> ใช้ entry ที่ประกาศไว้
2. `index.ts`
3. `index.js`
4. มิฉะนั้นจะสแกนหนึ่งระดับสำหรับ extension entry:
   - `*.ts` / `*.js` โดยตรง
   - ไดเรกทอรีย่อย `index.ts` / `index.js`
   - ไดเรกทอรีย่อย `package.json` ที่มี `xcsh.extensions` / `pi.extensions`

กฎและข้อจำกัด:

- ไม่มีการค้นพบแบบ recursive เกินกว่าหนึ่งระดับไดเรกทอรีย่อย
- entry ของ manifest `extensions` ที่ประกาศไว้จะถูกแก้ไขเทียบกับไดเรกทอรีของ package นั้น
- entry ที่ประกาศไว้จะถูกรวมเฉพาะเมื่อไฟล์มีอยู่/เข้าถึงได้
- ในคู่ `*/index.{ts,js}` TypeScript จะถูกเลือกก่อน JavaScript
- symlink จะถูกถือว่าเป็นไฟล์/ไดเรกทอรีที่มีสิทธิ์

### พฤติกรรมการข้ามจะแตกต่างกันตามแหล่งที่มา

- การค้นพบอัตโนมัติแบบ native (`discoverExtensionModulePaths` ในตัวช่วยค้นหา) ใช้ glob แบบ native ที่มี `gitignore: true` และ `hidden: false`
- การสแกนไดเรกทอรีที่กำหนดค่าอย่างชัดเจนใน `loader.ts` ใช้กฎ `readdir` และ**ไม่**ใช้การกรอง gitignore

---

## ลำดับการโหลดและลำดับความสำคัญ

`discoverAndLoadExtensions()` จะสร้างรายการเรียงลำดับหนึ่งรายการแล้วเรียก `loadExtensions()`

ลำดับ:

1. โมดูลที่ค้นพบอัตโนมัติแบบ native
2. Path ที่กำหนดค่าอย่างชัดเจน (ตามลำดับที่ให้มา)

ใน `sdk.ts` ลำดับที่กำหนดค่าคือ:

1. Path เพิ่มเติมจาก CLI
2. `extensions` ในการตั้งค่า

การกำจัดรายการซ้ำ:

- อิงตาม absolute path
- path ที่พบก่อนจะชนะ
- รายการซ้ำในภายหลังจะถูกข้าม

นัยสำคัญ: ถ้า path โมดูลเดียวกันถูกค้นพบอัตโนมัติและกำหนดค่าอย่างชัดเจนพร้อมกัน จะถูกโหลดครั้งเดียวที่ตำแหน่งแรก (ขั้นตอนการค้นพบอัตโนมัติ)

---

## การนำเข้าโมดูลและข้อตกลง factory

แต่ละ path ตัวเลือกจะถูกโหลดด้วย dynamic import:

- `await import(resolvedPath)`
- factory คือ `module.default ?? module`
- factory ต้องเป็นฟังก์ชัน (`ExtensionFactory`)

ถ้า export ไม่ใช่ฟังก์ชัน path นั้นจะล้มเหลวพร้อมข้อผิดพลาดที่มีโครงสร้าง และการโหลดจะดำเนินต่อ

---

## การจัดการข้อผิดพลาดและการแยกส่วน

### ระหว่างการโหลด

ต่อแต่ละ path ส่วนขยาย ข้อผิดพลาดจะถูกจับเป็น `{ path, error }` และจะไม่หยุด path อื่นจากการโหลด

กรณีทั่วไป:

- การนำเข้าล้มเหลว / ไฟล์หายไป
- การ export factory ไม่ถูกต้อง (ไม่ใช่ฟังก์ชัน)
- เกิด exception ขณะรัน factory

### โมเดลการแยกส่วนขณะรัน

- ส่วนขยาย**ไม่ได้ถูก sandbox** (process/runtime เดียวกัน)
- ส่วนขยายทั้งหมดใช้ `EventBus` และ `ExtensionRuntime` instance ร่วมกัน
- ระหว่างการโหลด เมธอดการกระทำของ runtime จะโยน `ExtensionRuntimeNotInitializedError` โดยตั้งใจ; การเชื่อมต่อการกระทำจะเกิดขึ้นในภายหลังใน `ExtensionRunner.initialize()`

### หลังการโหลด

เมื่อ event รันผ่าน `ExtensionRunner` exception ของ handler จะถูกจับและส่งออกเป็นข้อผิดพลาดของส่วนขยายแทนที่จะทำให้ลูปของ runner หยุดทำงาน

---

## ตัวอย่างเลย์เอาต์ผู้ใช้/โปรเจกต์ขั้นต่ำ

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

คีย์ manifest แบบเก่ายังคงยอมรับ:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
