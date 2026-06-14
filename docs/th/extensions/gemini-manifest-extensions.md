---
title: ส่วนขยาย Gemini Manifest
description: >-
  รูปแบบส่วนขยาย Gemini manifest
  สำหรับความเข้ากันได้ข้ามแพลตฟอร์มของสกิลและเอเจนต์
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# ส่วนขยาย Gemini Manifest (`gemini-extension.json`)

เอกสารนี้ครอบคลุมวิธีที่ coding-agent ค้นพบและแยกวิเคราะห์ส่วนขยาย Gemini-style manifest (`gemini-extension.json`) ให้เป็น capability ประเภท `extensions`

เอกสารนี้ **ไม่ครอบคลุม** การโหลดโมดูลส่วนขยาย TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) ซึ่งมีเอกสารอยู่ใน `extension-loading.md`

## ไฟล์ที่เกี่ยวข้องกับการ Implement

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## สิ่งที่ถูกค้นพบ

Gemini provider (`id: gemini`, priority `60`) ลงทะเบียน loader ประเภท `extensions` ที่สแกนรากสองตำแหน่งที่กำหนดตายตัว:

- ระดับผู้ใช้: `~/.gemini/extensions`
- ระดับโปรเจกต์: `<cwd>/.gemini/extensions`

การแก้ไขพาธดำเนินการโดยตรงจาก `ctx.home` และ `ctx.cwd` ผ่าน `getUserPath()` / `getProjectPath()`

กฎขอบเขตที่สำคัญ: การค้นหาระดับโปรเจกต์เป็นแบบ **cwd เท่านั้น** ไม่มีการเดินขึ้นไปยังไดเรกทอรีพาเรนต์

---

## กฎการสแกนไดเรกทอรี

สำหรับแต่ละรากไดเรกทอรี (`~/.gemini/extensions` และ `<cwd>/.gemini/extensions`) กระบวนการค้นพบจะดำเนินการดังนี้:

1. `readDirEntries(root)`
2. เก็บเฉพาะไดเรกทอรีลูกโดยตรง (`entry.isDirectory()`)
3. สำหรับลูกแต่ละรายการ `<name>` จะพยายามอ่านเฉพาะ:
   - `<root>/<name>/gemini-extension.json`

ไม่มีการสแกนแบบ recursive เกินกว่าหนึ่งระดับไดเรกทอรี

### ไดเรกทอรีที่ซ่อนอยู่

การค้นพบ Gemini manifest **ไม่กรอง** ชื่อไดเรกทอรีที่ขึ้นต้นด้วยจุด หากไดเรกทอรีลูกที่ซ่อนอยู่มีไฟล์ `gemini-extension.json` อยู่ ไดเรกทอรีนั้นจะได้รับการพิจารณา

### ไฟล์ที่หายไปหรืออ่านไม่ได้

หากไม่พบ `gemini-extension.json` หรืออ่านไม่ได้ ไดเรกทอรีนั้นจะถูกข้ามไปอย่างเงียบๆ (ไม่มีการแจ้งเตือน)

---

## รูปแบบ Manifest (ตามที่ Implement)

ประเภท capability กำหนดรูปแบบ manifest ดังนี้:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

พฤติกรรมในช่วงการค้นพบมีความยืดหยุ่นโดยเจตนา:

- การแยกวิเคราะห์ JSON ต้องสำเร็จ
- ไม่มีการตรวจสอบ schema แบบ runtime สำหรับประเภทฟิลด์หรือเนื้อหา นอกจากไวยากรณ์ JSON
- อ็อบเจกต์ที่แยกวิเคราะห์แล้วจะถูกเก็บเป็น `manifest` บน capability item

### การทำให้ชื่อเป็นมาตรฐาน

`Extension.name` ถูกกำหนดให้เป็น:

1. `manifest.name` หากไม่ใช่ `null`/`undefined`
2. มิฉะนั้นใช้ชื่อไดเรกทอรีของส่วนขยาย

ไม่มีการบังคับใช้ประเภท string ในขั้นตอนนี้

---

## การ Materialize เป็น Capability Items

Manifest ที่แยกวิเคราะห์ได้สำเร็จจะสร้าง capability item ประเภท `Extension` หนึ่งรายการ:

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

- `_source.path` ถูกทำให้เป็นพาธแบบสัมบูรณ์โดย `createSourceMeta()`
- การตรวจสอบ capability ระดับ Registry สำหรับ `extensions` ตรวจสอบเฉพาะการมีอยู่ของ `name` และ `path` เท่านั้น
- เนื้อหาภายใน Manifest (`mcpServers`, `tools`, `context`) ไม่ได้รับการตรวจสอบในช่วงการค้นพบ

---

## การจัดการข้อผิดพลาดและความหมายของการแจ้งเตือน

### มีการแจ้งเตือน

- JSON ไม่ถูกต้องในไฟล์ manifest:
  - รูปแบบการแจ้งเตือน: `Invalid JSON in <manifestPath>`

### ไม่มีการแจ้งเตือน (ข้ามอย่างเงียบๆ)

- ไดเรกทอรี `extensions` หายไป
- ไดเรกทอรีลูกไม่มี `gemini-extension.json`
- ไฟล์ manifest อ่านไม่ได้
- JSON ของ manifest ถูกต้องตามไวยากรณ์แต่มีความหมายที่แปลกหรือไม่สมบูรณ์

ซึ่งหมายความว่าความถูกต้องบางส่วนเป็นที่ยอมรับ: มีการแจ้งเตือนเฉพาะเมื่อ JSON มีข้อผิดพลาดทางไวยากรณ์เท่านั้น

---

## ลำดับความสำคัญและการขจัดข้อมูลซ้ำกับแหล่งอื่น

capability ประเภท `extensions` ถูกรวบรวมจาก provider ต่างๆ โดย capability registry

Provider ปัจจุบันสำหรับ capability นี้:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) priority `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) priority `60`

คีย์การขจัดข้อมูลซ้ำคือ `ext.name` (`extensionCapability.key = ext => ext.name`)

### ลำดับความสำคัญข้ามโปรแกรม Provider

Provider ที่มีลำดับความสำคัญสูงกว่าจะชนะเมื่อชื่อส่วนขยายซ้ำกัน

- หาก `native` และ `gemini` ทั้งคู่ส่งออกชื่อส่วนขยาย `foo` รายการ native จะถูกเก็บไว้
- รายการที่ซ้ำกันและมีลำดับความสำคัญต่ำกว่าจะถูกเก็บไว้ใน `result.all` เท่านั้น โดยมี `_shadowed = true`

### ผลกระทบจากลำดับภายใน Provider

เนื่องจากการขจัดข้อมูลซ้ำใช้หลัก "รายการแรกที่พบชนะ" ลำดับรายการภายใน provider จึงมีความสำคัญ

- Gemini loader เพิ่ม **ระดับผู้ใช้ก่อน** แล้วจึงเพิ่ม **ระดับโปรเจกต์**
- ดังนั้น ชื่อที่ซ้ำกันระหว่าง `~/.gemini/extensions` และ `<cwd>/.gemini/extensions` จะเก็บรายการระดับผู้ใช้ไว้ และซ่อนรายการระดับโปรเจกต์

ในทางตรงข้าม native provider สร้างลำดับไดเรกทอรี config แตกต่างออกไป (`project` ก่อน `user` ใน `getConfigDirs()`) ดังนั้นการซ่อนข้อมูลภายใน native provider จึงเป็นไปในทิศทางตรงข้าม

---

## สรุปพฤติกรรมระดับผู้ใช้เทียบกับระดับโปรเจกต์

สำหรับ Gemini manifests โดยเฉพาะ:

- ทั้งรากระดับผู้ใช้และระดับโปรเจกต์จะถูกสแกนทุกครั้งที่โหลด
- รากระดับโปรเจกต์ถูกกำหนดตายตัวที่ `<cwd>/.gemini/extensions` (ไม่มีการเดินขึ้นไปยังบรรพบุรุษ)
- ชื่อที่ซ้ำกันภายใน Gemini source จะแก้ไขโดยให้ผู้ใช้มาก่อน
- ชื่อที่ซ้ำกันกับ provider ที่มีลำดับความสำคัญสูงกว่า (โดยเฉพาะ native) จะแพ้ตามลำดับความสำคัญ

---

## ขอบเขต: Metadata ของการค้นพบ เทียบกับ การโหลดส่วนขยาย Runtime

การค้นพบ `gemini-extension.json` ในปัจจุบันป้อนข้อมูล metadata ให้กับ capability (`Extension` items) แต่ **ไม่** โหลดโมดูลส่วนขยาย TS/JS ที่รันได้โดยตรง

การโหลดโมดูล runtime (`discoverAndLoadExtensions()` / `loadExtensions()`) ใช้ `extension-modules` และพาธที่ระบุอย่างชัดเจน และในปัจจุบันกรองโมดูลที่ค้นพบอัตโนมัติให้เหลือเฉพาะ provider `native` เท่านั้น

ผลในทางปฏิบัติ:

- ส่วนขยาย Gemini manifest สามารถค้นพบได้ในฐานะ capability records
- ส่วนขยายเหล่านั้นไม่ได้ถูกประมวลผลในฐานะโมดูลส่วนขยาย runtime โดย extension loader pipeline ด้วยตัวเอง

ขอบเขตนี้เป็นเจตนาในการ implement ปัจจุบัน และอธิบายว่าเหตุใดการค้นพบ manifest กับการโหลดโมดูลที่ประมวลผลได้จึงอาจแตกต่างกันได้
