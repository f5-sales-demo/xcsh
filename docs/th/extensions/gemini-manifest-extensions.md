---
title: Gemini Manifest Extensions
description: >-
  รูปแบบ manifest extension ของ Gemini
  สำหรับความเข้ากันได้ของสกิลและเอเจนต์ข้ามแพลตฟอร์ม
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini Manifest Extensions (`gemini-extension.json`)

เอกสารนี้ครอบคลุมวิธีที่ coding-agent ค้นพบและแยกวิเคราะห์ Gemini-style manifest extensions (`gemini-extension.json`) ให้เป็น `extensions` capability

เอกสารนี้ **ไม่ครอบคลุม** การโหลด TypeScript/JavaScript extension module (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) ซึ่งมีเอกสารไว้ใน `extension-loading.md`

## ไฟล์ที่เกี่ยวข้องกับการนำไปใช้งาน

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## สิ่งที่ถูกค้นพบ

Gemini provider (`id: gemini`, priority `60`) ลงทะเบียน `extensions` loader ที่สแกนรูทแบบคงที่สองตำแหน่ง ได้แก่:

- ผู้ใช้: `~/.gemini/extensions`
- โปรเจกต์: `<cwd>/.gemini/extensions`

การกำหนด path ดำเนินการโดยตรงจาก `ctx.home` และ `ctx.cwd` ผ่าน `getUserPath()` / `getProjectPath()`

กฎขอบเขตที่สำคัญ: การค้นหาโปรเจกต์จะ **จำกัดเฉพาะ cwd เท่านั้น** โดยไม่มีการสำรวจไดเรกทอรีแม่

---

## กฎการสแกนไดเรกทอรี

สำหรับแต่ละรูท (`~/.gemini/extensions` และ `<cwd>/.gemini/extensions`) การค้นพบจะดำเนินการดังนี้:

1. `readDirEntries(root)`
2. เก็บเฉพาะไดเรกทอรีย่อยโดยตรง (`entry.isDirectory()`)
3. สำหรับแต่ละ `<name>` ย่อย พยายามอ่านเฉพาะ:
   - `<root>/<name>/gemini-extension.json`

ไม่มีการสแกนแบบ recursive เกินกว่าหนึ่งระดับไดเรกทอรี

### ไดเรกทอรีที่ซ่อนอยู่

การค้นพบ Gemini manifest **ไม่กรอง** ชื่อไดเรกทอรีที่ขึ้นต้นด้วยจุด หากมีไดเรกทอรีย่อยที่ซ่อนอยู่และมี `gemini-extension.json` อยู่ภายใน ก็จะถูกนำมาพิจารณา

### ไฟล์ที่ขาดหายหรืออ่านไม่ได้

หาก `gemini-extension.json` ขาดหายหรืออ่านไม่ได้ ไดเรกทอรีนั้นจะถูกข้ามผ่านอย่างเงียบๆ (ไม่มีการแจ้งเตือน)

---

## รูปร่างของ Manifest (ตามที่นำไปใช้งาน)

ประเภท capability กำหนดรูปร่างของ manifest ดังนี้:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

พฤติกรรมในขณะค้นพบถูกออกแบบให้ยืดหยุ่น:

- จำเป็นต้องแยกวิเคราะห์ JSON สำเร็จ
- ไม่มีการตรวจสอบ schema แบบ runtime สำหรับประเภท/เนื้อหาของฟิลด์ นอกจากไวยากรณ์ JSON
- ออบเจกต์ที่แยกวิเคราะห์แล้วจะถูกเก็บเป็น `manifest` บน capability item

### การทำให้ชื่อเป็นมาตรฐาน

`Extension.name` จะถูกกำหนดเป็น:

1. `manifest.name` หากไม่ใช่ `null`/`undefined`
2. มิฉะนั้นใช้ชื่อไดเรกทอรี extension

ไม่มีการบังคับใช้ประเภท string ในขั้นตอนนี้

---

## การสร้าง capability items

manifest ที่แยกวิเคราะห์สำเร็จจะสร้าง `Extension` capability item หนึ่งรายการ:

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

- `_source.path` ถูกทำให้เป็น absolute path โดย `createSourceMeta()`
- การตรวจสอบ capability ระดับ registry สำหรับ `extensions` จะตรวจสอบเฉพาะการมีอยู่ของ `name` และ `path` เท่านั้น
- ข้อมูลภายใน manifest (`mcpServers`, `tools`, `context`) ไม่ถูกตรวจสอบในระหว่างการค้นพบ

---

## การจัดการข้อผิดพลาดและความหมายของการแจ้งเตือน

### มีการแจ้งเตือน

- JSON ไม่ถูกต้องในไฟล์ manifest:
  - รูปแบบการแจ้งเตือน: `Invalid JSON in <manifestPath>`

### ไม่มีการแจ้งเตือน (ข้ามผ่านอย่างเงียบๆ)

- ไดเรกทอรี `extensions` ขาดหาย
- ไดเรกทอรีย่อยไม่มี `gemini-extension.json`
- ไฟล์ manifest อ่านไม่ได้
- JSON ของ manifest ถูกต้องทางไวยากรณ์แต่มีความหมายที่ผิดปกติหรือไม่สมบูรณ์

ซึ่งหมายความว่ายอมรับความถูกต้องบางส่วนได้: เฉพาะความล้มเหลวทางไวยากรณ์ JSON เท่านั้นที่จะส่งการแจ้งเตือน

---

## ลำดับความสำคัญและการกำจัดรายการซ้ำจากแหล่งอื่น

`extensions` capability ถูกรวบรวมจากหลาย provider โดย capability registry

Provider ปัจจุบันสำหรับ capability นี้:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) priority `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) priority `60`

คีย์สำหรับกำจัดรายการซ้ำคือ `ext.name` (`extensionCapability.key = ext => ext.name`)

### ลำดับความสำคัญข้ามแพลตฟอร์ม

Provider ที่มี priority สูงกว่าจะชนะเมื่อชื่อ extension ซ้ำกัน

- หาก `native` และ `gemini` ต่างส่งออก extension ชื่อ `foo` รายการของ native จะถูกเก็บไว้
- รายการซ้ำที่มี priority ต่ำกว่าจะถูกเก็บไว้ใน `result.all` เท่านั้น โดยมี `_shadowed = true`

### ผลกระทบของลำดับภายใน provider เดียวกัน

เนื่องจากการกำจัดรายการซ้ำใช้หลักการ "รายการแรกที่พบชนะ" ลำดับ item ภายใน provider จึงมีความสำคัญ

- Gemini loader เพิ่ม **user ก่อน** แล้วจึง **project**
- ดังนั้น ชื่อซ้ำกันระหว่าง `~/.gemini/extensions` และ `<cwd>/.gemini/extensions` จะเก็บรายการของ user และ shadow รายการของ project

ในทางกลับกัน native provider สร้างลำดับไดเรกทอรี config แตกต่างออกไป (`project` ก่อน `user` ใน `getConfigDirs()`) ดังนั้น การ shadow ภายใน native provider จึงเป็นทิศทางตรงกันข้าม

---

## สรุปพฤติกรรมของ user และ project

สำหรับ Gemini manifest โดยเฉพาะ:

- ทั้งรูทของ user และ project จะถูกสแกนทุกครั้งที่โหลด
- รูทของ project ถูกกำหนดไว้ที่ `<cwd>/.gemini/extensions` (ไม่มีการสำรวจไดเรกทอรีแม่)
- ชื่อซ้ำกันภายในแหล่ง Gemini จะใช้ user เป็นหลัก
- ชื่อซ้ำกันกับ provider ที่มี priority สูงกว่า (โดยเฉพาะ native) จะแพ้ตามลำดับ priority

---

## ขอบเขต: metadata การค้นพบ vs การโหลด extension แบบ runtime

การค้นพบ `gemini-extension.json` ในปัจจุบันให้ข้อมูล capability metadata (รายการ `Extension`) โดย **ไม่** โหลด TS/JS extension module ที่รันได้โดยตรง

การโหลด module แบบ runtime (`discoverAndLoadExtensions()` / `loadExtensions()`) ใช้ `extension-modules` และ path ที่ระบุอย่างชัดเจน และปัจจุบันกรองโมดูลที่ค้นพบอัตโนมัติให้เฉพาะ provider `native` เท่านั้น

ผลที่เกิดขึ้นในทางปฏิบัติ:

- Gemini manifest extensions สามารถค้นพบได้ในฐานะ capability records
- โดยตัวเองแล้ว extension เหล่านี้จะไม่ถูกรันในฐานะ runtime extension modules โดย extension loader pipeline

ขอบเขตนี้เป็นการออกแบบโดยเจตนาในการนำไปใช้งานปัจจุบัน และอธิบายว่าเหตุใดการค้นพบ manifest และการโหลด executable module จึงอาจแยกออกจากกันได้
