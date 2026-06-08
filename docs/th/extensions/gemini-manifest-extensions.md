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

เอกสารนี้ครอบคลุมวิธีที่ coding-agent ค้นพบและแยกวิเคราะห์ส่วนขยายสไตล์ Gemini manifest (`gemini-extension.json`) เข้าสู่ความสามารถ `extensions`

เอกสารนี้**ไม่**ครอบคลุมการโหลดโมดูลส่วนขยาย TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`) ซึ่งมีเอกสารอธิบายอยู่ใน `extension-loading.md`

## ไฟล์การใช้งาน

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## สิ่งที่ถูกค้นพบ

ผู้ให้บริการ Gemini (`id: gemini`, ลำดับความสำคัญ `60`) ลงทะเบียนตัวโหลด `extensions` ที่สแกนจุดเริ่มต้นสองตำแหน่งที่กำหนดไว้:

- ผู้ใช้: `~/.gemini/extensions`
- โปรเจกต์: `<cwd>/.gemini/extensions`

การแก้ไขเส้นทางจะทำโดยตรงจาก `ctx.home` และ `ctx.cwd` ผ่าน `getUserPath()` / `getProjectPath()`

กฎขอบเขตที่สำคัญ: การค้นหาโปรเจกต์ใช้ **เฉพาะ cwd เท่านั้น** ไม่มีการเดินย้อนขึ้นไปยังไดเรกทอรีระดับบน

---

## กฎการสแกนไดเรกทอรี

สำหรับแต่ละจุดเริ่มต้น (`~/.gemini/extensions` และ `<cwd>/.gemini/extensions`) การค้นพบจะทำดังนี้:

1. `readDirEntries(root)`
2. เก็บเฉพาะไดเรกทอรีลูกโดยตรง (`entry.isDirectory()`)
3. สำหรับแต่ละไดเรกทอรีลูก `<name>` พยายามอ่านเฉพาะ:
   - `<root>/<name>/gemini-extension.json`

ไม่มีการสแกนแบบเรียกซ้ำเกินกว่าหนึ่งระดับไดเรกทอรี

### ไดเรกทอรีที่ซ่อน

การค้นพบ Gemini manifest **ไม่**กรองชื่อไดเรกทอรีที่นำหน้าด้วยจุดออก หากมีไดเรกทอรีลูกที่ซ่อนอยู่และมี `gemini-extension.json` จะถูกพิจารณา

### ไฟล์ที่หายไป/อ่านไม่ได้

หาก `gemini-extension.json` หายไปหรืออ่านไม่ได้ ไดเรกทอรีนั้นจะถูกข้ามอย่างเงียบ ๆ (ไม่มีคำเตือน)

---

## รูปแบบ Manifest (ตามที่ใช้งานจริง)

ชนิดความสามารถกำหนดรูปแบบ manifest ดังนี้:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

พฤติกรรมในขั้นตอนค้นพบตั้งใจให้หลวม:

- ต้องแยกวิเคราะห์ JSON สำเร็จ
- ไม่มีการตรวจสอบ schema ขณะรันไทม์สำหรับชนิด/เนื้อหาของฟิลด์นอกเหนือจากไวยากรณ์ JSON
- ออบเจกต์ที่แยกวิเคราะห์แล้วจะถูกเก็บเป็น `manifest` บนรายการความสามารถ

### การทำให้ชื่อเป็นมาตรฐาน

`Extension.name` ถูกตั้งค่าเป็น:

1. `manifest.name` หากไม่ใช่ `null`/`undefined`
2. มิฉะนั้นจะใช้ชื่อไดเรกทอรีของส่วนขยาย

ไม่มีการบังคับชนิด string ที่นี่

---

## การแปลงเป็นรายการความสามารถ

manifest ที่แยกวิเคราะห์ถูกต้องจะสร้างรายการความสามารถ `Extension` หนึ่งรายการ:

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
- การตรวจสอบความสามารถระดับ registry สำหรับ `extensions` ตรวจสอบเฉพาะการมีอยู่ของ `name` และ `path`
- ส่วนภายในของ manifest (`mcpServers`, `tools`, `context`) ไม่ถูกตรวจสอบระหว่างการค้นพบ

---

## การจัดการข้อผิดพลาดและความหมายของคำเตือน

### มีคำเตือน

- JSON ไม่ถูกต้องในไฟล์ manifest:
  - รูปแบบคำเตือน: `Invalid JSON in <manifestPath>`

### ไม่มีคำเตือน (ข้ามอย่างเงียบ ๆ)

- ไดเรกทอรี `extensions` หายไป
- ไดเรกทอรีลูกไม่มี `gemini-extension.json`
- ไฟล์ manifest อ่านไม่ได้
- JSON ของ manifest ถูกต้องทางไวยากรณ์แต่ไม่สมบูรณ์หรือผิดปกติทางความหมาย

นั่นหมายความว่าความถูกต้องบางส่วนจะถูกยอมรับ: เฉพาะความล้มเหลวทางไวยากรณ์ JSON เท่านั้นที่จะแสดงคำเตือน

---

## ลำดับความสำคัญและการกำจัดรายการซ้ำกับแหล่งอื่น

ความสามารถ `extensions` ถูกรวบรวมข้ามผู้ให้บริการโดย capability registry

ผู้ให้บริการปัจจุบันสำหรับความสามารถนี้:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) ลำดับความสำคัญ `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) ลำดับความสำคัญ `60`

คีย์การกำจัดรายการซ้ำคือ `ext.name` (`extensionCapability.key = ext => ext.name`)

### ลำดับความสำคัญข้ามผู้ให้บริการ

ผู้ให้บริการที่มีลำดับความสำคัญสูงกว่าจะชนะเมื่อชื่อส่วนขยายซ้ำกัน

- หาก `native` และ `gemini` ทั้งคู่ส่งออกส่วนขยายชื่อ `foo` รายการ native จะถูกเก็บไว้
- รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะถูกเก็บไว้เฉพาะใน `result.all` โดยมี `_shadowed = true`

### ผลกระทบของลำดับภายในผู้ให้บริการ

เนื่องจากการกำจัดรายการซ้ำใช้หลัก "รายการที่พบก่อนชนะ" ลำดับรายการภายในผู้ให้บริการจึงมีความสำคัญ

- ตัวโหลด Gemini จะเพิ่ม **ผู้ใช้ก่อน** แล้วตามด้วย **โปรเจกต์**
- ดังนั้น ชื่อที่ซ้ำกันระหว่าง `~/.gemini/extensions` และ `<cwd>/.gemini/extensions` จะเก็บรายการผู้ใช้และบดบังรายการโปรเจกต์

ในทางตรงกันข้าม ผู้ให้บริการ native สร้างลำดับไดเรกทอรีกำหนดค่าต่างกัน (`project` แล้วตามด้วย `user` ใน `getConfigDirs()`) ดังนั้นการบดบังภายในผู้ให้บริการ native จะเป็นทิศทางตรงกันข้าม

---

## สรุปพฤติกรรมผู้ใช้กับโปรเจกต์

สำหรับ Gemini manifest โดยเฉพาะ:

- ทั้งจุดเริ่มต้นผู้ใช้และโปรเจกต์จะถูกสแกนทุกครั้งที่โหลด
- จุดเริ่มต้นโปรเจกต์ถูกกำหนดไว้ที่ `<cwd>/.gemini/extensions` (ไม่มีการเดินย้อนขึ้นไปยังระดับบน)
- ชื่อที่ซ้ำกันภายในแหล่ง Gemini จะแก้ไขโดยให้ผู้ใช้มาก่อน
- ชื่อที่ซ้ำกันเมื่อเทียบกับผู้ให้บริการที่มีลำดับความสำคัญสูงกว่า (โดยเฉพาะ native) จะแพ้ตามลำดับความสำคัญ

---

## ขอบเขต: ข้อมูลเมตาการค้นพบกับการโหลดส่วนขยายขณะรันไทม์

การค้นพบ `gemini-extension.json` ในปัจจุบันป้อนข้อมูลเมตาความสามารถ (รายการ `Extension`) **ไม่ได้**โหลดโมดูลส่วนขยาย TS/JS ที่รันได้โดยตรง

การโหลดโมดูลขณะรันไทม์ (`discoverAndLoadExtensions()` / `loadExtensions()`) ใช้ `extension-modules` และเส้นทางที่ระบุอย่างชัดเจน และในปัจจุบันกรองโมดูลที่ค้นพบอัตโนมัติเฉพาะผู้ให้บริการ `native` เท่านั้น

ผลกระทบในทางปฏิบัติ:

- ส่วนขยาย Gemini manifest สามารถค้นพบได้ในฐานะบันทึกความสามารถ
- ส่วนขยายเหล่านี้ไม่ได้ถูกดำเนินการเป็นโมดูลส่วนขยายขณะรันไทม์โดยไปป์ไลน์ตัวโหลดส่วนขยายด้วยตัวเอง

ขอบเขตนี้เป็นไปโดยตั้งใจในการใช้งานปัจจุบัน และอธิบายว่าเหตุใดการค้นพบ manifest และการโหลดโมดูลที่ดำเนินการได้จึงอาจแตกต่างกัน
