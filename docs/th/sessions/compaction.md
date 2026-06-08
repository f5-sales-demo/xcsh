---
title: Compaction and Branch Summaries
description: >-
  Context window compaction and branch summary generation for long-lived
  sessions.
sidebar:
  order: 5
  label: Compaction
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# การบีบอัดและสรุปสาขา

การบีบอัด (Compaction) และสรุปสาขา (Branch Summaries) คือกลไกสองอย่างที่ทำให้เซสชันที่ใช้งานยาวนานยังคงใช้งานได้โดยไม่สูญเสียบริบทของงานก่อนหน้า

- **การบีบอัด** เขียนประวัติเก่าใหม่เป็นสรุปบนสาขาปัจจุบัน
- **สรุปสาขา** จับบริบทของสาขาที่ถูกละทิ้งระหว่างการนำทางด้วย `/tree`

ทั้งสองถูกบันทึกเป็นรายการเซสชันและแปลงกลับเป็นข้อความบริบทผู้ใช้เมื่อสร้างอินพุต LLM ขึ้นมาใหม่

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

การบีบอัดและสรุปสาขาเป็นรายการเซสชันระดับเฟิร์สคลาส ไม่ใช่ข้อความ assistant/user ธรรมดา

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, `shortSummary` ที่เป็นตัวเลือก
  - `firstKeptEntryId` (ขอบเขตการบีบอัด)
  - `tokensBefore`
  - `details`, `preserveData`, `fromExtension` ที่เป็นตัวเลือก
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - `details`, `fromExtension` ที่เป็นตัวเลือก

เมื่อบริบทถูกสร้างขึ้นใหม่ (`buildSessionContext`):

1. การบีบอัดล่าสุดบนเส้นทางที่ใช้งานอยู่จะถูกแปลงเป็นข้อความ `compactionSummary` หนึ่งข้อความ
2. รายการที่ถูกเก็บไว้ตั้งแต่ `firstKeptEntryId` ถึงจุดบีบอัดจะถูกรวมเข้าไปอีกครั้ง
3. รายการหลังจากนั้นบนเส้นทางจะถูกต่อท้าย
4. รายการ `branch_summary` จะถูกแปลงเป็นข้อความ `branchSummary`
5. รายการ `custom_message` จะถูกแปลงเป็นข้อความ `custom`

บทบาทที่กำหนดเองเหล่านั้นจะถูกแปลงเป็นข้อความผู้ใช้ที่ส่งไปยัง LLM ใน `convertToLlm()` โดยใช้เทมเพลตคงที่:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## ไปป์ไลน์การบีบอัด

### ตัวกระตุ้น

การบีบอัดสามารถทำงานได้สามวิธี:

1. **ด้วยตนเอง**: `/compact [instructions]` เรียก `AgentSession.compact(...)`
2. **การกู้คืนอัตโนมัติจากบริบทล้น**: หลังจากข้อผิดพลาด assistant ที่ตรงกับบริบทล้น
3. **การบีบอัดอัตโนมัติตามเกณฑ์**: หลังจากรอบสำเร็จเมื่อบริบทเกินเกณฑ์

### รูปแบบการบีบอัด (แผนภาพ)

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

### การบีบอัดจากการลองใหม่เมื่อล้น vs การบีบอัดตามเกณฑ์

เส้นทางอัตโนมัติทั้งสองตั้งใจให้แตกต่างกัน:

- **การบีบอัดจากการลองใหม่เมื่อล้น**
  - ตัวกระตุ้น: ข้อผิดพลาด assistant ของโมเดลปัจจุบันถูกตรวจพบว่าเป็นบริบทล้น
  - ข้อความข้อผิดพลาด assistant ที่ล้มเหลวจะถูกลบออกจากสถานะ agent ที่ใช้งานอยู่ก่อนลองใหม่
  - การบีบอัดอัตโนมัติทำงานด้วย `reason: "overflow"` และ `willRetry: true`
  - เมื่อสำเร็จ agent จะดำเนินการต่อโดยอัตโนมัติ (`agent.continue()`) หลังการบีบอัด

- **การบีบอัดตามเกณฑ์**
  - ตัวกระตุ้น: `contextTokens > contextWindow - compaction.reserveTokens`
  - ทำงานด้วย `reason: "threshold"` และ `willRetry: false`
  - เมื่อสำเร็จ ถ้า `compaction.autoContinue !== false` จะแทรกพรอมต์สังเคราะห์:
    - `"Continue if you have next steps."`

### การตัดแต่งก่อนบีบอัด

ก่อนการตรวจสอบการบีบอัด อาจมีการตัดแต่งผลลัพธ์เครื่องมือ (`pruneToolOutputs`)

นโยบายการตัดแต่งเริ่มต้น:

- ปกป้องโทเค็นผลลัพธ์เครื่องมือล่าสุด `40_000` โทเค็น
- ต้องการการประหยัดขั้นต่ำ `20_000` โทเค็นโดยประมาณ
- ไม่ตัดแต่งผลลัพธ์เครื่องมือจาก `skill` หรือ `read`

ผลลัพธ์เครื่องมือที่ถูกตัดแต่งจะถูกแทนที่ด้วย:

- `[Output truncated - N tokens]`

หากการตัดแต่งเปลี่ยนแปลงรายการ ที่เก็บเซสชันจะถูกเขียนใหม่และสถานะข้อความ agent จะถูกรีเฟรชก่อนการตัดสินใจบีบอัด

### ตรรกะขอบเขตและจุดตัด

`prepareCompaction()` พิจารณาเฉพาะรายการตั้งแต่รายการบีบอัดล่าสุด (ถ้ามี)

1. ค้นหาดัชนีการบีบอัดก่อนหน้า
2. คำนวณ `boundaryStart = prevCompactionIndex + 1`
3. ปรับ `keepRecentTokens` โดยใช้อัตราส่วนการใช้งานที่วัดได้เมื่อมีข้อมูล
4. เรียก `findCutPoint()` บนหน้าต่างขอบเขต

จุดตัดที่ถูกต้องรวมถึง:

- รายการข้อความที่มีบทบาท: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- รายการ `custom_message`
- รายการ `branch_summary`

กฎเด็ดขาด: ห้ามตัดที่ `toolResult`

หากมีรายการเมตาดาต้าที่ไม่ใช่ข้อความอยู่ก่อนจุดตัดทันที (`model_change`, `thinking_level_change`, labels ฯลฯ) รายการเหล่านั้นจะถูกดึงเข้าไปในพื้นที่ที่เก็บไว้โดยเลื่อนดัชนีตัดถอยหลังจนกว่าจะพบข้อความหรือขอบเขตการบีบอัด

### การจัดการรอบที่ถูกแบ่ง

หากจุดตัดไม่อยู่ที่จุดเริ่มต้นรอบผู้ใช้ การบีบอัดจะถือว่าเป็นรอบที่ถูกแบ่ง

การตรวจจับจุดเริ่มต้นรอบถือสิ่งเหล่านี้เป็นขอบเขตรอบผู้ใช้:

- `message.role === "user"`
- `message.role === "bashExecution"`
- รายการ `custom_message`
- รายการ `branch_summary`

การบีบอัดรอบที่ถูกแบ่งจะสร้างสรุปสองรายการ:

1. สรุปประวัติ (`messagesToSummarize`)
2. สรุปคำนำหน้ารอบ (`turnPrefixMessages`)

สรุปที่บันทึกสุดท้ายจะถูกรวมเป็น:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### การสร้างสรุป

`compact(...)` สร้างสรุปจากข้อความสนทนาที่ถูก serialize:

1. แปลงข้อความผ่าน `convertToLlm()`
2. Serialize ด้วย `serializeConversation()`
3. ห่อใน `<conversation>...</conversation>`
4. รวม `<previous-summary>...</previous-summary>` ตามตัวเลือก
5. แทรกบริบท hook เป็นรายการ `<additional-context>` ตามตัวเลือก
6. ดำเนินการพรอมต์สรุปด้วย `SUMMARIZATION_SYSTEM_PROMPT`

การเลือกพรอมต์:

- การบีบอัดครั้งแรก: `compaction-summary.md`
- การบีบอัดแบบวนซ้ำที่มีสรุปก่อนหน้า: `compaction-update-summary.md`
- รอบที่สองของรอบที่ถูกแบ่ง: `compaction-turn-prefix.md`
- สรุปสั้นสำหรับ UI: `compaction-short-summary.md`

โหมดสรุปทางไกล:

- หาก `compaction.remoteEndpoint` ถูกตั้งค่า การบีบอัดจะ POST:
  - `{ systemPrompt, prompt }`
- คาดหวัง JSON ที่มีอย่างน้อย `{ summary }`

### บริบทการดำเนินการไฟล์ในสรุป

การบีบอัดติดตามกิจกรรมไฟล์สะสมโดยใช้การเรียกเครื่องมือ assistant:

- `read(path)` → ชุดที่อ่าน
- `write(path)` → ชุดที่แก้ไข
- `edit(path)` → ชุดที่แก้ไข

พฤติกรรมสะสม:

- รวมรายละเอียดการบีบอัดก่อนหน้าเมื่อรายการก่อนหน้าถูกสร้างโดย pi เท่านั้น (`fromExtension !== true`)
- ในรอบที่ถูกแบ่ง จะรวมการดำเนินการไฟล์ของคำนำหน้ารอบด้วย
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

### การบันทึกและโหลดใหม่

หลังจากสร้างสรุป (หรือสรุปที่ hook จัดเตรียมให้) เซสชัน agent จะ:

1. เพิ่ม `CompactionEntry` ด้วย `appendCompaction(...)`
2. สร้างบริบทใหม่ผ่าน `buildSessionContext()`
3. แทนที่ข้อความ agent ที่ทำงานอยู่ด้วยบริบทที่สร้างใหม่
4. ส่งเหตุการณ์ hook `session_compact`

## ไปป์ไลน์สรุปสาขา

สรุปสาขาเชื่อมโยงกับการนำทางต้นไม้ ไม่ใช่การล้นของโทเค็น

### ตัวกระตุ้น

ระหว่าง `navigateTree(...)`:

1. คำนวณรายการที่ถูกละทิ้งจากใบเก่าไปยังบรรพบุรุษร่วมโดยใช้ `collectEntriesForBranchSummary(...)`
2. หากผู้เรียกร้องขอสรุป (`options.summarize`) จะสร้างสรุปก่อนสลับใบ
3. หากมีสรุป จะแนบไว้ที่เป้าหมายการนำทางโดยใช้ `branchWithSummary(...)`

ในทางปฏิบัติสิ่งนี้มักถูกขับเคลื่อนโดยขั้นตอน `/tree` เมื่อ `branchSummary.enabled` ถูกเปิดใช้งาน

### รูปแบบการสลับสาขา (แผนภาพ)

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

### การเตรียมและงบประมาณโทเค็น

`generateBranchSummary(...)` คำนวณงบประมาณเป็น:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` จากนั้น:

1. รอบแรก: รวบรวมการดำเนินการไฟล์สะสมจากรายการที่สรุปทั้งหมด รวมถึงรายละเอียด `branch_summary` ที่สร้างโดย pi ก่อนหน้า
2. รอบที่สอง: เดินจากใหม่สุด → เก่าสุด เพิ่มข้อความจนกว่าจะถึงงบประมาณโทเค็น
3. ให้ความสำคัญกับการรักษาบริบทล่าสุด
4. อาจยังรวมรายการสรุปขนาดใหญ่ที่อยู่ใกล้ขอบงบประมาณเพื่อความต่อเนื่อง

รายการการบีบอัดจะถูกรวมเป็นข้อความ (`compactionSummary`) ระหว่างอินพุตสรุปสาขา

### การสร้างสรุปและการบันทึก

สรุปสาขา:

1. แปลงและ serialize ข้อความที่เลือก
2. ห่อใน `<conversation>`
3. ใช้คำสั่งที่กำหนดเองหากมี มิฉะนั้นใช้ `branch-summary.md`
4. เรียกโมเดลสรุปด้วย `SUMMARIZATION_SYSTEM_PROMPT`
5. เพิ่ม `branch-summary-preamble.md` ไว้ข้างหน้า
6. ต่อท้ายแท็กการดำเนินการไฟล์

ผลลัพธ์จะถูกบันทึกเป็น `BranchSummaryEntry` พร้อมรายละเอียดที่เป็นตัวเลือก (`readFiles`, `modifiedFiles`)

## จุดเชื่อมต่อส่วนขยายและ hook

### `session_before_compact`

Hook ก่อนการบีบอัด

สามารถ:

- ยกเลิกการบีบอัด (`{ cancel: true }`)
- จัดเตรียม payload การบีบอัดที่กำหนดเองทั้งหมด (`{ compaction: CompactionResult }`)

### `session.compacting`

Hook ปรับแต่งพรอมต์/บริบทสำหรับการบีบอัดเริ่มต้น

สามารถคืนค่า:

- `prompt` (แทนที่พรอมต์สรุปพื้นฐาน)
- `context` (บรรทัดบริบทเพิ่มเติมที่แทรกเข้าไปใน `<additional-context>`)
- `preserveData` (บันทึกบนรายการบีบอัด)

### `session_compact`

การแจ้งเตือนหลังการบีบอัดพร้อม `compactionEntry` ที่บันทึกแล้วและแฟล็ก `fromExtension`

### `session_before_tree`

ทำงานเมื่อนำทางต้นไม้ก่อนการสร้างสรุปสาขาเริ่มต้น

สามารถ:

- ยกเลิกการนำทาง
- จัดเตรียม `{ summary: { summary, details } }` ที่กำหนดเองที่ใช้เมื่อผู้ใช้ร้องขอการสรุป

### `session_tree`

เหตุการณ์หลังการนำทางที่เปิดเผยใบใหม่/เก่าและรายการสรุปที่เป็นตัวเลือก

## พฤติกรรมรันไทม์และความหมายของความล้มเหลว

- การบีบอัดด้วยตนเองจะยกเลิกการดำเนินการ agent ปัจจุบันก่อน
- `abortCompaction()` ยกเลิกทั้งตัวควบคุมการบีบอัดด้วยตนเองและอัตโนมัติ
- การบีบอัดอัตโนมัติส่งเหตุการณ์เริ่มต้น/สิ้นสุดเซสชันสำหรับการอัปเดต UI/สถานะ
- การบีบอัดอัตโนมัติสามารถลองโมเดลผู้สมัครหลายตัวและลองใหม่เมื่อเกิดข้อผิดพลาดชั่วคราว
- ข้อผิดพลาดจากการล้นจะถูกยกเว้นจากเส้นทางการลองใหม่ทั่วไปเนื่องจากถูกจัดการโดยการบีบอัด
- หากการบีบอัดอัตโนมัติล้มเหลว:
  - เส้นทางการล้นจะส่ง `Context overflow recovery failed: ...`
  - เส้นทางตามเกณฑ์จะส่ง `Auto-compaction failed: ...`
- สรุปสาขาสามารถถูกยกเลิกผ่านสัญญาณยกเลิก (เช่น Escape) โดยคืนผลลัพธ์การนำทางที่ถูกยกเลิก/ยุติ

## การตั้งค่าและค่าเริ่มต้น

จาก `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

ค่าเหล่านี้ถูกใช้งานที่รันไทม์โดย `AgentSession` และโมดูลการบีบอัด/สรุปสาขา
