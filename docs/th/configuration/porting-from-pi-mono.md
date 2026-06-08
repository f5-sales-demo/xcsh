---
title: 'Porting From pi-mono: A Practical Merge Guide'
description: คู่มือปฏิบัติสำหรับการย้ายโค้ดจาก monorepo pi-mono เข้าสู่ codebase ของ xcsh
sidebar:
  order: 9
  label: การย้ายจาก pi-mono
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# การย้ายจาก pi-mono: คู่มือการ Merge เชิงปฏิบัติ

คู่มือนี้เป็นรายการตรวจสอบที่สามารถทำซ้ำได้สำหรับการย้ายการเปลี่ยนแปลงจาก pi-mono เข้าสู่ repo นี้
ใช้ได้กับทุกการ merge: ไม่ว่าจะเป็นไฟล์เดียว, feature branch หรือการ sync ทั้ง release

## จุด Sync ล่าสุด

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**วันที่:** 2026-03-22

อัปเดตส่วนนี้หลังจากแต่ละครั้งที่ sync; อย่าใช้ range เดิมซ้ำ

เมื่อเริ่ม sync ใหม่ ให้สร้าง patch จาก commit นี้เป็นต้นไป:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) กำหนดขอบเขต

- ระบุ upstream reference (commit, tag หรือ PR)
- รายการ packages หรือโฟลเดอร์ที่คุณวางแผนจะแก้ไข
- ตัดสินใจว่าฟีเจอร์ใดอยู่ในขอบเขตและฟีเจอร์ใดที่ตั้งใจข้ามไป

## 1) นำโค้ดเข้ามาอย่างปลอดภัย

- ควรใช้ diff ที่สะอาดและเจาะจง แทนการคัดลอกทั้งหมด
- หลีกเลี่ยงการคัดลอก built artifacts หรือไฟล์ที่สร้างขึ้นอัตโนมัติ
- หาก upstream เพิ่มไฟล์ใหม่ ให้เพิ่มเข้ามาอย่างชัดเจนและตรวจสอบเนื้อหา

## 2) ให้ตรงตามแบบแผนนามสกุล import

ซอร์สโค้ด TypeScript สำหรับ runtime ส่วนใหญ่จะละเว้น `.js` ใน internal imports แต่ entrypoint ของ test/bench บางส่วนยังคง `.js` ไว้เพื่อความเข้ากันได้กับ ESM runtime ให้ทำตามสไตล์ที่มีอยู่แล้วของ package นั้นๆ; อย่าลบนามสกุลออกทั้งหมดแบบไม่เลือก

- ใน `packages/coding-agent` ซอร์สโค้ด runtime ให้ internal imports ไม่มีนามสกุล เว้นแต่จะ import สิ่งที่ไม่ใช่ TS assets
- ใน `packages/tui/test` และ `packages/natives/bench` ให้คง `.js` ไว้ในกรณีที่ไฟล์รอบข้างใช้อยู่แล้ว
- คงนามสกุลไฟล์จริงไว้เมื่อ tooling ต้องการ (เช่น `.json`, `.css`, `.md` text embeds)
- ตัวอย่าง: `import { x } from "./foo.js";` → `import { x } from "./foo";` (เฉพาะเมื่อแบบแผนของ package คือไม่มีนามสกุล)

## 3) แทนที่ import scopes

Upstream ใช้ package scopes ที่แตกต่างกัน แทนที่อย่างสม่ำเสมอ

- แทนที่ scopes เดิมด้วย local scope ที่ใช้ที่นี่
- ตัวอย่าง (ปรับให้ตรงกับ packages จริงที่คุณกำลังย้าย):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) ใช้ Bun APIs เมื่อดีกว่า Node

เรารันบน Bun แทนที่ Node APIs เฉพาะเมื่อ Bun มีทางเลือกที่ดีกว่า

**ควรแทนที่:**

- การ spawn process: `child_process.spawn` → Bun Shell `$` สำหรับคำสั่งง่ายๆ, `Bun.spawn`/`Bun.spawnSync` สำหรับงาน streaming หรือที่รันนาน
- File I/O: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP clients: `node-fetch`, `axios` → native `fetch`
- Crypto hashing: `node:crypto` → Web Crypto หรือ `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Env loading: `dotenv` → Bun โหลด `.env` อัตโนมัติ

**ไม่ควรแทนที่ (สิ่งเหล่านี้ทำงานได้ดีใน Bun):**

- `os.homedir()` — อย่าแทนที่ด้วย `Bun.env.HOME`, `Bun.env.HOME` หรือ literal `"~"`
- `os.tmpdir()` — อย่าแทนที่ด้วย `Bun.env.TMPDIR || "/tmp"` หรือ hardcoded paths
- `fs.mkdtempSync()` — อย่าแทนที่ด้วยการสร้าง path ด้วยตนเอง
- `path.join()`, `path.resolve()` ฯลฯ — สิ่งเหล่านี้ใช้ได้ดี

**สไตล์ Import:** ใช้ prefix `node:` กับ namespace imports เท่านั้น (ไม่ใช้ named imports จาก `node:fs` หรือ `node:path`)

**แบบแผนเพิ่มเติมของ Bun:**

- ใช้ Bun Shell `$` สำหรับคำสั่งสั้นที่ไม่ต้อง streaming; ใช้ `Bun.spawn` เฉพาะเมื่อต้องการ streaming I/O หรือการควบคุม process
- ใช้ `Bun.file()`/`Bun.write()` สำหรับไฟล์ และ `node:fs/promises` สำหรับไดเรกทอรี
- หลีกเลี่ยงการตรวจสอบ `Bun.file().exists()`; ใช้การจัดการ `isEnoent` ใน try/catch แทน
- ใช้ `Bun.sleep(ms)` แทน `setTimeout` wrappers

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

## 5) ใช้ Bun embeds (ไม่ต้องคัดลอก)

อย่าคัดลอก runtime assets หรือ vendor files ตอน build

- หาก upstream คัดลอก assets ไปยังโฟลเดอร์ dist ให้แทนที่ด้วย Bun-friendly embeds
- Prompts เป็นไฟล์ `.md` แบบ static; ใช้ Bun text imports (`with { type: "text" }`) และ Handlebars แทนที่ inline prompt strings
- ใช้ `import.meta.dir` + `Bun.file` เพื่อโหลด non-text resources ที่อยู่ข้างเคียง
- เก็บ assets ไว้ใน repo และให้ bundler รวมเข้าไป
- กำจัด copy scripts เว้นแต่ผู้ใช้ร้องขออย่างชัดเจน
- หาก upstream อ่านไฟล์ fallback ที่ bundle มาตอน runtime ให้แทนที่การอ่านจาก filesystem ด้วย Bun text embed import
  - ตัวอย่าง (Codex instructions fallback):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> ลบออก
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - ใช้ `return FALLBACK_INSTRUCTIONS;` แทน `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) ย้าย `package.json` อย่างระมัดระวัง

ถือว่า `package.json` เป็นสัญญา merge อย่างตั้งใจ

- คง `name`, `version`, `type`, `exports` และ `bin` ที่มีอยู่ เว้นแต่การย้ายต้องการการเปลี่ยนแปลง
- แทนที่ npm/node scripts ด้วย Bun equivalents (เช่น `bun check`, `bun test`)
- ตรวจสอบให้แน่ใจว่า dependencies ใช้ scope ที่ถูกต้อง
- อย่า downgrade dependencies เพื่อแก้ type errors; ให้ upgrade แทน
- ตรวจสอบ workspace package links และ `peerDependencies`

## 7) ปรับให้ตรงกับ code style และ tooling

- ยังคงแบบแผนการจัดรูปแบบที่มีอยู่
- อย่าใช้ `any` เว้นแต่จำเป็น
- หลีกเลี่ยง dynamic imports และ inline type imports; ใช้ top-level imports เท่านั้น
- อย่าสร้าง prompts ในโค้ด; prompts เป็นไฟล์ `.md` แบบ static ที่ render ด้วย Handlebars
- ใน coding-agent อย่าใช้ `console.log`/`console.warn`/`console.error`; ใช้ `logger` จาก `@f5xc-salesdemos/pi-utils`
- ใช้ `Promise.withResolvers()` แทน `new Promise((resolve, reject) => ...)`
- **ห้ามใช้ keyword `private`/`protected`/`public` บน class fields หรือ methods** ใช้ ES `#` private fields สำหรับ encapsulation; ปล่อย accessible members ให้เปล่า (ไม่มี keyword) ข้อยกเว้นเดียวคือ constructor parameter properties (`constructor(private readonly x: T)`) ซึ่ง keyword จำเป็นสำหรับ TypeScript เมื่อย้ายโค้ด upstream ที่ใช้ `private foo` หรือ `protected bar` ให้แปลงเป็น `#foo` (private) หรือ `bar` เปล่า (accessible)
- ใช้ helpers และ utilities ที่มีอยู่แล้วแทนโค้ด ad-hoc ใหม่
- รักษาการเปลี่ยนแปลงโครงสร้างพื้นฐาน Bun-first ที่ทำไว้แล้วใน repo นี้:
  - Runtime คือ Bun (ไม่มี Node entry points)
  - Package manager คือ Bun (ไม่มี npm lockfiles)
  - Node APIs ที่หนัก (`child_process`, `readline`) ถูกแทนที่ด้วย Bun equivalents
  - Node APIs ที่เบา (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) ยังคงไว้
  - CLI shebangs ใช้ `bun` (ไม่ใช่ `node` ไม่ใช่ `tsx`)
  - Packages ใช้ source files โดยตรง (ไม่มีขั้นตอน TypeScript build)
  - CI workflows รัน Bun สำหรับ install/check/test

## 8) ลบ compatibility layers เดิม

เว้นแต่มีการร้องขอ ให้ลบ upstream compatibility shims ออก

- ลบ APIs เดิมที่ถูกแทนที่แล้ว
- อัปเดต call sites ทั้งหมดไปใช้ API ใหม่โดยตรง
- อย่าเก็บ `*_v2` หรือเวอร์ชันคู่ขนาน

## 9) อัปเดตเอกสารและ references

- แทนที่ลิงก์ repo ของ pi-mono ตามความเหมาะสม
- อัปเดตตัวอย่างให้ใช้ Bun และ package scopes ที่ถูกต้อง
- ตรวจสอบให้แน่ใจว่าคำแนะนำใน README ยังตรงกับพฤติกรรมปัจจุบันของ repo

## 10) ตรวจสอบความถูกต้องของการย้าย

รันการตรวจสอบมาตรฐานหลังการเปลี่ยนแปลง:

- `bun check`

หากใน repo มีการตรวจสอบที่ล้มเหลวอยู่แล้วโดยไม่เกี่ยวกับการเปลี่ยนแปลงของคุณ ให้ระบุไว้
Tests ใช้ runner ของ Bun (ไม่ใช่ Vitest) แต่รัน `bun test` เฉพาะเมื่อมีการร้องขออย่างชัดเจน

## 11) ปกป้องฟีเจอร์ที่ปรับปรุงแล้ว (รายการดัก regression)

หากคุณปรับปรุงพฤติกรรมในเครื่องแล้ว ให้ถือว่าสิ่งเหล่านั้นเป็น**สิ่งที่ไม่สามารถต่อรองได้** ก่อนการย้าย ให้จดบันทึกการปรับปรุงและเพิ่มการตรวจสอบอย่างชัดเจนเพื่อไม่ให้สูญหายในการ merge

- **ล็อกพฤติกรรมที่คาดหวัง**: เพิ่มบันทึก "ก่อน/หลัง" สั้นๆ สำหรับแต่ละการปรับปรุง (inputs, outputs, defaults, edge cases) เพื่อป้องกันการ rollback โดยไม่รู้ตัว
- **แมป API เก่า → ใหม่**: หาก upstream เปลี่ยนชื่อแนวคิด (hooks → extensions, custom tools → tools ฯลฯ) ให้แน่ใจว่าทุก entry point เดิมยังเชื่อมต่อได้ flag หรือ export ที่พลาดไปแม้แค่อันเดียวเท่ากับฟังก์ชันการทำงานที่หายไป
- **ตรวจสอบ exports**: ตรวจสอบ `package.json` `exports`, public types และ barrel files Upstream ports มักลืม re-export สิ่งที่เพิ่มเข้ามาในเครื่อง
- **ครอบคลุม non-happy paths**: หากคุณแก้ไข error handling, timeouts หรือ fallback logic ให้เพิ่ม test หรืออย่างน้อย manual checklist ที่ทดสอบ paths เหล่านั้น
- **ตรวจสอบ defaults และลำดับการ merge config**: การปรับปรุงมักอยู่ใน defaults ยืนยันว่า defaults ใหม่ไม่ได้ revert กลับ (เช่น ลำดับความสำคัญของ config ใหม่, ฟีเจอร์ที่ปิดไว้, รายการ tool)
- **ตรวจสอบพฤติกรรม env/shell**: หากคุณแก้ไข execution หรือ sandboxing ให้ตรวจสอบว่า path ใหม่ยังใช้ env ที่ sanitize แล้วและไม่ได้นำ alias/function overrides กลับเข้ามา
- **รัน targeted samples อีกครั้ง**: เก็บชุดตัวอย่าง "known good" ขนาดเล็กและรันหลังการย้าย (CLI flags, extension registration, tool execution)

## 12) ตรวจจับและจัดการโค้ดที่ถูกปรับโครงสร้างใหม่

ก่อนย้ายไฟล์ ตรวจสอบว่า upstream ได้ refactor อย่างมีนัยสำคัญหรือไม่:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

หาก diff แสดงว่าไฟล์ถูก**ปรับโครงสร้างใหม่** (ไม่ใช่แค่ patch):

- abstractions ใหม่, แนวคิดที่เปลี่ยนชื่อ, modules ที่ merge กัน, data flow ที่เปลี่ยนไป

คุณต้อง**อ่าน implementation ใหม่อย่างละเอียด**ก่อนการย้าย การ merge แบบมืดบอดของโค้ดที่ถูกปรับโครงสร้างใหม่จะทำให้สูญเสียฟังก์ชันการทำงานเพราะ:

หมายเหตุ: interactive mode เพิ่งถูกแยกออกเป็น controllers/utils/types เมื่อ backport การเปลี่ยนแปลงที่เกี่ยวข้อง ให้ย้ายอัปเดตเข้าไปในไฟล์แต่ละไฟล์ที่เราสร้างและตรวจสอบให้แน่ใจว่าการเชื่อมต่อของ `interactive-mode.ts` ยังคงตรงกัน

1. **Defaults เปลี่ยนอย่างเงียบๆ** - ตัวแปรใหม่ `defaultFoo = [a, b]` อาจแทนที่ `getAllFoo()` เดิมที่ return `[a, b, c, d, e]`

2. **ตัวเลือก API ถูกตัดออก** - เมื่อระบบรวมกัน (เช่น `hooks` + `customTools` → `extensions`) ตัวเลือกเดิมอาจไม่ได้เชื่อมต่อกับ implementation ใหม่

3. **Code paths ล้าสมัย** - แนวคิดที่เปลี่ยนชื่อ (เช่น `hookMessage` → `custom`) ต้องอัปเดตในทุก switch statement, type guard และ handler—ไม่ใช่แค่ที่ definition

4. **Context/capabilities หดลง** - APIs เดิมอาจเปิดเผย `{ logger, typebox, pi }` ที่ APIs ใหม่ลืมรวมเข้าไป

### กระบวนการย้ายเชิงความหมาย

เมื่อ upstream ปรับโครงสร้าง module ใหม่:

1. **อ่าน implementation เดิม** - ทำความเข้าใจว่ามันทำอะไร, รับตัวเลือกอะไร, เปิดเผยอะไร

2. **อ่าน implementation ใหม่** - ทำความเข้าใจ abstractions ใหม่และวิธีที่มันแมปกับพฤติกรรมเดิม

3. **ตรวจสอบ feature parity** - สำหรับแต่ละความสามารถในโค้ดเดิม ยืนยันว่าโค้ดใหม่รักษาไว้หรือลบออกอย่างชัดเจน

4. **ค้นหาสิ่งที่ตกหล่น** - ค้นหาชื่อ/แนวคิดเดิมที่อาจพลาดใน switch statements, handlers, UI components

5. **ทดสอบขอบเขต** - CLI flags, SDK options, event handlers, default values—เหล่านี้คือจุดที่ regressions ซ่อนอยู่

### การตรวจสอบด่วน

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) รายการตรวจสอบแบบด่วน

ใช้เป็นการตรวจสอบรอบสุดท้ายก่อนที่คุณจะเสร็จ:

- [ ] นามสกุล import ตามแบบแผนของ local package (ไม่ลบ `.js` ทั้งหมดแบบไม่เลือก)
- [ ] ไม่มี Node-only APIs ในโค้ดใหม่/ที่ย้ายมา
- [ ] Package scopes ทั้งหมดถูกอัปเดตแล้ว
- [ ] `package.json` scripts ใช้ Bun
- [ ] Prompts เป็น `.md` text imports (ไม่มี inline prompt strings)
- [ ] ไม่มี `console.*` ใน coding-agent (ใช้ `logger`)
- [ ] Assets โหลดผ่าน Bun embed patterns (ไม่มี copy scripts)
- [ ] Tests หรือ checks รันได้ (หรือระบุอย่างชัดเจนว่าถูกบล็อก)
- [ ] ไม่มี regressions ของฟังก์ชันการทำงาน (ดูส่วนที่ 11-12)

## 14) รูปแบบ commit message

เมื่อ commit backport ให้ทำตามรูปแบบของ repo `<type>(scope): <past-tense description>` และระบุ commit range ในหัวข้อ

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
- รวม upstream issue/PR numbers และการระบุ contributor สำหรับ contributions จากภายนอก
- Commit range ในหัวข้อช่วยติดตามจุด sync

## 15) ความแตกต่างที่ตั้งใจ

Fork ของเรามีการตัดสินใจทางสถาปัตยกรรมที่แตกต่างจาก upstream **อย่าย้าย patterns เหล่านี้จาก upstream:**

### สถาปัตยกรรม UI

| Upstream                                    | Fork ของเรา                                               | เหตุผล                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` class                  | `StatusLineComponent`                                     | Status line ที่ง่ายกว่าและรวมเข้าด้วยกัน                                       |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub ในโหมดที่ไม่ใช่ TUI                                     | Implement ใน TUI, no-op ในที่อื่น                                   |
| `ctx.ui.setEditorComponent()`               | Stub ในโหมดที่ไม่ใช่ TUI                                     | Implement ใน TUI, no-op ในที่อื่น                                   |
| `InteractiveModeOptions` options object     | Positional constructor args (options type ยัง export อยู่) | คง constructor signature; อัปเดต type เมื่อ upstream เพิ่ม fields |

### การตั้งชื่อ Component

| Upstream                     | Fork ของเรา                |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### การตั้งชื่อ API

| Upstream                                 | Fork ของเรา                                 | หมายเหตุ                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | เราใช้ `sessionName` ตลอด           |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | เหมือนกัน (เรารวมให้ตรงกับ RPC ของ upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | เหมือนกัน                                      |

### การรวมไฟล์

| Upstream                                           | Fork ของเรา                                | เหตุผล                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (tool files) | `@f5xc-salesdemos/pi-natives` clipboard module | รวมเข้าเป็น N-API native implementation |

### Test Framework

| Upstream                  | Fork ของเรา                      |
| ------------------------- | ----------------------------- |
| `vitest` with `vi.mock()` | `bun:test` with `vi` from bun |
| `node:test` assertions    | `expect()` matchers           |

### สถาปัตยกรรม Tool

| Upstream                            | Fork ของเรา                                                          | หมายเหตุ                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` ผ่าน `BUILTIN_TOOLS` registry  | Tool factories รับ `ToolSession` และสามารถ return `null` |
| Per-tool `*Operations` interfaces   | Per-tool interfaces ยังคงอยู่ (`FindOperations`, `GrepOperations`)   | ใช้สำหรับ SSH/remote overrides                             |
| Node.js `fs/promises` ทุกที่    | `Bun.file()`/`Bun.write()` สำหรับไฟล์; `node:fs/promises` สำหรับ dirs | ใช้ Bun APIs เมื่อทำให้ง่ายขึ้น                        |

### Auth Storage

| Upstream                        | Fork ของเรา                                    | หมายเหตุ                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Credentials เก็บเฉพาะใน `agent.db` |
| Single credential per provider  | Multi-credential กับ round-robin selection | Session affinity และ backoff logic ยังคงอยู่ |

### Extensions

| Upstream                      | Fork ของเรา                                   |
| ----------------------------- | ------------------------------------------ |
| `jiti` สำหรับ TypeScript loading | Native Bun `import()`                      |
| `pkg.pi` manifest field       | `pkg.xcsh ?? pkg.pi` (ใช้ namespace ของเราก่อน) |

### ข้ามฟีเจอร์ Upstream เหล่านี้

เมื่อย้าย ให้**ข้าม**ไฟล์/ฟีเจอร์เหล่านี้ทั้งหมด:

- `footer-data-provider.ts` — เราใช้ StatusLineComponent
- `clipboard-image.ts` — clipboard อยู่ใน `@f5xc-salesdemos/pi-natives` N-API module
- GitHub workflow files — เรามี CI ของเราเอง
- `models.generated.ts` — สร้างอัตโนมัติ ให้ regenerate ในเครื่อง (เป็น models.json แทน)

### ฟีเจอร์ที่เราเพิ่มเข้ามา (รักษาสิ่งเหล่านี้ไว้)

สิ่งเหล่านี้มีอยู่ใน fork ของเราแต่ไม่มีใน upstream **อย่าเขียนทับเด็ดขาด:**

- `StatusLineComponent` ใน interactive mode
- Multi-credential auth กับ session affinity
- ระบบ capability-based discovery (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability` ฯลฯ)
- MCP/Exa/SSH integrations
- LSP writethrough สำหรับ format-on-save
- Bash interception (`checkBashInterception`)
- Fuzzy path suggestions ใน read tool
