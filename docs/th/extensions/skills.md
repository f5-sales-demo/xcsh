---
title: ทักษะ
description: ระบบทักษะสำหรับการลงทะเบียน ค้นหา และเรียกใช้ความสามารถเฉพาะทางใน coding agent
sidebar:
  order: 3
  label: ทักษะ
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# ทักษะ

ทักษะคือชุดความสามารถที่สนับสนุนด้วยไฟล์ ถูกค้นพบเมื่อเริ่มต้นระบบและเปิดเผยให้โมเดลในรูปแบบ:

- เมตาดาต้าน้ำหนักเบาใน system prompt (ชื่อ + คำอธิบาย)
- เนื้อหาตามต้องการผ่าน `read skill://...`
- คำสั่ง `/skill:<name>` แบบโต้ตอบที่เป็นทางเลือก

เอกสารนี้ครอบคลุมพฤติกรรมรันไทม์ปัจจุบันใน `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` และ `src/discovery/agents-md.ts`

## ทักษะคืออะไรในโค้ดเบสนี้

ทักษะที่ถูกค้นพบจะถูกแสดงเป็น:

- `name`
- `description`
- `filePath` (เส้นทาง `SKILL.md`)
- `baseDir` (ไดเรกทอรีของทักษะ)
- เมตาดาต้าแหล่งที่มา (`provider`, `level`, path)

รันไทม์ต้องการเพียง `name` และ `path` สำหรับความถูกต้อง ในทางปฏิบัติ คุณภาพการจับคู่ขึ้นอยู่กับ `description` ที่มีความหมาย

## โครงสร้างที่จำเป็นและความคาดหวังของ SKILL.md

### โครงสร้างไดเรกทอรี

สำหรับการค้นพบตาม provider (native/Claude/Codex/Agents/plugin providers) ทักษะจะถูกค้นพบเป็น **หนึ่งระดับภายใต้ `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

รูปแบบซ้อนกันเช่น `<skills-root>/group/<skill>/SKILL.md` จะไม่ถูกค้นพบโดย provider loaders

สำหรับ `skills.customDirectories` การสแกนใช้โครงสร้างแบบไม่เรียกซ้ำเช่นเดียวกัน (`*/SKILL.md`)

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### frontmatter ของ `SKILL.md`

ฟิลด์ frontmatter ที่รองรับบนประเภททักษะ:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- คีย์เพิ่มเติมจะถูกเก็บรักษาเป็นเมตาดาต้าที่ไม่ระบุประเภท

พฤติกรรมรันไทม์ปัจจุบัน:

- `name` จะใช้ค่าเริ่มต้นเป็นชื่อไดเรกทอรีของทักษะ
- `description` จำเป็นสำหรับ:
  - การค้นพบทักษะ provider `.xcsh` แบบ native (`requireDescription: true`)
  - การสแกน `skills.customDirectories` ผ่าน `scanSkillsFromDir` ใน `src/discovery/helpers.ts` (แบบไม่เรียกซ้ำ)
- provider ที่ไม่ใช่ native สามารถโหลดทักษะโดยไม่มี description ได้

## ไปป์ไลน์การค้นพบ

`discoverSkills()` ใน `src/extensibility/skills.ts` ทำสองรอบ:

1. **Capability providers** ผ่าน `loadCapability("skills")`
2. **ไดเรกทอรีกำหนดเอง** ผ่าน `scanSkillsFromDir(..., { requireDescription: true })` (การแจกแจงไดเรกทอรีหนึ่งระดับ)

หาก `skills.enabled` เป็น `false` การค้นพบจะไม่ส่งคืนทักษะใดๆ

### Provider ทักษะในตัวและลำดับความสำคัญ

ลำดับ provider จะให้ความสำคัญกับ priority สูงสุดก่อน จากนั้นเรียงตามลำดับการลงทะเบียนสำหรับกรณีที่เท่ากัน

Provider ทักษะที่ลงทะเบียนในปัจจุบัน:

1. `native` (priority 100) — ทักษะ `.xcsh` ระดับผู้ใช้/โปรเจกต์ผ่าน `src/discovery/builtin.ts`
2. `claude` (priority 80)
3. กลุ่ม priority 70 (ตามลำดับการลงทะเบียน):
   - `claude-plugins`
   - `agents`
   - `codex`

คีย์สำหรับการตัดรายการซ้ำคือชื่อทักษะ รายการแรกที่มีชื่อเดียวกันจะชนะ

### ตัวสลับแหล่งที่มาและการกรอง

`discoverSkills()` ใช้การควบคุมเหล่านี้:

- ตัวสลับแหล่งที่มา: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- ตัวกรอง glob ตามชื่อทักษะ:
  - `ignoredSkills` (ยกเว้น)
  - `includeSkills` (รายการอนุญาต; ว่างเปล่าหมายถึงรวมทั้งหมด)

ลำดับการกรอง:

1. แหล่งที่มาเปิดใช้งาน
2. ไม่ถูกเพิกเฉย
3. ถูกรวม (หากมีรายการรวม)

สำหรับ provider อื่นนอกจาก codex/claude/native (เช่น `agents`, `claude-plugins`) การเปิดใช้งานในปัจจุบันจะย้อนกลับไปที่: เปิดใช้งานหากตัวสลับแหล่งที่มาในตัว **ใดๆ** เปิดใช้งาน

### การจัดการการชนและรายการซ้ำ

- การตัดรายการซ้ำของ capability จะเก็บทักษะแรกต่อชื่อไว้แล้ว (provider ที่มี precedence สูงสุด)
- `extensibility/skills.ts` ยังทำเพิ่มเติม:
  - ตัดรายการซ้ำของไฟล์ที่เหมือนกันด้วย `realpath` (ปลอดภัยกับ symlink)
  - แสดงคำเตือนการชนเมื่อชื่อทักษะที่มาทีหลังขัดแย้งกัน
  - เก็บ API `discoverSkillsFromDir({ dir, source })` ที่สะดวกไว้เป็น adapter บางๆ เหนือ `scanSkillsFromDir`
- ทักษะจากไดเรกทอรีกำหนดเองจะถูกรวมหลังทักษะ provider และเป็นไปตามพฤติกรรมการชนเดียวกัน

## พฤติกรรมการใช้งานรันไทม์

### การเปิดเผยใน system prompt

การสร้าง system prompt (`src/system-prompt.ts`) ใช้ทักษะที่ค้นพบดังนี้:

- หากเครื่องมือ `read` พร้อมใช้งาน:
  - รวมรายการทักษะที่ค้นพบใน prompt
- มิฉะนั้น:
  - ไม่รวมรายการที่ค้นพบ

subagent ของเครื่องมือ Task จะได้รับรายการทักษะที่ค้นพบ/จัดเตรียมของเซสชันผ่านการสร้างเซสชันปกติ ไม่มีการแทนที่การตรึงทักษะต่อ task

### คำสั่งโต้ตอบ `/skill:<name>`

หาก `skills.enableSkillCommands` เป็น true โหมดโต้ตอบจะลงทะเบียน slash command หนึ่งรายการต่อทักษะที่ค้นพบ

พฤติกรรมของ `/skill:<name> [args]`:

- อ่านไฟล์ทักษะโดยตรงจาก `filePath`
- ตัด frontmatter ออก
- แทรกเนื้อหาทักษะเป็นข้อความกำหนดเองที่ตามมา
- เพิ่มเมตาดาต้า (`Skill: <path>`, `User: <args>` ที่เป็นทางเลือก)

## พฤติกรรม URL `skill://`

`src/internal-urls/skill-protocol.ts` รองรับ:

- `skill://<name>` → แก้ไขเป็น `SKILL.md` ของทักษะนั้น
- `skill://<name>/<relative-path>` → แก้ไขภายในไดเรกทอรีของทักษะนั้น

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

รายละเอียดการแก้ไข:

- ชื่อทักษะต้องตรงกันพอดี
- เส้นทางสัมพัทธ์จะถูก URL-decoded
- เส้นทางสัมบูรณ์จะถูกปฏิเสธ
- การข้ามเส้นทาง (`..`) จะถูกปฏิเสธ
- เส้นทางที่แก้ไขแล้วต้องอยู่ภายใน `baseDir`
- ไฟล์ที่หายไปจะส่งคืนข้อผิดพลาด `File not found` อย่างชัดเจน

ประเภทเนื้อหา:

- `.md` => `text/markdown`
- ทุกอย่างอื่น => `text/plain`

ไม่มีการค้นหาสำรองสำหรับ asset ที่หายไป

## ทักษะเทียบกับ AGENTS.md, คำสั่ง, เครื่องมือ, hooks

### ทักษะเทียบกับ AGENTS.md

- **ทักษะ**: ชุดความสามารถที่มีชื่อและเป็นทางเลือก ถูกเลือกตามบริบทของ task หรือถูกร้องขออย่างชัดเจน
- **AGENTS.md/ไฟล์บริบท**: ไฟล์คำสั่งถาวรที่โหลดเป็น capability ไฟล์บริบท และรวมตามกฎระดับ/ความลึก

`src/discovery/agents-md.ts` เดินทางผ่านไดเรกทอรีบรรพบุรุษจาก `cwd` โดยเฉพาะเพื่อค้นพบไฟล์ `AGENTS.md` แบบเดี่ยว (สูงสุดความลึก 20) โดยไม่รวมส่วนไดเรกทอรีที่ซ่อน

### ทักษะเทียบกับ slash commands

- **ทักษะ**: เนื้อหาความรู้/เวิร์กโฟลว์ที่โมเดลอ่านได้
- **Slash commands**: จุดเข้าคำสั่งที่ผู้ใช้เรียกใช้
- `/skill:<name>` เป็น wrapper สะดวกที่แทรกข้อความทักษะ ไม่เปลี่ยนแปลงความหมายการค้นพบทักษะ

### ทักษะเทียบกับเครื่องมือกำหนดเอง

- **ทักษะ**: เนื้อหาเอกสาร/เวิร์กโฟลว์ที่โหลดผ่านบริบท prompt และ `read`
- **เครื่องมือกำหนดเอง**: API เครื่องมือที่สามารถเรียกใช้ได้โดยโมเดล มี schema และผลข้างเคียงรันไทม์

### ทักษะเทียบกับ hooks

- **ทักษะ**: เนื้อหาแบบ passive
- **Hooks**: ตัวสกัดกั้นรันไทม์ที่ขับเคลื่อนด้วยเหตุการณ์ สามารถบล็อก/แก้ไขพฤติกรรมระหว่างการทำงาน

## แนวทางการเขียนเชิงปฏิบัติที่เชื่อมโยงกับตรรกะการค้นพบ

- วางแต่ละทักษะในไดเรกทอรีของตัวเอง: `<skills-root>/<skill-name>/SKILL.md`
- รวม frontmatter `name` และ `description` อย่างชัดเจนเสมอ
- เก็บ asset ที่อ้างอิงไว้ภายใต้ไดเรกทอรีทักษะเดียวกันและเข้าถึงด้วย `skill://<name>/...`
- สำหรับอนุกรมวิธานซ้อนกัน (`team/domain/skill`) ให้ชี้ `skills.customDirectories` ไปที่ไดเรกทอรีแม่ที่ซ้อนกัน การสแกนเองยังคงเป็นแบบไม่เรียกซ้ำ
- หลีกเลี่ยงชื่อทักษะซ้ำข้ามแหล่งที่มา รายการที่ตรงกันแรกจะชนะตามลำดับความสำคัญของ provider
