---
title: Extension Loading (TypeScript/JavaScript Modules)
description: >-
  TypeScript and JavaScript module loading pipeline for extensions with
  resolution, validation, and caching.
sidebar:
  order: 2
  label: การโหลดส่วนขยาย
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# การโหลดส่วนขยาย (TypeScript/JavaScript Modules)

เอกสารนี้ครอบคลุมวิธีที่ coding agent ค้นหาและโหลด **โมดูลส่วนขยาย** (`.ts`/`.js`) ในขั้นตอนเริ่มต้น

เอกสารนี้ **ไม่** ครอบคลุมส่วนขยายแบบ manifest `gemini-extension.json` (ซึ่งมีเอกสารแยกต่างหาก)

## สิ่งที่ระบบย่อยนี้ทำ

การโหลดส่วนขยายจะสร้างรายการไฟล์ entry ของโมดูล นำเข้าแต่ละโมดูลด้วย Bun ดำเนินการ factory ของโมดูล และส่งคืน:

- คำจำกัดความของส่วนขยายที่โหลดแล้ว
- ข้อผิดพลาดการโหลดแยกตามเส้นทาง (โดยไม่หยุดการโหลดทั้งหมด)
- อ็อบเจกต์ extension runtime ที่ใช้ร่วมกัน ซึ่งจะถูกใช้ภายหลังโดย `ExtensionRunner`

## ไฟล์การ implement หลัก

- `src/extensibility/extensions/loader.ts` — การค้นหาเส้นทาง + การนำเข้า/ดำเนินการ
- `src/extensibility/extensions/index.ts` — การ export สาธารณะ
- `src/extensibility/extensions/runner.ts` — การดำเนินการ runtime/event หลังจากโหลด
- `src/discovery/builtin.ts` — ผู้ให้บริการ auto-discovery แบบ native สำหรับโมดูลส่วนขยาย
- `src/config/settings.ts` — โหลดการตั้งค่า `extensions` / `disabledExtensions` ที่รวมแล้ว

---

## อินพุตสำหรับการโหลดส่วนขยาย

### 1) โมดูลส่วนขยาย native ที่ค้นพบอัตโนมัติ

`discoverAndLoadExtensions()` จะถาม discovery providers สำหรับรายการ capability `extension-module` ก่อน จากนั้นจะเก็บเฉพาะรายการของ provider `native` เท่านั้น

ตำแหน่ง native ที่ใช้งานจริง:

- โปรเจกต์: `<cwd>/.xcsh/extensions`
- ผู้ใช้: `~/.xcsh/agent/extensions`

ราก (root) ของเส้นทางมาจาก native provider (`SOURCE_PATHS.native`)

หมายเหตุ:

- การค้นพบอัตโนมัติแบบ native ปัจจุบันใช้ `.xcsh` เป็นฐาน
- `.pi` แบบ legacy ยังคงรองรับในคีย์ manifest ของ `package.json` (`pi.extensions`) แต่ไม่ใช่เป็น native root ที่นี่

### 2) เส้นทางที่กำหนดค่าอย่างชัดเจน

หลังจากการค้นพบอัตโนมัติ เส้นทางที่กำหนดค่าจะถูกเพิ่มต่อท้ายและ resolve

แหล่งที่มาของเส้นทางที่กำหนดค่าในเส้นทางเริ่มต้น session หลัก (`sdk.ts`):

1. เส้นทางที่ให้ผ่าน CLI (`--extension/-e` และ `--hook` ก็ถูกถือว่าเป็นเส้นทางส่วนขยายเช่นกัน)
2. อาร์เรย์ `extensions` ในการตั้งค่า (การตั้งค่า global + project ที่รวมกัน)

ไฟล์การตั้งค่า global:

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

## การควบคุมการเปิด/ปิดใช้งาน

### ปิดใช้งานการค้นพบ

- CLI: `--no-extensions`
- ตัวเลือก SDK: `disableExtensionDiscovery`

พฤติกรรมแยกตาม:

- SDK: เมื่อ `disableExtensionDiscovery=true` ยังคงโหลด `additionalExtensionPaths` ผ่าน `loadExtensions()`
- การสร้างเส้นทาง CLI (`main.ts`) ปัจจุบันจะล้างเส้นทางส่วนขยาย CLI เมื่อตั้ง `--no-extensions` ดังนั้น `-e/--hook` ที่ระบุชัดเจนจะไม่ถูกส่งต่อในโหมดนั้น

### ปิดใช้งานโมดูลส่วนขยายเฉพาะ

การตั้งค่า `disabledExtensions` กรองด้วยรูปแบบ extension id:

- `extension-module:<derivedName>`

`derivedName` อ้างอิงจากเส้นทาง entry (`getExtensionNameFromPath`) ตัวอย่างเช่น:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

ตัวอย่าง:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## การ resolve เส้นทางและ entry

### การ normalize เส้นทาง

สำหรับเส้นทางที่กำหนดค่า:

1. Normalize ช่องว่าง unicode
2. ขยาย `~`
3. หากเป็นเส้นทางสัมพัทธ์ ให้ resolve ตาม `cwd` ปัจจุบัน

### หากเส้นทางที่กำหนดค่าเป็นไฟล์

จะถูกใช้โดยตรงเป็นตัวเลือก module entry

### หากเส้นทางที่กำหนดค่าเป็นไดเรกทอรี

ลำดับการ resolve:

1. `package.json` ในไดเรกทอรีนั้นที่มี `xcsh.extensions` (หรือ `pi.extensions` แบบ legacy) -> ใช้ entries ที่ประกาศ
2. `index.ts`
3. `index.js`
4. มิฉะนั้นสแกนหนึ่งระดับสำหรับ extension entries:
   - `*.ts` / `*.js` โดยตรง
   - `index.ts` / `index.js` ในไดเรกทอรีย่อย
   - `package.json` ในไดเรกทอรีย่อยที่มี `xcsh.extensions` / `pi.extensions`

กฎและข้อจำกัด:

- ไม่มีการค้นพบแบบ recursive เกินกว่าหนึ่งระดับไดเรกทอรีย่อย
- entries ของ manifest `extensions` ที่ประกาศจะถูก resolve สัมพัทธ์กับไดเรกทอรีแพ็คเกจนั้น
- entries ที่ประกาศจะถูกรวมเฉพาะเมื่อไฟล์มีอยู่/การเข้าถึงได้รับอนุญาต
- ในคู่ `*/index.{ts,js}` TypeScript จะถูกเลือกก่อน JavaScript
- symlink ถูกถือว่าเป็นไฟล์/ไดเรกทอรีที่มีสิทธิ์

### พฤติกรรมการละเว้นแตกต่างกันตามแหล่งที่มา

- การค้นพบอัตโนมัติแบบ native (`discoverExtensionModulePaths` ใน discovery helpers) ใช้ native glob ที่มี `gitignore: true` และ `hidden: false`
- การสแกนไดเรกทอรีที่กำหนดค่าอย่างชัดเจนใน `loader.ts` ใช้กฎ `readdir` และ **ไม่** ใช้การกรอง gitignore

---

## ลำดับการโหลดและความสำคัญ

`discoverAndLoadExtensions()` สร้างรายการที่เรียงลำดับหนึ่งรายการ จากนั้นเรียก `loadExtensions()`

ลำดับ:

1. โมดูลที่ค้นพบอัตโนมัติแบบ native
2. เส้นทางที่กำหนดค่าอย่างชัดเจน (ตามลำดับที่ให้มา)

ใน `sdk.ts` ลำดับที่กำหนดค่าคือ:

1. เส้นทางเพิ่มเติมจาก CLI
2. `extensions` จากการตั้งค่า

การตัดรายการซ้ำ:

- อ้างอิงจากเส้นทางแบบ absolute
- เส้นทางที่พบก่อนจะถูกใช้
- เส้นทางซ้ำที่ตามมาจะถูกละเว้น

นัยยะ: หากเส้นทางโมดูลเดียวกันถูกทั้งค้นพบอัตโนมัติและกำหนดค่าอย่างชัดเจน จะถูกโหลดครั้งเดียวที่ตำแหน่งแรก (ขั้นตอนการค้นพบอัตโนมัติ)

---

## การนำเข้าโมดูลและข้อตกลง factory

แต่ละเส้นทางตัวเลือกจะถูกโหลดด้วย dynamic import:

- `await import(resolvedPath)`
- factory คือ `module.default ?? module`
- factory ต้องเป็นฟังก์ชัน (`ExtensionFactory`)

หาก export ไม่ใช่ฟังก์ชัน เส้นทางนั้นจะล้มเหลวด้วยข้อผิดพลาดที่มีโครงสร้างและการโหลดจะดำเนินต่อไป

---

## การจัดการความล้มเหลวและการแยกส่วน

### ระหว่างการโหลด

สำหรับแต่ละเส้นทางส่วนขยาย ความล้มเหลวจะถูกบันทึกเป็น `{ path, error }` และไม่หยุดการโหลดเส้นทางอื่น

กรณีที่พบบ่อย:

- การนำเข้าล้มเหลว / ไฟล์ไม่พบ
- การ export factory ไม่ถูกต้อง (ไม่ใช่ฟังก์ชัน)
- exception ถูกโยนขณะดำเนินการ factory

### โมเดลการแยกส่วนขณะ runtime

- ส่วนขยาย **ไม่ได้ถูก sandbox** (ใช้ process/runtime เดียวกัน)
- ส่วนขยายทั้งหมดใช้ `EventBus` หนึ่งตัวและอินสแตนซ์ `ExtensionRuntime` หนึ่งตัวร่วมกัน
- ระหว่างการโหลด เมธอด runtime action จะโยน `ExtensionRuntimeNotInitializedError` โดยตั้งใจ; การเชื่อมต่อ action จะเกิดขึ้นภายหลังใน `ExtensionRunner.initialize()`

### หลังจากการโหลด

เมื่อ event ทำงานผ่าน `ExtensionRunner` exception ของ handler จะถูกจับและปล่อยออกมาเป็นข้อผิดพลาดของส่วนขยาย แทนที่จะทำให้ลูปของ runner หยุดทำงาน

---

## ตัวอย่างโครงสร้างไฟล์ขั้นต่ำระดับผู้ใช้/โปรเจกต์

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
