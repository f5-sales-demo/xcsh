---
title: 'การย้ายจาก pi-mono: คู่มือการรวมโค้ดเชิงปฏิบัติ'
description: >-
  คู่มือเชิงปฏิบัติสำหรับการย้ายโค้ดจาก monorepo ของ pi-mono เข้าสู่ codebase
  ของ xcsh
sidebar:
  order: 9
  label: การย้ายจาก pi-mono
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# การย้ายจาก pi-mono: คู่มือการรวมโค้ดเชิงปฏิบัติ

คู่มือนี้เป็นรายการตรวจสอบที่ใช้ซ้ำได้สำหรับการย้ายการเปลี่ยนแปลงจาก pi-mono เข้าสู่ repo นี้
ใช้สำหรับการรวมโค้ดทุกรูปแบบ: ไฟล์เดียว, feature branch หรือการซิงก์รีลีสทั้งหมด

## จุดซิงก์ล่าสุด

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**วันที่:** 2026-03-22

อัปเดตส่วนนี้หลังจากการซิงก์แต่ละครั้ง; อย่าใช้ช่วงก่อนหน้าซ้ำ

เมื่อเริ่มการซิงก์ใหม่ ให้สร้าง patch จาก commit นี้เป็นต้นไป:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) กำหนดขอบเขต

- ระบุข้อมูลอ้างอิง upstream (commit, tag หรือ PR)
- ลิสต์ package หรือโฟลเดอร์ที่คุณวางแผนจะแก้ไข
- ตัดสินใจว่าฟีเจอร์ใดอยู่ในขอบเขตและฟีเจอร์ใดที่ตั้งใจข้ามไป

## 1) นำโค้ดเข้ามาอย่างปลอดภัย

- ใช้ diff ที่สะอาดและมุ่งเน้นแทนการคัดลอกทั้งหมด
- หลีกเลี่ยงการคัดลอก artifact ที่ build แล้วหรือไฟล์ที่ถูกสร้างขึ้น
- หาก upstream เพิ่มไฟล์ใหม่ ให้เพิ่มอย่างชัดเจนและตรวจสอบเนื้อหา

## 2) จับคู่ข้อตกลงนามสกุลไฟล์ของ import

ซอร์สโค้ด TypeScript ส่วนใหญ่ในรันไทม์ไม่ใส่ `.js` ใน internal import แต่ entrypoint ของ test/bench บางส่วนคง `.js` ไว้เพื่อความเข้ากันได้กับรันไทม์ ESM ให้ทำตามสไตล์ที่มีอยู่ของ package นั้น; อย่าลบนามสกุลไฟล์แบบเหมารวม

- ใน `packages/coding-agent` ซอร์สโค้ดรันไทม์ ให้ internal import ไม่มีนามสกุล เว้นแต่ import asset ที่ไม่ใช่ TS
- ใน `packages/tui/test` และ `packages/natives/bench` ให้คง `.js` ไว้ในกรณีที่ไฟล์รอบข้างใช้อยู่แล้ว
- คงนามสกุลไฟล์จริงเมื่อ tooling ต้องการ (เช่น `.json`, `.css`, `.md` text embed)
- ตัวอย่าง: `import { x } from "./foo.js";` → `import { x } from "./foo";` (เฉพาะเมื่อข้อตกลงของ package คือไม่มีนามสกุล)

## 3) แทนที่ scope ของ import

Upstream ใช้ scope ของ package ที่แตกต่างกัน ให้แทนที่อย่างสม่ำเสมอ

- แทนที่ scope เก่าด้วย scope ท้องถิ่นที่ใช้ที่นี่
- ตัวอย่าง (ปรับให้ตรงกับ package จริงที่คุณกำลังย้าย):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) ใช้ Bun API เมื่อดีกว่า Node

เรารันบน Bun ให้แทนที่ Node API เฉพาะเมื่อ Bun มีทางเลือกที่ดีกว่า

**ควรแทนที่:**

- การ spawn โปรเซส: `child_process.spawn` → Bun Shell `$` สำหรับคำสั่งง่ายๆ, `Bun.spawn`/`Bun.spawnSync` สำหรับงาน streaming หรือที่ทำงานนาน
- File I/O: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP client: `node-fetch`, `axios` → native `fetch`
- Crypto hashing: `node:crypto` → Web Crypto หรือ `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- การโหลด Env: `dotenv` → Bun โหลด `.env` โดยอัตโนมัติ

**ไม่ควรแทนที่ (ทำงานได้ดีใน Bun):**

- `os.homedir()` — อย่าแทนที่ด้วย `Bun.env.HOME`, `Bun.env.HOME` หรือ literal `"~"`
- `os.tmpdir()` — อย่าแทนที่ด้วย `Bun.env.TMPDIR || "/tmp"` หรือ path ที่ hardcode ไว้
- `fs.mkdtempSync()` — อย่าแทนที่ด้วยการสร้าง path ด้วยตนเอง
- `path.join()`, `path.resolve()` ฯลฯ — สิ่งเหล่านี้ใช้ได้ดี

**สไตล์การ import:** ใช้ prefix `node:` กับ namespace import เท่านั้น (ไม่ใช้ named import จาก `node:fs` หรือ `node:path`)

**ข้อตกลงเพิ่มเติมของ Bun:**

- ใช้ Bun Shell `$` สำหรับคำสั่งสั้นที่ไม่ต้อง streaming; ใช้ `Bun.spawn` เฉพาะเมื่อต้องการ streaming I/O หรือควบคุมโปรเซส
- ใช้ `Bun.file()`/`Bun.write()` สำหรับไฟล์และ `node:fs/promises` สำหรับไดเรกทอรี
- หลีกเลี่ยงการตรวจสอบ `Bun.file().exists()`; ใช้การจัดการ `isEnoent` ใน try/catch
- ใช้ `Bun.sleep(ms)` แทน wrapper ของ `setTimeout`

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

## 5) ใช้ Bun embed (ไม่ต้องคัดลอก)

อย่าคัดลอก asset รันไทม์หรือไฟล์ vendor ตอน build

- หาก upstream คัดลอก asset เข้าโฟลเดอร์ dist ให้แทนที่ด้วย embed ที่เข้ากันกับ Bun
- Prompt เป็นไฟล์ `.md` แบบ static; ใช้ Bun text import (`with { type: "text" }`) และ Handlebars แทนสตริง prompt แบบ inline
- ใช้ `import.meta.dir` + `Bun.file` เพื่อโหลดทรัพยากรที่ไม่ใช่ข้อความที่อยู่ใกล้เคียง
- เก็บ asset ไว้ใน repo และให้ bundler รวมเข้าไป
- กำจัดสคริปต์คัดลอกเว้นแต่ผู้ใช้ร้องขออย่างชัดเจน
- หาก upstream อ่านไฟล์ fallback ที่ bundle แล้วตอนรันไทม์ ให้แทนที่การอ่าน filesystem ด้วย Bun text embed import
  - ตัวอย่าง (Codex instructions fallback):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> ลบออก
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - ใช้ `return FALLBACK_INSTRUCTIONS;` แทน `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) ย้าย `package.json` อย่างระมัดระวัง

ถือว่า `package.json` เป็นสัญญา ให้รวมอย่างตั้งใจ

- คง `name`, `version`, `type`, `exports` และ `bin` ที่มีอยู่ เว้นแต่การย้ายต้องการเปลี่ยนแปลง
- แทนที่สคริปต์ npm/node ด้วยเทียบเท่าของ Bun (เช่น `bun check`, `bun test`)
- ตรวจสอบให้แน่ใจว่า dependency ใช้ scope ที่ถูกต้อง
- อย่า downgrade dependency เพื่อแก้ type error; ให้ upgrade แทน
- ตรวจสอบลิงก์ workspace package และ `peerDependencies`

## 7) จัดให้สอดคล้องกับสไตล์โค้ดและ tooling

- คงข้อตกลงการจัดรูปแบบที่มีอยู่
- อย่าใช้ `any` เว้นแต่จำเป็น
- หลีกเลี่ยง dynamic import และ inline type import; ใช้ top-level import เท่านั้น
- อย่าสร้าง prompt ในโค้ด; prompt เป็นไฟล์ `.md` แบบ static ที่ render ด้วย Handlebars
- ใน coding-agent อย่าใช้ `console.log`/`console.warn`/`console.error`; ใช้ `logger` จาก `@f5xc-salesdemos/pi-utils`
- ใช้ `Promise.withResolvers()` แทน `new Promise((resolve, reject) => ...)`
- **ห้ามใช้คีย์เวิร์ด `private`/`protected`/`public` บน class field หรือ method** ใช้ ES `#` private field สำหรับ encapsulation; ปล่อย member ที่เข้าถึงได้ไม่ต้องมีคีย์เวิร์ด ข้อยกเว้นเดียวคือ constructor parameter property (`constructor(private readonly x: T)`) ที่ TypeScript กำหนด เมื่อย้ายโค้ด upstream ที่ใช้ `private foo` หรือ `protected bar` ให้แปลงเป็น `#foo` (private) หรือ `bar` แบบเปล่า (เข้าถึงได้)
- ใช้ helper และ utility ที่มีอยู่แทนโค้ดเฉพาะกิจใหม่
- รักษาการเปลี่ยนแปลงโครงสร้าง Bun-first ที่ทำไว้แล้วใน repo นี้:
  - รันไทม์คือ Bun (ไม่มี Node entry point)
  - Package manager คือ Bun (ไม่มี npm lockfile)
  - Node API หนัก (`child_process`, `readline`) ถูกแทนที่ด้วยเทียบเท่าของ Bun
  - Node API เบา (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) คงไว้
  - CLI shebang ใช้ `bun` (ไม่ใช่ `node` หรือ `tsx`)
  - Package ใช้ไฟล์ source โดยตรง (ไม่มีขั้นตอน build TypeScript)
  - CI workflow รัน Bun สำหรับ install/check/test

## 8) ลบ compatibility layer เก่า

เว้นแต่มีการร้องขอ ให้ลบ compatibility shim ของ upstream

- ลบ API เก่าที่ถูกแทนที่แล้ว
- อัปเดต call site ทั้งหมดให้ใช้ API ใหม่โดยตรง
- อย่าคง `*_v2` หรือเวอร์ชันคู่ขนาน

## 9) อัปเดตเอกสารและข้อมูลอ้างอิง

- แทนที่ลิงก์ repo ของ pi-mono ตามความเหมาะสม
- อัปเดตตัวอย่างให้ใช้ Bun และ scope ของ package ที่ถูกต้อง
- ตรวจสอบว่าคำแนะนำใน README ยังตรงกับพฤติกรรมปัจจุบันของ repo

## 10) ตรวจสอบความถูกต้องของการย้าย

รันการตรวจสอบมาตรฐานหลังจากเปลี่ยนแปลง:

- `bun check`

หากที่ repo มีการตรวจสอบที่ fail อยู่แล้วซึ่งไม่เกี่ยวกับการเปลี่ยนแปลงของคุณ ให้ระบุออกมา
Test ใช้ runner ของ Bun (ไม่ใช่ Vitest) แต่รัน `bun test` เฉพาะเมื่อมีการร้องขออย่างชัดเจน

## 11) ปกป้องฟีเจอร์ที่ปรับปรุงแล้ว (รายการป้องกัน regression)

หากคุณปรับปรุงพฤติกรรมในเครื่องแล้ว ให้ถือว่าสิ่งเหล่านั้น **ไม่สามารถต่อรองได้** ก่อนการย้าย ให้จดบันทึกการปรับปรุงและเพิ่มการตรวจสอบอย่างชัดเจนเพื่อไม่ให้สูญหายในการรวม

- **ตรึงพฤติกรรมที่คาดหวัง**: เพิ่มบันทึก "ก่อน/หลัง" สั้นๆ สำหรับแต่ละการปรับปรุง (input, output, ค่าเริ่มต้น, กรณีขอบ) เพื่อป้องกันการย้อนกลับโดยไม่รู้ตัว
- **จับคู่ API เก่า → ใหม่**: หาก upstream เปลี่ยนชื่อแนวคิด (hooks → extensions, custom tools → tools ฯลฯ) ให้แน่ใจว่า entry point เก่าทุกตัวยังเชื่อมต่ออยู่ flag หรือ export ที่พลาดไปหนึ่งตัวเท่ากับฟังก์ชันการทำงานที่สูญหาย
- **ตรวจสอบ export**: ตรวจสอบ `package.json` `exports`, public type และ barrel file การย้าย upstream มักลืม re-export สิ่งที่เพิ่มในเครื่อง
- **ครอบคลุม non-happy path**: หากคุณแก้ไขการจัดการ error, timeout หรือ fallback logic ให้เพิ่ม test หรืออย่างน้อยรายการตรวจสอบด้วยตนเองที่ทดสอบ path เหล่านั้น
- **ตรวจสอบค่าเริ่มต้นและลำดับการรวม config**: การปรับปรุงมักอยู่ในค่าเริ่มต้น ยืนยันว่าค่าเริ่มต้นใหม่ไม่ถูกย้อนกลับ (เช่น ลำดับ config ใหม่, ฟีเจอร์ที่ปิด, รายการ tool)
- **ตรวจสอบพฤติกรรม env/shell**: หากคุณแก้ไขการ execution หรือ sandboxing ให้ตรวจสอบว่า path ใหม่ยังใช้ env ที่ sanitize แล้วของคุณและไม่นำ alias/function override กลับมา
- **รันตัวอย่างเป้าหมายอีกครั้ง**: เก็บชุดตัวอย่าง "known good" ขั้นต่ำและรันหลังการย้าย (CLI flag, การลงทะเบียน extension, การ execute tool)

## 12) ตรวจจับและจัดการโค้ดที่ถูกปรับโครงสร้างใหม่

ก่อนย้ายไฟล์ ให้ตรวจสอบว่า upstream ปรับโครงสร้างอย่างมากหรือไม่:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

หาก diff แสดงว่าไฟล์ถูก **ปรับโครงสร้างใหม่** (ไม่ใช่แค่แพตช์):

- abstraction ใหม่, แนวคิดที่เปลี่ยนชื่อ, โมดูลที่รวมกัน, data flow ที่เปลี่ยนไป

คุณต้อง **อ่านการ implement ใหม่อย่างละเอียด** ก่อนย้าย การรวมโค้ดที่ปรับโครงสร้างใหม่แบบไม่อ่านจะทำให้สูญเสียฟังก์ชันการทำงานเพราะ:

หมายเหตุ: interactive mode เพิ่งถูกแยกออกเป็น controllers/utils/types เมื่อ backport การเปลี่ยนแปลงที่เกี่ยวข้อง ให้ย้ายอัปเดตเข้าไฟล์แต่ละไฟล์ที่เราสร้างและตรวจสอบให้แน่ใจว่าการเชื่อมต่อของ `interactive-mode.ts` ยังซิงก์กันอยู่

1. **ค่าเริ่มต้นเปลี่ยนโดยไม่รู้ตัว** - ตัวแปรใหม่ `defaultFoo = [a, b]` อาจแทนที่ `getAllFoo()` เก่าที่คืน `[a, b, c, d, e]`

2. **ตัวเลือก API ถูกตัดทิ้ง** - เมื่อระบบรวมกัน (เช่น `hooks` + `customTools` → `extensions`), ตัวเลือกเก่าอาจไม่เชื่อมต่อกับ implementation ใหม่

3. **Code path ล้าสมัย** - แนวคิดที่เปลี่ยนชื่อ (เช่น `hookMessage` → `custom`) ต้องอัปเดตใน switch statement, type guard และ handler ทุกตัว—ไม่ใช่แค่ที่นิยาม

4. **Context/capability ลดลง** - API เก่าอาจ expose `{ logger, typebox, pi }` ที่ API ใหม่ลืมใส่

### กระบวนการย้ายเชิงความหมาย

เมื่อ upstream ปรับโครงสร้างโมดูลใหม่:

1. **อ่าน implementation เก่า** - ทำความเข้าใจว่ามันทำอะไร, รับตัวเลือกอะไร, expose อะไร

2. **อ่าน implementation ใหม่** - ทำความเข้าใจ abstraction ใหม่และวิธีที่จับคู่กับพฤติกรรมเก่า

3. **ตรวจสอบความเท่าเทียมของฟีเจอร์** - สำหรับแต่ละความสามารถในโค้ดเก่า ยืนยันว่าโค้ดใหม่รักษาไว้หรือลบออกอย่างชัดเจน

4. **ค้นหาสิ่งที่หลงเหลือ** - ค้นหาชื่อ/แนวคิดเก่าที่อาจถูกพลาดใน switch statement, handler, UI component

5. **ทดสอบขอบเขต** - CLI flag, SDK option, event handler, ค่าเริ่มต้น—สิ่งเหล่านี้คือที่ซ่อน regression

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

ใช้เป็นขั้นตอนสุดท้ายก่อนจบงาน:

- [ ] นามสกุลไฟล์ของ import ตามข้อตกลงของ package ท้องถิ่น (ไม่ลบ `.js` แบบเหมารวม)
- [ ] ไม่มี Node-only API ในโค้ดใหม่/ที่ย้ายมา
- [ ] scope ของ package ทั้งหมดอัปเดตแล้ว
- [ ] สคริปต์ `package.json` ใช้ Bun
- [ ] Prompt เป็น text import `.md` (ไม่มีสตริง prompt แบบ inline)
- [ ] ไม่มี `console.*` ใน coding-agent (ใช้ `logger`)
- [ ] Asset โหลดผ่านรูปแบบ Bun embed (ไม่มีสคริปต์คัดลอก)
- [ ] Test หรือการตรวจสอบรันได้ (หรือระบุอย่างชัดเจนว่าถูกบล็อก)
- [ ] ไม่มี regression ของฟังก์ชันการทำงาน (ดูส่วนที่ 11-12)

## 14) รูปแบบ commit message

เมื่อ commit backport ให้ทำตามรูปแบบของ repo `<type>(scope): <past-tense description>` และคงช่วง commit ไว้ในหัวข้อ

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
- ใช้ conventional commit type (`fix`, `feat`, `refactor`, `perf`, `docs`)
- ใส่หมายเลข issue/PR ของ upstream และการระบุผู้สนับสนุนสำหรับ contribution จากภายนอก
- ช่วง commit ในหัวข้อช่วยติดตามจุดซิงก์

## 15) ความแตกต่างที่ตั้งใจ

fork ของเรามีการตัดสินใจทางสถาปัตยกรรมที่แตกต่างจาก upstream **อย่าย้ายรูปแบบ upstream เหล่านี้:**

### สถาปัตยกรรม UI

| Upstream                                    | Fork ของเรา                                               | เหตุผล                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` class                  | `StatusLineComponent`                                     | Status line ที่ง่ายกว่าและรวมเข้าด้วยกัน                                       |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub ในโหมดที่ไม่ใช่ TUI                                     | Implement ใน TUI, no-op ที่อื่น                                   |
| `ctx.ui.setEditorComponent()`               | Stub ในโหมดที่ไม่ใช่ TUI                                     | Implement ใน TUI, no-op ที่อื่น                                   |
| `InteractiveModeOptions` options object     | Positional constructor arg (options type ยังคง export อยู่) | คง constructor signature ไว้; อัปเดต type เมื่อ upstream เพิ่ม field |

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
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | เราใช้ `sessionName` ทั่วทั้งโค้ด           |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | เหมือนกัน (เรารวมให้ตรงกับ RPC ของ upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | เหมือนกัน                                      |

### การรวมไฟล์

| Upstream                                           | Fork ของเรา                                | เหตุผล                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (ไฟล์ tool) | `@f5xc-salesdemos/pi-natives` clipboard module | รวมเข้าเป็น N-API native implementation |

### Test Framework

| Upstream                  | Fork ของเรา                      |
| ------------------------- | ----------------------------- |
| `vitest` with `vi.mock()` | `bun:test` with `vi` from bun |
| `node:test` assertion    | `expect()` matcher           |

### สถาปัตยกรรม Tool

| Upstream                            | Fork ของเรา                                                          | หมายเหตุ                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` ผ่าน `BUILTIN_TOOLS` registry  | Tool factory รับ `ToolSession` และสามารถคืน `null` |
| Per-tool `*Operations` interface   | Per-tool interface คงอยู่ (`FindOperations`, `GrepOperations`)   | ใช้สำหรับ SSH/remote override                             |
| Node.js `fs/promises` ทุกที่    | `Bun.file()`/`Bun.write()` สำหรับไฟล์; `node:fs/promises` สำหรับ dir | ใช้ Bun API เมื่อทำให้ง่ายขึ้น                        |

### Auth Storage

| Upstream                        | Fork ของเรา                                    | หมายเหตุ                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Credential เก็บเฉพาะใน `agent.db` |
| Credential เดียวต่อ provider  | หลาย credential พร้อม round-robin selection | Session affinity และ backoff logic คงอยู่ |

### Extension

| Upstream                      | Fork ของเรา                                   |
| ----------------------------- | ------------------------------------------ |
| `jiti` สำหรับโหลด TypeScript | Native Bun `import()`                      |
| `pkg.pi` manifest field       | `pkg.xcsh ?? pkg.pi` (ใช้ namespace ของเราก่อน) |

### ข้ามฟีเจอร์ Upstream เหล่านี้

เมื่อย้าย ให้ **ข้าม** ไฟล์/ฟีเจอร์เหล่านี้ทั้งหมด:

- `footer-data-provider.ts` — เราใช้ StatusLineComponent
- `clipboard-image.ts` — clipboard อยู่ใน `@f5xc-salesdemos/pi-natives` N-API module
- ไฟล์ GitHub workflow — เรามี CI ของเราเอง
- `models.generated.ts` — สร้างอัตโนมัติ, สร้างใหม่ในเครื่อง (เป็น models.json แทน)

### ฟีเจอร์ที่เราเพิ่ม (รักษาไว้)

สิ่งเหล่านี้มีอยู่ใน fork ของเราแต่ไม่มีใน upstream **อย่าเขียนทับ:**

- `StatusLineComponent` ใน interactive mode
- Multi-credential auth พร้อม session affinity
- ระบบ discovery ตาม capability (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability` ฯลฯ)
- MCP/Exa/SSH integration
- LSP writethrough สำหรับ format-on-save
- Bash interception (`checkBashInterception`)
- การแนะนำ path แบบ fuzzy ใน read tool
