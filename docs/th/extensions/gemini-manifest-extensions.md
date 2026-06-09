---
title: ส่วนขยาย Gemini Manifest
description: >-
  รูปแบบส่วนขยาย Gemini manifest
  สำหรับความเข้ากันได้ของทักษะและเอเจนต์ข้ามแพลตฟอร์ม
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# ส่วนขยาย Gemini Manifest (`gemini-extension.json`)

เอกสารนี้ครอบคลุมวิธีที่ coding-agent ค้นพบและแยกวิเคราะห์ส่วนขยายรูปแบบ Gemini-style manifest (`gemini-extension.json`) เข้าสู่ความสามารถ `extensions`

เอกสารนี้ **ไม่** ครอบคลุมการโหลดโมดูลส่วนขยาย TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) ซึ่งมีเอกสารอยู่ใน `extension-loading.md`

## ไฟล์การนำไปใช้งาน

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## สิ่งที่ถูกค้นพบ

ผู้ให้บริการ Gemini (`id: gemini`, ลำดับความสำคัญ `60`) ลงทะเบียนตัวโหลด `extensions` ที่สแกนรูทสองตำแหน่งคงที่:

- ผู้ใช้: `~/.gemini/extensions`
- โปรเจกต์: `<cwd>/.gemini/extensions`

การแก้ไขพาธทำโดยตรงจาก `ctx.home` และ `ctx.cwd` ผ่าน `getUserPath()` / `getProjectPath()`

กฎขอบเขตที่สำคัญ: การค้นหาโปรเจกต์ **จำกัดเฉพาะ cwd เท่านั้น** จะไม่เดินขึ้นไปยังไดเรกทอรีระดับบน

---

## กฎการสแกนไดเรกทอรี

สำหรับแต่ละรูท (`~/.gemini/extensions` และ `<cwd>/.gemini/extensions`) การค้นพบจะทำ:

1. `readDirEntries(root)`
2. เก็บเฉพาะไดเรกทอรีลูกโดยตรง (`entry.isDirectory()`)
3. สำหรับแต่ละลูก `<name>` พยายามอ่านไฟล์ที่ตรงกันเท่านั้น:
   - `<root>/<name>/gemini-extension.json`

ไม่มีการสแกนแบบเรียกซ้ำเกินหนึ่งระดับไดเรกทอรี

### ไดเรกทอรีที่ซ่อน

การค้นพบ Gemini manifest **ไม่** กรองชื่อไดเรกทอรีที่มีจุดนำหน้าออก หากมีไดเรกทอรีลูกที่ซ่อนอยู่และมี `gemini-extension.json` จะถูกพิจารณา

### ไฟล์ที่หายไป/อ่านไม่ได้

หาก `gemini-extension.json` หายไปหรืออ่านไม่ได้ ไดเรกทอรีนั้นจะถูกข้ามอย่างเงียบ ๆ (ไม่มีคำเตือน)

---

## รูปร่างของ Manifest (ตามที่นำไปใช้งาน)

ประเภทความสามารถกำหนดรูปร่าง manifest ดังนี้:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

พฤติกรรมในเวลาค้นพบตั้งใจให้หลวม:

- ต้องแยกวิเคราะห์ JSON สำเร็จ
- ไม่มีการตรวจสอบ schema ระหว่างรันไทม์สำหรับประเภท/เนื้อหาของฟิลด์นอกเหนือจากไวยากรณ์ JSON
- ออบเจกต์ที่แยกวิเคราะห์แล้วจะถูกเก็บเป็น `manifest` บนรายการความสามารถ

### การปรับชื่อให้เป็นมาตรฐาน

`Extension.name` ถูกตั้งค่าเป็น:

1. `manifest.name` หากไม่ใช่ `null`/`undefined`
2. มิฉะนั้นจะใช้ชื่อไดเรกทอรีของส่วนขยาย

ไม่มีการบังคับประเภทสตริงที่นี่

---

## การสร้างเป็นรายการความสามารถ

manifest ที่แยกวิเคราะห์สำเร็จจะสร้างรายการความสามารถ `Extension` หนึ่งรายการ:

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

- `_source.path` ถูกปรับเป็นพาธสัมบูรณ์โดย `createSourceMeta()`
- การตรวจสอบความสามารถระดับรีจิสทรีสำหรับ `extensions` ตรวจสอบเฉพาะการมีอยู่ของ `name` และ `path`
- ส่วนภายใน Manifest (`mcpServers`, `tools`, `context`) จะไม่ถูกตรวจสอบระหว่างการค้นพบ

---

## การจัดการข้อผิดพลาดและความหมายของคำเตือน

### มีคำเตือน

- JSON ไม่ถูกต้องในไฟล์ manifest:
  - รูปแบบคำเตือน: `Invalid JSON in <manifestPath>`

### ไม่มีคำเตือน (ข้ามอย่างเงียบ ๆ)

- ไม่มีไดเรกทอรี `extensions`
- ไดเรกทอรีลูกไม่มี `gemini-extension.json`
- ไฟล์ manifest อ่านไม่ได้
- JSON ของ manifest ถูกต้องทางไวยากรณ์แต่แปลกหรือไม่สมบูรณ์ทางความหมาย

หมายความว่าความถูกต้องบางส่วนได้รับการยอมรับ: เฉพาะความล้มเหลวทางไวยากรณ์ JSON เท่านั้นที่จะแสดงคำเตือน

---

## ลำดับความสำคัญและการกำจัดข้อมูลซ้ำกับแหล่งอื่น

ความสามารถ `extensions` ถูกรวบรวมข้ามผู้ให้บริการโดยรีจิสทรีความสามารถ

ผู้ให้บริการปัจจุบันสำหรับความสามารถนี้:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) ลำดับความสำคัญ `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) ลำดับความสำคัญ `60`

คีย์กำจัดข้อมูลซ้ำคือ `ext.name` (`extensionCapability.key = ext => ext.name`)

### ลำดับความสำคัญข้ามผู้ให้บริการ

ผู้ให้บริการที่มีลำดับความสำคัญสูงกว่าจะชนะเมื่อชื่อส่วนขยายซ้ำกัน

- หาก `native` และ `gemini` ทั้งคู่ส่งชื่อส่วนขยาย `foo` รายการ native จะถูกเก็บไว้
- รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะถูกเก็บไว้เฉพาะใน `result.all` พร้อมกับ `_shadowed = true`

### ผลกระทบของลำดับภายในผู้ให้บริการ

เนื่องจากการกำจัดข้อมูลซ้ำใช้หลัก "รายการแรกที่พบชนะ" ลำดับรายการภายในผู้ให้บริการจึงมีความสำคัญ

- ตัวโหลด Gemini ต่อท้าย **ผู้ใช้ก่อน** จากนั้น **โปรเจกต์**
- ดังนั้น ชื่อที่ซ้ำกันระหว่าง `~/.gemini/extensions` และ `<cwd>/.gemini/extensions` จะเก็บรายการผู้ใช้และบดบังรายการโปรเจกต์

ในทางตรงกันข้าม ผู้ให้บริการ native สร้างลำดับไดเรกทอรีการกำหนดค่าแตกต่างกัน (`project` ก่อนแล้ว `user` ใน `getConfigDirs()`) ดังนั้นการบดบังภายในผู้ให้บริการ native จะเป็นทิศทางตรงกันข้าม

---

## สรุปพฤติกรรมผู้ใช้ vs โปรเจกต์

สำหรับ Gemini manifests โดยเฉพาะ:

- ทั้งรูทผู้ใช้และโปรเจกต์จะถูกสแกนทุกครั้งที่โหลด
- รูทโปรเจกต์คงที่ที่ `<cwd>/.gemini/extensions` (ไม่เดินขึ้นไปยังระดับบน)
- ชื่อที่ซ้ำกันภายในแหล่ง Gemini จะแก้ไขโดยให้ผู้ใช้มาก่อน
- ชื่อที่ซ้ำกันเมื่อเทียบกับผู้ให้บริการที่มีลำดับความสำคัญสูงกว่า (โดยเฉพาะ native) จะแพ้ตามลำดับความสำคัญ

---

## ขอบเขต: เมตาดาต้าการค้นพบ vs การโหลดส่วนขยายรันไทม์

การค้นพบ `gemini-extension.json` ในปัจจุบันป้อนเมตาดาต้าความสามารถ (รายการ `Extension`) **ไม่ได้** โหลดโมดูลส่วนขยาย TS/JS ที่สามารถรันได้โดยตรง

การโหลดโมดูลรันไทม์ (`discoverAndLoadExtensions()` / `loadExtensions()`) ใช้ `extension-modules` และพาธที่ระบุชัดเจน และปัจจุบันกรองโมดูลที่ค้นพบอัตโนมัติเฉพาะผู้ให้บริการ `native` เท่านั้น

ผลกระทบในทางปฏิบัติ:

- ส่วนขยาย Gemini manifest สามารถค้นพบได้ในฐานะบันทึกความสามารถ
- โดยตัวมันเอง จะไม่ถูกดำเนินการเป็นโมดูลส่วนขยายรันไทม์โดยไปป์ไลน์ตัวโหลดส่วนขยาย

ขอบเขตนี้เป็นไปโดยตั้งใจในการนำไปใช้งานปัจจุบัน และอธิบายว่าเหตุใดการค้นพบ manifest และการโหลดโมดูลที่สามารถรันได้จึงสามารถแตกต่างกัน
