---
title: Rulebook Matching Pipeline
description: >-
  ไปป์ไลน์การจับคู่ Rulebook
  สำหรับเลือกและนำชุดคำสั่งเฉพาะบริบทไปใช้กับเซสชันของเอเจนต์
sidebar:
  order: 6
  label: Rulebook matching
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# ไปป์ไลน์การจับคู่ Rulebook

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นหากฎจากรูปแบบการกำหนดค่าที่รองรับ ปรับให้เป็นรูปแบบ `Rule` เดียว แก้ไขข้อขัดแย้งด้านลำดับความสำคัญ และแบ่งผลลัพธ์ออกเป็น:

- **กฎ Rulebook** (ใช้งานได้โดยโมเดลผ่าน system prompt + URL `rule://`)
- **กฎ TTSR** (กฎการขัดจังหวะสตรีมแบบ time-travel)

เอกสารนี้สะท้อนการใช้งานปัจจุบัน รวมถึง semantics ที่ยังไม่สมบูรณ์ และ metadata ที่ถูก parse แต่ยังไม่ได้บังคับใช้

## ไฟล์การใช้งาน

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

## 1. รูปแบบกฎมาตรฐาน

ผู้ให้บริการทั้งหมดปรับไฟล์ต้นทางให้เป็นรูปแบบ `Rule`:

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

ตัวตนของ Capability คือ `rule.name` (`ruleCapability.key = rule => rule.name`)

ผลที่ตามมา: ลำดับความสำคัญและการตัดรายการซ้ำจะ **อิงตามชื่อเท่านั้น** ไฟล์สองไฟล์ที่แตกต่างกันแต่มี `name` เดียวกันจะถือว่าเป็นกฎเชิงตรรกะเดียวกัน

## 2. แหล่งค้นหาและการปรับรูปแบบ

`src/discovery/index.ts` ลงทะเบียนผู้ให้บริการอัตโนมัติ สำหรับ `rules` ผู้ให้บริการปัจจุบันคือ:

- `native` (ลำดับความสำคัญ `100`)
- `cursor` (ลำดับความสำคัญ `50`)
- `windsurf` (ลำดับความสำคัญ `50`)
- `cline` (ลำดับความสำคัญ `40`)

### ผู้ให้บริการ Native (`builtin.ts`)

โหลดกฎ `.xcsh` จาก:

- โปรเจกต์: `<cwd>/.xcsh/rules/*.{md,mdc}`
- ผู้ใช้: `~/.xcsh/agent/rules/*.{md,mdc}`

การปรับรูปแบบ:

- `name` = ชื่อไฟล์โดยไม่มี `.md`/`.mdc`
- frontmatter ถูก parse ผ่าน `parseFrontmatter`
- `content` = เนื้อหา (ตัด frontmatter ออก)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` ถูกแมปโดยตรง

ข้อควรระวังสำคัญ: `globs` ถูกแปลงเป็น `string[] | undefined` โดยไม่มีการกรองสมาชิกในผู้ให้บริการนี้

### ผู้ให้บริการ Cursor (`cursor.ts`)

โหลดจาก:

- ผู้ใช้: `~/.cursor/rules/*.{mdc,md}`
- โปรเจกต์: `<cwd>/.cursor/rules/*.{mdc,md}`

การปรับรูปแบบ (`transformMDCRule`):

- `description`: เก็บไว้เฉพาะเมื่อเป็นสตริง
- `alwaysApply`: เก็บเฉพาะ `true` (`false` จะกลายเป็น `undefined`)
- `globs`: รับอาร์เรย์ (สมาชิกที่เป็นสตริงเท่านั้น) หรือสตริงเดี่ยว
- `ttsr_trigger`: สตริงเท่านั้น
- `name` จากชื่อไฟล์โดยไม่มีนามสกุล

### ผู้ให้บริการ Windsurf (`windsurf.ts`)

โหลดจาก:

- ผู้ใช้: `~/.codeium/windsurf/memories/global_rules.md` (ชื่อกฎคงที่ `global_rules`)
- โปรเจกต์: `<cwd>/.windsurf/rules/*.md`

การปรับรูปแบบ:

- `globs`: อาร์เรย์ของสตริงหรือสตริงเดี่ยว
- `alwaysApply`, `description` แปลงจาก frontmatter
- `ttsr_trigger`: สตริงเท่านั้น
- `name` จากชื่อไฟล์สำหรับกฎระดับโปรเจกต์

### ผู้ให้บริการ Cline (`cline.ts`)

ค้นหาขึ้นจาก `cwd` หา `.clinerules` ที่ใกล้ที่สุด:

- หากเป็นไดเรกทอรี: โหลด `*.md` ภายใน
- หากเป็นไฟล์: โหลดไฟล์เดียวเป็นกฎชื่อ `clinerules`

การปรับรูปแบบ:

- `globs`: อาร์เรย์ของสตริงหรือสตริงเดี่ยว
- `alwaysApply`: เฉพาะเมื่อเป็น boolean
- `description`: สตริงเท่านั้น
- `ttsr_trigger`: สตริงเท่านั้น

## 3. พฤติกรรมการ parse Frontmatter และความคลุมเครือ

ผู้ให้บริการทั้งหมดใช้ `parseFrontmatter` (`utils/frontmatter.ts`) ด้วย semantics เหล่านี้:

1. Frontmatter จะถูก parse เฉพาะเมื่อเนื้อหาเริ่มต้นด้วย `---` และมี `\n---` ปิดท้าย
2. เนื้อหาจะถูกตัดช่องว่างหลังจากการดึง frontmatter
3. หากการ parse YAML ล้มเหลว:
   - จะบันทึกคำเตือน
   - parser จะถอยกลับไปใช้การ parse แบบบรรทัดง่ายๆ `key: value` (`^(\w+):\s*(.*)$`)

ผลที่ตามมาจากความคลุมเครือ:

- parser สำรองไม่รองรับอาร์เรย์ อ็อบเจกต์ซ้อน กฎการใส่เครื่องหมายอัญประกาศ หรือคีย์ที่มีขีดกลาง
- ค่าจาก parser สำรองจะกลายเป็นสตริง (เช่น `alwaysApply: true` จะกลายเป็นสตริง `"true"`) ดังนั้นผู้ให้บริการที่ต้องการประเภท boolean/string อาจทิ้ง metadata ไป
- `ttsr_trigger` ทำงานได้ใน parser สำรอง (คีย์ที่มีขีดล่าง) แต่คีย์อย่าง `thinking-level` จะไม่ทำงาน
- ไฟล์ที่ไม่มี frontmatter ที่ถูกต้องจะยังคงถูกโหลดเป็นกฎที่มี metadata ว่างและเนื้อหาเต็ม

## 4. ลำดับความสำคัญของผู้ให้บริการและการตัดรายการซ้ำ

`loadCapability("rules")` (`capability/index.ts`) รวมผลลัพธ์ของผู้ให้บริการแล้วตัดรายการซ้ำตาม `rule.name`

### โมเดลลำดับความสำคัญ

- ผู้ให้บริการจะถูกเรียงตามลำดับความสำคัญจากมากไปน้อย
- ลำดับความสำคัญเท่ากันจะรักษาลำดับการลงทะเบียน (`cursor` ก่อน `windsurf` จาก `discovery/index.ts`)
- การตัดรายการซ้ำใช้หลักตัวแรกชนะ: ชื่อกฎที่พบก่อนจะถูกเก็บไว้ รายการที่มีชื่อเดียวกันภายหลังจะถูกทำเครื่องหมาย `_shadowed` ใน `all` และถูกแยกออกจาก `items`

ลำดับผู้ให้บริการกฎที่มีผลในปัจจุบันคือ:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### ข้อควรระวังเรื่องลำดับภายในผู้ให้บริการ

ภายในผู้ให้บริการ ลำดับรายการมาจากผลการ glob ของ `loadFilesFromDir` บวกกับลำดับ push ที่ชัดเจน ซึ่งมีความกำหนดแน่นอนเพียงพอสำหรับการใช้งานปกติ แต่ไม่ได้ถูกเรียงลำดับอย่างชัดเจนในโค้ด

ความแตกต่างของลำดับแหล่งที่มาที่น่าสนใจ:

- `native` เพิ่มไดเรกทอรีการกำหนดค่าโปรเจกต์ก่อนแล้วตามด้วยผู้ใช้
- `cursor` เพิ่มผลลัพธ์ผู้ใช้ก่อนแล้วตามด้วยโปรเจกต์
- `windsurf` เพิ่ม `global_rules` ของผู้ใช้ก่อนแล้วตามด้วยกฎโปรเจกต์
- `cline` โหลดเฉพาะแหล่ง `.clinerules` ที่ใกล้ที่สุด

## 5. การแบ่งออกเป็นกลุ่ม Rulebook, Always-Apply และ TTSR

หลังจากค้นหากฎใน `createAgentSession` (`sdk.ts`):

1. กฎที่ค้นพบทั้งหมดจะถูกสแกน
2. กฎที่มี `condition` (คีย์ frontmatter; `ttsr_trigger` / `ttsrTrigger` ถูกยอมรับเป็นตัวสำรอง) จะถูกลงทะเบียนใน `TtsrManager`
3. รายการ `rulebookRules` แยกต่างหากจะถูกสร้างด้วยเงื่อนไขนี้:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. รายการ `alwaysApplyRules` จะถูกสร้าง:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### พฤติกรรมของกลุ่ม

- **กลุ่ม TTSR**: กฎใดก็ตามที่มี `condition` (ไม่ต้องมี description) มีลำดับความสำคัญเหนือกลุ่มอื่น
- **กลุ่ม Always-apply**: `alwaysApply === true` ไม่ใช่ TTSR เนื้อหาเต็มถูกฉีดเข้าไปใน system prompt สามารถเข้าถึงผ่าน `rule://`
- **กลุ่ม Rulebook**: ต้องมี description, ต้องไม่ใช่ TTSR, ต้องไม่ใช่ `alwaysApply` แสดงรายการใน system prompt ตามชื่อ+description เนื้อหาจะถูกอ่านตามความต้องการผ่าน `rule://`
- กฎที่มีทั้ง `condition` และ `alwaysApply` จะเข้ากลุ่ม TTSR เท่านั้น (TTSR มีลำดับความสำคัญสูงกว่า)
- กฎที่มีทั้ง `alwaysApply` และ `description` จะเข้ากลุ่ม always-apply เท่านั้น (ไม่ใช่ rulebook)

## 6. Metadata ส่งผลต่อพื้นผิวรันไทม์อย่างไร

### `description`

- จำเป็นสำหรับการรวมอยู่ใน rulebook
- แสดงผลในบล็อก `<rules>` ของ system prompt
- หากไม่มี description หมายความว่ากฎจะไม่สามารถเข้าถึงผ่าน `rule://` และไม่แสดงในกฎของ system prompt

### `globs`

- ถูกส่งต่อใน `Rule`
- แสดงผลเป็นรายการ `<glob>...</glob>` ในบล็อกกฎของ system prompt
- แสดงใน UI state ของกฎ (รายการโหมด `extensions`)
- **ไม่ได้ถูกบังคับใช้สำหรับการจับคู่อัตโนมัติในไปป์ไลน์นี้** ไม่มีตัวจับคู่ glob รันไทม์ที่เลือกกฎตามไฟล์ปัจจุบัน/เป้าหมายของเครื่องมือ

### `alwaysApply`

- ถูก parse และเก็บรักษาโดยผู้ให้บริการ
- ใช้ในการแสดงผล UI (ป้ายกำกับ trigger `"always"` ใน extensions state manager)
- ใช้เป็นเงื่อนไขการยกเว้นจาก `rulebookRules`
- **เนื้อหากฎเต็มถูกฉีดเข้าไปใน system prompt โดยอัตโนมัติ** (ก่อนส่วนกฎ rulebook)
- กฎยังสามารถเข้าถึงผ่าน `rule://<name>` เพื่ออ่านซ้ำได้

### `ttsr_trigger`

- ถูกแมปเป็น `rule.ttsrTrigger`
- หากมีอยู่ กฎจะถูกส่งไปยัง TTSR manager ไม่ใช่ rulebook

## 7. เส้นทางการรวมเข้า System prompt

`buildSystemPromptInternal` ได้รับทั้ง `rules` (rulebook) และ `alwaysApplyRules`

กฎ always-apply จะถูกแสดงผลก่อน โดยฉีดเนื้อหาดิบเข้าไปใน prompt โดยตรง

กฎ Rulebook จะถูกแสดงผลในส่วน `# Rules` พร้อมด้วย:

- `Read rule://<name> when working in matching domain`
- `name`, `description` และรายการ `<glob>` ที่เป็นทางเลือกของแต่ละกฎ

นี่เป็นเชิงแนะนำ/บริบท: ข้อความ prompt ขอให้โมเดลอ่านกฎที่เกี่ยวข้อง แต่โค้ดไม่ได้บังคับการใช้งาน glob

## 8. พฤติกรรม URL ภายใน `rule://`

`RuleProtocolHandler` ถูกลงทะเบียนด้วย:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

ผลที่ตามมา:

- `rule://<name>` จะค้นหาจากทั้ง **rulebookRules** และ **alwaysApplyRules**
- กฎที่เป็น TTSR เท่านั้นและกฎที่ไม่มี description และไม่มี `alwaysApply` ไม่สามารถเข้าถึงผ่าน `rule://`
- การค้นหาเป็นการจับคู่ชื่อแบบตรงทั้งหมด
- ชื่อที่ไม่รู้จักจะส่งกลับข้อผิดพลาดพร้อมรายชื่อกฎที่มีอยู่
- เนื้อหาที่ส่งกลับคือ `rule.content` ดิบ (ตัด frontmatter ออก) ประเภทเนื้อหาเป็น `text/markdown`

## 9. Semantics ที่ยังไม่สมบูรณ์ / ยังไม่ได้บังคับใช้ที่ทราบ

1. คำอธิบายของผู้ให้บริการกล่าวถึงไฟล์เก่า (`.cursorrules`, `.windsurfrules`) แต่เส้นทางโค้ดตัวโหลดปัจจุบันไม่ได้อ่านไฟล์เหล่านั้นจริง
2. Metadata `globs` ถูกแสดงใน prompt/UI แต่ไม่ได้ถูกบังคับใช้โดยตรรกะการเลือกกฎ
3. การเลือกกฎสำหรับ `rule://` รวมกฎ rulebook และ always-apply แต่ไม่รวมกฎที่เป็น TTSR เท่านั้น
4. คำเตือนจากการค้นหา (`loadCapability("rules").warnings`) ถูกสร้างขึ้น แต่ `createAgentSession` ไม่ได้แสดง/บันทึกคำเตือนในเส้นทางนี้ในปัจจุบัน
