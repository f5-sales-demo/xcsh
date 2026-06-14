---
title: ไปป์ไลน์การจับคู่ Rulebook
description: >-
  ไปป์ไลน์การจับคู่ Rulebook
  สำหรับการเลือกและนำชุดคำสั่งเฉพาะบริบทไปใช้กับเซสชันของตัวแทน
sidebar:
  order: 6
  label: การจับคู่ Rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# ไปป์ไลน์การจับคู่ Rulebook

เอกสารนี้อธิบายวิธีที่ coding-agent ค้นพบกฎจากรูปแบบการตั้งค่าที่รองรับ ทำให้เป็นมาตรฐานในรูปแบบ `Rule` เดียว แก้ไขความขัดแย้งด้านลำดับความสำคัญ และแบ่งผลลัพธ์ออกเป็น:

- **กฎ Rulebook** (พร้อมใช้งานสำหรับโมเดลผ่าน system prompt + URL `rule://`)
- **กฎ TTSR** (กฎการขัดจังหวะสตรีมแบบย้อนเวลา)

เนื้อหานี้สะท้อนการนำไปใช้งานปัจจุบัน รวมถึงความหมายบางส่วนและข้อมูลเมตาที่ถูกแยกวิเคราะห์แต่ยังไม่บังคับใช้

## ไฟล์การนำไปใช้งาน

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

ผู้ให้บริการทั้งหมดทำให้ไฟล์ต้นทางเป็นมาตรฐานในรูปแบบ `Rule`:

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

ตัวระบุ Capability คือ `rule.name` (`ruleCapability.key = rule => rule.name`)

ผลที่ตามมา: การกำหนดลำดับความสำคัญและการตัดรายการซ้ำเป็น **แบบอิงตามชื่อเท่านั้น** ไฟล์สองไฟล์ที่แตกต่างกันซึ่งมี `name` เดียวกันจะถือว่าเป็นกฎเชิงตรรกะเดียวกัน

## 2. แหล่งที่มาของการค้นพบและการทำให้เป็นมาตรฐาน

`src/discovery/index.ts` ลงทะเบียนผู้ให้บริการโดยอัตโนมัติ สำหรับ `rules` ผู้ให้บริการปัจจุบันได้แก่:

- `native` (ลำดับความสำคัญ `100`)
- `cursor` (ลำดับความสำคัญ `50`)
- `windsurf` (ลำดับความสำคัญ `50`)
- `cline` (ลำดับความสำคัญ `40`)

### ผู้ให้บริการ Native (`builtin.ts`)

โหลดกฎ `.xcsh` จาก:

- โปรเจกต์: `<cwd>/.xcsh/rules/*.{md,mdc}`
- ผู้ใช้: `~/.xcsh/agent/rules/*.{md,mdc}`

การทำให้เป็นมาตรฐาน:

- `name` = ชื่อไฟล์โดยไม่มี `.md`/`.mdc`
- frontmatter แยกวิเคราะห์ผ่าน `parseFrontmatter`
- `content` = เนื้อหา (ลบ frontmatter ออก)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` ถูกแมปโดยตรง

ข้อควรระวังสำคัญ: `globs` ถูกแคสต์เป็น `string[] | undefined` โดยไม่มีการกรององค์ประกอบในผู้ให้บริการนี้

### ผู้ให้บริการ Cursor (`cursor.ts`)

โหลดจาก:

- ผู้ใช้: `~/.cursor/rules/*.{mdc,md}`
- โปรเจกต์: `<cwd>/.cursor/rules/*.{mdc,md}`

การทำให้เป็นมาตรฐาน (`transformMDCRule`):

- `description`: เก็บไว้เฉพาะเมื่อเป็น string
- `alwaysApply`: เก็บเฉพาะ `true` (`false` กลายเป็น `undefined`)
- `globs`: รับอาร์เรย์ (เฉพาะองค์ประกอบ string) หรือ string เดี่ยว
- `ttsr_trigger`: string เท่านั้น
- `name` จากชื่อไฟล์โดยไม่มีนามสกุล

### ผู้ให้บริการ Windsurf (`windsurf.ts`)

โหลดจาก:

- ผู้ใช้: `~/.codeium/windsurf/memories/global_rules.md` (ชื่อกฎคงที่ `global_rules`)
- โปรเจกต์: `<cwd>/.windsurf/rules/*.md`

การทำให้เป็นมาตรฐาน:

- `globs`: อาร์เรย์ของ string หรือ string เดี่ยว
- `alwaysApply`, `description` แคสต์จาก frontmatter
- `ttsr_trigger`: string เท่านั้น
- `name` จากชื่อไฟล์สำหรับกฎโปรเจกต์

### ผู้ให้บริการ Cline (`cline.ts`)

ค้นหาขึ้นไปจาก `cwd` เพื่อหา `.clinerules` ที่ใกล้ที่สุด:

- ถ้าเป็นไดเรกทอรี: โหลด `*.md` ภายใน
- ถ้าเป็นไฟล์: โหลดไฟล์เดี่ยวเป็นกฎที่ชื่อ `clinerules`

การทำให้เป็นมาตรฐาน:

- `globs`: อาร์เรย์ของ string หรือ string เดี่ยว
- `alwaysApply`: เฉพาะเมื่อเป็น boolean
- `description`: string เท่านั้น
- `ttsr_trigger`: string เท่านั้น

## 3. พฤติกรรมการแยกวิเคราะห์ frontmatter และความกำกวม

ผู้ให้บริการทั้งหมดใช้ `parseFrontmatter` (`utils/frontmatter.ts`) ด้วยความหมายเหล่านี้:

1. Frontmatter จะถูกแยกวิเคราะห์เฉพาะเมื่อเนื้อหาขึ้นต้นด้วย `---` และมีการปิดด้วย `\n---`
2. เนื้อหาจะถูก trim หลังจากการดึง frontmatter ออก
3. หาก YAML แยกวิเคราะห์ล้มเหลว:
   - จะบันทึกคำเตือน
   - ตัวแยกวิเคราะห์จะย้อนกลับไปใช้การแยกวิเคราะห์บรรทัด `key: value` แบบง่าย (`^(\w+):\s*(.*)$`)

ผลที่ตามมาจากความกำกวม:

- ตัวแยกวิเคราะห์สำรองไม่รองรับอาร์เรย์ วัตถุซ้อน กฎการใส่เครื่องหมายอัญประกาศ หรือคีย์ที่มีขีดกลาง
- ค่าสำรองจะกลายเป็น string (ตัวอย่างเช่น `alwaysApply: true` กลายเป็น string `"true"`) ดังนั้นผู้ให้บริการที่ต้องการประเภท boolean/string อาจละทิ้งข้อมูลเมตา
- `ttsr_trigger` ทำงานได้ในโหมดสำรอง (คีย์ที่ใช้ขีดล่าง) แต่คีย์อย่าง `thinking-level` จะไม่ทำงาน
- ไฟล์ที่ไม่มี frontmatter ที่ถูกต้องยังคงโหลดเป็นกฎที่มีข้อมูลเมตาว่างเปล่าและเนื้อหาเต็ม

## 4. ลำดับความสำคัญของผู้ให้บริการและการตัดรายการซ้ำ

`loadCapability("rules")` (`capability/index.ts`) รวมผลลัพธ์จากผู้ให้บริการและตัดรายการซ้ำตาม `rule.name`

### โมเดลลำดับความสำคัญ

- ผู้ให้บริการเรียงลำดับตามลำดับความสำคัญจากมากไปน้อย
- ลำดับความสำคัญเท่ากันจะเก็บลำดับการลงทะเบียน (`cursor` ก่อน `windsurf` จาก `discovery/index.ts`)
- การตัดรายการซ้ำแบบ first-wins: กฎที่พบชื่อแรกจะถูกเก็บไว้ รายการที่มีชื่อเดียวกันในภายหลังจะถูกทำเครื่องหมาย `_shadowed` ใน `all` และถูกยกเว้นจาก `items`

ลำดับผู้ให้บริการกฎที่มีผลในปัจจุบันคือ:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### ข้อควรระวังเกี่ยวกับลำดับภายในผู้ให้บริการ

ภายในผู้ให้บริการ ลำดับรายการมาจากผลลัพธ์การจัดเรียง glob ของ `loadFilesFromDir` บวกกับลำดับการ push ที่ชัดเจน ซึ่งมีความแน่นอนเพียงพอสำหรับการใช้งานปกติ แต่ไม่ได้เรียงลำดับอย่างชัดเจนในโค้ด

ความแตกต่างของลำดับแหล่งที่มาที่น่าสังเกต:

- `native` เพิ่มไดเรกทอรีการตั้งค่าโปรเจกต์ก่อนแล้วจึงตามด้วยผู้ใช้
- `cursor` เพิ่มผลลัพธ์ผู้ใช้ก่อนแล้วจึงตามด้วยโปรเจกต์
- `windsurf` เพิ่ม `global_rules` ของผู้ใช้ก่อน แล้วจึงตามด้วยกฎโปรเจกต์
- `cline` โหลดเฉพาะแหล่ง `.clinerules` ที่ใกล้ที่สุด

## 5. แบ่งออกเป็น Rulebook, Always-Apply และกลุ่ม TTSR

หลังจากการค้นพบกฎใน `createAgentSession` (`sdk.ts`):

1. กฎที่ค้นพบทั้งหมดจะถูกสแกน
2. กฎที่มี `condition` (คีย์ frontmatter; `ttsr_trigger` / `ttsrTrigger` ยอมรับเป็นทางเลือกสำรอง) จะถูกลงทะเบียนใน `TtsrManager`
3. รายการ `rulebookRules` แยกต่างหากจะถูกสร้างด้วยเงื่อนไขนี้:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. รายการ `alwaysApplyRules` จะถูกสร้าง:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### พฤติกรรมของกลุ่ม

- **กลุ่ม TTSR**: กฎใดก็ตามที่มี `condition` (ไม่จำเป็นต้องมี description) มีลำดับความสำคัญสูงกว่ากลุ่มอื่น
- **กลุ่ม Always-apply**: `alwaysApply === true` ไม่ใช่ TTSR เนื้อหาเต็มจะถูกฉีดเข้า system prompt โดยสามารถเข้าถึงได้ผ่าน `rule://`
- **กลุ่ม Rulebook**: ต้องมี description ต้องไม่ใช่ TTSR ต้องไม่ใช่ `alwaysApply` แสดงรายการใน system prompt ตามชื่อ+description โดยอ่านเนื้อหาตามต้องการผ่าน `rule://`
- กฎที่มีทั้ง `condition` และ `alwaysApply` จะไปยัง TTSR เท่านั้น (TTSR มีลำดับความสำคัญสูงกว่า)
- กฎที่มีทั้ง `alwaysApply` และ `description` จะไปยัง always-apply เท่านั้น (ไม่ใช่ rulebook)

## 6. วิธีที่ข้อมูลเมตาส่งผลต่อพื้นผิวรันไทม์

### `description`

- จำเป็นสำหรับการรวมอยู่ใน rulebook
- แสดงผลใน system prompt บล็อก `<rules>`
- หากไม่มี description หมายความว่ากฎนั้นไม่สามารถเข้าถึงได้ผ่าน `rule://` และไม่ปรากฏในกฎ system prompt

### `globs`

- ส่งต่อไปใน `Rule`
- แสดงผลเป็นรายการ `<glob>...</glob>` ในบล็อกกฎ system prompt
- แสดงในสถานะ UI กฎ (รายการโหมด `extensions`)
- **ไม่บังคับใช้สำหรับการจับคู่อัตโนมัติในไปป์ไลน์นี้** ไม่มีตัวจับคู่ glob รันไทม์ที่เลือกกฎตามไฟล์ปัจจุบัน/เป้าหมายเครื่องมือ

### `alwaysApply`

- แยกวิเคราะห์และเก็บรักษาโดยผู้ให้บริการ
- ใช้ในการแสดงผล UI (ป้ายกำกับทริกเกอร์ `"always"` ใน extensions state manager)
- ใช้เป็นเงื่อนไขการยกเว้นจาก `rulebookRules`
- **เนื้อหากฎเต็มจะถูกฉีดเข้า system prompt โดยอัตโนมัติ** (ก่อนส่วนกฎ rulebook)
- กฎยังสามารถระบุได้ผ่าน `rule://<name>` เพื่ออ่านซ้ำ

### `ttsr_trigger`

- แมปไปยัง `rule.ttsrTrigger`
- หากมีอยู่ กฎจะถูกส่งไปยัง TTSR manager ไม่ใช่ rulebook

## 7. เส้นทางการรวมอยู่ใน system prompt

`buildSystemPromptInternal` รับทั้ง `rules` (rulebook) และ `alwaysApplyRules`

กฎ always-apply จะถูกแสดงผลก่อน โดยฉีดเนื้อหาดิบของกฎเข้าไปใน prompt โดยตรง

กฎ Rulebook จะถูกแสดงผลในส่วน `# Rules` ด้วย:

- `Read rule://<name> when working in matching domain`
- `name`, `description` และรายการ `<glob>` ที่เลือกได้ของแต่ละกฎ

สิ่งนี้เป็นคำแนะนำ/บริบท: ข้อความ prompt ขอให้โมเดลอ่านกฎที่เกี่ยวข้อง แต่โค้ดไม่บังคับการใช้ globs

## 8. พฤติกรรม URL ภายใน `rule://`

`RuleProtocolHandler` ลงทะเบียนด้วย:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

ผลที่ตามมา:

- `rule://<name>` แก้ไขเทียบกับทั้ง **rulebookRules** และ **alwaysApplyRules**
- กฎ TTSR เท่านั้น และกฎที่ไม่มี description และไม่มี `alwaysApply` ไม่สามารถระบุได้ผ่าน `rule://`
- การแก้ไขเป็นการจับคู่ชื่อแบบตรงทั้งหมด
- ชื่อที่ไม่รู้จักจะส่งคืนข้อผิดพลาดพร้อมรายการชื่อกฎที่มีอยู่
- เนื้อหาที่ส่งคืนคือ `rule.content` ดิบ (ลบ frontmatter ออก) ประเภทเนื้อหา `text/markdown`

## 9. ความหมายบางส่วน / ที่ยังไม่บังคับใช้ที่ทราบ

1. คำอธิบายของผู้ให้บริการกล่าวถึงไฟล์เก่า (`.cursorrules`, `.windsurfrules`) แต่เส้นทางโค้ดตัวโหลดปัจจุบันไม่ได้อ่านไฟล์เหล่านั้นจริงๆ
2. ข้อมูลเมตา `globs` แสดงต่อ prompt/UI แต่ไม่ได้บังคับใช้โดยตรรกะการเลือกกฎ
3. การเลือกกฎสำหรับ `rule://` รวม rulebook และกฎ always-apply แต่ไม่รวมกฎ TTSR เท่านั้น
4. คำเตือนการค้นพบ (`loadCapability("rules").warnings`) ถูกสร้างขึ้นแต่ `createAgentSession` ไม่ได้แสดง/บันทึกคำเตือนเหล่านั้นในเส้นทางนี้ในปัจจุบัน
