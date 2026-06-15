---
title: การบีบอัดและสรุปสาขา
description: การบีบอัดหน้าต่างบริบทและการสร้างสรุปสาขาสำหรับเซสชันที่ยาวนาน
sidebar:
  order: 5
  label: การบีบอัด
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# การบีบอัดและสรุปสาขา

การบีบอัดและสรุปสาขาเป็นสองกลไกที่ทำให้เซสชันที่ยาวนานยังคงใช้งานได้โดยไม่สูญเสียบริบทการทำงานก่อนหน้า

- **การบีบอัด** เขียนประวัติเก่าใหม่เป็นสรุปบนสาขาปัจจุบัน
- **สรุปสาขา** บันทึกบริบทของสาขาที่ถูกละทิ้งระหว่างการนำทางด้วย `/tree`

ทั้งสองถูกบันทึกเป็นรายการเซสชันและแปลงกลับเป็นข้อความบริบทผู้ใช้เมื่อสร้างอินพุต LLM ใหม่

## ไฟล์การนำไปใช้งานหลัก

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
  - `summary`, `shortSummary` ที่เป็นทางเลือก
  - `firstKeptEntryId` (ขอบเขตการบีบอัด)
  - `tokensBefore`
  - `details`, `preserveData`, `fromExtension` ที่เป็นทางเลือก
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - `details`, `fromExtension` ที่เป็นทางเลือก

เมื่อมีการสร้างบริบทใหม่ (`buildSessionContext`):

1. การบีบอัดล่าสุดบนเส้นทางที่ใช้งานอยู่จะถูกแปลงเป็นข้อความ `compactionSummary` หนึ่งรายการ
2. รายการที่เก็บไว้จาก `firstKeptEntryId` ไปยังจุดบีบอัดจะถูกรวมซ้ำ
3. รายการที่อยู่ถัดไปบนเส้นทางจะถูกต่อท้าย
4. รายการ `branch_summary` จะถูกแปลงเป็นข้อความ `branchSummary`
5. รายการ `custom_message` จะถูกแปลงเป็นข้อความ `custom`

บทบาทกำหนดเองเหล่านั้นจะถูกแปลงเป็นข้อความผู้ใช้ที่ส่งไปยัง LLM ใน `convertToLlm()` โดยใช้เทมเพลตแบบคงที่:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## ขั้นตอนการบีบอัด

### ตัวกระตุ้น

การบีบอัดสามารถทำงานได้สามวิธี:

1. **แบบแมนวล**: `/compact [instructions]` เรียก `AgentSession.compact(...)`
2. **การกู้คืนจากล้นอัตโนมัติ**: หลังจากข้อผิดพลาดของ assistant ที่ตรงกับการล้นของบริบท
3. **การบีบอัดแบบเกณฑ์อัตโนมัติ**: หลังจากเทิร์นสำเร็จเมื่อบริบทเกินเกณฑ์

### รูปแบบการบีบอัด (ภาพ)

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

### การบีบอัดแบบล้นซ้ำ vs การบีบอัดแบบเกณฑ์

เส้นทางอัตโนมัติสองเส้นทางนี้แตกต่างกันโดยเจตนา:

- **การบีบอัดแบบล้นซ้ำ**
  - ตัวกระตุ้น: ข้อผิดพลาดของ assistant ในโมเดลปัจจุบันถูกตรวจพบว่าเป็นการล้นของบริบท
  - ข้อความแสดงข้อผิดพลาดของ assistant ที่ล้มเหลวจะถูกลบออกจากสถานะ agent ที่ใช้งานอยู่ก่อนลองซ้ำ
  - การบีบอัดอัตโนมัติทำงานด้วย `reason: "overflow"` และ `willRetry: true`
  - เมื่อสำเร็จ agent จะดำเนินการต่ออัตโนมัติ (`agent.continue()`) หลังการบีบอัด

- **การบีบอัดแบบเกณฑ์**
  - ตัวกระตุ้น: `contextTokens > contextWindow - compaction.reserveTokens`
  - ทำงานด้วย `reason: "threshold"` และ `willRetry: false`
  - เมื่อสำเร็จ ถ้า `compaction.autoContinue !== false` จะฉีดพรอมต์สังเคราะห์:
    - `"Continue if you have next steps."`

### การตัดทอนก่อนการบีบอัด

ก่อนการตรวจสอบการบีบอัด การตัดทอนผลลัพธ์เครื่องมืออาจทำงาน (`pruneToolOutputs`)

นโยบายการตัดทอนเริ่มต้น:

- ป้องกันโทเคนผลลัพธ์เครื่องมือใหม่ล่าสุด `40_000` รายการ
- ต้องการประหยัดรวมประมาณการอย่างน้อย `20_000`
- ไม่ตัดทอนผลลัพธ์เครื่องมือจาก `skill` หรือ `read` เลย

ผลลัพธ์เครื่องมือที่ถูกตัดทอนจะถูกแทนที่ด้วย:

- `[Output truncated - N tokens]`

หากการตัดทอนเปลี่ยนรายการ พื้นที่จัดเก็บเซสชันจะถูกเขียนใหม่และสถานะข้อความ agent จะถูกรีเฟรชก่อนการตัดสินใจบีบอัด

### ตรรกะขอบเขตและจุดตัด

`prepareCompaction()` พิจารณาเฉพาะรายการนับจากรายการการบีบอัดล่าสุด (ถ้ามี)

1. ค้นหาดัชนีการบีบอัดก่อนหน้า
2. คำนวณ `boundaryStart = prevCompactionIndex + 1`
3. ปรับ `keepRecentTokens` โดยใช้อัตราส่วนการใช้งานที่วัดได้เมื่อมี
4. รัน `findCutPoint()` บนหน้าต่างขอบเขต

จุดตัดที่ถูกต้องรวมถึง:

- รายการข้อความที่มีบทบาท: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- รายการ `custom_message`
- รายการ `branch_summary`

กฎหลัก: ห้ามตัดที่ `toolResult`

หากมีรายการข้อมูลเมตาที่ไม่ใช่ข้อความอยู่ก่อนหน้าจุดตัดทันที (`model_change`, `thinking_level_change`, ป้ายชื่อ ฯลฯ) รายการเหล่านั้นจะถูกดึงเข้าในบริเวณที่เก็บไว้โดยเลื่อนดัชนีตัดไปข้างหลังจนกระทั่งพบข้อความหรือขอบเขตการบีบอัด

### การจัดการเทิร์นแยก

หากจุดตัดไม่ได้อยู่ที่จุดเริ่มต้นเทิร์นผู้ใช้ การบีบอัดจะถือว่าเป็นเทิร์นแยก

การตรวจจับจุดเริ่มต้นเทิร์นถือว่าสิ่งเหล่านี้เป็นขอบเขตเทิร์นผู้ใช้:

- `message.role === "user"`
- `message.role === "bashExecution"`
- รายการ `custom_message`
- รายการ `branch_summary`

การบีบอัดเทิร์นแยกสร้างสรุปสองรายการ:

1. สรุปประวัติ (`messagesToSummarize`)
2. สรุปคำนำหน้าเทิร์น (`turnPrefixMessages`)

สรุปที่จัดเก็บสุดท้ายถูกรวมเป็น:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### การสร้างสรุป

`compact(...)` สร้างสรุปจากข้อความสนทนาที่ซีเรียลไลซ์:

1. แปลงข้อความผ่าน `convertToLlm()`
2. ซีเรียลไลซ์ด้วย `serializeConversation()`
3. ห่อใน `<conversation>...</conversation>`
4. รวม `<previous-summary>...</previous-summary>` ตามต้องการ
5. ฉีดบริบท hook เป็นรายการ `<additional-context>` ตามต้องการ
6. ดำเนินการพรอมต์สรุปด้วย `SUMMARIZATION_SYSTEM_PROMPT`

การเลือกพรอมต์:

- การบีบอัดครั้งแรก: `compaction-summary.md`
- การบีบอัดซ้ำพร้อมสรุปก่อนหน้า: `compaction-update-summary.md`
- การผ่านครั้งที่สองของเทิร์นแยก: `compaction-turn-prefix.md`
- สรุป UI สั้น: `compaction-short-summary.md`

โหมดสรุประยะไกล:

- หาก `compaction.remoteEndpoint` ถูกตั้งค่า การบีบอัดจะ POST:
  - `{ systemPrompt, prompt }`
- คาดหวัง JSON ที่มีอย่างน้อย `{ summary }`

### บริบทการดำเนินการไฟล์ในสรุป

การบีบอัดติดตามกิจกรรมไฟล์สะสมโดยใช้การเรียกเครื่องมือของ assistant:

- `read(path)` → ชุดที่อ่าน
- `write(path)` → ชุดที่แก้ไข
- `edit(path)` → ชุดที่แก้ไข

พฤติกรรมสะสม:

- รวมรายละเอียดการบีบอัดก่อนหน้าเฉพาะเมื่อรายการก่อนหน้าสร้างโดย pi (`fromExtension !== true`)
- ในเทิร์นแยก รวมการดำเนินการไฟล์คำนำหน้าเทิร์นด้วย
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

### การบันทึกและโหลดซ้ำ

หลังจากสร้างสรุป (หรือสรุปที่ hook ให้มา) เซสชัน agent จะ:

1. ต่อท้าย `CompactionEntry` ด้วย `appendCompaction(...)`
2. สร้างบริบทใหม่ผ่าน `buildSessionContext()`
3. แทนที่ข้อความ agent สดด้วยบริบทที่สร้างใหม่
4. ส่งเหตุการณ์ hook `session_compact`

## ขั้นตอนการสรุปสาขา

การสรุปสาขาเชื่อมกับการนำทางต้นไม้ ไม่ใช่การล้นของโทเคน

### ตัวกระตุ้น

ระหว่าง `navigateTree(...)`:

1. คำนวณรายการที่ถูกละทิ้งจากใบเก่าไปยังบรรพบุรุษร่วมโดยใช้ `collectEntriesForBranchSummary(...)`
2. หากผู้เรียกร้องขอสรุป (`options.summarize`) ให้สร้างสรุปก่อนสลับใบ
3. หากมีสรุป ให้แนบไว้ที่เป้าหมายการนำทางโดยใช้ `branchWithSummary(...)`

ในทางปฏิบัติ สิ่งนี้มักถูกขับเคลื่อนโดยขั้นตอน `/tree` เมื่อ `branchSummary.enabled` เปิดใช้งานอยู่

### รูปแบบการสลับสาขา (ภาพ)

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

### การเตรียมการและงบประมาณโทเคน

`generateBranchSummary(...)` คำนวณงบประมาณเป็น:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

จากนั้น `prepareBranchEntries(...)` จะ:

1. การผ่านครั้งแรก: รวบรวมการดำเนินการไฟล์สะสมจากรายการที่สรุปทั้งหมด รวมถึงรายละเอียด `branch_summary` ที่สร้างโดย pi ก่อนหน้า
2. การผ่านครั้งที่สอง: เดินจากใหม่ล่าสุดไปเก่าสุด เพิ่มข้อความจนกว่าจะถึงงบประมาณโทเคน
3. ให้ความสำคัญกับการรักษาบริบทล่าสุด
4. อาจยังรวมรายการสรุปขนาดใหญ่ใกล้ขอบงบประมาณเพื่อความต่อเนื่อง

รายการการบีบอัดจะถูกรวมเป็นข้อความ (`compactionSummary`) ระหว่างอินพุตการสรุปสาขา

### การสร้างสรุปและการบันทึก

การสรุปสาขา:

1. แปลงและซีเรียลไลซ์ข้อความที่เลือก
2. ห่อใน `<conversation>`
3. ใช้คำแนะนำกำหนดเองหากมี มิฉะนั้น `branch-summary.md`
4. เรียกโมเดลสรุปด้วย `SUMMARIZATION_SYSTEM_PROMPT`
5. เติมด้านหน้าด้วย `branch-summary-preamble.md`
6. ต่อท้ายแท็กการดำเนินการไฟล์

ผลลัพธ์จะถูกจัดเก็บเป็น `BranchSummaryEntry` พร้อมรายละเอียดเสริม (`readFiles`, `modifiedFiles`)

## จุดสัมผัสของส่วนขยายและ hook

### `session_before_compact`

Hook ก่อนการบีบอัด

สามารถ:

- ยกเลิกการบีบอัด (`{ cancel: true }`)
- ให้เพย์โหลดการบีบอัดกำหนดเองเต็มรูปแบบ (`{ compaction: CompactionResult }`)

### `session.compacting`

Hook การปรับแต่งพรอมต์/บริบทสำหรับการบีบอัดเริ่มต้น

สามารถคืนค่า:

- `prompt` (แทนที่พรอมต์สรุปหลัก)
- `context` (บรรทัดบริบทเพิ่มเติมที่ฉีดเข้าใน `<additional-context>`)
- `preserveData` (จัดเก็บบนรายการการบีบอัด)

### `session_compact`

การแจ้งเตือนหลังการบีบอัดพร้อม `compactionEntry` ที่บันทึกไว้และแฟล็ก `fromExtension`

### `session_before_tree`

ทำงานบนการนำทางต้นไม้ก่อนการสร้างสรุปสาขาเริ่มต้น

สามารถ:

- ยกเลิกการนำทาง
- ให้ `{ summary: { summary, details } }` กำหนดเองที่ใช้เมื่อผู้ใช้ร้องขอการสรุป

### `session_tree`

เหตุการณ์หลังการนำทางที่เปิดเผยใบใหม่/เก่าและรายการสรุปเสริม

## พฤติกรรมรันไทม์และความหมายของความล้มเหลว

- การบีบอัดแบบแมนวลจะยกเลิกการดำเนินการ agent ปัจจุบันก่อน
- `abortCompaction()` ยกเลิกทั้งตัวควบคุมการบีบอัดแบบแมนวลและอัตโนมัติ
- การบีบอัดอัตโนมัติส่งเหตุการณ์เซสชันเริ่ม/สิ้นสุดสำหรับการอัปเดต UI/สถานะ
- การบีบอัดอัตโนมัติสามารถลองผู้สมัครโมเดลหลายรายและลองซ้ำความล้มเหลวชั่วคราว
- ข้อผิดพลาดการล้นถูกแยกออกจากเส้นทางลองซ้ำทั่วไปเพราะจัดการโดยการบีบอัด
- หากการบีบอัดอัตโนมัติล้มเหลว:
  - เส้นทางการล้นส่ง `Context overflow recovery failed: ...`
  - เส้นทางเกณฑ์ส่ง `Auto-compaction failed: ...`
- การสรุปสาขาสามารถยกเลิกได้ผ่านสัญญาณยกเลิก (เช่น Escape) คืนค่าผลลัพธ์การนำทางที่ยกเลิก/ยุติ

## การตั้งค่าและค่าเริ่มต้น

จาก `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

ค่าเหล่านี้ถูกใช้ในรันไทม์โดย `AgentSession` และโมดูลการบีบอัด/สรุปสาขา
