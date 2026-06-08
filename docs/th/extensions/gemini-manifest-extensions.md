---
title: Gemini Manifest Extensions
description: >-
  Gemini manifest extension format for cross-platform skill and agent
  compatibility.
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# ส่วนขยาย Gemini Manifest (`gemini-extension.json`)

เอกสารนี้ครอบคลุมวิธีที่ coding-agent ค้นพบและแยกวิเคราะห์ส่วนขยายแบบ Gemini-style manifest (`gemini-extension.json`) เข้าสู่ capability `extensions`

เอกสารนี้**ไม่**ครอบคลุมการโหลดโมดูลส่วนขยาย TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) ซึ่งมีเอกสารอยู่ใน `extension-loading.md`

## ไฟล์การใช้งาน

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## สิ่งที่ถูกค้นพบ

ผู้ให้บริการ Gemini (`id: gemini`, ลำดับความสำคัญ `60`) ลงทะเบียนตัวโหลด `extensions` ที่สแกนสอง root คงที่:

- ผู้ใช้: `~/.gemini/extensions`
- โปรเจกต์: `<cwd>/.gemini/extensions`

การแก้ไขเส้นทางทำโดยตรงจาก `ctx.home` และ `ctx.cwd` ผ่าน `getUserPath()` / `getProjectPath()`

กฎขอบเขตที่สำคัญ: การค้นหาโปรเจกต์เป็น **เฉพาะ cwd เท่านั้น** จะไม่เดินย้อนขึ้นไปยังไดเรกทอรีแม่

---

## กฎการสแกนไดเรกทอรี

สำหรับแต่ละ root (`~/.gemini/extensions` และ `<cwd>/.gemini/extensions`) การค้นพบจะทำ:

1. `readDirEntries(root)`
2. เก็บเฉพาะไดเรกทอรีลูกโดยตรง (`entry.isDirectory()`)
3. สำหรับแต่ละลูก `<name>`, พยายามอ่านอย่างแม่นยำ:
   - `<root>/<name>/gemini-extension.json`

ไม่มีการสแกนแบบ recursive เกินกว่าหนึ่งระดับไดเรกทอรี

### ไดเรกทอรีที่ซ่อน

การค้นพบ Gemini manifest **ไม่**กรองชื่อไดเรกทอรีที่มีจุดนำหน้าออก หากไดเรกทอรีลูกที่ซ่อนมีอยู่และมี `gemini-extension.json` จะถูกพิจารณา

### ไฟล์ที่หายไป/อ่านไม่ได้

หาก `gemini-extension.json` หายไปหรืออ่านไม่ได้ ไดเรกทอรีนั้นจะถูกข้ามอย่างเงียบๆ (ไม่มีคำเตือน)

---

## รูปร่างของ manifest (ตามที่ใช้งาน)

ประเภท capability กำหนดรูปร่าง manifest นี้:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

พฤติกรรมในเวลาค้นพบเป็นแบบหลวมโดยเจตนา:

- ต้องการ JSON parse สำเร็จ
- ไม่มีการตรวจสอบ schema ในขณะ runtime สำหรับประเภท/เนื้อหาของฟิลด์นอกเหนือจากไวยากรณ์ JSON
- อ็อบเจกต์ที่แยกวิเคราะห์แล้วจะถูกเก็บเป็น `manifest` บนรายการ capability

### การทำให้ชื่อเป็นมาตรฐาน

`Extension.name` ถูกตั้งค่าเป็น:

1. `manifest.name` หากไม่ใช่ `null`/`undefined`
2. มิฉะนั้นใช้ชื่อไดเรกทอรีส่วนขยาย

ไม่มีการบังคับประเภท string ที่นี่

---

## การทำให้เป็นรูปธรรมเป็นรายการ capability

manifest ที่แยกวิเคราะห์ถูกต้องจะสร้างรายการ capability `Extension` หนึ่งรายการ:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attached by capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

หมายเหตุ:

- `_source.path` ถูกทำให้เป็นมาตรฐานเป็นเส้นทางสัมบูรณ์โดย `createSourceMeta()`
- การตรวจสอบ capability ระดับ registry สำหรับ `extensions` จะตรวจสอบเฉพาะการมีอยู่ของ `name` และ `path`
- ส่วนภายในของ manifest (`mcpServers`, `tools`, `context`) จะไม่ถูกตรวจสอบระหว่างการค้นพบ

---

## การจัดการข้อผิดพลาดและความหมายของคำเตือน

### มีคำเตือน

- JSON ไม่ถูกต้องในไฟล์ manifest:
  - รูปแบบคำเตือน: `Invalid JSON in <manifestPath>`

### ไม่มีคำเตือน (ข้ามอย่างเงียบๆ)

- ไดเรกทอรี `extensions` หายไป
- ไดเรกทอรีลูกไม่มี `gemini-extension.json`
- ไฟล์ manifest อ่านไม่ได้
- manifest JSON ถูกต้องทางไวยากรณ์แต่แปลก/ไม่สมบูรณ์ทางความหมาย

นี่หมายความว่าความถูกต้องบางส่วนเป็นที่ยอมรับ: เฉพาะความล้มเหลวทางไวยากรณ์ JSON เท่านั้นที่ปล่อยคำเตือน

---

## ลำดับความสำคัญและการขจัดรายการซ้ำกับแหล่งอื่น

capability `extensions` ถูกรวบรวมข้ามผู้ให้บริการโดย capability registry

ผู้ให้บริการปัจจุบันสำหรับ capability นี้:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) ลำดับความสำคัญ `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) ลำดับความสำคัญ `60`

คีย์ขจัดรายการซ้ำคือ `ext.name` (`extensionCapability.key = ext => ext.name`)

### ลำดับความสำคัญข้ามผู้ให้บริการ

ผู้ให้บริการที่มีลำดับความสำคัญสูงกว่าชนะเมื่อชื่อส่วนขยายซ้ำกัน

- หาก `native` และ `gemini` ทั้งคู่ปล่อยชื่อส่วนขยาย `foo` รายการ native จะถูกเก็บไว้
- รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะถูกเก็บไว้เฉพาะใน `result.all` ด้วย `_shadowed = true`

### ผลกระทบของลำดับภายในผู้ให้บริการ

เนื่องจากการขจัดรายการซ้ำเป็นแบบ "ตัวแรกที่เห็นชนะ" ลำดับรายการภายในผู้ให้บริการจึงมีความสำคัญ

- ตัวโหลด Gemini เพิ่ม **ผู้ใช้ก่อน** จากนั้น **โปรเจกต์**
- ดังนั้น ชื่อที่ซ้ำกันระหว่าง `~/.gemini/extensions` และ `<cwd>/.gemini/extensions` จะเก็บรายการผู้ใช้และบดบังรายการโปรเจกต์

ในทางตรงกันข้าม ผู้ให้บริการ native สร้างลำดับไดเรกทอรีการกำหนดค่าต่างออกไป (`project` ก่อน จากนั้น `user` ใน `getConfigDirs()`) ดังนั้นการบดบังภายในผู้ให้บริการ native จะเป็นทิศทางตรงข้าม

---

## สรุปพฤติกรรมผู้ใช้ vs โปรเจกต์

สำหรับ Gemini manifest โดยเฉพาะ:

- ทั้ง root ผู้ใช้และโปรเจกต์ถูกสแกนทุกครั้งที่โหลด
- root โปรเจกต์คงที่ที่ `<cwd>/.gemini/extensions` (ไม่มีการเดินย้อนขึ้นไปยังบรรพบุรุษ)
- ชื่อที่ซ้ำกันภายในแหล่ง Gemini แก้ไขเป็นผู้ใช้ก่อน
- ชื่อที่ซ้ำกันกับผู้ให้บริการที่มีลำดับความสำคัญสูงกว่า (โดยเฉพาะ native) แพ้ตามลำดับความสำคัญ

---

## ขอบเขต: เมตาดาต้าการค้นพบ vs การโหลดส่วนขยายขณะ runtime

การค้นพบ `gemini-extension.json` ในปัจจุบันป้อนเมตาดาต้า capability (รายการ `Extension`) **ไม่ได้**โหลดโมดูลส่วนขยาย TS/JS ที่รันได้โดยตรง

การโหลดโมดูลขณะ runtime (`discoverAndLoadExtensions()` / `loadExtensions()`) ใช้ `extension-modules` และเส้นทางที่ระบุชัดเจน และปัจจุบันกรองโมดูลที่ค้นพบอัตโนมัติเฉพาะผู้ให้บริการ `native` เท่านั้น

ความหมายในทางปฏิบัติ:

- ส่วนขยาย Gemini manifest สามารถค้นพบได้ในฐานะบันทึก capability
- ส่วนขยายเหล่านี้ไม่ได้ถูกรันเป็นโมดูลส่วนขยาย runtime โดยไปป์ไลน์ตัวโหลดส่วนขยายด้วยตัวเอง

ขอบเขตนี้เป็นไปโดยเจตนาในการใช้งานปัจจุบัน และอธิบายว่าทำไมการค้นพบ manifest และการโหลดโมดูลที่รันได้จึงสามารถแตกต่างกันได้
