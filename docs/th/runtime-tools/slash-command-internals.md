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

# ระบบภายในของ Slash command

เอกสารนี้อธิบายวิธีที่ slash commands ถูกค้นพบ จัดการรายการซ้ำ แสดงผลในโหมดโต้ตอบ และขยายในเวลา prompt ใน `coding-agent`

## ไฟล์ที่ใช้ในการ implement

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

Slash commands เป็น capability (`id: "slash-commands"`) ที่ใช้ชื่อคำสั่งเป็น key (`key: cmd => cmd.name`)

capability registry จะโหลด provider ที่ลงทะเบียนทั้งหมด เรียงตาม priority ของ provider จากมากไปน้อย และจัดการรายการซ้ำด้วยหลักการ **รายการแรกชนะ**

### ลำดับความสำคัญของ Provider

Provider ของ slash-command ปัจจุบันและ priority:

1. `native` (OMP) — priority `100`
2. `claude` — priority `80`
3. `claude-plugins` — priority `70`
4. `codex` — priority `70`

พฤติกรรมเมื่อ priority เท่ากัน: provider ที่มี priority เท่ากันจะรักษาลำดับการลงทะเบียน ลำดับ import ปัจจุบันจะลงทะเบียน `claude-plugins` ก่อน `codex` ดังนั้นคำสั่ง plugin จะชนะคำสั่ง codex เมื่อชื่อซ้ำกัน

### พฤติกรรมเมื่อชื่อซ้ำกัน

สำหรับ `slash-commands` การซ้ำกันจะถูกแก้ไขอย่างเข้มงวดโดย capability dedup:

- รายการที่มี precedence สูงสุดจะถูกเก็บไว้ใน `result.items`
- รายการซ้ำที่มี precedence ต่ำกว่าจะอยู่เฉพาะใน `result.all` และถูกทำเครื่องหมาย `_shadowed = true`

สิ่งนี้ใช้ได้ทั้งข้าม provider และภายใน provider เดียวกันหากมันส่งคืนชื่อซ้ำ

### พฤติกรรมการสแกนไฟล์

Provider ส่วนใหญ่ใช้ `loadFilesFromDir(...)` ซึ่งปัจจุบัน:

- ค่าเริ่มต้นเป็นการจับคู่แบบไม่เรียกซ้ำ (`*.md`)
- ใช้ native glob กับ `gitignore: true`, `hidden: false`
- อ่านแต่ละไฟล์ที่ตรงกันและแปลงเป็น `SlashCommand`

ดังนั้นไฟล์/ไดเรกทอรีที่ซ่อนจะไม่ถูกโหลด และ path ที่ถูก ignore จะถูกข้าม

## 2) เส้นทางแหล่งที่มาเฉพาะ Provider และลำดับความสำคัญภายใน

## Provider `native` (`builtin.ts`)

รากการค้นหามาจากไดเรกทอรี `.xcsh`:

- โปรเจกต์: `<cwd>/.xcsh/commands/*.md`
- ผู้ใช้: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` จะส่งคืนโปรเจกต์ก่อนแล้วตามด้วยผู้ใช้ ดังนั้น **คำสั่ง native ของโปรเจกต์จะชนะคำสั่ง native ของผู้ใช้** เมื่อชื่อซ้ำกัน

## Provider `claude` (`claude.ts`)

โหลด:

- ผู้ใช้: `~/.claude/commands/*.md`
- โปรเจกต์: `<cwd>/.claude/commands/*.md`

Provider จะเพิ่มรายการผู้ใช้ก่อนรายการโปรเจกต์ ดังนั้น **คำสั่ง Claude ของผู้ใช้จะชนะคำสั่ง Claude ของโปรเจกต์** เมื่อชื่อซ้ำกันภายใน provider นี้

## Provider `codex` (`codex.ts`)

โหลด:

- ผู้ใช้: `~/.codex/commands/*.md`
- โปรเจกต์: `<cwd>/.codex/commands/*.md`

ทั้งสองฝั่งจะถูกโหลดแล้วรวมกันตามลำดับผู้ใช้ก่อน ดังนั้น **คำสั่ง Codex ของผู้ใช้จะชนะคำสั่ง Codex ของโปรเจกต์** เมื่อชื่อซ้ำกัน

เนื้อหาคำสั่ง Codex จะถูก parse โดยตัด frontmatter ออก (`parseFrontmatter`) และชื่อคำสั่งสามารถถูกแทนที่ด้วย frontmatter `name` มิฉะนั้นจะใช้ชื่อไฟล์

## Provider `claude-plugins` (`claude-plugins.ts`)

โหลดรากคำสั่ง plugin จาก `~/.claude/plugins/installed_plugins.json` จากนั้นสแกน `<pluginRoot>/commands/*.md`

ลำดับจะเป็นไปตามลำดับการวนซ้ำของ registry และลำดับรายการต่อ plugin จากข้อมูล JSON นั้น ไม่มีขั้นตอนการเรียงลำดับเพิ่มเติม

## 3) การสร้าง `FileSlashCommand` สำหรับ runtime

`loadSlashCommands()` ใน `src/extensibility/slash-commands.ts` จะแปลงรายการ capability เป็นออบเจกต์ `FileSlashCommand` ที่ใช้ในเวลา prompt

สำหรับแต่ละคำสั่ง:

1. parse frontmatter/body (`parseFrontmatter`)
2. แหล่งที่มาของคำอธิบาย:
   - `frontmatter.description` หากมี
   - มิฉะนั้นจะใช้บรรทัดแรกของ body ที่ไม่ว่าง (ตัดช่องว่าง, สูงสุด 60 ตัวอักษรพร้อม `...`)
3. เก็บ body ที่ parse แล้วเป็นเนื้อหาเทมเพลตที่สามารถรันได้
4. คำนวณสตริงแหล่งที่มาสำหรับแสดงผล เช่น `via Claude Code Project`

ระดับความรุนแรงของการ parse frontmatter ขึ้นอยู่กับแหล่งที่มา:

- ระดับ `native` -> ข้อผิดพลาดการ parse เป็น `fatal`
- ระดับ `user`/`project` -> ข้อผิดพลาดการ parse เป็น `warn` พร้อมการ parse สำรอง

### คำสั่ง fallback ที่รวมมาด้วย

หลังจากคำสั่งจาก filesystem/provider แล้ว เทมเพลตคำสั่งที่ฝังมา (`EMBEDDED_COMMAND_TEMPLATES`) จะถูกเพิ่มต่อท้ายหากชื่อของพวกมันยังไม่มีอยู่

ชุดคำสั่งฝังตัวปัจจุบันมาจาก `src/task/commands.ts` และใช้เป็น fallback (`source: "bundled"`)

## 4) โหมดโต้ตอบ: รายการคำสั่งมาจากไหน

โหมดโต้ตอบรวมแหล่งคำสั่งหลายแหล่งสำหรับ autocomplete และการกำหนดเส้นทางคำสั่ง

ในเวลาสร้างจะสร้างรายการคำสั่งที่รอดำเนินการจาก:

- คำสั่งในตัว (`BUILTIN_SLASH_COMMANDS` รวมถึงการเติมอาร์กิวเมนต์อัตโนมัติและคำแนะนำแบบ inline สำหรับคำสั่งที่เลือก)
- คำสั่ง slash ที่ลงทะเบียนผ่าน extension (`extensionRunner.getRegisteredCommands(...)`)
- คำสั่ง custom ของ TypeScript (`session.customCommands`) ที่ถูกแมปเป็น label ของ slash command
- คำสั่ง skill ที่เป็นทางเลือก (`/skill:<name>`) เมื่อเปิดใช้งาน `skills.enableSkillCommands`

จากนั้น `init()` จะเรียก `refreshSlashCommandState(...)` เพื่อโหลดคำสั่งจากไฟล์และติดตั้ง `CombinedAutocompleteProvider` หนึ่งตัวที่ประกอบด้วย:

- คำสั่งที่รอดำเนินการด้านบน
- คำสั่งจากไฟล์ที่ค้นพบ

`refreshSlashCommandState(...)` ยังอัปเดต `session.setSlashCommands(...)` เพื่อให้การขยาย prompt ใช้ชุดคำสั่งไฟล์ที่ค้นพบเดียวกัน

### วงจรชีวิตของการรีเฟรช

สถานะ slash command จะถูกรีเฟรช:

- ระหว่างการเริ่มต้นโหมดโต้ตอบ
- หลังจาก `/move` เปลี่ยนไดเรกทอรีทำงาน (`handleMoveCommand` เรียก `resetCapabilities()` จากนั้น `refreshSlashCommandState(newCwd)`)

ไม่มีตัวเฝ้าดูไฟล์อย่างต่อเนื่องสำหรับไดเรกทอรีคำสั่ง

### การแสดงผลอื่น ๆ

แดชบอร์ด Extensions ก็โหลด capability `slash-commands` เช่นกันและแสดงรายการคำสั่งที่ใช้งาน/ถูกบัง รวมถึงรายการซ้ำที่เป็น `_shadowed`

## 5) ตำแหน่งใน prompt pipeline

ลำดับการจัดการ slash ของ `AgentSession.prompt(...)` (เมื่อ `expandPromptTemplates !== false`):

1. **คำสั่ง Extension** (`#tryExecuteExtensionCommand`)  
   หาก `/name` ตรงกับคำสั่งที่ลงทะเบียนผ่าน extension handler จะทำงานทันทีและ prompt จะ return
2. **คำสั่ง custom ของ TypeScript** (`#tryExecuteCustomCommand`)  
   ขอบเขตเท่านั้น: หากตรงกัน จะทำงานและอาจ return:
   - `string` -> แทนที่ข้อความ prompt ด้วยสตริงนั้น
   - `void/undefined` -> ถือว่าจัดการแล้ว; ไม่มี LLM prompt
3. **คำสั่ง slash จากไฟล์** (`expandSlashCommand`)  
   หากข้อความยังคงเริ่มต้นด้วย `/` ให้พยายามขยายคำสั่ง markdown
4. **Prompt templates** (`expandPromptTemplate`)  
   ใช้หลังจากการประมวลผล slash/custom
5. **การส่งมอบ**
   - idle: prompt จะถูกส่งไปยัง agent ทันที
   - streaming: prompt จะถูกจัดคิวเป็น steer/follow-up ขึ้นอยู่กับ `streamingBehavior`

นี่คือเหตุผลที่การขยาย slash command อยู่ก่อนการขยาย prompt-template และเหตุผลที่คำสั่ง custom สามารถแปลง slash นำออกก่อนการจับคู่คำสั่งไฟล์

## 6) ความหมายของการขยายสำหรับคำสั่ง slash จากไฟล์

พฤติกรรมของ `expandSlashCommand(text, fileCommands)`:

- ทำงานเฉพาะเมื่อข้อความเริ่มต้นด้วย `/`
- parse ชื่อคำสั่งจาก token แรกหลัง `/`
- parse อาร์กิวเมนต์จากข้อความที่เหลือผ่าน `parseCommandArgs`
- ค้นหาชื่อที่ตรงกันพอดีในรายการ `fileCommands` ที่โหลดไว้
- หากตรงกัน จะใช้:
  - การแทนที่ตามตำแหน่ง: `$1`, `$2`, ...
  - การแทนที่แบบรวม: `$ARGUMENTS` และ `$@`
  - จากนั้น render เทมเพลตผ่าน `prompt.render` ด้วย `{ args, ARGUMENTS, arguments }`
- หากไม่ตรงกัน จะส่งคืนข้อความเดิมโดยไม่เปลี่ยนแปลง

### ข้อควรระวังของ `parseCommandArgs`

ตัว parser เป็นการแยกแบบง่ายที่รองรับเครื่องหมายคำพูด:

- รองรับการใส่เครื่องหมายคำพูดแบบ `'single'` และ `"double"` เพื่อรักษาช่องว่าง
- ตัดตัวคั่นเครื่องหมายคำพูดออก
- ไม่ implement กฎการ escape ด้วย backslash
- เครื่องหมายคำพูดที่ไม่จับคู่ไม่ใช่ข้อผิดพลาด; parser จะอ่านจนถึงจุดสิ้นสุด

## 7) พฤติกรรมเมื่อ `/...` ไม่รู้จัก

อินพุต slash ที่ไม่รู้จัก **ไม่ถูกปฏิเสธ** โดยตรรกะ slash หลัก

หากคำสั่งไม่ถูกจัดการโดยชั้น extension/custom/file `expandSlashCommand` จะส่งคืนข้อความเดิม และ prompt `/...` ที่เป็นตัวอักษรจริงจะดำเนินต่อผ่านการขยาย prompt-template ปกติและการส่ง LLM

โหมดโต้ตอบจะจัดการคำสั่งในตัวหลายรายการโดยตรงใน `InputController` (เช่น `/settings`, `/model`, `/mcp`, `/move`, `/exit`) คำสั่งเหล่านั้นจะถูกใช้ก่อน `session.prompt(...)` และดังนั้นจะไม่ถึงการขยายคำสั่งไฟล์ในเส้นทางนั้น

## 8) ความแตกต่างระหว่าง streaming-time กับ idle

## เส้นทาง Idle

- `session.prompt("/x ...")` รัน command pipeline และทำงานคำสั่งทันทีหรือส่งข้อความที่ขยายแล้วโดยตรง

## เส้นทาง Streaming (`session.isStreaming === true`)

- `prompt(...)` ยังคงรันการแปลง extension/custom/file/template ก่อน
- จากนั้นต้องการ `streamingBehavior`:
  - `"steer"` -> จัดคิวข้อความ interrupt (`agent.steer`)
  - `"followUp"` -> จัดคิวข้อความหลังเทิร์น (`agent.followUp`)
- หากไม่ระบุ `streamingBehavior` prompt จะ throw ข้อผิดพลาด

### พฤติกรรม streaming ที่สำคัญเฉพาะคำสั่ง

- คำสั่ง Extension จะถูกทำงานทันทีแม้ในระหว่าง streaming (ไม่ถูกจัดคิวเป็นข้อความ)
- เมธอด `steer(...)`/`followUp(...)` helper จะปฏิเสธคำสั่ง extension (`#throwIfExtensionCommand`) เพื่อหลีกเลี่ยงการจัดคิวข้อความคำสั่งสำหรับ handler ที่ต้องทำงานแบบ synchronous
- การเล่นซ้ำคิว compaction ใช้ `isKnownSlashCommand(...)` เพื่อตัดสินว่ารายการที่จัดคิวควรถูกเล่นซ้ำผ่าน `session.prompt(...)` (สำหรับ slash command ที่รู้จัก) หรือเมธอด steer/follow-up แบบ raw

## 9) การจัดการข้อผิดพลาดและจุดล้มเหลว

- ความล้มเหลวในการโหลด Provider จะถูกแยกออก; registry จะรวบรวมคำเตือนและดำเนินต่อกับ provider อื่น
- รายการ slash command ที่ไม่ถูกต้อง (ขาดชื่อ/เส้นทาง/เนื้อหา หรือระดับไม่ถูกต้อง) จะถูกทิ้งโดยการตรวจสอบ capability
- ความล้มเหลวในการ parse Frontmatter:
  - คำสั่ง native: ข้อผิดพลาดการ parse แบบ fatal จะ bubble ขึ้น
  - คำสั่ง non-native: คำเตือน + การ parse key/value สำรอง
- ข้อยกเว้นของ handler คำสั่ง Extension/custom จะถูกจับและรายงานผ่านช่องทางข้อผิดพลาด extension (หรือ logger fallback สำหรับคำสั่ง custom ที่ไม่มี extension runner) และถือว่าจัดการแล้ว (ไม่มีการทำงาน fallback โดยไม่ตั้งใจ)
