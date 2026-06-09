---
title: การบีบอัดและสรุปสาขา
description: การบีบอัดหน้าต่างบริบทและการสร้างสรุปสาขาสำหรับเซสชันที่ใช้งานยาวนาน
sidebar:
  order: 5
  label: การบีบอัด
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# การบีบอัดและสรุปสาขา

การบีบอัดและสรุปสาขาเป็นสองกลไกที่ทำให้เซสชันที่ใช้งานยาวนานยังคงใช้งานได้โดยไม่สูญเสียบริบทของงานก่อนหน้า

- **การบีบอัด** เขียนประวัติเก่าใหม่เป็นสรุปบนสาขาปัจจุบัน
- **สรุปสาขา** บันทึกบริบทของสาขาที่ถูกละทิ้งระหว่างการนำทาง `/tree`

ทั้งสองจะถูกจัดเก็บเป็นรายการเซสชันและแปลงกลับเป็นข้อความ user-context เมื่อสร้างอินพุต LLM ใหม่

## ไฟล์การดำเนินงานหลัก

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## โมเดลรายการเซสชัน

การบีบอัดและสรุปสาขาเป็นรายการเซสชันระดับหลัก ไม่ใช่ข้อความ assistant/user ธรรมดา

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, optional `shortSummary`
  - `firstKeptEntryId` (ขอบเขตการบีบอัด)
  - `tokensBefore`
  - optional `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - optional `details`, `fromExtension`

เมื่อบริบทถูกสร้างใหม่ (`buildSessionContext`):

1. การบีบอัดล่าสุดบนเส้นทางที่ใช้งานอยู่จะถูกแปลงเป็นข้อความ `compactionSummary` หนึ่งข้อความ
2. รายการที่เก็บไว้ตั้งแต่ `firstKeptEntryId` ถึงจุดบีบอัดจะถูกรวมกลับเข้าไป
3. รายการหลังจากนั้นบนเส้นทางจะถูกเพิ่มต่อท้าย
4. รายการ `branch_summary` จะถูกแปลงเป็นข้อความ `branchSummary`
5. รายการ `custom_message` จะถูกแปลงเป็นข้อความ `custom`

บทบาทที่กำหนดเองเหล่านั้นจะถูกแปลงเป็นข้อความ user ที่ส่งไปยัง LLM ใน `convertToLlm()` โดยใช้เทมเพลตคงที่:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## ไปป์ไลน์การบีบอัด

### ตัวกระตุ้น

การบีบอัดสามารถทำงานได้สามวิธี:

1. **แบบแมนนวล**: `/compact [instructions]` เรียก `AgentSession.compact(...)`
2. **การกู้คืนอัตโนมัติเมื่อล้นบริบท**: หลังจาก assistant error ที่ตรงกับการล้นบริบท
3. **การบีบอัดอัตโนมัติตามเกณฑ์**: หลังจากเทิร์นที่สำเร็จเมื่อบริบทเกินเกณฑ์

### รูปร่างการบีบอัด (แผนภาพ)

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### การบีบอัดแบบลองใหม่เมื่อล้น vs การบีบอัดตามเกณฑ์

เส้นทางอัตโนมัติสองเส้นทางนี้มีความแตกต่างกันโดยตั้งใจ:

- **การบีบอัดแบบลองใหม่เมื่อล้น**
  - ตัวกระตุ้น: assistant error ของโมเดลปัจจุบันถูกตรวจจับว่าเป็นการล้นบริบท
  - ข้อความ assistant error ที่ล้มเหลวจะถูกลบออกจากสถานะ agent ที่ใช้งานอยู่ก่อนลองใหม่
  - การบีบอัดอัตโนมัติทำงานด้วย `reason: "overflow"` และ `willRetry: true`
  - เมื่อสำเร็จ agent จะดำเนินการต่ออัตโนมัติ (`agent.continue()`) หลังการบีบอัด

- **การบีบอัดตามเกณฑ์**
  - ตัวกระตุ้น: `contextTokens > contextWindow - compaction.reserveTokens`
  - ทำงานด้วย `reason: "threshold"` และ `willRetry: false`
  - เมื่อสำเร็จ ถ้า `compaction.autoContinue !== false` จะแทรกพรอมต์สังเคราะห์:
    - `"Continue if you have next steps."`

### การตัดแต่งก่อนบีบอัด

ก่อนการตรวจสอบการบีบอัด การตัดแต่งผลลัพธ์เครื่องมืออาจทำงาน (`pruneToolOutputs`)

นโยบายการตัดแต่งเริ่มต้น:

- ปกป้องโทเค็นผลลัพธ์เครื่องมือล่าสุด `40_000` โทเค็น
- ต้องการการประหยัดโดยประมาณรวมอย่างน้อย `20_000`
- ไม่ตัดแต่งผลลัพธ์เครื่องมือจาก `skill` หรือ `read` เด็ดขาด

ผลลัพธ์เครื่องมือที่ถูกตัดแต่งจะถูกแทนที่ด้วย:

- `[Output truncated - N tokens]`

หากการตัดแต่งเปลี่ยนแปลงรายการ ที่เก็บเซสชันจะถูกเขียนใหม่และสถานะข้อความ agent จะถูกรีเฟรชก่อนการตัดสินใจบีบอัด

### ตรรกะขอบเขตและจุดตัด

`prepareCompaction()` พิจารณาเฉพาะรายการตั้งแต่รายการบีบอัดล่าสุด (ถ้ามี)

1. ค้นหาดัชนีการบีบอัดก่อนหน้า
2. คำนวณ `boundaryStart = prevCompactionIndex + 1`
3. ปรับ `keepRecentTokens` โดยใช้อัตราส่วนการใช้งานที่วัดได้เมื่อพร้อมใช้งาน
4. เรียกใช้ `findCutPoint()` เหนือหน้าต่างขอบเขต

จุดตัดที่ถูกต้องรวมถึง:

- รายการข้อความที่มีบทบาท: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- รายการ `custom_message`
- รายการ `branch_summary`

กฎเข้มงวด: ห้ามตัดที่ `toolResult` เด็ดขาด

หากมีรายการเมตาดาต้าที่ไม่ใช่ข้อความอยู่ก่อนจุดตัดทันที (`model_change`, `thinking_level_change`, ป้ายกำกับ ฯลฯ) จะถูกดึงเข้าสู่บริเวณที่เก็บไว้โดยเลื่อนดัชนีตัดกลับไปจนกว่าจะถึงข้อความหรือขอบเขตการบีบอัด

### การจัดการเทิร์นที่ถูกแบ่ง

หากจุดตัดไม่อยู่ที่จุดเริ่มต้นเทิร์นของผู้ใช้ การบีบอัดจะปฏิบัติกับมันเป็นเทิร์นที่ถูกแบ่ง

การตรวจจับจุดเริ่มต้นเทิร์นถือว่าสิ่งเหล่านี้เป็นขอบเขตเทิร์นของผู้ใช้:

- `message.role === "user"`
- `message.role === "bashExecution"`
- รายการ `custom_message`
- รายการ `branch_summary`

การบีบอัดเทิร์นที่ถูกแบ่งจะสร้างสรุปสองรายการ:

1. สรุปประวัติ (`messagesToSummarize`)
2. สรุปคำนำหน้าเทิร์น (`turnPrefixMessages`)

สรุปที่จัดเก็บสุดท้ายจะถูกรวมเป็น:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### การสร้างสรุป

`compact(...)` สร้างสรุปจากข้อความสนทนาที่ถูกจัดลำดับ:

1. แปลงข้อความผ่าน `convertToLlm()`
2. จัดลำดับด้วย `serializeConversation()`
3. ครอบด้วย `<conversation>...</conversation>`
4. เพิ่ม `<previous-summary>...</previous-summary>` หากมี
5. แทรกบริบท hook เป็นรายการ `<additional-context>` หากมี
6. ดำเนินการพรอมต์สรุปด้วย `SUMMARIZATION_SYSTEM_PROMPT`

การเลือกพรอมต์:

- การบีบอัดครั้งแรก: `compaction-summary.md`
- การบีบอัดแบบวนซ้ำที่มีสรุปก่อนหน้า: `compaction-update-summary.md`
- รอบที่สองของเทิร์นที่ถูกแบ่ง: `compaction-turn-prefix.md`
- สรุปสั้นสำหรับ UI: `compaction-short-summary.md`

โหมดสรุประยะไกล:

- หากตั้งค่า `compaction.remoteEndpoint` ไว้ การบีบอัดจะ POST:
  - `{ systemPrompt, prompt }`
- คาดหวัง JSON ที่มีอย่างน้อย `{ summary }`

### บริบทการดำเนินการกับไฟล์ในสรุป

การบีบอัดติดตามกิจกรรมไฟล์สะสมโดยใช้การเรียกเครื่องมือของ assistant:

- `read(path)` → ชุดที่อ่าน
- `write(path)` → ชุดที่แก้ไข
- `edit(path)` → ชุดที่แก้ไข

พฤติกรรมสะสม:

- รวมรายละเอียดการบีบอัดก่อนหน้าเฉพาะเมื่อรายการก่อนหน้าถูกสร้างโดย pi (`fromExtension !== true`)
- ในเทิร์นที่ถูกแบ่ง รวมการดำเนินการไฟล์ของคำนำหน้าเทิร์นด้วย
- `readFiles` ไม่รวมไฟล์ที่ถูกแก้ไขด้วย

ข้อความสรุปจะมีแท็กไฟล์ต่อท้ายผ่านเทมเพลตพรอมต์:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### การจัดเก็บและโหลดใหม่

หลังจากการสร้างสรุป (หรือสรุปที่ hook จัดหาให้) เซสชัน agent:

1. เพิ่ม `CompactionEntry` ด้วย `appendCompaction(...)`
2. สร้างบริบทใหม่ผ่าน `buildSessionContext()`
3. แทนที่ข้อความ agent ที่ใช้งานอยู่ด้วยบริบทที่สร้างใหม่
4. ปล่อยเหตุการณ์ hook `session_compact`

## ไปป์ไลน์สรุปสาขา

การสรุปสาขาเชื่อมโยงกับการนำทางแผนภูมิ ไม่ใช่การล้นโทเค็น

### ตัวกระตุ้น

ระหว่าง `navigateTree(...)`:

1. คำนวณรายการที่ถูกละทิ้งจากใบเก่าไปยังบรรพบุรุษร่วมโดยใช้ `collectEntriesForBranchSummary(...)`
2. หากผู้เรียกร้องขอสรุป (`options.summarize`) จะสร้างสรุปก่อนสลับใบ
3. หากมีสรุป จะแนบที่เป้าหมายการนำทางโดยใช้ `branchWithSummary(...)`

ในทางปฏิบัติ สิ่งนี้มักถูกขับเคลื่อนโดยขั้นตอน `/tree` เมื่อ `branchSummary.enabled` ถูกเปิดใช้งาน

### รูปร่างการสลับสาขา (แผนภาพ)

```text
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### การเตรียมการและงบประมาณโทเค็น

`generateBranchSummary(...)` คำนวณงบประมาณเป็น:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` จากนั้น:

1. รอบแรก: รวบรวมการดำเนินการไฟล์สะสมจากรายการที่ถูกสรุปทั้งหมด รวมถึงรายละเอียด `branch_summary` ก่อนหน้าที่สร้างโดย pi
2. รอบที่สอง: เดินจากใหม่สุด → เก่าสุด เพิ่มข้อความจนกว่าจะถึงงบประมาณโทเค็น
3. ให้ความสำคัญกับการรักษาบริบทล่าสุด
4. อาจยังรวมรายการสรุปขนาดใหญ่ใกล้ขอบงบประมาณเพื่อความต่อเนื่อง

รายการบีบอัดจะถูกรวมเป็นข้อความ (`compactionSummary`) ระหว่างอินพุตการสรุปสาขา

### การสร้างสรุปและการจัดเก็บ

การสรุปสาขา:

1. แปลงและจัดลำดับข้อความที่เลือก
2. ครอบด้วย `<conversation>`
3. ใช้คำสั่งที่กำหนดเองหากมี มิฉะนั้นใช้ `branch-summary.md`
4. เรียกใช้โมเดลสรุปด้วย `SUMMARIZATION_SYSTEM_PROMPT`
5. เพิ่มคำนำหน้า `branch-summary-preamble.md`
6. เพิ่มแท็กการดำเนินการไฟล์ต่อท้าย

ผลลัพธ์จะถูกจัดเก็บเป็น `BranchSummaryEntry` พร้อมรายละเอียดที่เป็นทางเลือก (`readFiles`, `modifiedFiles`)

## จุดเชื่อมต่อส่วนขยายและ hook

### `session_before_compact`

Hook ก่อนการบีบอัด

สามารถ:

- ยกเลิกการบีบอัด (`{ cancel: true }`)
- จัดหา payload การบีบอัดที่กำหนดเองทั้งหมด (`{ compaction: CompactionResult }`)

### `session.compacting`

Hook สำหรับปรับแต่งพรอมต์/บริบทสำหรับการบีบอัดเริ่มต้น

สามารถส่งคืน:

- `prompt` (แทนที่พรอมต์สรุปฐาน)
- `context` (บรรทัดบริบทเพิ่มเติมที่แทรกใน `<additional-context>`)
- `preserveData` (จัดเก็บบนรายการบีบอัด)

### `session_compact`

การแจ้งเตือนหลังการบีบอัดพร้อม `compactionEntry` ที่บันทึกแล้วและแฟล็ก `fromExtension`

### `session_before_tree`

ทำงานเมื่อนำทางแผนภูมิก่อนการสร้างสรุปสาขาเริ่มต้น

สามารถ:

- ยกเลิกการนำทาง
- จัดหา `{ summary: { summary, details } }` ที่กำหนดเองเมื่อผู้ใช้ร้องขอการสรุป

### `session_tree`

เหตุการณ์หลังการนำทางที่เปิดเผยใบใหม่/เก่าและรายการสรุปที่เป็นทางเลือก

## พฤติกรรมรันไทม์และความหมายของความล้มเหลว

- การบีบอัดแบบแมนนวลจะยกเลิกการดำเนินการ agent ปัจจุบันก่อน
- `abortCompaction()` ยกเลิกตัวควบคุมการบีบอัดทั้งแบบแมนนวลและอัตโนมัติ
- การบีบอัดอัตโนมัติปล่อยเหตุการณ์เซสชันเริ่มต้น/สิ้นสุดสำหรับการอัปเดต UI/สถานะ
- การบีบอัดอัตโนมัติสามารถลองโมเดลผู้สมัครหลายตัวและลองใหม่เมื่อเกิดความล้มเหลวชั่วคราว
- ข้อผิดพลาดการล้นจะถูกยกเว้นจากเส้นทางลองใหม่ทั่วไปเพราะถูกจัดการโดยการบีบอัด
- หากการบีบอัดอัตโนมัติล้มเหลว:
  - เส้นทางการล้นจะปล่อย `Context overflow recovery failed: ...`
  - เส้นทางเกณฑ์จะปล่อย `Auto-compaction failed: ...`
- การสรุปสาขาสามารถถูกยกเลิกผ่านสัญญาณ abort (เช่น Escape) ส่งคืนผลลัพธ์การนำทางที่ถูกยกเลิก/หยุดกลางคัน

## การตั้งค่าและค่าเริ่มต้น

จาก `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

ค่าเหล่านี้ถูกใช้งานในรันไทม์โดย `AgentSession` และโมดูลการบีบอัด/สรุปสาขา
