---
title: 'Porting From pi-mono: คู่มือการผสานรวมเชิงปฏิบัติ'
description: >-
  คู่มือเชิงปฏิบัติสำหรับการย้ายโค้ดจาก monorepo ของ pi-mono เข้าสู่ codebase
  ของ xcsh
sidebar:
  order: 9
  label: การพอร์ตจาก pi-mono
i18n:
  sourceHash: fd4e8c09303d
  translator: machine
---

# การพอร์ตจาก pi-mono: คู่มือการผสานรวมเชิงปฏิบัติ

คู่มือนี้เป็นรายการตรวจสอบที่สามารถใช้ซ้ำได้สำหรับการพอร์ตการเปลี่ยนแปลงจาก pi-mono เข้าสู่ repo นี้
ใช้ได้กับทุกการผสาน: ไฟล์เดียว, feature branch, หรือการซิงค์รีลีสทั้งหมด

## จุดซิงค์ล่าสุด

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**วันที่:** 2026-03-22

อัปเดตส่วนนี้หลังจากการซิงค์แต่ละครั้ง; อย่าใช้ช่วงก่อนหน้าซ้ำ

เมื่อเริ่มการซิงค์ใหม่ ให้สร้าง patches จาก commit นี้เป็นต้นไป:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) กำหนดขอบเขต

- ระบุข้อมูลอ้างอิงจาก upstream (commit, tag, หรือ PR)
- ระบุรายการ packages หรือโฟลเดอร์ที่คุณวางแผนจะแก้ไข
- ตัดสินใจว่าฟีเจอร์ใดอยู่ในขอบเขตและฟีเจอร์ใดที่ข้ามโดยตั้งใจ

## 1) นำโค้ดมาอย่างปลอดภัย

- ใช้ diff ที่สะอาดและมีจุดเน้นชัดเจน แทนการคัดลอกทั้งหมด
- หลีกเลี่ยงการคัดลอก built artifacts หรือไฟล์ที่สร้างอัตโนมัติ
- หาก upstream เพิ่มไฟล์ใหม่ ให้เพิ่มอย่างชัดเจนและตรวจสอบเนื้อหา

## 2) จับคู่ข้อกำหนดนามสกุลไฟล์ในการ import

ซอร์ส TypeScript สำหรับ runtime ส่วนใหญ่จะละ `.js` ในการ import ภายใน แต่ entrypoints ของ test/bench บางไฟล์จะคง `.js` ไว้เพื่อความเข้ากันได้กับ ESM runtime ให้ทำตามรูปแบบที่มีอยู่ของ package นั้นๆ; อย่าลบนามสกุลไฟล์แบบหว่านแห

- ในซอร์ส runtime ของ `packages/coding-agent` ให้ import ภายในไม่ต้องมีนามสกุล ยกเว้นเมื่อ import สิ่งที่ไม่ใช่ TS
- ใน `packages/tui/test` และ `packages/natives/bench` ให้คง `.js` ไว้ในจุดที่ไฟล์โดยรอบใช้อยู่แล้ว
- คงนามสกุลไฟล์จริงเมื่อเครื่องมือต้องการ (เช่น `.json`, `.css`, `.md` text embeds)
- ตัวอย่าง: `import { x } from "./foo.js";` → `import { x } from "./foo";` (เฉพาะเมื่อข้อกำหนดของ package คือไม่มีนามสกุล)

## 3) แทนที่ scope ของ import

Upstream ใช้ package scope ที่แตกต่างกัน ให้แทนที่อย่างสม่ำเสมอ

- แทนที่ scope เก่าด้วย scope ที่ใช้ในที่นี้
- ตัวอย่าง (ปรับให้ตรงกับ packages ที่คุณกำลังพอร์ต):
  - `@mariozechner/pi-coding-agent` → `@f5-sales-demo/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5-sales-demo/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5-sales-demo/pi-tui`
  - `@mariozechner/pi-ai` → `@f5-sales-demo/pi-ai`

## 4) ใช้ Bun APIs เมื่อดีกว่า Node

เรารันบน Bun แทนที่ Node APIs เฉพาะเมื่อ Bun มีทางเลือกที่ดีกว่า

**ควรแทนที่:**

- การสร้าง Process: `child_process.spawn` → Bun Shell `$` สำหรับคำสั่งง่ายๆ, `Bun.spawn`/`Bun.spawnSync` สำหรับ streaming หรืองานที่ทำงานนาน
- File I/O: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP clients: `node-fetch`, `axios` → native `fetch`
- Crypto hashing: `node:crypto` → Web Crypto หรือ `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- การโหลด Env: `dotenv` → Bun โหลด `.env` อัตโนมัติ

**ไม่ควรแทนที่ (สิ่งเหล่านี้ทำงานได้ดีใน Bun):**

- `os.homedir()` — อย่าแทนที่ด้วย `Bun.env.HOME`, `Bun.env.HOME`, หรือค่าตายตัว `"~"`
- `os.tmpdir()` — อย่าแทนที่ด้วย `Bun.env.TMPDIR || "/tmp"` หรือ path แบบ hardcoded
- `fs.mkdtempSync()` — อย่าแทนที่ด้วยการสร้าง path แบบ manual
- `path.join()`, `path.resolve()` ฯลฯ — ใช้ได้ปกติ

**รูปแบบ Import:** ใช้ prefix `node:` กับ namespace imports เท่านั้น (ไม่ใช้ named imports จาก `node:fs` หรือ `node:path`)

**ข้อกำหนดเพิ่มเติมของ Bun:**

- ใช้ Bun Shell `$` สำหรับคำสั่งสั้นๆ ที่ไม่ต้อง streaming; ใช้ `Bun.spawn` เฉพาะเมื่อต้องการ streaming I/O หรือการควบคุม process
- ใช้ `Bun.file()`/`Bun.write()` สำหรับไฟล์ และ `node:fs/promises` สำหรับไดเรกทอรี
- หลีกเลี่ยงการตรวจสอบ `Bun.file().exists()`; ใช้การจัดการ `isEnoent` ใน try/catch
- ใช้ `Bun.sleep(ms)` แทน wrappers ของ `setTimeout`

**ผิด:**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**ถูกต้อง:**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) ใช้ Bun embeds แทน (ไม่ต้องคัดลอก)

อย่าคัดลอก runtime assets หรือ vendor files ตอน build time

- หาก upstream คัดลอก assets ลงในโฟลเดอร์ dist ให้แทนที่ด้วย Bun-friendly embeds
- Prompts เป็นไฟล์ `.md` แบบ static; ใช้ Bun text imports (`with { type: "text" }`) และ Handlebars แทน inline prompt strings
- ใช้ `import.meta.dir` + `Bun.file` เพื่อโหลดทรัพยากรที่ไม่ใช่ข้อความที่อยู่ใกล้เคียง
- เก็บ assets ไว้ใน repo และให้ bundler รวมเข้ามา
- ลบ copy scripts ยกเว้นผู้ใช้ร้องขออย่างชัดเจน
- หาก upstream อ่านไฟล์ bundled fallback ตอน runtime ให้แทนที่การอ่าน filesystem ด้วย Bun text embed import
  - ตัวอย่าง (Codex instructions fallback):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> ลบออก
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - ใช้ `return FALLBACK_INSTRUCTIONS;` แทน `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) พอร์ต `package.json` อย่างระมัดระวัง

ถือว่า `package.json` เป็นสัญญา ผสานอย่างตั้งใจ

- คง `name`, `version`, `type`, `exports`, และ `bin` ที่มีอยู่ ยกเว้นการพอร์ตจำเป็นต้องเปลี่ยนแปลง
- แทนที่ npm/node scripts ด้วย Bun equivalents (เช่น `bun check`, `bun test`)
- ตรวจสอบให้แน่ใจว่า dependencies ใช้ scope ที่ถูกต้อง
- อย่า downgrade dependencies เพื่อแก้ type errors; ให้ upgrade แทน
- ตรวจสอบ workspace package links และ `peerDependencies`

## 7) จัดรูปแบบโค้ดและเครื่องมือให้สอดคล้อง

- คงข้อกำหนดการจัดรูปแบบที่มีอยู่
- อย่าใช้ `any` ยกเว้นจำเป็น
- หลีกเลี่ยง dynamic imports และ inline type imports; ใช้ top-level imports เท่านั้น
- อย่าสร้าง prompts ในโค้ด; prompts เป็นไฟล์ `.md` แบบ static ที่ render ด้วย Handlebars
- ใน coding-agent อย่าใช้ `console.log`/`console.warn`/`console.error`; ใช้ `logger` จาก `@f5-sales-demo/pi-utils`
- ใช้ `Promise.withResolvers()` แทน `new Promise((resolve, reject) => ...)`
- **ไม่ใช้คีย์เวิร์ด `private`/`protected`/`public` บน class fields หรือ methods** ใช้ ES `#` private fields สำหรับการห่อหุ้ม; ปล่อย accessible members ไม่ต้องมีคีย์เวิร์ด ข้อยกเว้นเดียวคือ constructor parameter properties (`constructor(private readonly x: T)`) ซึ่ง TypeScript กำหนดให้ต้องมีคีย์เวิร์ด เมื่อพอร์ตโค้ด upstream ที่ใช้ `private foo` หรือ `protected bar` ให้แปลงเป็น `#foo` (private) หรือ bare `bar` (accessible)
- ใช้ helpers และ utilities ที่มีอยู่แทนโค้ด ad-hoc ใหม่
- รักษาการเปลี่ยนแปลงโครงสร้างพื้นฐานแบบ Bun-first ที่ทำไว้แล้วใน repo นี้:
  - Runtime คือ Bun (ไม่มี Node entry points)
  - Package manager คือ Bun (ไม่มี npm lockfiles)
  - Node APIs หนักๆ (`child_process`, `readline`) ถูกแทนที่ด้วย Bun equivalents
  - Node APIs เบาๆ (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) ยังคงใช้อยู่
  - CLI shebangs ใช้ `bun` (ไม่ใช่ `node`, ไม่ใช่ `tsx`)
  - Packages ใช้ไฟล์ source โดยตรง (ไม่มี TypeScript build step)
  - CI workflows รัน Bun สำหรับ install/check/test

## 8) ลบ compatibility layers เก่า

ยกเว้นได้รับการร้องขอ ให้ลบ upstream compatibility shims

- ลบ APIs เก่าที่ถูกแทนที่แล้ว
- อัปเดตทุก call sites ให้ใช้ API ใหม่โดยตรง
- อย่าคง `*_v2` หรือเวอร์ชันคู่ขนานไว้

## 9) อัปเดตเอกสารและการอ้างอิง

- แทนที่ลิงก์ repo ของ pi-mono ตามความเหมาะสม
- อัปเดตตัวอย่างให้ใช้ Bun และ package scopes ที่ถูกต้อง
- ตรวจสอบให้แน่ใจว่าคำแนะนำใน README ยังตรงกับพฤติกรรมปัจจุบันของ repo

## 10) ตรวจสอบการพอร์ต

รันการตรวจสอบมาตรฐานหลังจากทำการเปลี่ยนแปลง:

- `bun check`

หาก repo มีการตรวจสอบที่ล้มเหลวอยู่แล้วที่ไม่เกี่ยวข้องกับการเปลี่ยนแปลงของคุณ ให้แจ้งเรื่องนั้น
การทดสอบใช้ runner ของ Bun (ไม่ใช่ Vitest) แต่รัน `bun test` เฉพาะเมื่อมีการร้องขอโดยชัดเจนเท่านั้น

## 11) ปกป้องฟีเจอร์ที่ปรับปรุงแล้ว (รายการดักจับ regression)

หากคุณปรับปรุงพฤติกรรมในเครื่องแล้ว ให้ถือว่าเป็น**สิ่งที่เปลี่ยนไม่ได้** ก่อนพอร์ต ให้จดบันทึก
การปรับปรุงและเพิ่มการตรวจสอบอย่างชัดเจนเพื่อไม่ให้สูญหายในการผสาน

- **ตรึงพฤติกรรมที่คาดหวัง**: เพิ่มบันทึก "ก่อน/หลัง" สั้นๆ สำหรับการปรับปรุงแต่ละอย่าง (inputs, outputs,
  defaults, edge cases) เพื่อป้องกันการ rollback แบบเงียบ
- **แมป API เก่า → ใหม่**: หาก upstream เปลี่ยนชื่อแนวคิด (hooks → extensions, custom tools → tools ฯลฯ)
  ตรวจสอบให้แน่ใจว่าทุก entry point เก่ายังเชื่อมต่ออยู่ flag หรือ export ที่พลาดไปหนึ่งรายการเท่ากับฟังก์ชันที่สูญหาย
- **ตรวจสอบ exports**: ตรวจสอบ `package.json` `exports`, public types, และ barrel files Upstream ports
  มักลืม re-export สิ่งที่เพิ่มเข้ามาในเครื่อง
- **ครอบคลุม non-happy paths**: หากคุณแก้ไข error handling, timeouts, หรือ fallback logic ให้เพิ่ม test หรือ
  อย่างน้อย manual checklist ที่ทดสอบ paths เหล่านั้น
- **ตรวจสอบ defaults และลำดับการ merge config**: การปรับปรุงมักอยู่ใน defaults ยืนยันว่า defaults ใหม่
  ไม่ได้ย้อนกลับ (เช่น ลำดับความสำคัญของ config ใหม่, ฟีเจอร์ที่ปิดการใช้งาน, รายการเครื่องมือ)
- **ตรวจสอบพฤติกรรม env/shell**: หากคุณแก้ไข execution หรือ sandboxing ให้ตรวจสอบว่า path ใหม่ยังใช้
  env ที่ sanitized ของคุณ และไม่ได้นำ alias/function overrides กลับมา
- **รันตัวอย่างที่กำหนดเป้าหมายอีกครั้ง**: เก็บชุด "known good" ตัวอย่างขั้นต่ำ และรันหลังจากพอร์ต
  (CLI flags, extension registration, tool execution)

## 12) ตรวจจับและจัดการโค้ดที่ถูกปรับโครงสร้างใหม่

ก่อนพอร์ตไฟล์ ให้ตรวจสอบว่า upstream ได้ refactor อย่างมีนัยสำคัญหรือไม่:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

หาก diff แสดงว่าไฟล์ถูก**ปรับโครงสร้างใหม่** (ไม่ใช่แค่แก้ไขเล็กน้อย):

- abstractions ใหม่, แนวคิดที่เปลี่ยนชื่อ, modules ที่รวม, data flow ที่เปลี่ยน

คุณต้อง**อ่าน implementation ใหม่อย่างละเอียด**ก่อนพอร์ต การผสานแบบสุ่มสี่สุ่มห้าของโค้ดที่ปรับโครงสร้างใหม่จะทำให้สูญเสียฟังก์ชันการทำงานเนื่องจาก:

หมายเหตุ: interactive mode ถูกแยกออกเป็น controllers/utils/types เมื่อเร็วๆ นี้ เมื่อ backport การเปลี่ยนแปลงที่เกี่ยวข้อง ให้พอร์ตการอัปเดตเข้าสู่ไฟล์แต่ละไฟล์ที่เราสร้างขึ้น และตรวจสอบให้แน่ใจว่าการเชื่อมต่อของ `interactive-mode.ts` ยังซิงค์อยู่

1. **Defaults เปลี่ยนแบบเงียบ** - ตัวแปรใหม่ `defaultFoo = [a, b]` อาจแทนที่ `getAllFoo()` เก่าที่คืนค่า `[a, b, c, d, e]`

2. **ตัวเลือก API ถูกตัดทิ้ง** - เมื่อระบบรวมกัน (เช่น `hooks` + `customTools` → `extensions`) ตัวเลือกเก่าอาจไม่เชื่อมต่อกับ implementation ใหม่

3. **Code paths เก่าไม่ทำงาน** - แนวคิดที่เปลี่ยนชื่อ (เช่น `hookMessage` → `custom`) ต้องอัปเดตในทุก switch statement, type guard, และ handler — ไม่ใช่แค่ definition

4. **Context/capabilities ลดลง** - APIs เก่าอาจเปิดเผย `{ logger, typebox, pi }` ที่ APIs ใหม่ลืมรวม

### กระบวนการพอร์ตเชิงความหมาย

เมื่อ upstream ปรับโครงสร้างโมดูลใหม่:

1. **อ่าน implementation เก่า** - ทำความเข้าใจว่ามันทำอะไร, รับตัวเลือกอะไร, เปิดเผยอะไร

2. **อ่าน implementation ใหม่** - ทำความเข้าใจ abstractions ใหม่และวิธีที่แมปกับพฤติกรรมเก่า

3. **ตรวจสอบความเท่าเทียมของฟีเจอร์** - สำหรับแต่ละความสามารถในโค้ดเก่า ยืนยันว่าโค้ดใหม่ยังคงรักษาไว้หรือลบออกอย่างชัดเจน

4. **ค้นหาสิ่งที่ตกหล่น** - ค้นหาชื่อ/แนวคิดเก่าที่อาจพลาดไปใน switch statements, handlers, UI components

5. **ทดสอบขอบเขต** - CLI flags, SDK options, event handlers, ค่า default — เหล่านี้คือจุดที่ regression ซ่อนอยู่

### การตรวจสอบด่วน

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) รายการตรวจสอบด่วน

ใช้เป็นรอบสุดท้ายก่อนที่คุณจะเสร็จ:

- [ ] นามสกุลไฟล์ Import ตามข้อกำหนดของ package ในเครื่อง (ไม่ลบ `.js` แบบหว่านแห)
- [ ] ไม่มี Node-only APIs ในโค้ดใหม่/ที่พอร์ต
- [ ] อัปเดต package scopes ทั้งหมดแล้ว
- [ ] scripts ใน `package.json` ใช้ Bun
- [ ] Prompts เป็น `.md` text imports (ไม่มี inline prompt strings)
- [ ] ไม่มี `console.*` ใน coding-agent (ใช้ `logger`)
- [ ] Assets โหลดผ่านรูปแบบ Bun embed (ไม่มี copy scripts)
- [ ] Tests หรือ checks รันได้ (หรือระบุชัดเจนว่าติดขัด)
- [ ] ไม่มี regression ของฟังก์ชันการทำงาน (ดูส่วนที่ 11-12)

## 14) รูปแบบ commit message

เมื่อ commit backport ให้ทำตามรูปแบบของ repo `<type>(scope): <past-tense description>` และเก็บช่วง commit
ไว้ในชื่อเรื่อง

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**ตัวอย่าง:**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**กฎ:**

- จัดกลุ่มการเปลี่ยนแปลงตาม package
- ใช้ conventional commit types (`fix`, `feat`, `refactor`, `perf`, `docs`)
- รวมหมายเลข issue/PR ของ upstream และการระบุตัวผู้มีส่วนร่วมสำหรับ contributions จากภายนอก
- ช่วง commit ในชื่อเรื่องช่วยติดตามจุดซิงค์

## 15) การแตกต่างโดยตั้งใจ

fork ของเรามีการตัดสินใจทางสถาปัตยกรรมที่แตกต่างจาก upstream **อย่าพอร์ตรูปแบบ upstream เหล่านี้:**

### สถาปัตยกรรม UI

| Upstream                                    | Fork ของเรา                                               | เหตุผล                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` class                  | `StatusLineComponent`                                     | Status line ที่ง่ายกว่าและรวมเข้าด้วยกัน                              |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub ในโหมดที่ไม่ใช่ TUI                                  | ใช้งานใน TUI, no-op ที่อื่น                                           |
| `ctx.ui.setEditorComponent()`               | Stub ในโหมดที่ไม่ใช่ TUI                                  | ใช้งานใน TUI, no-op ที่อื่น                                           |
| `InteractiveModeOptions` options object     | Positional constructor args (options type ยังคง export อยู่) | คง constructor signature ไว้; อัปเดต type เมื่อ upstream เพิ่ม fields |

### การตั้งชื่อ Component

| Upstream                     | Fork ของเรา             |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### การตั้งชื่อ API

| Upstream                                 | Fork ของเรา                              | หมายเหตุ                                  |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | เราใช้ `sessionName` ทั่วทั้งระบบ         |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | เหมือนกัน (เรารวมให้ตรงกับ RPC ของ upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | เหมือนกัน                                 |

### การรวมไฟล์

| Upstream                                           | Fork ของเรา                             | เหตุผล                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (tool files) | `@f5-sales-demo/pi-natives` clipboard module | รวมเข้าสู่ N-API native implementation |

### Test Framework

| Upstream                  | Fork ของเรา                   |
| ------------------------- | ----------------------------- |
| `vitest` กับ `vi.mock()`  | `bun:test` กับ `vi` จาก bun  |
| `node:test` assertions    | `expect()` matchers           |

### สถาปัตยกรรม Tool

| Upstream                            | Fork ของเรา                                                      | หมายเหตุ                                                  |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` ผ่าน `BUILTIN_TOOLS` registry | Tool factories รับ `ToolSession` และสามารถคืนค่า `null` ได้ |
| Per-tool `*Operations` interfaces   | Per-tool interfaces ยังคงอยู่ (`FindOperations`, `GrepOperations`)  | ใช้สำหรับ SSH/remote overrides                            |
| Node.js `fs/promises` ทุกที่        | `Bun.file()`/`Bun.write()` สำหรับไฟล์; `node:fs/promises` สำหรับ dirs | ใช้ Bun APIs เมื่อทำให้ง่ายขึ้น                           |

### การเก็บข้อมูล Auth

| Upstream                        | Fork ของเรา                                 | หมายเหตุ                                     |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Credentials เก็บเฉพาะใน `agent.db`           |
| Single credential per provider  | Multi-credential กับ round-robin selection  | รักษา session affinity และ backoff logic ไว้  |

### Extensions

| Upstream                      | Fork ของเรา                                |
| ----------------------------- | ------------------------------------------ |
| `jiti` สำหรับโหลด TypeScript  | Native Bun `import()`                      |
| `pkg.pi` manifest field       | `pkg.xcsh ?? pkg.pi` (ใช้ namespace ของเราก่อน) |

### ข้ามฟีเจอร์ Upstream เหล่านี้

เมื่อพอร์ต ให้**ข้าม**ไฟล์/ฟีเจอร์เหล่านี้ทั้งหมด:

- `footer-data-provider.ts` — เราใช้ StatusLineComponent
- `clipboard-image.ts` — clipboard อยู่ใน `@f5-sales-demo/pi-natives` N-API module
- ไฟล์ GitHub workflow — เรามี CI ของตัวเอง
- `models.generated.ts` — สร้างอัตโนมัติ, สร้างใหม่ในเครื่อง (เป็น models.json แทน)

### ฟีเจอร์ที่เราเพิ่ม (ต้องรักษาไว้)

สิ่งเหล่านี้มีอยู่ใน fork ของเราแต่ไม่มีใน upstream **อย่าเขียนทับ:**

- `StatusLineComponent` ใน interactive mode
- Multi-credential auth กับ session affinity
- ระบบค้นหาแบบ capability-based (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability` ฯลฯ)
- การรวม MCP/Exa/SSH
- LSP writethrough สำหรับ format-on-save
- การดักจับ Bash (`checkBashInterception`)
- การแนะนำ path แบบ fuzzy ใน read tool
