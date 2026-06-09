---
title: ภายในระบบ Slash Command
description: >-
  รายละเอียดภายในระบบ slash command รวมถึงการลงทะเบียน
  การแยกวิเคราะห์อาร์กิวเมนต์ และการส่งต่อการทำงาน
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# ภายในระบบ Slash command

เอกสารนี้อธิบายวิธีที่ slash commands ถูกค้นพบ ขจัดรายการซ้ำ แสดงผลในโหมดโต้ตอบ และขยายในเวลาที่ส่ง prompt ใน `coding-agent`

## ไฟล์การใช้งาน

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

Slash commands เป็นความสามารถ (capability) (`id: "slash-commands"`) ที่ใช้ชื่อคำสั่งเป็นคีย์ (`key: cmd => cmd.name`)

รีจิสทรีความสามารถจะโหลดผู้ให้บริการที่ลงทะเบียนทั้งหมด เรียงตามลำดับความสำคัญของผู้ให้บริการจากมากไปน้อย และขจัดรายการซ้ำตามคีย์ด้วยหลักการ **ตัวแรกชนะ**

### ลำดับความสำคัญของผู้ให้บริการ

ผู้ให้บริการ slash-command ปัจจุบันและลำดับความสำคัญ:

1. `native` (OMP) — ลำดับความสำคัญ `100`
2. `claude` — ลำดับความสำคัญ `80`
3. `claude-plugins` — ลำดับความสำคัญ `70`
4. `codex` — ลำดับความสำคัญ `70`

พฤติกรรมเมื่อลำดับเท่ากัน: ผู้ให้บริการที่มีลำดับความสำคัญเท่ากันจะรักษาลำดับการลงทะเบียนไว้ ลำดับการ import ปัจจุบันจะลงทะเบียน `claude-plugins` ก่อน `codex` ดังนั้นคำสั่งจากปลั๊กอินจะชนะเหนือคำสั่ง codex เมื่อชื่อซ้ำกัน

### พฤติกรรมเมื่อชื่อซ้ำกัน

สำหรับ `slash-commands` การซ้ำกันจะถูกแก้ไขอย่างเข้มงวดโดยการขจัดรายการซ้ำของความสามารถ:

- รายการที่มีลำดับความสำคัญสูงสุดจะถูกเก็บไว้ใน `result.items`
- รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะคงอยู่เฉพาะใน `result.all` และถูกทำเครื่องหมาย `_shadowed = true`

สิ่งนี้ใช้ได้ทั้งข้ามผู้ให้บริการและภายในผู้ให้บริการเดียวกันหากส่งคืนชื่อซ้ำ

### พฤติกรรมการสแกนไฟล์

ผู้ให้บริการส่วนใหญ่ใช้ `loadFilesFromDir(...)` ซึ่งปัจจุบัน:

- ค่าเริ่มต้นใช้การจับคู่แบบไม่เรียกซ้ำ (`*.md`)
- ใช้ native glob ด้วย `gitignore: true`, `hidden: false`
- อ่านแต่ละไฟล์ที่ตรงกันและแปลงเป็น `SlashCommand`

ดังนั้นไฟล์/ไดเรกทอรีที่ซ่อนจะไม่ถูกโหลด และเส้นทางที่ถูกเพิกเฉยจะถูกข้าม

## 2) เส้นทางแหล่งเฉพาะผู้ให้บริการและลำดับความสำคัญภายใน

## ผู้ให้บริการ `native` (`builtin.ts`)

รากการค้นหามาจากไดเรกทอรี `.xcsh`:

- โปรเจกต์: `<cwd>/.xcsh/commands/*.md`
- ผู้ใช้: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` ส่งคืนโปรเจกต์ก่อน จากนั้นผู้ใช้ ดังนั้น **คำสั่ง native ของโปรเจกต์จะชนะเหนือคำสั่ง native ของผู้ใช้** เมื่อชื่อซ้ำกัน

## ผู้ให้บริการ `claude` (`claude.ts`)

โหลด:

- ผู้ใช้: `~/.claude/commands/*.md`
- โปรเจกต์: `<cwd>/.claude/commands/*.md`

ผู้ให้บริการจะเพิ่มรายการของผู้ใช้ก่อนรายการของโปรเจกต์ ดังนั้น **คำสั่ง Claude ของผู้ใช้จะชนะเหนือคำสั่ง Claude ของโปรเจกต์** เมื่อชื่อซ้ำกันภายในผู้ให้บริการนี้

## ผู้ให้บริการ `codex` (`codex.ts`)

โหลด:

- ผู้ใช้: `~/.codex/commands/*.md`
- โปรเจกต์: `<cwd>/.codex/commands/*.md`

ทั้งสองฝั่งจะถูกโหลดแล้วรวมเรียบในลำดับผู้ใช้ก่อน ดังนั้น **คำสั่ง Codex ของผู้ใช้จะชนะเหนือคำสั่ง Codex ของโปรเจกต์** เมื่อชื่อซ้ำกัน

เนื้อหาคำสั่ง Codex ถูกแยกวิเคราะห์ด้วยการตัด frontmatter ออก (`parseFrontmatter`) และชื่อคำสั่งสามารถถูกแทนที่โดย frontmatter `name`; มิฉะนั้นจะใช้ชื่อไฟล์

## ผู้ให้บริการ `claude-plugins` (`claude-plugins.ts`)

โหลดรากคำสั่งปลั๊กอินจาก `~/.claude/plugins/installed_plugins.json` จากนั้นสแกน `<pluginRoot>/commands/*.md`

ลำดับเป็นไปตามลำดับการวนซ้ำของรีจิสทรีและลำดับรายการต่อปลั๊กอินจากข้อมูล JSON นั้น ไม่มีขั้นตอนการเรียงลำดับเพิ่มเติม

## 3) การแปลงเป็น `FileSlashCommand` ในรันไทม์

`loadSlashCommands()` ใน `src/extensibility/slash-commands.ts` แปลงรายการความสามารถเป็นอ็อบเจกต์ `FileSlashCommand` ที่ใช้ในเวลา prompt

สำหรับแต่ละคำสั่ง:

1. แยกวิเคราะห์ frontmatter/body (`parseFrontmatter`)
2. แหล่งที่มาของคำอธิบาย:
   - `frontmatter.description` หากมี
   - มิฉะนั้นใช้บรรทัดแรกของ body ที่ไม่ว่าง (ตัดช่องว่าง สูงสุด 60 ตัวอักษรพร้อม `...`)
3. เก็บ body ที่แยกวิเคราะห์แล้วเป็นเนื้อหาเทมเพลตที่สามารถเรียกใช้ได้
4. คำนวณสตริงแหล่งที่มาสำหรับแสดงผล เช่น `via Claude Code Project`

ระดับความรุนแรงของการแยกวิเคราะห์ frontmatter ขึ้นอยู่กับแหล่งที่มา:

- ระดับ `native` -> ข้อผิดพลาดการแยกวิเคราะห์เป็น `fatal`
- ระดับ `user`/`project` -> ข้อผิดพลาดการแยกวิเคราะห์เป็น `warn` พร้อมการแยกวิเคราะห์สำรอง

### คำสั่งสำรองที่รวมมาด้วย

หลังจากคำสั่งจากระบบไฟล์/ผู้ให้บริการ เทมเพลตคำสั่งที่ฝังมา (`EMBEDDED_COMMAND_TEMPLATES`) จะถูกเพิ่มต่อท้ายหากชื่อของพวกมันยังไม่มีอยู่

ชุดที่ฝังมาปัจจุบันมาจาก `src/task/commands.ts` และใช้เป็นตัวสำรอง (`source: "bundled"`)

## 4) โหมดโต้ตอบ: รายการคำสั่งมาจากไหน

โหมดโต้ตอบรวมแหล่งคำสั่งหลายแหล่งสำหรับการเติมอัตโนมัติและการกำหนดเส้นทางคำสั่ง

ในเวลาสร้างจะสร้างรายการคำสั่งที่รอดำเนินการจาก:

- คำสั่งในตัว (`BUILTIN_SLASH_COMMANDS` รวมถึงการเติมอาร์กิวเมนต์และคำแนะนำแบบอินไลน์สำหรับคำสั่งที่เลือก)
- คำสั่ง slash ที่ลงทะเบียนจากส่วนขยาย (`extensionRunner.getRegisteredCommands(...)`)
- คำสั่งกำหนดเอง TypeScript (`session.customCommands`) ที่แมปกับป้ายกำกับ slash command
- คำสั่ง skill เสริม (`/skill:<name>`) เมื่อเปิดใช้ `skills.enableSkillCommands`

จากนั้น `init()` เรียก `refreshSlashCommandState(...)` เพื่อโหลดคำสั่งจากไฟล์และติดตั้ง `CombinedAutocompleteProvider` หนึ่งตัวที่ประกอบด้วย:

- คำสั่งที่รอดำเนินการข้างต้น
- คำสั่งจากไฟล์ที่ค้นพบ

`refreshSlashCommandState(...)` ยังอัปเดต `session.setSlashCommands(...)` เพื่อให้การขยาย prompt ใช้ชุดคำสั่งจากไฟล์ที่ค้นพบเดียวกัน

### วงจรชีวิตการรีเฟรช

สถานะ slash command จะถูกรีเฟรช:

- ระหว่างการเริ่มต้นโหมดโต้ตอบ
- หลังจาก `/move` เปลี่ยนไดเรกทอรีทำงาน (`handleMoveCommand` เรียก `resetCapabilities()` จากนั้น `refreshSlashCommandState(newCwd)`)

ไม่มีตัวเฝ้าดูไฟล์แบบต่อเนื่องสำหรับไดเรกทอรีคำสั่ง

### การแสดงผลอื่นๆ

แดชบอร์ดส่วนขยายยังโหลดความสามารถ `slash-commands` และแสดงรายการคำสั่งที่ใช้งานอยู่/ถูกบดบัง รวมถึงรายการซ้ำที่เป็น `_shadowed`

## 5) ตำแหน่งในไปป์ไลน์ Prompt

ลำดับการจัดการ slash ของ `AgentSession.prompt(...)` (เมื่อ `expandPromptTemplates !== false`):

1. **คำสั่งส่วนขยาย** (`#tryExecuteExtensionCommand`)  
   หาก `/name` ตรงกับคำสั่งที่ลงทะเบียนจากส่วนขยาย ตัวจัดการจะทำงานทันทีและ prompt จะส่งคืน
2. **คำสั่งกำหนดเอง TypeScript** (`#tryExecuteCustomCommand`)  
   ขอบเขตเท่านั้น: หากตรงกัน จะทำงานและอาจส่งคืน:
   - `string` -> แทนที่ข้อความ prompt ด้วยสตริงนั้น
   - `void/undefined` -> ถือว่าจัดการแล้ว; ไม่มี prompt ไปยัง LLM
3. **คำสั่ง slash จากไฟล์** (`expandSlashCommand`)  
   หากข้อความยังคงเริ่มต้นด้วย `/` จะพยายามขยายคำสั่ง markdown
4. **เทมเพลต Prompt** (`expandPromptTemplate`)  
   ใช้หลังจากการประมวลผล slash/custom
5. **การส่งมอบ**
   - idle: prompt จะถูกส่งไปยัง agent ทันที
   - streaming: prompt จะถูกจัดคิวเป็น steer/follow-up ขึ้นอยู่กับ `streamingBehavior`

นี่คือเหตุผลว่าทำไมการขยาย slash command จึงอยู่ก่อนการขยายเทมเพลต prompt และทำไมคำสั่งกำหนดเองจึงสามารถแปลง slash นำหน้าออกก่อนการจับคู่คำสั่งจากไฟล์

## 6) ความหมายของการขยายสำหรับ slash commands จากไฟล์

พฤติกรรมของ `expandSlashCommand(text, fileCommands)`:

- ทำงานเฉพาะเมื่อข้อความเริ่มต้นด้วย `/`
- แยกวิเคราะห์ชื่อคำสั่งจากโทเค็นแรกหลัง `/`
- แยกวิเคราะห์อาร์กิวเมนต์จากข้อความที่เหลือผ่าน `parseCommandArgs`
- ค้นหาชื่อที่ตรงกันพอดีในคำสั่ง `fileCommands` ที่โหลดแล้ว
- หากตรงกัน จะใช้:
  - การแทนที่ตามตำแหน่ง: `$1`, `$2`, ...
  - การแทนที่แบบรวม: `$ARGUMENTS` และ `$@`
  - จากนั้นเรนเดอร์เทมเพลตผ่าน `prompt.render` ด้วย `{ args, ARGUMENTS, arguments }`
- หากไม่ตรงกัน ส่งคืนข้อความเดิมโดยไม่เปลี่ยนแปลง

### ข้อควรระวังของ `parseCommandArgs`

ตัวแยกวิเคราะห์เป็นการแบ่งอย่างง่ายที่รองรับเครื่องหมายอัญประกาศ:

- รองรับเครื่องหมายอัญประกาศ `'เดี่ยว'` และ `"คู่"` เพื่อรักษาช่องว่าง
- ตัดตัวคั่นเครื่องหมายอัญประกาศออก
- ไม่ใช้กฎการ escape ด้วย backslash
- เครื่องหมายอัญประกาศที่ไม่จับคู่ไม่ใช่ข้อผิดพลาด; ตัวแยกวิเคราะห์จะอ่านจนถึงตอนจบ

## 7) พฤติกรรมเมื่อ `/...` ไม่รู้จัก

อินพุต slash ที่ไม่รู้จัก **ไม่ถูกปฏิเสธ** โดยตรรกะ slash หลัก

หากคำสั่งไม่ถูกจัดการโดยชั้น extension/custom/file `expandSlashCommand` จะส่งคืนข้อความเดิม และ prompt `/...` ตามตัวอักษรจะดำเนินต่อผ่านการขยายเทมเพลต prompt ปกติและการส่งมอบไปยัง LLM

โหมดโต้ตอบจะจัดการคำสั่งในตัวหลายรายการแยกต่างหากโดยตรงใน `InputController` (ตัวอย่างเช่น `/settings`, `/model`, `/mcp`, `/move`, `/exit`) คำสั่งเหล่านี้จะถูกใช้ก่อน `session.prompt(...)` และดังนั้นจึงไม่มีวันไปถึงการขยายคำสั่งจากไฟล์ในเส้นทางนั้น

## 8) ความแตกต่างระหว่าง streaming กับ idle

## เส้นทาง Idle

- `session.prompt("/x ...")` เรียกใช้ไปป์ไลน์คำสั่งและทำงานคำสั่งทันทีหรือส่งข้อความที่ขยายแล้วโดยตรง

## เส้นทาง Streaming (`session.isStreaming === true`)

- `prompt(...)` ยังคงเรียกใช้การแปลง extension/custom/file/template ก่อน
- จากนั้นต้องการ `streamingBehavior`:
  - `"steer"` -> จัดคิวข้อความขัดจังหวะ (`agent.steer`)
  - `"followUp"` -> จัดคิวข้อความหลังเทิร์น (`agent.followUp`)
- หาก `streamingBehavior` ถูกละเว้น prompt จะส่งข้อผิดพลาด

### พฤติกรรม streaming เฉพาะคำสั่งที่สำคัญ

- คำสั่งส่วนขยายจะถูกเรียกใช้ทันทีแม้ในระหว่าง streaming (ไม่ถูกจัดคิวเป็นข้อความ)
- เมธอด `steer(...)`/`followUp(...)` ตัวช่วยจะปฏิเสธคำสั่งส่วนขยาย (`#throwIfExtensionCommand`) เพื่อหลีกเลี่ยงการจัดคิวข้อความคำสั่งสำหรับตัวจัดการที่ต้องทำงานแบบซิงโครนัส
- การเล่นซ้ำคิว compaction ใช้ `isKnownSlashCommand(...)` เพื่อตัดสินใจว่ารายการที่จัดคิวควรถูกเล่นซ้ำผ่าน `session.prompt(...)` (สำหรับ slash commands ที่รู้จัก) หรือเมธอด steer/follow-up แบบดิบ

## 9) การจัดการข้อผิดพลาดและจุดที่อาจล้มเหลว

- ความล้มเหลวในการโหลดผู้ให้บริการจะถูกแยกออก; รีจิสทรีจะรวบรวมคำเตือนและดำเนินการต่อกับผู้ให้บริการอื่น
- รายการ slash command ที่ไม่ถูกต้อง (ไม่มีชื่อ/เส้นทาง/เนื้อหา หรือระดับไม่ถูกต้อง) จะถูกตัดออกโดยการตรวจสอบความสามารถ
- ความล้มเหลวในการแยกวิเคราะห์ frontmatter:
  - คำสั่ง native: ข้อผิดพลาดการแยกวิเคราะห์แบบ fatal จะลอยขึ้น
  - คำสั่ง non-native: คำเตือน + การแยกวิเคราะห์สำรองแบบ key/value
- ข้อยกเว้นของตัวจัดการคำสั่ง extension/custom จะถูกจับและรายงานผ่านช่องทางข้อผิดพลาดของส่วนขยาย (หรือ logger สำรองสำหรับคำสั่งกำหนดเองที่ไม่มี extension runner) และถือว่าจัดการแล้ว (ไม่มีการทำงานสำรองที่ไม่ตั้งใจ)
