---
title: Rulebook Matching Pipeline
description: >-
  Rulebook matching pipeline for selecting and applying context-specific
  instruction sets to agent sessions.
sidebar:
  order: 6
  label: Rulebook matching
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# ไปป์ไลน์การจับคู่ Rulebook

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นหากฎจากรูปแบบ config ที่รองรับ ทำการ normalize ให้เป็นรูปแบบ `Rule` เดียว แก้ไขข้อขัดแย้งเรื่องลำดับความสำคัญ และแยกผลลัพธ์ออกเป็น:

- **กฎ Rulebook** (พร้อมใช้งานสำหรับโมเดลผ่าน system prompt + `rule://` URLs)
- **กฎ TTSR** (กฎการขัดจังหวะ time-travel stream)

เอกสารนี้สะท้อนการ implement ในปัจจุบัน รวมถึง semantics ที่ยังไม่สมบูรณ์และ metadata ที่ถูก parse แต่ยังไม่มีการบังคับใช้

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

## 1. รูปแบบ rule มาตรฐาน

Provider ทั้งหมดจะ normalize ไฟล์ต้นทางให้เป็น `Rule`:

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

ตัวตนของ capability คือ `rule.name` (`ruleCapability.key = rule => rule.name`)

ผลที่ตามมา: ลำดับความสำคัญและการตัดรายการซ้ำเป็นแบบ **อิงตามชื่อเท่านั้น** ไฟล์สองไฟล์ที่แตกต่างกันแต่มี `name` เดียวกันจะถูกพิจารณาว่าเป็นกฎเชิงตรรกะเดียวกัน

## 2. แหล่ง discovery และการ normalize

`src/discovery/index.ts` ลงทะเบียน provider โดยอัตโนมัติ สำหรับ `rules` provider ปัจจุบันคือ:

- `native` (priority `100`)
- `cursor` (priority `50`)
- `windsurf` (priority `50`)
- `cline` (priority `40`)

### Native provider (`builtin.ts`)

โหลดกฎ `.xcsh` จาก:

- project: `<cwd>/.xcsh/rules/*.{md,mdc}`
- user: `~/.xcsh/agent/rules/*.{md,mdc}`

การ normalize:

- `name` = ชื่อไฟล์โดยไม่มี `.md`/`.mdc`
- frontmatter ถูก parse ผ่าน `parseFrontmatter`
- `content` = เนื้อหา (ตัด frontmatter ออก)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` ถูก map โดยตรง

ข้อควรระวังสำคัญ: `globs` ถูก cast เป็น `string[] | undefined` โดยไม่มีการกรองสมาชิกใน provider นี้

### Cursor provider (`cursor.ts`)

โหลดจาก:

- user: `~/.cursor/rules/*.{mdc,md}`
- project: `<cwd>/.cursor/rules/*.{mdc,md}`

การ normalize (`transformMDCRule`):

- `description`: เก็บไว้เฉพาะเมื่อเป็น string
- `alwaysApply`: เก็บเฉพาะ `true` เท่านั้น (`false` จะกลายเป็น `undefined`)
- `globs`: ยอมรับ array (สมาชิกที่เป็น string เท่านั้น) หรือ string เดี่ยว
- `ttsr_trigger`: string เท่านั้น
- `name` จากชื่อไฟล์โดยไม่มีนามสกุล

### Windsurf provider (`windsurf.ts`)

โหลดจาก:

- user: `~/.codeium/windsurf/memories/global_rules.md` (ชื่อกฎคงที่ `global_rules`)
- project: `<cwd>/.windsurf/rules/*.md`

การ normalize:

- `globs`: array-of-string หรือ string เดี่ยว
- `alwaysApply`, `description` cast จาก frontmatter
- `ttsr_trigger`: string เท่านั้น
- `name` จากชื่อไฟล์สำหรับกฎ project

### Cline provider (`cline.ts`)

ค้นหาขึ้นจาก `cwd` เพื่อหา `.clinerules` ที่ใกล้ที่สุด:

- ถ้าเป็นไดเรกทอรี: โหลด `*.md` ภายใน
- ถ้าเป็นไฟล์: โหลดไฟล์เดียวเป็นกฎชื่อ `clinerules`

การ normalize:

- `globs`: array-of-string หรือ string เดี่ยว
- `alwaysApply`: เฉพาะเมื่อเป็น boolean เท่านั้น
- `description`: string เท่านั้น
- `ttsr_trigger`: string เท่านั้น

## 3. พฤติกรรมการ parse frontmatter และความคลุมเครือ

Provider ทั้งหมดใช้ `parseFrontmatter` (`utils/frontmatter.ts`) ด้วย semantics ดังนี้:

1. Frontmatter จะถูก parse เฉพาะเมื่อเนื้อหาเริ่มต้นด้วย `---` และมี `\n---` ปิดท้าย
2. เนื้อหาจะถูก trim หลังจากแยก frontmatter ออก
3. หาก YAML parse ล้มเหลว:
   - คำเตือนจะถูกบันทึก,
   - parser จะ fallback ไปใช้การ parse แบบ `key: value` ต่อบรรทัด (`^(\w+):\s*(.*)$`)

ผลของความคลุมเครือ:

- Fallback parser ไม่รองรับ array, nested object, กฎการใส่เครื่องหมายคำพูด หรือ key ที่มีขีด
- ค่าจาก fallback จะกลายเป็น string (ตัวอย่างเช่น `alwaysApply: true` จะกลายเป็น string `"true"`) ดังนั้น provider ที่ต้องการประเภท boolean/string อาจไม่ได้รับ metadata
- `ttsr_trigger` ทำงานได้ใน fallback (key ที่มี underscore); key อย่าง `thinking-level` จะไม่ทำงาน
- ไฟล์ที่ไม่มี frontmatter ที่ถูกต้องจะยังคงถูกโหลดเป็นกฎที่มี metadata ว่างเปล่าและเนื้อหาเต็ม

## 4. ลำดับความสำคัญของ provider และการตัดรายการซ้ำ

`loadCapability("rules")` (`capability/index.ts`) รวมผลลัพธ์ของ provider แล้วตัดรายการซ้ำตาม `rule.name`

### โมเดลลำดับความสำคัญ

- Provider ถูกเรียงตาม priority จากมากไปน้อย
- Priority ที่เท่ากันจะรักษาลำดับการลงทะเบียน (`cursor` ก่อน `windsurf` จาก `discovery/index.ts`)
- การตัดรายการซ้ำเป็นแบบรายการแรกชนะ: ชื่อกฎที่พบก่อนจะถูกเก็บไว้; รายการที่มีชื่อเดียวกันที่พบทีหลังจะถูกทำเครื่องหมาย `_shadowed` ใน `all` และถูกตัดออกจาก `items`

ลำดับ rule provider ที่มีผลจริงในปัจจุบัน:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### ข้อควรระวังเรื่องลำดับภายใน provider

ภายใน provider ลำดับรายการมาจากการเรียงผลลัพธ์ glob ของ `loadFilesFromDir` บวกกับลำดับ push ที่ชัดเจน สิ่งนี้มีความ deterministic เพียงพอสำหรับการใช้งานปกติ แต่ไม่ได้ถูกเรียงอย่างชัดเจนในโค้ด

ความแตกต่างของลำดับแหล่งที่มาที่สำคัญ:

- `native` เพิ่ม project ก่อนแล้วตามด้วยไดเรกทอรี user config
- `cursor` เพิ่มผลลัพธ์ user ก่อนแล้วตามด้วย project
- `windsurf` เพิ่ม `global_rules` ของ user ก่อน แล้วตามด้วยกฎ project
- `cline` โหลดเฉพาะแหล่ง `.clinerules` ที่ใกล้ที่สุด

## 5. การแยกเป็น bucket ของ Rulebook, Always-Apply และ TTSR

หลังจากการ discover กฎใน `createAgentSession` (`sdk.ts`):

1. กฎที่ค้นพบทั้งหมดจะถูกสแกน
2. กฎที่มี `condition` (frontmatter key; `ttsr_trigger` / `ttsrTrigger` ยอมรับเป็น fallback) จะถูกลงทะเบียนใน `TtsrManager`
3. รายการ `rulebookRules` แยกต่างหากจะถูกสร้างด้วย predicate นี้:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. รายการ `alwaysApplyRules` จะถูกสร้าง:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### พฤติกรรมของ bucket

- **TTSR bucket**: กฎใดๆ ที่มี `condition` (ไม่จำเป็นต้องมี description) มีลำดับความสำคัญเหนือ bucket อื่น
- **Always-apply bucket**: `alwaysApply === true`, ไม่ใช่ TTSR เนื้อหาเต็มถูกฉีดเข้า system prompt สามารถ resolve ผ่าน `rule://` ได้
- **Rulebook bucket**: ต้องมี description, ต้องไม่ใช่ TTSR, ต้องไม่ใช่ `alwaysApply` แสดงรายการใน system prompt ด้วย name+description; เนื้อหาอ่านตามต้องการผ่าน `rule://`
- กฎที่มีทั้ง `condition` และ `alwaysApply` จะไปที่ TTSR เท่านั้น (TTSR มีลำดับความสำคัญสูงกว่า)
- กฎที่มีทั้ง `alwaysApply` และ `description` จะไปที่ always-apply เท่านั้น (ไม่ใช่ rulebook)

## 6. metadata มีผลต่อ runtime surfaces อย่างไร

### `description`

- จำเป็นสำหรับการรวมอยู่ใน rulebook
- แสดงผลใน system prompt บล็อก `<rules>`
- หากไม่มี description หมายความว่ากฎจะไม่สามารถเข้าถึงผ่าน `rule://` และไม่แสดงในกฎของ system prompt

### `globs`

- ถูกส่งต่อบน `Rule`
- แสดงผลเป็นรายการ `<glob>...</glob>` ในบล็อกกฎของ system prompt
- เปิดเผยใน rules UI state (รายการโหมด `extensions`)
- **ไม่ถูกบังคับใช้สำหรับการจับคู่อัตโนมัติในไปป์ไลน์นี้** ไม่มี runtime glob matcher ที่เลือกกฎตามไฟล์ปัจจุบัน/เป้าหมาย tool

### `alwaysApply`

- ถูก parse และเก็บรักษาโดย provider
- ใช้ในการแสดง UI (ป้าย trigger `"always"` ใน extensions state manager)
- ใช้เป็นเงื่อนไขการตัดออกจาก `rulebookRules`
- **เนื้อหากฎเต็มจะถูกฉีดเข้า system prompt โดยอัตโนมัติ** (ก่อนส่วนกฎ rulebook)
- กฎยังสามารถเข้าถึงผ่าน `rule://<name>` เพื่ออ่านซ้ำได้

### `ttsr_trigger`

- ถูก map เป็น `rule.ttsrTrigger`
- หากมีอยู่ กฎจะถูกส่งไปที่ TTSR manager ไม่ใช่ rulebook

## 7. เส้นทางการรวมเข้า system prompt

`buildSystemPromptInternal` รับทั้ง `rules` (rulebook) และ `alwaysApplyRules`

กฎ always-apply จะถูกแสดงผลก่อน โดยฉีดเนื้อหาดิบเข้าไปใน prompt โดยตรง

กฎ Rulebook จะถูกแสดงผลในส่วน `# Rules` ด้วย:

- `Read rule://<name> when working in matching domain`
- `name`, `description` ของแต่ละกฎ และรายการ `<glob>` ที่เป็นตัวเลือก

สิ่งนี้เป็นแบบ advisory/contextual: ข้อความ prompt ขอให้โมเดลอ่านกฎที่เกี่ยวข้อง แต่โค้ดไม่ได้บังคับการใช้งานตาม glob

## 8. พฤติกรรม internal URL `rule://`

`RuleProtocolHandler` ถูกลงทะเบียนด้วย:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

ผลที่ตามมา:

- `rule://<name>` resolve ได้กับทั้ง **rulebookRules** และ **alwaysApplyRules**
- กฎที่เป็น TTSR-only และกฎที่ไม่มี description และไม่มี `alwaysApply` จะไม่สามารถเข้าถึงผ่าน `rule://` ได้
- การ resolve เป็นการจับคู่ชื่อแบบตรงทั้งหมด
- ชื่อที่ไม่รู้จักจะส่งคืน error พร้อมรายการชื่อกฎที่มีให้ใช้งาน
- เนื้อหาที่ส่งคืนเป็น `rule.content` ดิบ (ตัด frontmatter ออก) ประเภทเนื้อหาเป็น `text/markdown`

## 9. semantics ที่ยังไม่สมบูรณ์ / ไม่ได้บังคับใช้ที่ทราบ

1. คำอธิบาย provider กล่าวถึงไฟล์ legacy (`.cursorrules`, `.windsurfrules`) แต่เส้นทางโค้ด loader ปัจจุบันไม่ได้อ่านไฟล์เหล่านั้นจริงๆ
2. Metadata `globs` ถูกแสดงใน prompt/UI แต่ไม่ได้บังคับใช้โดยตรรกะการเลือกกฎ
3. การเลือกกฎสำหรับ `rule://` รวมกฎ rulebook และ always-apply แต่ไม่รวมกฎที่เป็น TTSR-only
4. คำเตือน discovery (`loadCapability("rules").warnings`) ถูกสร้างขึ้นแต่ `createAgentSession` ยังไม่แสดง/บันทึกคำเตือนเหล่านี้ในเส้นทางนี้ในปัจจุบัน
