---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# ภายในระบบ Slash Command

เอกสารนี้อธิบายวิธีการค้นหา การกรองรายการซ้ำ การแสดงผลในโหมดโต้ตอบ และการขยายคำสั่งเมื่อถึงเวลาประมวลผลพรอมต์ใน `coding-agent`

## ไฟล์ที่เกี่ยวข้องกับการ Implement

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) โมเดลการค้นหา

Slash command เป็นความสามารถ (capability) (`id: "slash-commands"`) ที่ใช้ชื่อคำสั่งเป็นคีย์ (`key: cmd => cmd.name`)

Capability registry จะโหลด provider ที่ลงทะเบียนทั้งหมด เรียงลำดับตามลำดับความสำคัญของ provider จากมากไปน้อย และกรองรายการซ้ำโดยใช้คีย์ด้วยหลักการ **รายการแรกชนะ**

### ลำดับความสำคัญของ Provider

Provider ของ slash command ปัจจุบันและลำดับความสำคัญ:

1. `native` (OMP) — ลำดับความสำคัญ `100`
2. `claude` — ลำดับความสำคัญ `80`
3. `claude-plugins` — ลำดับความสำคัญ `70`
4. `codex` — ลำดับความสำคัญ `70`

พฤติกรรมเมื่อลำดับความสำคัญเท่ากัน: provider ที่มีลำดับความสำคัญเท่ากันจะรักษาลำดับการลงทะเบียนไว้ ลำดับการ import ปัจจุบันจะลงทะเบียน `claude-plugins` ก่อน `codex` ดังนั้นคำสั่งจาก plugin จะชนะคำสั่งจาก codex เมื่อชื่อซ้ำกัน

### พฤติกรรมเมื่อชื่อซ้ำกัน

สำหรับ `slash-commands` การซ้ำกันจะถูกแก้ไขอย่างเคร่งครัดผ่านการกรองรายการซ้ำของ capability:

- รายการที่มีลำดับความสำคัญสูงสุดจะถูกเก็บไว้ใน `result.items`
- รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะอยู่เฉพาะใน `result.all` และถูกทำเครื่องหมาย `_shadowed = true`

สิ่งนี้มีผลทั้งข้าม provider และภายใน provider เดียวกันหากส่งคืนชื่อซ้ำ

### พฤติกรรมการสแกนไฟล์

Provider ส่วนใหญ่ใช้ `loadFilesFromDir(...)` ซึ่งปัจจุบัน:

- ค่าเริ่มต้นเป็นการจับคู่แบบไม่ลงลึก (non-recursive) (`*.md`)
- ใช้ native glob ด้วย `gitignore: true`, `hidden: false`
- อ่านแต่ละไฟล์ที่ตรงกันและแปลงเป็น `SlashCommand`

ดังนั้นไฟล์/ไดเรกทอรีที่ซ่อนจะไม่ถูกโหลด และเส้นทางที่ถูก ignore จะถูกข้ามไป

## 2) เส้นทางต้นทางเฉพาะ Provider และลำดับความสำคัญภายใน

## Provider `native` (`builtin.ts`)

รากของการค้นหามาจากไดเรกทอรี `.xcsh`:

- โปรเจกต์: `<cwd>/.xcsh/commands/*.md`
- ผู้ใช้: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` ส่งคืนโปรเจกต์ก่อน จากนั้นผู้ใช้ ดังนั้น **คำสั่ง native ของโปรเจกต์จะชนะคำสั่ง native ของผู้ใช้** เมื่อชื่อซ้ำกัน

## Provider `claude` (`claude.ts`)

โหลด:

- ผู้ใช้: `~/.claude/commands/*.md`
- โปรเจกต์: `<cwd>/.claude/commands/*.md`

Provider จะเพิ่มรายการของผู้ใช้ก่อนรายการของโปรเจกต์ ดังนั้น **คำสั่ง Claude ของผู้ใช้จะชนะคำสั่ง Claude ของโปรเจกต์** เมื่อชื่อซ้ำกันภายใน provider นี้

## Provider `codex` (`codex.ts`)

โหลด:

- ผู้ใช้: `~/.codex/commands/*.md`
- โปรเจกต์: `<cwd>/.codex/commands/*.md`

ทั้งสองฝั่งจะถูกโหลดแล้วรวมกันในลำดับผู้ใช้ก่อน ดังนั้น **คำสั่ง Codex ของผู้ใช้จะชนะคำสั่ง Codex ของโปรเจกต์** เมื่อซ้ำกัน

เนื้อหาคำสั่ง Codex จะถูกแยกวิเคราะห์ด้วยการตัด frontmatter ออก (`parseFrontmatter`) และชื่อคำสั่งสามารถถูกแทนที่ด้วย frontmatter `name` มิฉะนั้นจะใช้ชื่อไฟล์

## Provider `claude-plugins` (`claude-plugins.ts`)

โหลดรากคำสั่ง plugin จาก `~/.claude/plugins/installed_plugins.json` จากนั้นสแกน `<pluginRoot>/commands/*.md`

ลำดับเป็นไปตามลำดับการวนซ้ำของ registry และลำดับรายการต่อ plugin จากข้อมูล JSON นั้น ไม่มีขั้นตอนการเรียงลำดับเพิ่มเติม

## 3) การสร้าง `FileSlashCommand` สำหรับ Runtime

`loadSlashCommands()` ใน `src/extensibility/slash-commands.ts` แปลงรายการ capability เป็นอ็อบเจกต์ `FileSlashCommand` ที่ใช้ในเวลาประมวลผลพรอมต์

สำหรับแต่ละคำสั่ง:

1. แยกวิเคราะห์ frontmatter/body (`parseFrontmatter`)
2. แหล่งที่มาของคำอธิบาย:
   - `frontmatter.description` หากมี
   - มิฉะนั้นใช้บรรทัดแรกของ body ที่ไม่ว่าง (ตัดช่องว่าง, สูงสุด 60 ตัวอักษรพร้อม `...`)
3. เก็บ body ที่แยกวิเคราะห์แล้วเป็นเนื้อหาเทมเพลตที่สามารถดำเนินการได้
4. คำนวณสตริงแหล่งที่มาสำหรับแสดงผล เช่น `via Claude Code Project`

ความรุนแรงของการแยกวิเคราะห์ frontmatter ขึ้นอยู่กับแหล่งที่มา:

- ระดับ `native` -> ข้อผิดพลาดในการแยกวิเคราะห์เป็น `fatal`
- ระดับ `user`/`project` -> ข้อผิดพลาดในการแยกวิเคราะห์เป็น `warn` พร้อมการแยกวิเคราะห์สำรอง

### คำสั่งสำรองแบบ Bundled

หลังจากคำสั่งจาก filesystem/provider คำสั่งเทมเพลตที่ฝังมาด้วย (`EMBEDDED_COMMAND_TEMPLATES`) จะถูกเพิ่มต่อท้ายหากชื่อของพวกมันยังไม่มีอยู่

ชุดที่ฝังปัจจุบันมาจาก `src/task/commands.ts` และถูกใช้เป็นตัวสำรอง (`source: "bundled"`)

## 4) โหมดโต้ตอบ: รายการคำสั่งมาจากไหน

โหมดโต้ตอบรวมแหล่งคำสั่งหลายแหล่งสำหรับ autocomplete และการกำหนดเส้นทางคำสั่ง

ในขั้นตอนการสร้าง มันจะสร้างรายการคำสั่งที่รอดำเนินการจาก:

- คำสั่ง built-in (`BUILTIN_SLASH_COMMANDS` รวมถึง argument completion และ inline hints สำหรับคำสั่งที่เลือก)
- slash command ที่ลงทะเบียนผ่าน extension (`extensionRunner.getRegisteredCommands(...)`)
- คำสั่ง custom แบบ TypeScript (`session.customCommands`) ที่ถูก map เป็น label ของ slash command
- คำสั่ง skill ที่เลือกได้ (`/skill:<name>`) เมื่อเปิดใช้งาน `skills.enableSkillCommands`

จากนั้น `init()` จะเรียก `refreshSlashCommandState(...)` เพื่อโหลดคำสั่งจากไฟล์และติดตั้ง `CombinedAutocompleteProvider` หนึ่งตัวที่ประกอบด้วย:

- คำสั่งที่รอดำเนินการข้างต้น
- คำสั่งจากไฟล์ที่ค้นพบ

`refreshSlashCommandState(...)` ยังอัปเดต `session.setSlashCommands(...)` เพื่อให้การขยายพรอมต์ใช้ชุดคำสั่งจากไฟล์ที่ค้นพบเดียวกัน

### วงจรชีวิตการรีเฟรช

สถานะ slash command จะถูกรีเฟรช:

- ระหว่างการ init ของโหมดโต้ตอบ
- หลังจาก `/move` เปลี่ยนไดเรกทอรีทำงาน (`handleMoveCommand` เรียก `resetCapabilities()` จากนั้น `refreshSlashCommandState(newCwd)`)

ไม่มี file watcher แบบต่อเนื่องสำหรับไดเรกทอรีคำสั่ง

### การแสดงผลอื่นๆ

แดชบอร์ด Extensions ก็โหลด capability `slash-commands` และแสดงรายการคำสั่งที่ใช้งานอยู่/ถูก shadow รวมถึงรายการซ้ำที่มี `_shadowed`

## 5) ตำแหน่งในท่อประมวลผลพรอมต์

ลำดับการจัดการ slash ของ `AgentSession.prompt(...)` (เมื่อ `expandPromptTemplates !== false`):

1. **คำสั่ง Extension** (`#tryExecuteExtensionCommand`)  
   หาก `/name` ตรงกับคำสั่งที่ลงทะเบียนผ่าน extension ตัวจัดการจะดำเนินการทันทีและ prompt จะ return
2. **คำสั่ง custom แบบ TypeScript** (`#tryExecuteCustomCommand`)  
   เฉพาะขอบเขต: หากตรงกัน จะดำเนินการและอาจส่งคืน:
   - `string` -> แทนที่ข้อความพรอมต์ด้วยสตริงนั้น
   - `void/undefined` -> ถือว่าจัดการแล้ว; ไม่มีพรอมต์ LLM
3. **คำสั่ง slash จากไฟล์** (`expandSlashCommand`)  
   หากข้อความยังคงเริ่มต้นด้วย `/` จะพยายามขยายคำสั่ง markdown
4. **เทมเพลตพรอมต์** (`expandPromptTemplate`)  
   ถูกนำไปใช้หลังจากการประมวลผล slash/custom
5. **การส่งมอบ**
   - idle: พรอมต์จะถูกส่งไปยัง agent ทันที
   - streaming: พรอมต์จะถูกเข้าคิวเป็น steer/follow-up ขึ้นอยู่กับ `streamingBehavior`

นี่คือเหตุผลที่การขยาย slash command อยู่ก่อนการขยายเทมเพลตพรอมต์ และเหตุผลที่คำสั่ง custom สามารถเปลี่ยนเครื่องหมาย slash นำหน้าออกก่อนการจับคู่คำสั่งจากไฟล์

## 6) ความหมายของการขยายสำหรับ slash command จากไฟล์

พฤติกรรมของ `expandSlashCommand(text, fileCommands)`:

- ทำงานเมื่อข้อความเริ่มต้นด้วย `/` เท่านั้น
- แยกวิเคราะห์ชื่อคำสั่งจากโทเค็นแรกหลัง `/`
- แยกวิเคราะห์ args จากข้อความที่เหลือผ่าน `parseCommandArgs`
- ค้นหาการจับคู่ชื่อที่ตรงกันทุกประการในคำสั่ง `fileCommands` ที่โหลดแล้ว
- หากตรงกัน จะใช้:
  - การแทนที่ตามตำแหน่ง: `$1`, `$2`, ...
  - การแทนที่แบบรวม: `$ARGUMENTS` และ `$@`
  - จากนั้นเรนเดอร์เทมเพลตผ่าน `prompt.render` ด้วย `{ args, ARGUMENTS, arguments }`
- หากไม่ตรงกัน จะส่งคืนข้อความเดิมโดยไม่เปลี่ยนแปลง

### ข้อควรระวังของ `parseCommandArgs`

ตัวแยกวิเคราะห์เป็นการแยกแบบง่ายที่รองรับเครื่องหมายคำพูด:

- รองรับเครื่องหมายคำพูด `'เดี่ยว'` และ `"คู่"` เพื่อรักษาช่องว่าง
- ตัดตัวคั่นเครื่องหมายคำพูดออก
- ไม่มีการ implement กฎ backslash escaping
- เครื่องหมายคำพูดที่ไม่จับคู่ไม่ถือเป็นข้อผิดพลาด; ตัวแยกวิเคราะห์จะอ่านจนจบ

## 7) พฤติกรรมเมื่อ `/...` ไม่รู้จัก

อินพุต slash ที่ไม่รู้จัก **จะไม่ถูกปฏิเสธ** โดยตรรกะ slash หลัก

หากคำสั่งไม่ได้รับการจัดการโดยเลเยอร์ extension/custom/file `expandSlashCommand` จะส่งคืนข้อความเดิม และพรอมต์ `/...` ตามตัวอักษรจะดำเนินผ่านการขยายเทมเพลตพรอมต์ปกติและการส่งไปยัง LLM

โหมดโต้ตอบจะจัดการ built-in หลายตัวโดยตรงใน `InputController` แยกต่างหาก (เช่น `/settings`, `/model`, `/mcp`, `/move`, `/exit`) สิ่งเหล่านี้จะถูกใช้ก่อน `session.prompt(...)` และดังนั้นจะไม่ถึงการขยายคำสั่งจากไฟล์ในเส้นทางนั้น

## 8) ความแตกต่างระหว่างช่วง Streaming กับ Idle

## เส้นทาง Idle

- `session.prompt("/x ...")` รันท่อประมวลผลคำสั่งและทั้งดำเนินการคำสั่งทันทีหรือส่งข้อความที่ขยายแล้วโดยตรง

## เส้นทาง Streaming (`session.isStreaming === true`)

- `prompt(...)` ยังคงรัน extension/custom/file/template transforms ก่อน
- จากนั้นต้องการ `streamingBehavior`:
  - `"steer"` -> เข้าคิวข้อความ interrupt (`agent.steer`)
  - `"followUp"` -> เข้าคิวข้อความหลังเทิร์น (`agent.followUp`)
- หากไม่ระบุ `streamingBehavior` prompt จะ throw ข้อผิดพลาด

### พฤติกรรม streaming เฉพาะคำสั่งที่สำคัญ

- คำสั่ง Extension จะถูกดำเนินการทันทีแม้ในระหว่าง streaming (ไม่ถูกเข้าคิวเป็นข้อความ)
- เมธอดตัวช่วย `steer(...)`/`followUp(...)` จะปฏิเสธคำสั่ง extension (`#throwIfExtensionCommand`) เพื่อหลีกเลี่ยงการเข้าคิวข้อความคำสั่งสำหรับตัวจัดการที่ต้องรันแบบ synchronous
- การเล่นซ้ำคิว compaction ใช้ `isKnownSlashCommand(...)` เพื่อตัดสินใจว่ารายการที่อยู่ในคิวควรถูกเล่นซ้ำผ่าน `session.prompt(...)` (สำหรับ slash command ที่รู้จัก) หรือเมธอด steer/follow-up แบบดิบ

## 9) การจัดการข้อผิดพลาดและจุดที่อาจเกิดความล้มเหลว

- ความล้มเหลวในการโหลด provider จะถูกแยกออก; registry จะรวบรวมคำเตือนและดำเนินการต่อกับ provider อื่นๆ
- รายการ slash command ที่ไม่ถูกต้อง (ขาด name/path/content หรือ level ไม่ถูกต้อง) จะถูกตัดออกโดยการตรวจสอบ capability
- ความล้มเหลวในการแยกวิเคราะห์ frontmatter:
  - คำสั่ง native: ข้อผิดพลาดการแยกวิเคราะห์แบบ fatal จะถูกส่งขึ้นไป
  - คำสั่งที่ไม่ใช่ native: คำเตือน + การแยกวิเคราะห์ key/value สำรอง
- ข้อยกเว้นจากตัวจัดการคำสั่ง Extension/custom จะถูกจับและรายงานผ่านช่องทางข้อผิดพลาดของ extension (หรือ logger สำรองสำหรับคำสั่ง custom ที่ไม่มี extension runner) และถือว่าจัดการแล้ว (ไม่มีการดำเนินการสำรองที่ไม่ตั้งใจ)
