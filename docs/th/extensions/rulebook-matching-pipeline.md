---
title: ไปป์ไลน์การจับคู่ Rulebook
description: >-
  ไปป์ไลน์การจับคู่ Rulebook
  สำหรับการเลือกและนำชุดคำสั่งเฉพาะบริบทไปใช้กับเซสชันของเอเจนต์
sidebar:
  order: 6
  label: การจับคู่ Rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# ไปป์ไลน์การจับคู่ Rulebook

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นพบกฎจากรูปแบบ config ที่รองรับ, ทำให้เป็นมาตรฐาน (normalize) เป็นรูปแบบ `Rule` เดียว, แก้ไขความขัดแย้งเรื่องลำดับความสำคัญ และแบ่งผลลัพธ์ออกเป็น:

- **กฎ Rulebook** (พร้อมใช้งานสำหรับโมเดลผ่าน system prompt + URL `rule://`)
- **กฎ TTSR** (กฎการขัดจังหวะสตรีมแบบย้อนเวลา)

เอกสารนี้สะท้อนการ implement ในปัจจุบัน รวมถึง semantic บางส่วนและ metadata ที่ถูก parse แต่ยังไม่ถูกบังคับใช้

## ไฟล์ implementation

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. รูปแบบกฎมาตรฐาน (Canonical rule shape)

Provider ทั้งหมดจะทำให้ไฟล์ต้นทางเป็นมาตรฐานเป็น `Rule`:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

การระบุตัวตนของ capability คือ `rule.name` (`ruleCapability.key = rule => rule.name`)

ผลที่ตามมา: ลำดับความสำคัญและการกำจัดรายการซ้ำจะ**อิงตามชื่อเท่านั้น** ไฟล์สองไฟล์ที่มี `name` เดียวกันจะถือเป็นกฎเชิงตรรกะเดียวกัน

## 2. แหล่งค้นพบและการทำให้เป็นมาตรฐาน

`src/discovery/index.ts` จะลงทะเบียน provider โดยอัตโนมัติ สำหรับ `rules` provider ปัจจุบันมีดังนี้:

- `native` (priority `100`)
- `cursor` (priority `50`)
- `windsurf` (priority `50`)
- `cline` (priority `40`)

### Native provider (`builtin.ts`)

โหลดกฎ `.xcsh` จาก:

- project: `<cwd>/.xcsh/rules/*.{md,mdc}`
- user: `~/.xcsh/agent/rules/*.{md,mdc}`

การทำให้เป็นมาตรฐาน:

- `name` = ชื่อไฟล์โดยไม่มี `.md`/`.mdc`
- frontmatter ถูก parse ผ่าน `parseFrontmatter`
- `content` = เนื้อหา (frontmatter ถูกตัดออก)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` ถูก map โดยตรง

ข้อควรระวังสำคัญ: `globs` ถูก cast เป็น `string[] | undefined` โดยไม่มีการกรองสมาชิกใน provider นี้

### Cursor provider (`cursor.ts`)

โหลดจาก:

- user: `~/.cursor/rules/*.{mdc,md}`
- project: `<cwd>/.cursor/rules/*.{mdc,md}`

การทำให้เป็นมาตรฐาน (`transformMDCRule`):

- `description`: เก็บไว้เฉพาะเมื่อเป็น string
- `alwaysApply`: เฉพาะ `true` เท่านั้นที่จะถูกเก็บไว้ (`false` จะกลายเป็น `undefined`)
- `globs`: รับ array (สมาชิกเป็น string เท่านั้น) หรือ string เดี่ยว
- `ttsr_trigger`: string เท่านั้น
- `name` จากชื่อไฟล์โดยไม่มี extension

### Windsurf provider (`windsurf.ts`)

โหลดจาก:

- user: `~/.codeium/windsurf/memories/global_rules.md` (ชื่อกฎคงที่ `global_rules`)
- project: `<cwd>/.windsurf/rules/*.md`

การทำให้เป็นมาตรฐาน:

- `globs`: array-of-string หรือ string เดี่ยว
- `alwaysApply`, `description` cast จาก frontmatter
- `ttsr_trigger`: string เท่านั้น
- `name` จากชื่อไฟล์สำหรับกฎระดับ project

### Cline provider (`cline.ts`)

ค้นหาขึ้นไปจาก `cwd` เพื่อหา `.clinerules` ที่ใกล้ที่สุด:

- ถ้าเป็นไดเรกทอรี: โหลด `*.md` ภายใน
- ถ้าเป็นไฟล์: โหลดไฟล์เดียวเป็นกฎชื่อ `clinerules`

การทำให้เป็นมาตรฐาน:

- `globs`: array-of-string หรือ string เดี่ยว
- `alwaysApply`: เฉพาะเมื่อเป็น boolean เท่านั้น
- `description`: string เท่านั้น
- `ttsr_trigger`: string เท่านั้น

## 3. พฤติกรรมการ parse frontmatter และความคลุมเครือ

Provider ทั้งหมดใช้ `parseFrontmatter` (`utils/frontmatter.ts`) ด้วย semantic ดังนี้:

1. Frontmatter จะถูก parse เฉพาะเมื่อเนื้อหาเริ่มต้นด้วย `---` และมี `\n---` ปิดท้าย
2. เนื้อหาจะถูก trim หลังจากแยก frontmatter ออก
3. หากการ parse YAML ล้มเหลว:
   - มีการบันทึกคำเตือน,
   - parser จะ fallback ไปใช้การ parse แบบ `key: value` ทีละบรรทัดแบบง่าย (`^(\w+):\s*(.*)$`)

ผลกระทบจากความคลุมเครือ:

- Fallback parser ไม่รองรับ array, nested object, กฎการใส่เครื่องหมายอัญประกาศ หรือ key ที่มีขีดกลาง
- ค่า fallback จะกลายเป็น string (ตัวอย่างเช่น `alwaysApply: true` จะกลายเป็น string `"true"`) ดังนั้น provider ที่ต้องการประเภท boolean/string อาจทิ้ง metadata ไป
- `ttsr_trigger` ทำงานได้ใน fallback (key ที่มีขีดล่าง); key เช่น `thinking-level` จะทำงานไม่ได้
- ไฟล์ที่ไม่มี frontmatter ที่ถูกต้องจะยังคงถูกโหลดเป็นกฎที่มี metadata ว่างเปล่าและเนื้อหาเต็ม

## 4. ลำดับความสำคัญของ provider และการกำจัดรายการซ้ำ

`loadCapability("rules")` (`capability/index.ts`) จะรวมผลลัพธ์ของ provider แล้วจึงกำจัดรายการซ้ำตาม `rule.name`

### โมเดลลำดับความสำคัญ

- Provider ถูกเรียงตาม priority จากมากไปน้อย
- Priority ที่เท่ากันจะเรียงตามลำดับการลงทะเบียน (`cursor` ก่อน `windsurf` จาก `discovery/index.ts`)
- การกำจัดรายการซ้ำใช้แบบ first-wins: ชื่อกฎที่พบก่อนจะถูกเก็บไว้; รายการที่มีชื่อเดียวกันที่พบทีหลังจะถูกทำเครื่องหมายเป็น `_shadowed` ใน `all` และถูกตัดออกจาก `items`

ลำดับ provider กฎที่มีผลในปัจจุบันคือ:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### ข้อควรระวังเรื่องลำดับภายใน provider

ภายใน provider ลำดับของรายการมาจากลำดับผลลัพธ์ glob ของ `loadFilesFromDir` รวมกับลำดับ push ที่ชัดเจน ซึ่งมีความแน่นอนเพียงพอสำหรับการใช้งานปกติ แต่ไม่ได้ถูกเรียงลำดับอย่างชัดเจนในโค้ด

ความแตกต่างของลำดับแหล่งที่มาที่น่าสนใจ:

- `native` เพิ่มไดเรกทอรี config ของ project ก่อนแล้วจึง user
- `cursor` เพิ่มผลลัพธ์ของ user ก่อนแล้วจึง project
- `windsurf` เพิ่ม `global_rules` ของ user ก่อน แล้วจึงกฎระดับ project
- `cline` โหลดเฉพาะแหล่ง `.clinerules` ที่ใกล้ที่สุด

## 5. การแบ่งเป็นกลุ่ม Rulebook, Always-Apply และ TTSR

หลังจากการค้นพบกฎใน `createAgentSession` (`sdk.ts`):

1. กฎที่ค้นพบทั้งหมดจะถูกสแกน
2. กฎที่มี `condition` (key ของ frontmatter; `ttsr_trigger` / `ttsrTrigger` ยอมรับเป็น fallback) จะถูกลงทะเบียนใน `TtsrManager`
3. รายการ `rulebookRules` แยกต่างหากจะถูกสร้างด้วย predicate นี้:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. รายการ `alwaysApplyRules` จะถูกสร้าง:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### พฤติกรรมของกลุ่ม

- **กลุ่ม TTSR**: กฎใดก็ตามที่มี `condition` (ไม่ต้องมี description) มีลำดับความสำคัญเหนือกลุ่มอื่น
- **กลุ่ม Always-apply**: `alwaysApply === true`, ไม่ใช่ TTSR เนื้อหาเต็มจะถูกฉีดเข้า system prompt สามารถเข้าถึงได้ผ่าน `rule://`
- **กลุ่ม Rulebook**: ต้องมี description, ต้องไม่ใช่ TTSR, ต้องไม่ใช่ `alwaysApply` แสดงรายการใน system prompt ด้วยชื่อ+description; เนื้อหาจะถูกอ่านเมื่อต้องการผ่าน `rule://`
- กฎที่มีทั้ง `condition` และ `alwaysApply` จะเข้ากลุ่ม TTSR เท่านั้น (TTSR มีลำดับความสำคัญสูงกว่า)
- กฎที่มีทั้ง `alwaysApply` และ `description` จะเข้ากลุ่ม always-apply เท่านั้น (ไม่ใช่ rulebook)

## 6. metadata ส่งผลต่อพื้นที่การทำงาน runtime อย่างไร

### `description`

- จำเป็นสำหรับการรวมอยู่ใน rulebook
- ถูก render ในบล็อก `<rules>` ของ system prompt
- การไม่มี description หมายความว่ากฎจะไม่พร้อมใช้งานผ่าน `rule://` และไม่ถูกแสดงรายการในกฎของ system prompt

### `globs`

- ถูกส่งต่อบน `Rule`
- ถูก render เป็นรายการ `<glob>...</glob>` ในบล็อกกฎของ system prompt
- ถูกเปิดเผยใน UI state ของกฎ (รายการโหมด `extensions`)
- **ไม่ถูกบังคับใช้สำหรับการจับคู่อัตโนมัติในไปป์ไลน์นี้** ไม่มี glob matcher ที่ runtime สำหรับเลือกกฎตามไฟล์ปัจจุบัน/เป้าหมายของ tool

### `alwaysApply`

- ถูก parse และเก็บรักษาโดย provider
- ใช้ในการแสดงผล UI (ป้ายกำกับ trigger `"always"` ใน extensions state manager)
- ใช้เป็นเงื่อนไขการยกเว้นจาก `rulebookRules`
- **เนื้อหากฎเต็มจะถูกฉีดเข้า system prompt โดยอัตโนมัติ** (ก่อนส่วนกฎ rulebook)
- กฎยังสามารถเข้าถึงได้ผ่าน `rule://<name>` สำหรับการอ่านซ้ำ

### `ttsr_trigger`

- ถูก map เป็น `rule.ttsrTrigger`
- หากมีอยู่ กฎจะถูกส่งไปยัง TTSR manager ไม่ใช่ rulebook

## 7. เส้นทางการรวมใน system prompt

`buildSystemPromptInternal` รับทั้ง `rules` (rulebook) และ `alwaysApplyRules`

กฎ always-apply จะถูก render ก่อน โดยฉีดเนื้อหาดิบเข้าไปใน prompt โดยตรง

กฎ rulebook จะถูก render ในส่วน `# Rules` พร้อมด้วย:

- `Read rule://<name> when working in matching domain`
- `name`, `description` และรายการ `<glob>` เสริมของแต่ละกฎ

นี่เป็นเชิงแนะนำ/บริบท: ข้อความ prompt จะขอให้โมเดลอ่านกฎที่เกี่ยวข้อง แต่โค้ดจะไม่บังคับใช้ความเกี่ยวข้องของ glob

## 8. พฤติกรรมของ internal URL `rule://`

`RuleProtocolHandler` ถูกลงทะเบียนด้วย:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

ผลที่ตามมา:

- `rule://<name>` จะ resolve เทียบกับทั้ง **rulebookRules** และ **alwaysApplyRules**
- กฎ TTSR-only และกฎที่ไม่มี description และไม่มี `alwaysApply` จะไม่สามารถเข้าถึงได้ผ่าน `rule://`
- การ resolve เป็นการจับคู่ชื่อแบบตรงทั้งหมด
- ชื่อที่ไม่รู้จักจะส่งคืน error พร้อมรายการชื่อกฎที่มีอยู่
- เนื้อหาที่ส่งคืนคือ `rule.content` แบบดิบ (frontmatter ถูกตัดออก), content type เป็น `text/markdown`

## 9. semantic ที่เป็นบางส่วน / ยังไม่ถูกบังคับใช้ที่ทราบ

1. คำอธิบายของ provider กล่าวถึงไฟล์ legacy (`.cursorrules`, `.windsurfrules`) แต่เส้นทางโค้ดของ loader ปัจจุบันไม่ได้อ่านไฟล์เหล่านั้นจริงๆ
2. metadata `globs` ถูกแสดงใน prompt/UI แต่ไม่ถูกบังคับใช้โดยตรรกะการเลือกกฎ
3. การเลือกกฎสำหรับ `rule://` รวมกฎ rulebook และ always-apply แต่ไม่รวมกฎ TTSR-only
4. คำเตือนจากการค้นพบ (`loadCapability("rules").warnings`) ถูกสร้างขึ้น แต่ `createAgentSession` ไม่ได้แสดง/บันทึกคำเตือนเหล่านั้นในเส้นทางนี้ในปัจจุบัน
