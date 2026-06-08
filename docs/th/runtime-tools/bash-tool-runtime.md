---
title: Bash Tool Runtime
description: >-
  Bash tool runtime with shell process management, sandboxing, timeout, and
  output streaming.
sidebar:
  order: 1
  label: Bash tool
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# รันไทม์ของเครื่องมือ Bash

เอกสารนี้อธิบายเส้นทางรันไทม์ของ **เครื่องมือ `bash`** ที่ใช้โดยการเรียกเครื่องมือของเอเจนต์ ตั้งแต่การปรับมาตรฐานคำสั่งไปจนถึงการดำเนินการ การตัดทอน/อาร์ติแฟกต์ และการเรนเดอร์

นอกจากนี้ยังระบุจุดที่พฤติกรรมแตกต่างกันใน TUI แบบโต้ตอบ โหมดพิมพ์ โหมด RPC และการดำเนินการเชลล์แบบ bang (`!`) ที่ผู้ใช้เป็นคนเริ่มต้น

## ขอบเขตและพื้นผิวรันไทม์

มีพื้นผิวการดำเนินการ bash สองแบบที่แตกต่างกันใน coding-agent:

1. **พื้นผิวการเรียกเครื่องมือ** (`toolName: "bash"`): ใช้เมื่อโมเดลเรียกเครื่องมือ bash
   - จุดเข้า: `BashTool.execute()`
2. **พื้นผิวคำสั่ง bang ของผู้ใช้** (`!cmd` จากอินพุตแบบโต้ตอบหรือคำสั่ง RPC `bash`): เส้นทางตัวช่วยระดับเซสชัน
   - จุดเข้า: `AgentSession.executeBash()`

ทั้งสองแบบในที่สุดจะใช้ `executeBash()` ใน `src/exec/bash-executor.ts` สำหรับการดำเนินการแบบไม่ใช้ PTY แต่เฉพาะเส้นทางการเรียกเครื่องมือเท่านั้นที่จะรันการปรับมาตรฐาน/การสกัดกั้นและตรรกะตัวเรนเดอร์เครื่องมือ

## ไปป์ไลน์การเรียกเครื่องมือแบบครบวงจร

## 1) การปรับมาตรฐานอินพุตและการรวมพารามิเตอร์

`BashTool.execute()` จะปรับมาตรฐานคำสั่งดิบผ่าน `normalizeBashCommand()` ก่อน:

- แยก `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` ที่ต่อท้ายออกเป็นขีดจำกัดแบบมีโครงสร้าง
- ตัดช่องว่างท้าย/หน้าออก
- คงช่องว่างภายในไว้ตามเดิม

จากนั้นจะรวมขีดจำกัดที่แยกออกมากับ tool args ที่ระบุอย่างชัดเจน:

- args `head`/`tail` ที่ระบุอย่างชัดเจนจะแทนที่ค่าที่แยกออกมา
- ค่าที่แยกออกมาเป็นเพียงค่าสำรองเท่านั้น

### ข้อควรระวัง

ความคิดเห็นใน `bash-normalize.ts` กล่าวถึงการตัด `2>&1` ออก แต่การใช้งานปัจจุบันไม่ได้ลบมันออก พฤติกรรมรันไทม์ยังคงถูกต้อง (stdout/stderr ถูกรวมกันแล้ว) แต่พฤติกรรมการปรับมาตรฐานแคบกว่าที่ความคิดเห็นระบุไว้

## 2) การสกัดกั้นตามเงื่อนไข (เส้นทางคำสั่งที่ถูกบล็อก)

หาก `bashInterceptor.enabled` เป็น true `BashTool` จะโหลดกฎจากการตั้งค่าและรัน `checkBashInterception()` กับคำสั่งที่ปรับมาตรฐานแล้ว

พฤติกรรมการสกัดกั้น:

- คำสั่งจะถูกบล็อก **เฉพาะเมื่อ**:
  - กฎ regex ตรงกัน และ
  - เครื่องมือที่แนะนำมีอยู่ใน `ctx.toolNames`
- กฎ regex ที่ไม่ถูกต้องจะถูกข้ามอย่างเงียบๆ
- เมื่อถูกบล็อก `BashTool` จะ throw `ToolError` พร้อมข้อความ:
  - `Blocked: ...`
  - คำสั่งดั้งเดิมรวมอยู่ด้วย

รูปแบบกฎเริ่มต้น (กำหนดในโค้ด) มุ่งเป้าไปที่การใช้งานผิดทั่วไป:

- ตัวอ่านไฟล์ (`cat`, `head`, `tail`, ...)
- เครื่องมือค้นหา (`grep`, `rg`, ...)
- ตัวค้นหาไฟล์ (`find`, `fd`, ...)
- ตัวแก้ไขแบบ in-place (`sed -i`, `perl -i`, `awk -i inplace`)
- การเขียนด้วยการเปลี่ยนทิศทางเชลล์ (`echo ... > file`, heredoc redirection)

### ข้อควรระวัง

`InterceptionResult` มี `suggestedTool` แต่ `BashTool` ปัจจุบันแสดงเฉพาะข้อความ (ไม่มีฟิลด์ suggested-tool แบบมีโครงสร้างใน `details`)

## 3) การตรวจสอบ CWD และการจำกัดค่า timeout

`cwd` จะถูก resolve เทียบกับ cwd ของเซสชัน (`resolveToCwd`) จากนั้นตรวจสอบผ่าน `stat`:

- เส้นทางไม่มีอยู่ -> `ToolError("Working directory does not exist: ...")`
- ไม่ใช่ไดเรกทอรี -> `ToolError("Working directory is not a directory: ...")`

Timeout จะถูกจำกัดไว้ที่ `[1, 3600]` วินาทีและแปลงเป็นมิลลิวินาที

## 4) การจัดสรรอาร์ติแฟกต์

ก่อนการดำเนินการ เครื่องมือจะจัดสรรเส้นทาง/id ของอาร์ติแฟกต์ (แบบพยายามให้ดีที่สุด) สำหรับการจัดเก็บเอาต์พุตที่ถูกตัดทอน

- ความล้มเหลวในการจัดสรรอาร์ติแฟกต์ไม่ถือเป็นข้อผิดพลาดร้ายแรง (การดำเนินการยังคงดำเนินต่อโดยไม่มีไฟล์ spill ของอาร์ติแฟกต์)
- id/เส้นทางของอาร์ติแฟกต์จะถูกส่งเข้าไปในเส้นทางการดำเนินการเพื่อคงเอาต์พุตเต็มเมื่อมีการตัดทอน

## 5) การเลือกการดำเนินการแบบ PTY และไม่ใช่ PTY

`BashTool` จะเลือกการดำเนินการแบบ PTY เฉพาะเมื่อเงื่อนไขทั้งหมดเป็นจริง:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- tool context มี UI (`ctx.hasUI === true` และ `ctx.ui` ถูกตั้งค่า)

มิฉะนั้นจะใช้ `executeBash()` แบบไม่โต้ตอบ

นั่นหมายความว่าโหมดพิมพ์และ RPC/tool contexts ที่ไม่มี UI จะใช้แบบไม่ใช้ PTY เสมอ

## เอนจินการดำเนินการแบบไม่โต้ตอบ (`executeBash`)

## โมเดลการนำเชลล์เซสชันกลับมาใช้

`executeBash()` แคชอินสแตนซ์ `Shell` แบบเนทีฟในแมประดับกระบวนการที่มีคีย์โดย:

- เส้นทางเชลล์
- command prefix ที่กำหนดค่าไว้
- เส้นทาง snapshot
- shell env ที่ถูก serialize
- agent session key ที่เป็นตัวเลือก

สำหรับการดำเนินการระดับเซสชัน `AgentSession.executeBash()` จะส่ง `sessionKey: this.sessionId` เพื่อแยกการนำกลับมาใช้ต่อเซสชัน

เส้นทางการเรียกเครื่องมือ **ไม่** ส่ง `sessionKey` ดังนั้นขอบเขตการนำกลับมาใช้จะอิงตามการกำหนดค่าเชลล์/snapshot/env

## การกำหนดค่าเชลล์และพฤติกรรม snapshot

ในแต่ละการเรียก executor จะโหลดการกำหนดค่าเชลล์จากการตั้งค่า (`shell`, `env`, `prefix` ที่เป็นตัวเลือก)

หากเชลล์ที่เลือกมี `bash` จะพยายาม `getOrCreateSnapshot()`:

- snapshot จับ aliases/functions/options จาก user rc
- การสร้าง snapshot เป็นแบบพยายามให้ดีที่สุด
- ความล้มเหลวจะ fallback เป็นไม่มี snapshot

หาก `prefix` ถูกกำหนดค่า คำสั่งจะกลายเป็น:

```text
<prefix> <command>
```

## การสตรีมและการยกเลิก

`Shell.run()` สตรีม chunk ไปยัง callback ตัว executor จะส่ง chunk แต่ละตัวไปยัง `OutputSink` และ callback `onChunk` ที่เป็นตัวเลือก

การยกเลิก:

- สัญญาณ aborted จะทริกเกอร์ `shellSession.abort(...)`
- timeout จากผลลัพธ์เนทีฟจะถูกแมปเป็น `cancelled: true` + ข้อความ annotation
- การยกเลิกแบบชัดเจนจะคืนค่า `cancelled: true` + annotation เช่นเดียวกัน

ไม่มี exception ถูก throw ภายใน executor สำหรับ timeout/cancel; มันจะคืนค่า `BashResult` แบบมีโครงสร้างและให้ caller กำหนด error semantics

## เส้นทาง PTY แบบโต้ตอบ (`runInteractiveBashPty`)

เมื่อ PTY ถูกเปิดใช้งาน เครื่องมือจะรัน `runInteractiveBashPty()` ซึ่งเปิดคอมโพเนนต์คอนโซลแบบ overlay และขับเคลื่อน `PtySession` แบบเนทีฟ

จุดเด่นของพฤติกรรม:

- เทอร์มินัลเสมือน xterm-headless เรนเดอร์ viewport ใน overlay
- อินพุตแป้นพิมพ์ถูกปรับมาตรฐาน (รวมถึงการจัดการ Kitty sequences และโหมด application cursor)
- `esc` ขณะกำลังรันจะ kill เซสชัน PTY
- การปรับขนาดเทอร์มินัลจะถูกส่งต่อไปยัง PTY (`session.resize(cols, rows)`)

ค่าเริ่มต้นสำหรับการเสริมความแข็งแกร่งของสภาพแวดล้อมถูกฉีดเข้าไปสำหรับการรันแบบ unattended:

- ปิดการใช้งาน pager (`PAGER=cat`, `GIT_PAGER=cat` เป็นต้น)
- ปิดการใช้งาน editor prompts (`GIT_EDITOR=true`, `EDITOR=true` ...)
- ลด terminal/auth prompts (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`)
- แฟล็กอัตโนมัติของ package-manager/เครื่องมือสำหรับพฤติกรรมแบบไม่โต้ตอบ

เอาต์พุต PTY ถูกปรับมาตรฐาน (`CRLF`/`CR` เป็น `LF`, `sanitizeText`) และเขียนลงใน `OutputSink` รวมถึงรองรับการ spill อาร์ติแฟกต์

เมื่อมีข้อผิดพลาดในการเริ่ม/รันไทม์ PTY sink จะรับบรรทัด `PTY error: ...` และคำสั่งจะสิ้นสุดด้วย exit code ที่เป็น undefined

## การจัดการเอาต์พุต: การสตรีม การตัดทอน การ spill อาร์ติแฟกต์

ทั้งเส้นทาง PTY และไม่ใช่ PTY ใช้ `OutputSink`

## ความหมายของ OutputSink

- เก็บบัฟเฟอร์ tail ในหน่วยความจำที่ปลอดภัยสำหรับ UTF-8 (`DEFAULT_MAX_BYTES` ปัจจุบัน 50KB)
- ติดตามจำนวนไบต์/บรรทัดทั้งหมดที่เห็น
- หากมีเส้นทางอาร์ติแฟกต์อยู่และเอาต์พุตล้น (หรือไฟล์ใช้งานอยู่แล้ว) จะเขียนสตรีมเต็มไปยังไฟล์อาร์ติแฟกต์
- เมื่อเกณฑ์หน่วยความจำล้น จะตัดบัฟเฟอร์ในหน่วยความจำให้เหลือเฉพาะ tail (ปลอดภัยต่อขอบเขต UTF-8)
- ทำเครื่องหมาย `truncated` เมื่อเกิดการล้น/การ spill ไฟล์

`dump()` คืนค่า:

- `output` (อาจมีคำนำหน้า annotation)
- `truncated`
- `totalLines/totalBytes`
- `outputLines/outputBytes`
- `artifactId` หากไฟล์อาร์ติแฟกต์ใช้งานอยู่

### ข้อควรระวังเรื่องเอาต์พุตยาว

การตัดทอนรันไทม์เป็นแบบอิงเกณฑ์ไบต์ใน `OutputSink` (ค่าเริ่มต้น 50KB) ไม่ได้บังคับใช้ขีดจำกัด 2000 บรรทัดแบบเข้มงวดในเส้นทางโค้ดนี้

## การอัปเดตเครื่องมือแบบสด

สำหรับการดำเนินการแบบไม่ใช้ PTY `BashTool` ใช้ `TailBuffer` แยกต่างหากสำหรับการอัปเดตบางส่วนและปล่อย snapshot `onUpdate` ขณะที่คำสั่งกำลังทำงาน

สำหรับการดำเนินการแบบ PTY การเรนเดอร์แบบสดจะจัดการโดย UI overlay แบบกำหนดเอง ไม่ใช่โดย chunk ข้อความ `onUpdate`

## การจัดรูปผลลัพธ์ เมตาดาต้า และการแมปข้อผิดพลาด

หลังการดำเนินการ:

1. การจัดการ `cancelled`:
   - หากสัญญาณ abort ถูก abort -> throw `ToolAbortError` (ความหมายแบบ abort)
   - มิฉะนั้น -> throw `ToolError` (ถือเป็นความล้มเหลวของเครื่องมือ)
2. PTY `timedOut` -> throw `ToolError`
3. ใช้ตัวกรอง head/tail กับข้อความเอาต์พุตสุดท้าย (`applyHeadTail`, head ก่อน tail)
4. เอาต์พุตว่างจะกลายเป็น `(no output)`
5. แนบเมตาดาต้าการตัดทอนผ่าน `toolResult(...).truncationFromSummary(result, { direction: "tail" })`
6. การแมป exit-code:
   - ไม่มี exit code -> `ToolError("... missing exit status")`
   - exit ที่ไม่ใช่ศูนย์ -> `ToolError("... Command exited with code N")`
   - exit เป็นศูนย์ -> ผลลัพธ์สำเร็จ

โครงสร้าง payload สำเร็จ:

- `content`: เอาต์พุตข้อความ
- `details.meta.truncation` เมื่อถูกตัดทอน รวมถึง:
  - `direction`, `truncatedBy`, จำนวนบรรทัด+ไบต์ทั้งหมด/เอาต์พุต
  - `shownRange`
  - `artifactId` เมื่อมี

เนื่องจากเครื่องมือในตัวถูกครอบด้วย `wrapToolWithMetaNotice()` ข้อความแจ้งเตือนการตัดทอนจะถูกต่อท้ายเนื้อหาข้อความสุดท้ายโดยอัตโนมัติ (ตัวอย่าง: `Full: artifact://<id>`)

## เส้นทางการเรนเดอร์

## ตัวเรนเดอร์การเรียกเครื่องมือ (`bashToolRenderer`)

`bashToolRenderer` ใช้สำหรับข้อความการเรียกเครื่องมือ (`toolCall` / `toolResult`):

- โหมดยุบแสดงตัวอย่างที่ถูกตัดทอนตามบรรทัดที่มองเห็น
- โหมดขยายแสดงข้อความเอาต์พุตทั้งหมดที่มีอยู่ในปัจจุบัน
- บรรทัดเตือนรวมเหตุผลการตัดทอนและ `artifact://<id>` เมื่อถูกตัดทอน
- ค่า timeout (จาก args) จะแสดงในบรรทัดเมตาดาต้าส่วนท้าย

### ข้อควรระวัง: การขยายอาร์ติแฟกต์เต็ม

`BashRenderContext` มี `isFullOutput` แต่ตัวสร้าง context ของ renderer ปัจจุบันไม่ได้ตั้งค่ามันสำหรับผลลัพธ์เครื่องมือ bash มุมมองขยายยังคงใช้ข้อความที่อยู่ในเนื้อหาผลลัพธ์อยู่แล้ว (เอาต์พุต tail/ที่ถูกตัดทอน) เว้นแต่ caller อื่นจะให้เนื้อหาอาร์ติแฟกต์แบบเต็ม

## คอมโพเนนต์คำสั่ง bang ของผู้ใช้ (`BashExecutionComponent`)

`BashExecutionComponent` ใช้สำหรับคำสั่ง `!` ของผู้ใช้ในโหมดโต้ตอบ (ไม่ใช่การเรียกเครื่องมือของโมเดล):

- สตรีม chunk แบบสด
- ตัวอย่างแบบยุบเก็บ 20 บรรทัดตรรกะสุดท้าย
- จำกัดบรรทัดที่ 4000 อักขระต่อบรรทัด
- แสดงคำเตือนการตัดทอน + อาร์ติแฟกต์เมื่อมีเมตาดาต้า
- ทำเครื่องหมายสถานะยกเลิก/ข้อผิดพลาด/exit แยกกัน

คอมโพเนนต์นี้เชื่อมต่อโดย `CommandController.handleBashCommand()` และรับข้อมูลจาก `AgentSession.executeBash()`

## ความแตกต่างของพฤติกรรมเฉพาะโหมด

| พื้นผิว                        | เส้นทางเข้า                                            | สามารถใช้ PTY ได้                                                         | UX เอาต์พุตแบบสด                                                           | การแสดงข้อผิดพลาด                                  |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| การเรียกเครื่องมือแบบโต้ตอบ          | `BashTool.execute`                                    | ใช่ เมื่อ `bash.virtualTerminal=on` และมี UI และ `PI_NO_PTY!=1` | PTY overlay (โต้ตอบ) หรือการอัปเดต tail แบบสตรีม                       | ข้อผิดพลาดเครื่องมือกลายเป็น `toolResult.isError`          |
| การเรียกเครื่องมือโหมดพิมพ์           | `BashTool.execute`                                    | ไม่ (ไม่มี UI context)                                                   | ไม่มี TUI overlay; เอาต์พุตปรากฏในสตรีมอีเวนต์/ข้อความ assistant สุดท้าย | การแมปข้อผิดพลาดเครื่องมือเดียวกัน                          |
| การเรียกเครื่องมือ RPC (agent tooling)  | `BashTool.execute`                                    | โดยปกติไม่มี UI -> ไม่ใช้ PTY                                             | อีเวนต์/ผลลัพธ์เครื่องมือแบบมีโครงสร้าง                                           | การแมปข้อผิดพลาดเครื่องมือเดียวกัน                          |
| คำสั่ง bang แบบโต้ตอบ (`!`) | `AgentSession.executeBash` + `BashExecutionComponent` | ไม่ (ใช้ executor โดยตรง)                                          | คอมโพเนนต์การดำเนินการ bash เฉพาะ                                       | Controller จับ exception และแสดงข้อผิดพลาดใน UI |
| คำสั่ง RPC `bash`             | `rpc-mode` -> `session.executeBash`                   | ไม่                                                                   | คืนค่า `BashResult` โดยตรง                                            | ผู้ใช้จัดการฟิลด์ที่คืนค่ามา                 |

## ข้อควรระวังในการดำเนินงาน

- Interceptor บล็อกคำสั่งเฉพาะเมื่อเครื่องมือที่แนะนำมีอยู่ใน context ปัจจุบัน
- หากการจัดสรรอาร์ติแฟกต์ล้มเหลว การตัดทอนยังคงเกิดขึ้นแต่จะไม่มีการอ้างอิงกลับ `artifact://`
- แคชเซสชันเชลล์ไม่มีการขับไล่อย่างชัดเจนในโมดูลนี้; อายุการใช้งานเป็นระดับกระบวนการ
- พื้นผิว timeout ของ PTY และไม่ใช่ PTY แตกต่างกัน:
  - PTY เปิดเผยฟิลด์ผลลัพธ์ `timedOut` อย่างชัดเจน
  - ไม่ใช้ PTY จะแมป timeout เป็นสรุป `cancelled + annotation`

## ไฟล์การใช้งาน

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — จุดเข้าของเครื่องมือ การปรับมาตรฐาน/การสกัดกั้น การเลือก PTY/ไม่ใช้ PTY การแมปผลลัพธ์/ข้อผิดพลาด ตัวเรนเดอร์เครื่องมือ bash
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — การปรับมาตรฐานคำสั่งและการกรอง head/tail หลังการรัน
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — การจับคู่กฎ interceptor และข้อความคำสั่งที่ถูกบล็อก
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — executor แบบไม่ใช้ PTY การนำเซสชันเชลล์กลับมาใช้ การเชื่อมต่อการยกเลิก การรวม output sink
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — รันไทม์ PTY, UI overlay, การปรับมาตรฐานอินพุต, ค่าเริ่มต้น env แบบไม่โต้ตอบ
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — การตัดทอน/การ spill อาร์ติแฟกต์ของ `OutputSink` และเมตาดาต้าสรุป
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — ตัวช่วยการจัดสรรอาร์ติแฟกต์และ tail buffer แบบสตรีม
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — รูปแบบเมตาดาต้าการตัดทอน + wrapper การฉีดข้อความแจ้งเตือน
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` ระดับเซสชัน การบันทึกข้อความ วงจรชีวิต abort
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — คอมโพเนนต์การดำเนินการคำสั่ง `!` แบบโต้ตอบ
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — การเชื่อมต่อสำหรับสตรีม/อัปเดตการเสร็จสมบูรณ์ UI คำสั่ง `!` แบบโต้ตอบ
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — พื้นผิวคำสั่ง RPC `bash` และ `abort_bash`
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — การ resolve `artifact://<id>`
