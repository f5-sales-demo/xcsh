---
title: ภายในระบบ Slash Command
description: >-
  ภายในระบบ slash command พร้อมการลงทะเบียน การแยกวิเคราะห์อาร์กิวเมนต์
  และการส่งการดำเนินการ
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# ภายในระบบ Slash Command

เอกสารนี้อธิบายวิธีที่ slash command ถูกค้นพบ ตรวจสอบรายการซ้ำ แสดงในโหมดโต้ตอบ และขยายผลตอนป้อน prompt ใน `coding-agent`

## ไฟล์การดำเนินการ

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

## 1) โมเดลการค้นพบ

Slash command เป็น capability (`id: "slash-commands"`) ที่มีคีย์ตามชื่อคำสั่ง (`key: cmd => cmd.name`)

รีจิสทรี capability จะโหลด provider ที่ลงทะเบียนทั้งหมด เรียงลำดับตามลำดับความสำคัญของ provider จากมากไปน้อย และตรวจสอบรายการซ้ำตามคีย์โดยใช้ semantics แบบ **ตัวแรกชนะ**

### ลำดับความสำคัญของ Provider

Provider ของ slash command ในปัจจุบันและลำดับความสำคัญ:

1. `native` (OMP) — ลำดับความสำคัญ `100`
2. `claude` — ลำดับความสำคัญ `80`
3. `claude-plugins` — ลำดับความสำคัญ `70`
4. `codex` — ลำดับความสำคัญ `70`

พฤติกรรมเมื่อเสมอกัน: provider ที่มีลำดับความสำคัญเท่ากันจะรักษาลำดับการลงทะเบียนไว้ ลำดับการ import ปัจจุบันจะลงทะเบียน `claude-plugins` ก่อน `codex` ดังนั้นคำสั่ง plugin จะชนะคำสั่ง codex เมื่อชื่อชนกัน

### พฤติกรรมเมื่อชื่อชนกัน

สำหรับ `slash-commands` การชนกันจะถูกแก้ไขโดยการตรวจสอบรายการซ้ำของ capability อย่างเคร่งครัด:

- รายการที่มีลำดับความสำคัญสูงสุดจะถูกเก็บไว้ใน `result.items`
- รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะอยู่ใน `result.all` เท่านั้น และถูกทำเครื่องหมาย `_shadowed = true`

ซึ่งใช้ได้ทั้งกับ provider ต่าง ๆ และภายใน provider เดียวกันหากส่งคืนชื่อซ้ำกัน

### พฤติกรรมการสแกนไฟล์

Provider ส่วนใหญ่ใช้ `loadFilesFromDir(...)` ซึ่งปัจจุบัน:

- ค่าเริ่มต้นเป็นการจับคู่แบบไม่ recursive (`*.md`)
- ใช้ native glob พร้อม `gitignore: true`, `hidden: false`
- อ่านแต่ละไฟล์ที่จับคู่และแปลงเป็น `SlashCommand`

ดังนั้นไฟล์/ไดเรกทอรีที่ซ่อนอยู่จะไม่ถูกโหลด และเส้นทางที่ถูก ignore จะถูกข้าม

## 2) เส้นทางต้นทางเฉพาะของ Provider และลำดับความสำคัญในท้องถิ่น

## Provider `native` (`builtin.ts`)

ต้นทางการค้นหามาจากไดเรกทอรี `.xcsh`:

- โปรเจกต์: `<cwd>/.xcsh/commands/*.md`
- ผู้ใช้: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` จะส่งคืนโปรเจกต์ก่อน จากนั้นผู้ใช้ ดังนั้น **คำสั่ง native ของโปรเจกต์จะชนะคำสั่ง native ของผู้ใช้** เมื่อชื่อชนกัน

## Provider `claude` (`claude.ts`)

โหลด:

- ผู้ใช้: `~/.claude/commands/*.md`
- โปรเจกต์: `<cwd>/.claude/commands/*.md`

Provider จะ push รายการผู้ใช้ก่อนรายการโปรเจกต์ ดังนั้น **คำสั่ง Claude ของผู้ใช้จะชนะคำสั่ง Claude ของโปรเจกต์** เมื่อชื่อเดียวกันชนกันภายใน provider นี้

## Provider `codex` (`codex.ts`)

โหลด:

- ผู้ใช้: `~/.codex/commands/*.md`
- โปรเจกต์: `<cwd>/.codex/commands/*.md`

ทั้งสองฝั่งจะถูกโหลดแล้ว flatten ตามลำดับผู้ใช้ก่อน ดังนั้น **คำสั่ง Codex ของผู้ใช้จะชนะคำสั่ง Codex ของโปรเจกต์** เมื่อชนกัน

เนื้อหาคำสั่ง Codex ถูก parse ด้วยการ strip frontmatter (`parseFrontmatter`) และชื่อคำสั่งสามารถถูกแทนที่ด้วย frontmatter `name` ได้ มิฉะนั้นจะใช้ชื่อไฟล์แทน

## Provider `claude-plugins` (`claude-plugins.ts`)

โหลด root ของคำสั่ง plugin จาก `~/.claude/plugins/installed_plugins.json` แล้วสแกน `<pluginRoot>/commands/*.md`

การจัดลำดับเป็นไปตามลำดับการ iterate ของ registry และลำดับ entry ต่อ plugin จากข้อมูล JSON นั้น ไม่มีขั้นตอนการเรียงลำดับเพิ่มเติม

## 3) การ Materialize ไปยัง `FileSlashCommand` ที่ใช้งานจริง

`loadSlashCommands()` ใน `src/extensibility/slash-commands.ts` แปลง capability item เป็น object `FileSlashCommand` ที่ใช้ตอนป้อน prompt

สำหรับแต่ละคำสั่ง:

1. parse frontmatter/body (`parseFrontmatter`)
2. แหล่งที่มาของคำอธิบาย:
   - `frontmatter.description` หากมี
   - มิฉะนั้นจะใช้บรรทัดแรกของ body ที่ไม่ว่างเปล่า (trimmed ไม่เกิน 60 ตัวอักษรพร้อม `...`)
3. เก็บ body ที่ parse แล้วเป็นเนื้อหา template ที่ดำเนินการได้
4. คำนวณสตริงแหล่งที่มาสำหรับแสดงผล เช่น `via Claude Code Project`

ระดับความรุนแรงของการ parse frontmatter ขึ้นอยู่กับแหล่งที่มา:

- ระดับ `native` -> ข้อผิดพลาดในการ parse เป็น `fatal`
- ระดับ `user`/`project` -> ข้อผิดพลาดในการ parse เป็น `warn` พร้อม fallback parsing

### คำสั่ง fallback ที่ฝังไว้

หลังจากคำสั่งจากระบบไฟล์/provider จะมีการ append command template ที่ฝังไว้ (`EMBEDDED_COMMAND_TEMPLATES`) หากชื่อของคำสั่งเหล่านั้นยังไม่มีอยู่

ชุดที่ฝังไว้ปัจจุบันมาจาก `src/task/commands.ts` และใช้เป็น fallback (`source: "bundled"`)

## 4) โหมดโต้ตอบ: แหล่งที่มาของรายการคำสั่ง

โหมดโต้ตอบรวมแหล่งที่มาของคำสั่งหลายแหล่งสำหรับ autocomplete และการกำหนดเส้นทางคำสั่ง

ตอน construction จะสร้างรายการคำสั่งที่รอดำเนินการจาก:

- built-in (`BUILTIN_SLASH_COMMANDS` ซึ่งรวมถึงการเติมอาร์กิวเมนต์และ inline hint สำหรับคำสั่งที่เลือก)
- slash command ที่ลงทะเบียนโดย extension (`extensionRunner.getRegisteredCommands(...)`)
- คำสั่งกำหนดเองของ TypeScript (`session.customCommands`) ที่ map ไปยัง label ของ slash command
- คำสั่ง skill เพิ่มเติม (`/skill:<name>`) เมื่อ `skills.enableSkillCommands` เปิดใช้งาน

จากนั้น `init()` จะเรียก `refreshSlashCommandState(...)` เพื่อโหลดคำสั่งจากไฟล์และติดตั้ง `CombinedAutocompleteProvider` หนึ่งตัวที่ประกอบด้วย:

- คำสั่งที่รอดำเนินการข้างต้น
- คำสั่งจากไฟล์ที่ค้นพบ

`refreshSlashCommandState(...)` ยังอัปเดต `session.setSlashCommands(...)` ด้วย เพื่อให้การขยายผล prompt ใช้ชุดคำสั่งจากไฟล์ที่ค้นพบเดียวกัน

### วงจรชีวิตการรีเฟรช

สถานะ slash command จะถูกรีเฟรช:

- ระหว่างการ init แบบโต้ตอบ
- หลังจาก `/move` เปลี่ยนไดเรกทอรีการทำงาน (`handleMoveCommand` เรียก `resetCapabilities()` แล้ว `refreshSlashCommandState(newCwd)`)

ไม่มี file watcher ต่อเนื่องสำหรับไดเรกทอรีคำสั่ง

### การแสดงผลอื่น ๆ

แดชบอร์ด Extensions ยังโหลด capability `slash-commands` และแสดง entry ของคำสั่งที่ active/shadowed รวมถึงรายการซ้ำที่มีเครื่องหมาย `_shadowed`

## 5) ตำแหน่งใน Prompt Pipeline

ลำดับการจัดการ slash ของ `AgentSession.prompt(...)` (เมื่อ `expandPromptTemplates !== false`):

1. **คำสั่ง Extension** (`#tryExecuteExtensionCommand`)  
   หาก `/name` ตรงกับคำสั่งที่ลงทะเบียนโดย extension handler จะดำเนินการทันทีและ prompt จะส่งคืน
2. **คำสั่งกำหนดเองของ TypeScript** (`#tryExecuteCustomCommand`)  
   เฉพาะขอบเขต: หากตรงกัน จะดำเนินการและอาจส่งคืน:
   - `string` -> แทนที่ข้อความ prompt ด้วยสตริงนั้น
   - `void/undefined` -> ถือว่าถูกจัดการแล้ว ไม่มี LLM prompt
3. **Slash command จากไฟล์** (`expandSlashCommand`)  
   หากข้อความยังคงขึ้นต้นด้วย `/` จะพยายามขยาย markdown command
4. **Prompt template** (`expandPromptTemplate`)  
   ใช้หลังจากประมวลผล slash/custom แล้ว
5. **การส่งมอบ**
   - idle: prompt จะถูกส่งไปยัง agent ทันที
   - streaming: prompt จะถูกเข้าคิวเป็น steer/follow-up ตาม `streamingBehavior`

นี่คือเหตุผลที่การขยาย slash command อยู่ก่อนการขยาย prompt-template และเหตุผลที่คำสั่งกำหนดเองสามารถแปลง slash นำหน้าออกก่อนการจับคู่ file-command

## 6) Semantics การขยายสำหรับ slash command จากไฟล์

พฤติกรรมของ `expandSlashCommand(text, fileCommands)`:

- ทำงานเฉพาะเมื่อข้อความขึ้นต้นด้วย `/`
- parse ชื่อคำสั่งจาก token แรกหลัง `/`
- parse args จากข้อความที่เหลือผ่าน `parseCommandArgs`
- ค้นหาการจับคู่ชื่อที่แน่ชัดใน `fileCommands` ที่โหลดแล้ว
- หากจับคู่ได้ จะใช้:
  - การแทนที่ตำแหน่ง: `$1`, `$2`, ...
  - การแทนที่รวม: `$ARGUMENTS` และ `$@`
  - จากนั้น template rendering ผ่าน `prompt.render` ด้วย `{ args, ARGUMENTS, arguments }`
- หากไม่จับคู่ได้ จะส่งคืนข้อความต้นฉบับโดยไม่เปลี่ยนแปลง

### ข้อควรระวังของ `parseCommandArgs`

Parser เป็น quote-aware splitting แบบง่าย:

- รองรับการ quote แบบ `'single'` และ `"double"` เพื่อรักษาช่องว่าง
- ลบตัวคั่น quote ออก
- ไม่ implement กฎการ escape ด้วย backslash
- quote ที่ไม่มีคู่ไม่ถือเป็นข้อผิดพลาด parser จะดำเนินการจนถึงสิ้นสุด

## 7) พฤติกรรมของ `/...` ที่ไม่รู้จัก

input slash ที่ไม่รู้จัก **จะไม่ถูกปฏิเสธ** โดย core slash logic

หากคำสั่งไม่ถูกจัดการโดย layer ของ extension/custom/file `expandSlashCommand` จะส่งคืนข้อความต้นฉบับ และ prompt `/...` ตามตัวอักษรจะดำเนินต่อผ่านการขยาย prompt-template ปกติและการส่งไปยัง LLM

โหมดโต้ตอบจะจัดการ built-in หลายตัวโดยตรงใน `InputController` แยกต่างหาก (เช่น `/settings`, `/model`, `/mcp`, `/move`, `/exit`) ซึ่งจะถูกใช้ก่อน `session.prompt(...)` ดังนั้นจึงไม่เคยไปถึงการขยาย file-command ในเส้นทางนั้น

## 8) ความแตกต่างในเวลา Streaming เทียบกับ Idle

## เส้นทาง Idle

- `session.prompt("/x ...")` รัน command pipeline และทั้งดำเนินการคำสั่งทันทีหรือส่งข้อความที่ขยายแล้วโดยตรง

## เส้นทาง Streaming (`session.isStreaming === true`)

- `prompt(...)` ยังคงรัน transform ของ extension/custom/file/template ก่อน
- จากนั้นต้องการ `streamingBehavior`:
  - `"steer"` -> เข้าคิวข้อความ interrupt (`agent.steer`)
  - `"followUp"` -> เข้าคิวข้อความหลัง turn (`agent.followUp`)
- หากละเว้น `streamingBehavior` prompt จะ throw error

### พฤติกรรม streaming เฉพาะของแต่ละคำสั่งที่สำคัญ

- คำสั่ง Extension จะดำเนินการทันทีแม้ระหว่าง streaming (ไม่เข้าคิวเป็นข้อความ)
- method helper `steer(...)`/`followUp(...)` จะปฏิเสธคำสั่ง extension (`#throwIfExtensionCommand`) เพื่อหลีกเลี่ยงการเข้าคิวข้อความคำสั่งสำหรับ handler ที่ต้องรันแบบ synchronous
- การ replay คิว compaction ใช้ `isKnownSlashCommand(...)` เพื่อตัดสินใจว่า entry ที่เข้าคิวควรถูก replay ผ่าน `session.prompt(...)` (สำหรับ slash command ที่รู้จัก) หรือผ่าน method steer/follow-up แบบ raw

## 9) การจัดการข้อผิดพลาดและพื้นผิวของความล้มเหลว

- ความล้มเหลวในการโหลด provider จะถูก isolate รีจิสทรีจะรวบรวมคำเตือนและดำเนินต่อกับ provider อื่น
- slash command item ที่ไม่ถูกต้อง (ไม่มีชื่อ/เส้นทาง/เนื้อหา หรือ level ไม่ถูกต้อง) จะถูกละทิ้งโดยการ validation ของ capability
- ความล้มเหลวในการ parse frontmatter:
  - คำสั่ง native: ข้อผิดพลาด parse ที่ fatal จะ bubble ขึ้น
  - คำสั่งที่ไม่ใช่ native: คำเตือน + fallback key/value parse
- exception ของ handler ของคำสั่ง extension/custom จะถูก catch และรายงานผ่าน channel ข้อผิดพลาดของ extension (หรือ logger fallback สำหรับคำสั่งกำหนดเองที่ไม่มี extension runner) และถือว่าถูกจัดการแล้ว (ไม่มีการดำเนินการ fallback โดยไม่ตั้งใจ)
