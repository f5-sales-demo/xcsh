---
title: ส่วนขยาย Gemini Manifest
description: >-
  รูปแบบส่วนขยาย Gemini manifest สำหรับความเข้ากันได้ข้ามแพลตฟอร์มของ skill และ
  agent
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# ส่วนขยาย Gemini Manifest (`gemini-extension.json`)

เอกสารนี้ครอบคลุมวิธีที่ coding-agent ค้นพบและแยกวิเคราะห์ส่วนขยาย Gemini-style manifest (`gemini-extension.json`) ลงในความสามารถ `extensions`

เอกสารนี้ **ไม่ครอบคลุม** การโหลดโมดูลส่วนขยาย TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) ซึ่งมีเอกสารอยู่ใน `extension-loading.md`

## ไฟล์การดำเนินการ

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## สิ่งที่ถูกค้นพบ

ผู้ให้บริการ Gemini (`id: gemini`, ลำดับความสำคัญ `60`) ลงทะเบียน loader ของ `extensions` ที่สแกนรากสองตำแหน่งที่กำหนดไว้:

- ผู้ใช้: `~/.gemini/extensions`
- โปรเจกต์: `<cwd>/.gemini/extensions`

การแก้ไขเส้นทางดำเนินการโดยตรงจาก `ctx.home` และ `ctx.cwd` ผ่าน `getUserPath()` / `getProjectPath()`

กฎขอบเขตที่สำคัญ: การค้นหาโปรเจกต์เป็น **เฉพาะ cwd** เท่านั้น ไม่มีการเดินผ่านไดเรกทอรีหลัก

---

## กฎการสแกนไดเรกทอรี

สำหรับแต่ละราก (`~/.gemini/extensions` และ `<cwd>/.gemini/extensions`) การค้นพบจะทำสิ่งต่อไปนี้:

1. `readDirEntries(root)`
2. เก็บเฉพาะไดเรกทอรีลูกโดยตรง (`entry.isDirectory()`)
3. สำหรับแต่ละลูก `<name>` พยายามอ่านเฉพาะ:
   - `<root>/<name>/gemini-extension.json`

ไม่มีการสแกนแบบเรียกซ้ำเกินหนึ่งระดับไดเรกทอรี

### ไดเรกทอรีที่ซ่อนอยู่

การค้นพบ Gemini manifest **ไม่กรอง** ชื่อไดเรกทอรีที่ขึ้นต้นด้วยจุด หากมีไดเรกทอรีลูกที่ซ่อนอยู่และมี `gemini-extension.json` อยู่ภายใน ไดเรกทอรีนั้นจะถูกพิจารณา

### ไฟล์ที่หายไป/อ่านไม่ได้

หาก `gemini-extension.json` หายไปหรืออ่านไม่ได้ ไดเรกทอรีนั้นจะถูกข้ามอย่างเงียบๆ (ไม่มีคำเตือน)

---

## รูปแบบ Manifest (ตามที่ดำเนินการ)

ประเภทความสามารถกำหนดรูปแบบ manifest ดังนี้:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

พฤติกรรมในเวลาค้นพบมีความยืดหยุ่นโดยเจตนา:

- จำเป็นต้องแยกวิเคราะห์ JSON ได้สำเร็จ
- ไม่มีการตรวจสอบ schema ขณะรันไทม์สำหรับประเภทฟิลด์/เนื้อหาเกินกว่าไวยากรณ์ JSON
- วัตถุที่แยกวิเคราะห์แล้วจะถูกเก็บไว้เป็น `manifest` บนรายการความสามารถ

### การทำให้ชื่อเป็นมาตรฐาน

`Extension.name` ถูกตั้งค่าเป็น:

1. `manifest.name` หากไม่ใช่ `null`/`undefined`
2. มิฉะนั้นจะใช้ชื่อไดเรกทอรีส่วนขยาย

ไม่มีการบังคับใช้ประเภทสตริงที่นี่

---

## การสร้างรายการความสามารถ

manifest ที่แยกวิเคราะห์ได้ถูกต้องจะสร้างรายการความสามารถ `Extension` หนึ่งรายการ:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // แนบโดย capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

หมายเหตุ:

- `_source.path` ถูกทำให้เป็นเส้นทางสัมบูรณ์โดย `createSourceMeta()`
- การตรวจสอบความสามารถระดับ Registry สำหรับ `extensions` จะตรวจสอบเฉพาะการมีอยู่ของ `name` และ `path`
- รายละเอียดภายใน manifest (`mcpServers`, `tools`, `context`) ไม่ได้รับการตรวจสอบในระหว่างการค้นพบ

---

## การจัดการข้อผิดพลาดและความหมายของคำเตือน

### มีคำเตือน

- JSON ไม่ถูกต้องในไฟล์ manifest:
  - รูปแบบคำเตือน: `Invalid JSON in <manifestPath>`

### ไม่มีคำเตือน (ข้ามอย่างเงียบๆ)

- ไดเรกทอรี `extensions` หายไป
- ไดเรกทอรีลูกไม่มี `gemini-extension.json`
- ไฟล์ manifest อ่านไม่ได้
- manifest JSON มีไวยากรณ์ถูกต้องแต่มีความหมายที่แปลกหรือไม่สมบูรณ์

ซึ่งหมายความว่าการยอมรับความถูกต้องบางส่วน: เฉพาะความล้มเหลวด้านไวยากรณ์ JSON เท่านั้นที่ส่งคำเตือน

---

## ลำดับความสำคัญและการกำจัดซ้ำกับแหล่งอื่น

ความสามารถ `extensions` ถูกรวบรวมข้ามผู้ให้บริการโดย capability registry

ผู้ให้บริการปัจจุบันสำหรับความสามารถนี้:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) ลำดับความสำคัญ `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) ลำดับความสำคัญ `60`

คีย์การกำจัดซ้ำคือ `ext.name` (`extensionCapability.key = ext => ext.name`)

### ลำดับความสำคัญข้ามผู้ให้บริการ

ผู้ให้บริการที่มีลำดับความสำคัญสูงกว่าจะชนะเมื่อมีชื่อส่วนขยายซ้ำกัน

- หาก `native` และ `gemini` ต่างปล่อยชื่อส่วนขยาย `foo` รายการของ native จะถูกเก็บไว้
- รายการที่ซ้ำกันซึ่งมีลำดับความสำคัญต่ำกว่าจะถูกเก็บไว้เฉพาะใน `result.all` โดยมี `_shadowed = true`

### ผลกระทบของลำดับภายในผู้ให้บริการ

เนื่องจากการกำจัดซ้ำใช้หลัก "ที่เห็นก่อนชนะ" ลำดับรายการภายในผู้ให้บริการจึงมีความสำคัญ

- Gemini loader เพิ่ม **ผู้ใช้ก่อน** จากนั้นจึงเป็น **โปรเจกต์**
- ดังนั้น ชื่อซ้ำกันระหว่าง `~/.gemini/extensions` และ `<cwd>/.gemini/extensions` จะเก็บรายการของผู้ใช้และซ่อนรายการของโปรเจกต์

ในทางกลับกัน ผู้ให้บริการ native สร้างลำดับไดเรกทอรี config แตกต่างออกไป (`project` ก่อน `user` ใน `getConfigDirs()`) ดังนั้นการซ่อนภายในผู้ให้บริการ native จึงเป็นทิศทางตรงกันข้าม

---

## สรุปพฤติกรรม User กับ Project

สำหรับ Gemini manifest โดยเฉพาะ:

- ทั้งรากของผู้ใช้และโปรเจกต์จะถูกสแกนทุกครั้งที่โหลด
- รากของโปรเจกต์ถูกกำหนดไว้ที่ `<cwd>/.gemini/extensions` (ไม่มีการเดินผ่านไปยังบรรพบุรุษ)
- ชื่อซ้ำกันภายในแหล่ง Gemini จะแก้ไขโดยใช้ผู้ใช้ก่อน
- ชื่อซ้ำกันกับผู้ให้บริการที่มีลำดับความสำคัญสูงกว่า (โดยเฉพาะ native) จะแพ้ตามลำดับความสำคัญ

---

## ขอบเขต: เมตาดาต้าการค้นพบ กับ การโหลดส่วนขยายขณะรันไทม์

การค้นพบ `gemini-extension.json` ในปัจจุบันป้อนข้อมูลเมตาดาต้าความสามารถ (รายการ `Extension`) เท่านั้น **ไม่ได้** โหลดโมดูลส่วนขยาย TS/JS ที่สามารถรันได้โดยตรง

การโหลดโมดูลขณะรันไทม์ (`discoverAndLoadExtensions()` / `loadExtensions()`) ใช้ `extension-modules` และเส้นทางที่ระบุอย่างชัดเจน และในปัจจุบันกรองโมดูลที่ค้นพบอัตโนมัติให้เฉพาะผู้ให้บริการ `native` เท่านั้น

ผลที่เป็นรูปธรรม:

- ส่วนขยาย Gemini manifest สามารถค้นพบได้ในฐานะระเบียนความสามารถ
- ส่วนขยายเหล่านั้นไม่ถูกดำเนินการเป็นโมดูลส่วนขยายขณะรันไทม์โดยไปป์ไลน์ extension loader โดยตัวมันเอง

ขอบเขตนี้เป็นเจตนาในการดำเนินการปัจจุบัน และอธิบายว่าเหตุใดการค้นพบ manifest และการโหลดโมดูลที่ดำเนินการได้จึงอาจแตกต่างกัน
