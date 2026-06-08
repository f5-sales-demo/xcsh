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

# การโหลดส่วนขยาย (โมดูล TypeScript/JavaScript)

เอกสารนี้ครอบคลุมวิธีที่ coding agent ค้นหาและโหลด**โมดูลส่วนขยาย** (`.ts`/`.js`) ขณะเริ่มต้นทำงาน

เอกสารนี้**ไม่**ครอบคลุมส่วนขยายแบบ manifest `gemini-extension.json` (มีเอกสารแยกต่างหาก)

## สิ่งที่ระบบย่อมนี้ทำ

การโหลดส่วนขยายจะสร้างรายการไฟล์ entry ของโมดูล นำเข้าแต่ละโมดูลด้วย Bun ดำเนินการ factory และส่งคืน:

- คำจำกัดความของส่วนขยายที่โหลดแล้ว
- ข้อผิดพลาดในการโหลดแบบต่อ path (โดยไม่ยกเลิกการโหลดทั้งหมด)
- อ็อบเจกต์รันไทม์ส่วนขยายที่ใช้ร่วมกัน ซึ่งจะถูกใช้ภายหลังโดย `ExtensionRunner`

## ไฟล์การ implement หลัก

- `src/extensibility/extensions/loader.ts` — การค้นหา path + การนำเข้า/ดำเนินการ
- `src/extensibility/extensions/index.ts` — exports สาธารณะ
- `src/extensibility/extensions/runner.ts` — การดำเนินการรันไทม์/event หลังโหลด
- `src/discovery/builtin.ts` — native auto-discovery provider สำหรับโมดูลส่วนขยาย
- `src/config/settings.ts` — โหลดการตั้งค่า `extensions` / `disabledExtensions` ที่รวมแล้ว

---

## อินพุตสำหรับการโหลดส่วนขยาย

### 1) โมดูลส่วนขยาย native ที่ค้นพบอัตโนมัติ

`discoverAndLoadExtensions()` จะถาม discovery providers เพื่อขอรายการ capability `extension-module` ก่อน จากนั้นจึงเก็บเฉพาะรายการที่เป็น provider `native`

ตำแหน่ง native ที่มีผล:

- โปรเจกต์: `<cwd>/.xcsh/extensions`
- ผู้ใช้: `~/.xcsh/agent/extensions`

ราก path มาจาก native provider (`SOURCE_PATHS.native`)

หมายเหตุ:

- Native auto-discovery ในปัจจุบันใช้ฐาน `.xcsh`
- `.pi` แบบ legacy ยังคงยอมรับในคีย์ manifest ของ `package.json` (`pi.extensions`) แต่ไม่ใช่เป็นราก native ที่นี่

### 2) path ที่กำหนดค่าไว้อย่างชัดเจน

หลังจาก auto-discovery จะมีการเพิ่มและ resolve path ที่กำหนดค่าไว้

แหล่งที่มาของ path ที่กำหนดค่าไว้ใน path เริ่มต้นเซสชันหลัก (`sdk.ts`):

1. path ที่ให้ผ่าน CLI (`--extension/-e` และ `--hook` ก็ถูกถือว่าเป็น path ส่วนขยายเช่นกัน)
2. อาร์เรย์ `extensions` ในการตั้งค่า (การตั้งค่า global + โปรเจกต์ที่รวมแล้ว)

ไฟล์การตั้งค่า global:

- `~/.xcsh/agent/config.yml` (หรือไดเรกทอรี agent ที่กำหนดเองผ่าน `PI_CODING_AGENT_DIR`)

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

## การควบคุมเปิด/ปิดใช้งาน

### ปิดใช้งาน discovery

- CLI: `--no-extensions`
- ตัวเลือก SDK: `disableExtensionDiscovery`

พฤติกรรมที่แตกต่าง:

- SDK: เมื่อ `disableExtensionDiscovery=true` จะยังคงโหลด `additionalExtensionPaths` ผ่าน `loadExtensions()`
- การสร้าง path ทาง CLI (`main.ts`) ในปัจจุบันจะล้าง path ส่วนขยายจาก CLI เมื่อตั้งค่า `--no-extensions` ดังนั้น `-e/--hook` ที่ระบุชัดเจนจะไม่ถูกส่งต่อในโหมดนั้น

### ปิดใช้งานโมดูลส่วนขยายเฉพาะ

การตั้งค่า `disabledExtensions` กรองด้วยรูปแบบ id ส่วนขยาย:

- `extension-module:<derivedName>`

`derivedName` อิงจาก entry path (`getExtensionNameFromPath`) ตัวอย่างเช่น:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

ตัวอย่าง:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## การ resolve path และ entry

### การทำ path ให้เป็นมาตรฐาน

สำหรับ path ที่กำหนดค่าไว้:

1. ทำ unicode spaces ให้เป็นมาตรฐาน
2. ขยาย `~`
3. หากเป็น relative ให้ resolve เทียบกับ `cwd` ปัจจุบัน

### หาก path ที่กำหนดค่าเป็นไฟล์

จะถูกใช้โดยตรงเป็นตัวเลือก module entry

### หาก path ที่กำหนดค่าเป็นไดเรกทอรี

ลำดับการ resolve:

1. `package.json` ในไดเรกทอรีนั้นที่มี `xcsh.extensions` (หรือ legacy `pi.extensions`) -> ใช้ entries ที่ประกาศไว้
2. `index.ts`
3. `index.js`
4. มิฉะนั้นสแกนหนึ่งระดับเพื่อหา extension entries:
   - `*.ts` / `*.js` โดยตรง
   - ไดเรกทอรีย่อย `index.ts` / `index.js`
   - ไดเรกทอรีย่อย `package.json` ที่มี `xcsh.extensions` / `pi.extensions`

กฎและข้อจำกัด:

- ไม่มีการค้นหาแบบ recursive เกินหนึ่งระดับไดเรกทอรีย่อย
- entries ที่ประกาศใน manifest `extensions` จะ resolve เทียบกับไดเรกทอรีของ package นั้น
- entries ที่ประกาศจะถูกรวมเฉพาะเมื่อไฟล์มีอยู่/การเข้าถึงได้รับอนุญาต
- ในคู่ `*/index.{ts,js}` TypeScript จะถูกเลือกก่อน JavaScript
- symlinks ถูกถือว่าเป็นไฟล์/ไดเรกทอรีที่มีสิทธิ์

### พฤติกรรมการเพิกเฉยแตกต่างตามแหล่งที่มา

- Native auto-discovery (`discoverExtensionModulePaths` ใน discovery helpers) ใช้ native glob ที่มี `gitignore: true` และ `hidden: false`
- การสแกนไดเรกทอรีที่กำหนดค่าอย่างชัดเจนใน `loader.ts` ใช้กฎ `readdir` และ**ไม่**ใช้การกรอง gitignore

---

## ลำดับการโหลดและความสำคัญ

`discoverAndLoadExtensions()` สร้างรายการเรียงลำดับหนึ่งรายการแล้วเรียก `loadExtensions()`

ลำดับ:

1. โมดูลที่ค้นพบอัตโนมัติแบบ native
2. path ที่กำหนดค่าอย่างชัดเจน (ตามลำดับที่ให้มา)

ใน `sdk.ts` ลำดับที่กำหนดค่าคือ:

1. path เพิ่มเติมจาก CLI
2. `extensions` จากการตั้งค่า

การกำจัดรายการซ้ำ:

- อิงจาก absolute path
- path ที่เห็นก่อนจะชนะ
- รายการซ้ำในภายหลังจะถูกเพิกเฉย

ผลที่ตามมา: หาก path โมดูลเดียวกันถูกค้นพบอัตโนมัติและกำหนดค่าอย่างชัดเจนทั้งสองทาง จะถูกโหลดครั้งเดียวที่ตำแหน่งแรก (ขั้นตอนค้นพบอัตโนมัติ)

---

## การนำเข้าโมดูลและสัญญา factory

แต่ละ path ตัวเลือกจะถูกโหลดด้วย dynamic import:

- `await import(resolvedPath)`
- factory คือ `module.default ?? module`
- factory ต้องเป็นฟังก์ชัน (`ExtensionFactory`)

หาก export ไม่ใช่ฟังก์ชัน path นั้นจะล้มเหลวพร้อมข้อผิดพลาดที่มีโครงสร้างและการโหลดจะดำเนินต่อ

---

## การจัดการความล้มเหลวและการแยกส่วน

### ระหว่างการโหลด

สำหรับแต่ละ path ส่วนขยาย ความล้มเหลวจะถูกจับเป็น `{ path, error }` และไม่หยุด path อื่นจากการโหลด

กรณีที่พบบ่อย:

- การนำเข้าล้มเหลว / ไฟล์หาไม่พบ
- factory export ไม่ถูกต้อง (ไม่ใช่ฟังก์ชัน)
- exception ที่ถูกโยนขณะดำเนินการ factory

### โมเดลการแยกส่วนรันไทม์

- ส่วนขยาย**ไม่ได้ถูก sandbox** (process/runtime เดียวกัน)
- แชร์ `EventBus` หนึ่งตัวและอินสแตนซ์ `ExtensionRuntime` หนึ่งตัว
- ระหว่างการโหลด เมธอด action ของรันไทม์จะโยน `ExtensionRuntimeNotInitializedError` โดยตั้งใจ การเชื่อมต่อ action จะเกิดขึ้นภายหลังใน `ExtensionRunner.initialize()`

### หลังการโหลด

เมื่อ event ทำงานผ่าน `ExtensionRunner` exception ของ handler จะถูกจับและส่งออกเป็นข้อผิดพลาดส่วนขยายแทนที่จะทำให้ runner loop หยุดทำงาน

---

## ตัวอย่างเลย์เอาต์ระดับผู้ใช้/โปรเจกต์แบบขั้นต่ำ

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

คีย์ manifest แบบ legacy ยังคงยอมรับ:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
