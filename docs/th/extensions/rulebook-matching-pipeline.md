---
title: ไปป์ไลน์การจับคู่ Rulebook
description: >-
  ไปป์ไลน์การจับคู่ Rulebook
  สำหรับการเลือกและนำชุดคำสั่งเฉพาะบริบทไปใช้กับเซสชันของ agent
sidebar:
  order: 6
  label: การจับคู่ Rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# ไปป์ไลน์การจับคู่ Rulebook

เอกสารนี้อธิบายว่า coding-agent ค้นพบกฎจากรูปแบบคอนฟิกที่รองรับได้อย่างไร ทำให้กฎเหล่านั้นเป็นรูปแบบ `Rule` เดียวกัน แก้ไขข้อขัดแย้งด้านลำดับความสำคัญ และแบ่งผลลัพธ์ออกเป็น:

- **กฎ Rulebook** (ให้โมเดลใช้ได้ผ่าน system prompt + URL `rule://`)
- **กฎ TTSR** (กฎการหยุดสตรีมแบบ time-travel)

เอกสารนี้สะท้อนการใช้งานในปัจจุบัน รวมถึง semantics บางส่วนและ metadata ที่ถูกแยกวิเคราะห์แต่ไม่ได้บังคับใช้

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

## 1. รูปร่างกฎตามรูปแบบมาตรฐาน

ผู้ให้บริการทั้งหมดทำให้ไฟล์ต้นทางอยู่ในรูปแบบ `Rule`:

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

เอกลักษณ์ของความสามารถคือ `rule.name` (`ruleCapability.key = rule => rule.name`)

ผลลัพธ์: ลำดับความสำคัญและการขจัดข้อมูลซ้ำซ้อนเป็นแบบ**อิงตามชื่อเท่านั้น** ไฟล์ที่ต่างกันสองไฟล์ที่มี `name` เหมือนกันจะถือว่าเป็นกฎเชิงตรรกะเดียวกัน

## 2. แหล่งที่มาของการค้นพบและการทำให้เป็นรูปแบบมาตรฐาน

`src/discovery/index.ts` ลงทะเบียนผู้ให้บริการโดยอัตโนมัติ สำหรับ `rules` ผู้ให้บริการในปัจจุบันได้แก่:

- `native` (ลำดับความสำคัญ `100`)
- `cursor` (ลำดับความสำคัญ `50`)
- `windsurf` (ลำดับความสำคัญ `50`)
- `cline` (ลำดับความสำคัญ `40`)

### ผู้ให้บริการ Native (`builtin.ts`)

โหลดกฎ `.xcsh` จาก:

- โปรเจกต์: `<cwd>/.xcsh/rules/*.{md,mdc}`
- ผู้ใช้: `~/.xcsh/agent/rules/*.{md,mdc}`

การทำให้เป็นรูปแบบมาตรฐาน:

- `name` = ชื่อไฟล์โดยไม่มีนามสกุล `.md`/`.mdc`
- frontmatter ถูกแยกวิเคราะห์ผ่าน `parseFrontmatter`
- `content` = เนื้อหา (frontmatter ถูกตัดออก)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` ถูก map โดยตรง

ข้อควรระวังสำคัญ: `globs` ถูก cast เป็น `string[] | undefined` โดยไม่มีการกรองสมาชิกในผู้ให้บริการนี้

### ผู้ให้บริการ Cursor (`cursor.ts`)

โหลดจาก:

- ผู้ใช้: `~/.cursor/rules/*.{mdc,md}`
- โปรเจกต์: `<cwd>/.cursor/rules/*.{mdc,md}`

การทำให้เป็นรูปแบบมาตรฐาน (`transformMDCRule`):

- `description`: เก็บไว้เฉพาะเมื่อเป็น string เท่านั้น
- `alwaysApply`: เก็บเฉพาะค่า `true` เท่านั้น (`false` จะกลายเป็น `undefined`)
- `globs`: รับ array (เฉพาะสมาชิกที่เป็น string) หรือ string เดี่ยว
- `ttsr_trigger`: เฉพาะ string เท่านั้น
- `name` จากชื่อไฟล์โดยไม่มีนามสกุล

### ผู้ให้บริการ Windsurf (`windsurf.ts`)

โหลดจาก:

- ผู้ใช้: `~/.codeium/windsurf/memories/global_rules.md` (ชื่อกฎคงที่ `global_rules`)
- โปรเจกต์: `<cwd>/.windsurf/rules/*.md`

การทำให้เป็นรูปแบบมาตรฐาน:

- `globs`: array ของ string หรือ string เดี่ยว
- `alwaysApply`, `description` ถูก cast จาก frontmatter
- `ttsr_trigger`: เฉพาะ string เท่านั้น
- `name` จากชื่อไฟล์สำหรับกฎในโปรเจกต์

### ผู้ให้บริการ Cline (`cline.ts`)

ค้นหาขึ้นไปจาก `cwd` เพื่อหา `.clinerules` ที่ใกล้ที่สุด:

- หากเป็นไดเรกทอรี: โหลด `*.md` ที่อยู่ข้างใน
- หากเป็นไฟล์: โหลดไฟล์เดียวเป็นกฎที่ชื่อว่า `clinerules`

การทำให้เป็นรูปแบบมาตรฐาน:

- `globs`: array ของ string หรือ string เดี่ยว
- `alwaysApply`: เฉพาะเมื่อเป็น boolean เท่านั้น
- `description`: เฉพาะ string เท่านั้น
- `ttsr_trigger`: เฉพาะ string เท่านั้น

## 3. พฤติกรรมการแยกวิเคราะห์ Frontmatter และความคลุมเครือ

ผู้ให้บริการทั้งหมดใช้ `parseFrontmatter` (`utils/frontmatter.ts`) ด้วย semantics เหล่านี้:

1. Frontmatter จะถูกแยกวิเคราะห์เฉพาะเมื่อเนื้อหาเริ่มต้นด้วย `---` และมีการปิด `\n---`
2. เนื้อหาจะถูกตัดช่องว่างหลังจากแยก frontmatter ออก
3. หาก YAML แยกวิเคราะห์ล้มเหลว:
   - จะบันทึกคำเตือน
   - parser จะ fallback ไปใช้การแยกวิเคราะห์แบบ `key: value` บรรทัดต่อบรรทัด (`^(\w+):\s*(.*)$`)

ผลที่ตามมาของความคลุมเครือ:

- Fallback parser ไม่รองรับ array, nested object, กฎการ quoting หรือ key ที่มีขีดกลาง
- ค่า fallback จะกลายเป็น string (ตัวอย่างเช่น `alwaysApply: true` จะกลายเป็น string `"true"`) ดังนั้นผู้ให้บริการที่ต้องการประเภท boolean/string อาจสูญเสีย metadata
- `ttsr_trigger` ใช้งานได้ใน fallback (key ที่ใช้ underscore); key เช่น `thinking-level` จะไม่ทำงาน
- ไฟล์ที่ไม่มี frontmatter ที่ถูกต้องจะยังคงโหลดเป็นกฎโดยมี metadata ว่างเปล่าและเนื้อหาครบถ้วน

## 4. ลำดับความสำคัญของผู้ให้บริการและการขจัดข้อมูลซ้ำซ้อน

`loadCapability("rules")` (`capability/index.ts`) รวมผลลัพธ์จากผู้ให้บริการ จากนั้นขจัดข้อมูลซ้ำซ้อนด้วย `rule.name`

### โมเดลลำดับความสำคัญ

- ผู้ให้บริการถูกเรียงลำดับตาม priority จากมากไปน้อย
- ลำดับความสำคัญเท่ากันจะรักษาลำดับการลงทะเบียน (`cursor` ก่อน `windsurf` จาก `discovery/index.ts`)
- การขจัดข้อมูลซ้ำซ้อนแบบ first-wins: ชื่อกฎที่พบก่อนจะถูกเก็บไว้; รายการที่มีชื่อเดียวกันในภายหลังจะถูกทำเครื่องหมาย `_shadowed` ใน `all` และถูกแยกออกจาก `items`

ลำดับผู้ให้บริการกฎที่มีผลในปัจจุบันคือ:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### ข้อควรระวังเกี่ยวกับการเรียงลำดับภายในผู้ให้บริการ

ภายในผู้ให้บริการ ลำดับรายการมาจากผลลัพธ์การ glob ของ `loadFilesFromDir` บวกกับลำดับการ push ที่ชัดเจน ซึ่งเพียงพอสำหรับการใช้งานปกติแต่ไม่ได้ระบุการเรียงลำดับไว้ชัดเจนในโค้ด

ความแตกต่างของลำดับแหล่งที่มาที่สังเกตได้:

- `native` เพิ่มไดเรกทอรีคอนฟิกของโปรเจกต์ก่อน จากนั้นจึงเพิ่มของผู้ใช้
- `cursor` เพิ่มผลลัพธ์ของผู้ใช้ก่อน จากนั้นจึงเพิ่มของโปรเจกต์
- `windsurf` เพิ่ม `global_rules` ของผู้ใช้ก่อน จากนั้นจึงเพิ่มกฎของโปรเจกต์
- `cline` โหลดเฉพาะแหล่ง `.clinerules` ที่ใกล้ที่สุดเท่านั้น

## 5. การแบ่งออกเป็น bucket Rulebook, Always-Apply และ TTSR

หลังจากค้นพบกฎใน `createAgentSession` (`sdk.ts`):

1. กฎที่ค้นพบทั้งหมดจะถูกสแกน
2. กฎที่มี `condition` (frontmatter key; `ttsr_trigger` / `ttsrTrigger` ถูกรับเป็นค่า fallback) จะถูกลงทะเบียนเข้าสู่ `TtsrManager`
3. รายการ `rulebookRules` แยกต่างหากจะถูกสร้างขึ้นด้วย predicate นี้:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. รายการ `alwaysApplyRules` จะถูกสร้างขึ้น:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### พฤติกรรมของ Bucket

- **TTSR bucket**: กฎใดก็ตามที่มี `condition` (ไม่จำเป็นต้องมี description) มีลำดับความสำคัญเหนือ bucket อื่น
- **Always-apply bucket**: `alwaysApply === true`, ไม่ใช่ TTSR เนื้อหาทั้งหมดถูก inject เข้าสู่ system prompt สามารถ resolve ผ่าน `rule://` ได้
- **Rulebook bucket**: ต้องมี description, ต้องไม่ใช่ TTSR, ต้องไม่มี `alwaysApply` ถูกระบุไว้ใน system prompt ด้วยชื่อ+description; เนื้อหาถูกอ่านตามต้องการผ่าน `rule://`
- กฎที่มีทั้ง `condition` และ `alwaysApply` จะไปอยู่ใน TTSR เท่านั้น (TTSR มีลำดับความสำคัญสูงกว่า)
- กฎที่มีทั้ง `alwaysApply` และ `description` จะไปอยู่ใน always-apply เท่านั้น (ไม่ใช่ rulebook)

## 6. วิธีที่ metadata ส่งผลต่อพื้นผิว runtime

### `description`

- จำเป็นสำหรับการรวมไว้ใน rulebook
- แสดงผลใน block `<rules>` ของ system prompt
- หาก description หายไป กฎจะไม่สามารถใช้งานผ่าน `rule://` และไม่ถูกระบุไว้ใน system prompt rules

### `globs`

- ถูกส่งต่อไปบน `Rule`
- แสดงผลเป็นรายการ `<glob>...</glob>` ใน block rules ของ system prompt
- แสดงในสถานะ UI ของกฎ (รายการโหมด `extensions`)
- **ไม่ได้บังคับใช้สำหรับการจับคู่อัตโนมัติในไปป์ไลน์นี้** ไม่มี runtime glob matcher ที่เลือกกฎตาม file/tool target ในปัจจุบัน

### `alwaysApply`

- ถูกแยกวิเคราะห์และเก็บรักษาโดยผู้ให้บริการ
- ใช้ในการแสดงผล UI (ป้ายกำกับ trigger `"always"` ใน extensions state manager)
- ใช้เป็นเงื่อนไขการแยกออกจาก `rulebookRules`
- **เนื้อหากฎทั้งหมดจะถูก inject เข้าสู่ system prompt โดยอัตโนมัติ** (ก่อนส่วน rulebook rules)
- กฎยังสามารถระบุที่อยู่ได้ผ่าน `rule://<name>` เพื่ออ่านซ้ำ

### `ttsr_trigger`

- ถูก map ไปยัง `rule.ttsrTrigger`
- หากมีอยู่ กฎจะถูกส่งต่อไปยัง TTSR manager ไม่ใช่ rulebook

## 7. เส้นทางการรวมอยู่ใน System Prompt

`buildSystemPromptInternal` รับทั้ง `rules` (rulebook) และ `alwaysApplyRules`

กฎ Always-apply จะถูกแสดงผลก่อน โดย inject เนื้อหาดิบของกฎเข้าสู่ prompt โดยตรง

กฎ Rulebook จะถูกแสดงผลในส่วน `# Rules` พร้อมด้วย:

- `Read rule://<name> when working in matching domain`
- `name`, `description` และรายการ `<glob>` ที่ไม่บังคับของแต่ละกฎ

นี่เป็นแนวทางแบบ advisory/contextual: ข้อความ prompt ขอให้โมเดลอ่านกฎที่ใช้งานได้ แต่โค้ดไม่ได้บังคับการใช้งานได้ของ glob

## 8. พฤติกรรม URL ภายใน `rule://`

`RuleProtocolHandler` ถูกลงทะเบียนด้วย:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

ผลที่ตามมา:

- `rule://<name>` resolve กับทั้ง **rulebookRules** และ **alwaysApplyRules**
- กฎที่อยู่ใน TTSR เท่านั้น และกฎที่ไม่มี description และไม่มี `alwaysApply` ไม่สามารถระบุที่อยู่ผ่าน `rule://` ได้
- การ resolution เป็นการจับคู่ชื่อแบบตรงทั้งหมด
- ชื่อที่ไม่รู้จักจะ return error พร้อมระบุชื่อกฎที่มีอยู่
- เนื้อหาที่ return คือ `rule.content` ดิบ (frontmatter ถูกตัดออก) ประเภทเนื้อหา `text/markdown`

## 9. Semantics บางส่วน / ที่ไม่ได้บังคับใช้ที่ทราบ

1. คำอธิบายของผู้ให้บริการกล่าวถึงไฟล์ legacy (`.cursorrules`, `.windsurfrules`) แต่เส้นทางโค้ด loader ในปัจจุบันไม่ได้อ่านไฟล์เหล่านั้นจริง
2. metadata `globs` ถูกนำเสนอไปยัง prompt/UI แต่ไม่ได้บังคับใช้โดย logic การเลือกกฎ
3. การเลือกกฎสำหรับ `rule://` รวม rulebook และ always-apply rules แต่ไม่รวมกฎที่อยู่ใน TTSR เท่านั้น
4. คำเตือนการค้นพบ (`loadCapability("rules").warnings`) ถูกสร้างขึ้นแต่ `createAgentSession` ในปัจจุบันไม่ได้ surface/บันทึกคำเตือนเหล่านั้นในเส้นทางนี้
