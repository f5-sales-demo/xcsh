---
title: ทักษะ
description: >-
  ระบบทักษะสำหรับการลงทะเบียน ค้นหา
  และเรียกใช้ความสามารถเฉพาะทางในตัวแทนการเขียนโค้ด
sidebar:
  order: 3
  label: ทักษะ
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# ทักษะ

ทักษะคือชุดความสามารถที่อิงกับไฟล์ ซึ่งถูกค้นพบตอนเริ่มต้นระบบและเปิดเผยต่อโมเดลในรูปแบบ:

- ข้อมูลเมตาขนาดเล็กใน system prompt (ชื่อ + คำอธิบาย)
- เนื้อหาตามความต้องการผ่าน `read skill://...`
- คำสั่ง `/skill:<name>` แบบโต้ตอบที่เป็นตัวเลือก

เอกสารนี้ครอบคลุมพฤติกรรมรันไทม์ปัจจุบันใน `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts`, และ `src/discovery/agents-md.ts`

## ทักษะในฐานรหัสนี้คืออะไร

ทักษะที่ถูกค้นพบจะถูกแทนด้วย:

- `name`
- `description`
- `filePath` (เส้นทางของ `SKILL.md`)
- `baseDir` (ไดเรกทอรีของทักษะ)
- ข้อมูลเมตาของแหล่งที่มา (`provider`, `level`, เส้นทาง)

รันไทม์ต้องการเพียง `name` และ `path` เพื่อตรวจสอบความถูกต้อง ในทางปฏิบัติ คุณภาพการจับคู่ขึ้นอยู่กับ `description` ที่มีความหมาย

## รูปแบบโครงสร้างที่จำเป็นและความคาดหวังของ SKILL.md

### รูปแบบโครงสร้างไดเรกทอรี

สำหรับการค้นพบตามผู้ให้บริการ (native/Claude/Codex/Agents/plugin providers) ทักษะจะถูกค้นพบใน **ระดับเดียวภายใต้ `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

รูปแบบแบบซ้อนกัน เช่น `<skills-root>/group/<skill>/SKILL.md` จะไม่ถูกค้นพบโดย provider loaders

สำหรับ `skills.customDirectories` การสแกนจะใช้รูปแบบที่ไม่ซ้อนกันเหมือนกัน (`*/SKILL.md`)

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

### Frontmatter ของ `SKILL.md`

ฟิลด์ frontmatter ที่รองรับในประเภทของทักษะ:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- คีย์เพิ่มเติมจะถูกเก็บรักษาไว้เป็นข้อมูลเมตาที่ไม่รู้จัก

พฤติกรรมรันไทม์ปัจจุบัน:

- `name` ค่าเริ่มต้นคือชื่อไดเรกทอรีของทักษะ
- `description` เป็นสิ่งจำเป็นสำหรับ:
  - การค้นพบทักษะของ native `.xcsh` provider (`requireDescription: true`)
  - การสแกน `skills.customDirectories` ผ่าน `scanSkillsFromDir` ใน `src/discovery/helpers.ts` (ไม่ซ้อนกัน)
- ผู้ให้บริการที่ไม่ใช่ native สามารถโหลดทักษะโดยไม่มีคำอธิบายได้

## กระบวนการค้นพบทักษะ

`discoverSkills()` ใน `src/extensibility/skills.ts` ทำงานสองรอบ:

1. **Capability providers** ผ่าน `loadCapability("skills")`
2. **Custom directories** ผ่าน `scanSkillsFromDir(..., { requireDescription: true })` (การระบุไดเรกทอรีหนึ่งระดับ)

หาก `skills.enabled` เป็น `false` การค้นพบจะไม่ส่งคืนทักษะใด ๆ

### ผู้ให้บริการทักษะในตัวและลำดับความสำคัญ

การเรียงลำดับผู้ให้บริการเป็นแบบ priority-first (ค่าที่สูงกว่าชนะ) แล้วตามด้วยลำดับการลงทะเบียนสำหรับกรณีที่เท่ากัน

ผู้ให้บริการทักษะที่ลงทะเบียนในปัจจุบัน:

1. `native` (priority 100) — ทักษะผู้ใช้/โปรเจกต์ `.xcsh` ผ่าน `src/discovery/builtin.ts`
2. `claude` (priority 80)
3. กลุ่ม priority 70 (ตามลำดับการลงทะเบียน):
   - `claude-plugins`
   - `agents`
   - `codex`

คีย์การลบข้อมูลซ้ำคือชื่อทักษะ รายการแรกที่มีชื่อที่กำหนดจะชนะ

### การสลับแหล่งที่มาและการกรอง

`discoverSkills()` ใช้การควบคุมเหล่านี้:

- การสลับแหล่งที่มา: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- ตัวกรอง glob บนชื่อทักษะ:
  - `ignoredSkills` (ยกเว้น)
  - `includeSkills` (รายการที่อนุญาตให้รวม; ว่างหมายถึงรวมทั้งหมด)

ลำดับการกรองคือ:

1. แหล่งที่มาเปิดใช้งาน
2. ไม่ถูกละเว้น
3. รวมอยู่ (หากมีรายการรวม)

สำหรับผู้ให้บริการที่ไม่ใช่ codex/claude/native (เช่น `agents`, `claude-plugins`) การเปิดใช้งานจะกลับไปที่: เปิดใช้งานหาก **การสลับแหล่งที่มาในตัวใด ๆ** เปิดใช้งานอยู่

### การจัดการการชนกันและข้อมูลซ้ำ

- การลบข้อมูลซ้ำของ Capability จะเก็บทักษะแรกต่อชื่อไว้แล้ว (ผู้ให้บริการที่มีความสำคัญสูงสุด)
- `extensibility/skills.ts` เพิ่มเติม:
  - ลบข้อมูลซ้ำของไฟล์เหมือนกันด้วย `realpath` (ปลอดภัยสำหรับ symlink)
  - ส่งคำเตือนการชนกันเมื่อชื่อทักษะในภายหลังขัดแย้ง
  - เก็บ API `discoverSkillsFromDir({ dir, source })` อย่างสะดวกเป็น thin adapter เหนือ `scanSkillsFromDir`
- ทักษะของ Custom-directory จะถูกรวมหลังจากทักษะของผู้ให้บริการและปฏิบัติตามพฤติกรรมการชนกันเดียวกัน

## พฤติกรรมการใช้งานรันไทม์

### การเปิดเผยใน System Prompt

การสร้าง system prompt (`src/system-prompt.ts`) ใช้ทักษะที่ค้นพบดังนี้:

- หากเครื่องมือ `read` พร้อมใช้งาน:
  - รวมรายการทักษะที่ค้นพบใน prompt
- มิฉะนั้น:
  - ละเว้นรายการที่ค้นพบ

Task tool subagents รับรายการทักษะที่ค้นพบ/ให้มาของเซสชันผ่านการสร้างเซสชันปกติ ไม่มีการแทนที่การปักหมุดทักษะต่องาน

### คำสั่ง `/skill:<name>` แบบโต้ตอบ

หาก `skills.enableSkillCommands` เป็น true โหมดโต้ตอบจะลงทะเบียนหนึ่ง slash command ต่อทักษะที่ค้นพบ

พฤติกรรม `/skill:<name> [args]`:

- อ่านไฟล์ทักษะโดยตรงจาก `filePath`
- ลบ frontmatter ออก
- แทรกเนื้อหาทักษะเป็นข้อความกำหนดเองติดตามผล
- ต่อท้ายข้อมูลเมตา (`Skill: <path>`, `User: <args>` ที่เป็นตัวเลือก)

## พฤติกรรม URL `skill://`

`src/internal-urls/skill-protocol.ts` รองรับ:

- `skill://<name>` → แก้ไขไปยัง `SKILL.md` ของทักษะนั้น
- `skill://<name>/<relative-path>` → แก้ไขภายในไดเรกทอรีทักษะนั้น

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
- ไฟล์ที่ไม่มีอยู่จะส่งคืนข้อผิดพลาด `File not found` อย่างชัดเจน

ประเภทเนื้อหา:

- `.md` => `text/markdown`
- อื่น ๆ ทั้งหมด => `text/plain`

ไม่มีการค้นหาสำรองสำหรับทรัพย์สินที่หายไป

## ทักษะ vs AGENTS.md คำสั่ง เครื่องมือ hooks

### ทักษะ vs AGENTS.md

- **ทักษะ**: ชุดความสามารถที่มีชื่อและเป็นตัวเลือก ซึ่งถูกเลือกตามบริบทของงานหรือร้องขออย่างชัดเจน
- **AGENTS.md/context files**: ไฟล์คำสั่งถาวรที่โหลดเป็นความสามารถของไฟล์บริบทและรวมกันตามกฎระดับ/ความลึก

`src/discovery/agents-md.ts` เดินผ่านไดเรกทอรีบรรพบุรุษจาก `cwd` โดยเฉพาะเพื่อค้นพบไฟล์ `AGENTS.md` แบบสแตนด์อโลน (ถึงความลึก 20) โดยไม่รวมส่วนของไดเรกทอรีที่ซ่อนอยู่

### ทักษะ vs slash commands

- **ทักษะ**: เนื้อหาความรู้/เวิร์กโฟลว์ที่โมเดลอ่านได้
- **Slash commands**: จุดเข้าคำสั่งที่ผู้ใช้เรียกใช้
- `/skill:<name>` เป็นตัวห่อที่สะดวกที่แทรกข้อความทักษะ ไม่เปลี่ยนความหมายของการค้นพบทักษะ

### ทักษะ vs custom tools

- **ทักษะ**: เนื้อหาเอกสาร/เวิร์กโฟลว์ที่โหลดผ่านบริบท prompt และ `read`
- **Custom tools**: API เครื่องมือที่เรียกใช้งานได้ซึ่งโมเดลสามารถเรียกใช้ด้วย schemas และผลข้างเคียงของรันไทม์

### ทักษะ vs hooks

- **ทักษะ**: เนื้อหาแบบ passive
- **Hooks**: interceptors รันไทม์ที่ขับเคลื่อนด้วยเหตุการณ์ซึ่งสามารถบล็อก/แก้ไขพฤติกรรมระหว่างการดำเนินการ

## คำแนะนำการเขียนเชิงปฏิบัติที่เชื่อมโยงกับตรรกะการค้นพบ

- วางทักษะแต่ละอย่างในไดเรกทอรีของตัวเอง: `<skills-root>/<skill-name>/SKILL.md`
- ระบุ frontmatter `name` และ `description` อย่างชัดเจนเสมอ
- เก็บทรัพย์สินที่อ้างถึงไว้ภายใต้ไดเรกทอรีทักษะเดียวกันและเข้าถึงด้วย `skill://<name>/...`
- สำหรับอนุกรมวิธานแบบซ้อนกัน (`team/domain/skill`) ให้ชี้ `skills.customDirectories` ไปที่ไดเรกทอรีหลักที่ซ้อนกัน การสแกนเองจะยังคงไม่ซ้อนกัน
- หลีกเลี่ยงชื่อทักษะซ้ำกันข้ามแหล่งที่มา การจับคู่แรกชนะตามลำดับความสำคัญของผู้ให้บริการ
