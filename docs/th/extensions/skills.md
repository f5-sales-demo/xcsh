---
title: Skills
description: ระบบทักษะสำหรับการลงทะเบียน ค้นหา และเรียกใช้ความสามารถเฉพาะทางใน coding agent
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Skills เป็นชุดความสามารถที่มีไฟล์เป็นพื้นฐาน ถูกค้นพบเมื่อเริ่มต้นระบบ และเปิดให้โมเดลใช้งานในรูปแบบ:

- เมตาดาต้าแบบเบาในระบบพรอมต์ (name + description)
- เนื้อหาแบบเรียกใช้ตามต้องการผ่าน `read skill://...`
- คำสั่งเชิงโต้ตอบ `/skill:<name>` แบบตัวเลือก

เอกสารนี้ครอบคลุมพฤติกรรมรันไทม์ปัจจุบันใน `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` และ `src/discovery/agents-md.ts`

## Skill คืออะไรในโค้ดเบสนี้

Skill ที่ค้นพบแล้วจะแสดงเป็น:

- `name`
- `description`
- `filePath` (เส้นทาง `SKILL.md`)
- `baseDir` (ไดเรกทอรีของ skill)
- เมตาดาต้าแหล่งที่มา (`provider`, `level`, path)

รันไทม์ต้องการเพียง `name` และ `path` เพื่อให้ถูกต้อง ในทางปฏิบัติ คุณภาพของการจับคู่ขึ้นอยู่กับว่า `description` มีความหมายเพียงพอ

## เลย์เอาต์ที่จำเป็นและสิ่งที่คาดหวังจาก SKILL.md

### เลย์เอาต์ไดเรกทอรี

สำหรับการค้นพบแบบ provider-based (native/Claude/Codex/Agents/plugin providers) skills จะถูกค้นพบ **หนึ่งระดับภายใต้ `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

รูปแบบซ้อนเช่น `<skills-root>/group/<skill>/SKILL.md` จะไม่ถูกค้นพบโดย provider loaders

สำหรับ `skills.customDirectories` การสแกนใช้เลย์เอาต์แบบไม่เรียกซ้ำเหมือนกัน (`*/SKILL.md`)

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

ฟิลด์ frontmatter ที่รองรับในประเภท skill:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- คีย์เพิ่มเติมจะถูกเก็บรักษาไว้เป็นเมตาดาต้าที่ไม่ทราบชนิด

พฤติกรรมรันไทม์ปัจจุบัน:

- `name` มีค่าเริ่มต้นเป็นชื่อไดเรกทอรีของ skill
- `description` จำเป็นสำหรับ:
  - การค้นพบ skill ของ native `.xcsh` provider (`requireDescription: true`)
  - การสแกน `skills.customDirectories` ผ่าน `scanSkillsFromDir` ใน `src/discovery/helpers.ts` (ไม่เรียกซ้ำ)
- provider ที่ไม่ใช่ native สามารถโหลด skills โดยไม่ต้องมี description

## ขั้นตอนการค้นพบ

`discoverSkills()` ใน `src/extensibility/skills.ts` ทำสองรอบ:

1. **Capability providers** ผ่าน `loadCapability("skills")`
2. **Custom directories** ผ่าน `scanSkillsFromDir(..., { requireDescription: true })` (การแจกแจงไดเรกทอรีหนึ่งระดับ)

ถ้า `skills.enabled` เป็น `false` การค้นพบจะไม่ส่งคืน skills ใดๆ

### Built-in skill providers และลำดับความสำคัญ

การเรียงลำดับ provider ใช้ priority-first (ค่าสูงกว่าชนะ) จากนั้นใช้ลำดับการลงทะเบียนสำหรับกรณีเท่ากัน

Skill providers ที่ลงทะเบียนปัจจุบัน:

1. `native` (priority 100) — skills ระดับ user/project ของ `.xcsh` ผ่าน `src/discovery/builtin.ts`
2. `claude` (priority 80)
3. กลุ่ม priority 70 (ตามลำดับการลงทะเบียน):
   - `claude-plugins`
   - `agents`
   - `codex`

คีย์สำหรับการตัดซ้ำคือชื่อ skill รายการแรกที่มีชื่อเดียวกันจะชนะ

### ตัวสลับแหล่งที่มาและการกรอง

`discoverSkills()` ใช้การควบคุมเหล่านี้:

- ตัวสลับแหล่งที่มา: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- ตัวกรอง glob บนชื่อ skill:
  - `ignoredSkills` (ยกเว้น)
  - `includeSkills` (รายการอนุญาต; ว่างหมายถึงรวมทั้งหมด)

ลำดับการกรอง:

1. แหล่งที่มาเปิดใช้งาน
2. ไม่ถูกเพิกเฉย
3. อยู่ในรายการรวม (ถ้ามีรายการ include)

สำหรับ providers อื่นที่ไม่ใช่ codex/claude/native (เช่น `agents`, `claude-plugins`) การเปิดใช้งานปัจจุบันใช้ค่าเริ่มต้น: เปิดใช้งานถ้าตัวสลับแหล่งที่มา built-in **ใดๆ** เปิดใช้งานอยู่

### การจัดการการชนและรายการซ้ำ

- การตัดซ้ำของ Capability จะเก็บ skill แรกต่อชื่อไว้แล้ว (provider ที่มี precedence สูงสุด)
- `extensibility/skills.ts` เพิ่มเติม:
  - ตัดซ้ำไฟล์ที่เหมือนกันด้วย `realpath` (ปลอดภัยกับ symlink)
  - แสดงคำเตือนการชนเมื่อชื่อ skill ที่ตามมาขัดแย้งกัน
  - เก็บ API สะดวก `discoverSkillsFromDir({ dir, source })` เป็น thin adapter เหนือ `scanSkillsFromDir`
- Skills จาก custom-directory จะถูกรวมหลังจาก provider skills และปฏิบัติตามพฤติกรรมการชนเดียวกัน

## พฤติกรรมการใช้งานรันไทม์

### การเปิดเผยในระบบพรอมต์

การสร้างระบบพรอมต์ (`src/system-prompt.ts`) ใช้ skills ที่ค้นพบดังนี้:

- ถ้าเครื่องมือ `read` พร้อมใช้งาน:
  - รวมรายการ skills ที่ค้นพบในพรอมต์
- มิฉะนั้น:
  - ละเว้นรายการที่ค้นพบ

Task tool subagents จะได้รับรายการ skills ที่ค้นพบ/จัดเตรียมของเซสชันผ่านการสร้างเซสชันปกติ; ไม่มีการ override การปักหมุด skill ต่อ task

### คำสั่งเชิงโต้ตอบ `/skill:<name>`

ถ้า `skills.enableSkillCommands` เป็น true โหมดเชิงโต้ตอบจะลงทะเบียน slash command หนึ่งคำสั่งต่อ skill ที่ค้นพบ

พฤติกรรม `/skill:<name> [args]`:

- อ่านไฟล์ skill โดยตรงจาก `filePath`
- ตัด frontmatter ออก
- แทรกเนื้อหา skill เป็นข้อความติดตามแบบกำหนดเอง
- เพิ่มเมตาดาต้า (`Skill: <path>`, ตัวเลือก `User: <args>`)

## พฤติกรรม URL `skill://`

`src/internal-urls/skill-protocol.ts` รองรับ:

- `skill://<name>` → แก้ไขเป็น `SKILL.md` ของ skill นั้น
- `skill://<name>/<relative-path>` → แก้ไขภายในไดเรกทอรีของ skill นั้น

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

- ชื่อ skill ต้องตรงกันอย่างแน่นอน
- เส้นทางสัมพัทธ์จะถูก URL-decoded
- เส้นทางแบบสัมบูรณ์จะถูกปฏิเสธ
- การข้ามเส้นทาง (`..`) จะถูกปฏิเสธ
- เส้นทางที่แก้ไขแล้วต้องอยู่ภายใน `baseDir`
- ไฟล์ที่หายไปจะส่งคืนข้อผิดพลาด `File not found` อย่างชัดเจน

ประเภทเนื้อหา:

- `.md` => `text/markdown`
- อย่างอื่นทั้งหมด => `text/plain`

ไม่มีการค้นหาสำรองสำหรับ assets ที่หายไป

## Skills เทียบกับ AGENTS.md, commands, tools, hooks

### Skills เทียบกับ AGENTS.md

- **Skills**: ชุดความสามารถแบบมีชื่อและตัวเลือก ที่เลือกตามบริบทของงานหรือร้องขอโดยเฉพาะ
- **AGENTS.md/context files**: ไฟล์คำสั่งถาวรที่โหลดเป็น context-file capability และรวมตามกฎ level/depth

`src/discovery/agents-md.ts` จะเดินสำรวจไดเรกทอรีบรรพบุรุษจาก `cwd` โดยเฉพาะเพื่อค้นพบไฟล์ `AGENTS.md` แบบ standalone (สูงสุดถึงความลึก 20) โดยยกเว้นส่วนของ hidden-directory

### Skills เทียบกับ slash commands

- **Skills**: เนื้อหาความรู้/เวิร์กโฟลว์ที่โมเดลอ่านได้
- **Slash commands**: จุดเข้าคำสั่งที่ผู้ใช้เรียกใช้
- `/skill:<name>` เป็น wrapper สะดวกที่แทรกข้อความ skill; ไม่เปลี่ยนแปลงความหมายของการค้นพบ skill

### Skills เทียบกับ custom tools

- **Skills**: เนื้อหาเอกสาร/เวิร์กโฟลว์ที่โหลดผ่านบริบทพรอมต์และ `read`
- **Custom tools**: API เครื่องมือที่สามารถดำเนินการได้ ที่โมเดลสามารถเรียกใช้ได้พร้อม schemas และผลข้างเคียงรันไทม์

### Skills เทียบกับ hooks

- **Skills**: เนื้อหาแบบ passive
- **Hooks**: ตัวดักจับรันไทม์ที่ขับเคลื่อนด้วยเหตุการณ์ ที่สามารถบล็อก/ปรับเปลี่ยนพฤติกรรมระหว่างการดำเนินการ

## แนวทางการเขียนเชิงปฏิบัติที่เชื่อมโยงกับตรรกะการค้นพบ

- วาง skill แต่ละอันในไดเรกทอรีของตัวเอง: `<skills-root>/<skill-name>/SKILL.md`
- รวม frontmatter `name` และ `description` อย่างชัดเจนเสมอ
- เก็บ assets ที่อ้างอิงไว้ภายใต้ไดเรกทอรี skill เดียวกันและเข้าถึงด้วย `skill://<name>/...`
- สำหรับ taxonomy แบบซ้อน (`team/domain/skill`) ให้ชี้ `skills.customDirectories` ไปที่ไดเรกทอรีแม่ที่ซ้อนอยู่; การสแกนเองยังคงเป็นแบบไม่เรียกซ้ำ
- หลีกเลี่ยงชื่อ skill ที่ซ้ำกันข้ามแหล่งที่มา; การจับคู่แรกจะชนะตามลำดับความสำคัญของ provider
