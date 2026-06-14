---
title: รันไทม์ Bash Tool
description: >-
  รันไทม์ Bash tool พร้อมการจัดการกระบวนการ shell, การจำกัดสภาพแวดล้อม, timeout
  และการสตรีมผลลัพธ์
sidebar:
  order: 1
  label: Bash tool
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# รันไทม์ Bash tool

เอกสารนี้อธิบายเส้นทางรันไทม์ของ **`bash` tool** ที่ใช้โดยการเรียก agent tool ตั้งแต่การ normalize คำสั่งไปจนถึงการประมวลผล การตัดทอน/artifacts และการแสดงผล

นอกจากนี้ยังระบุจุดที่พฤติกรรมแตกต่างกันในโหมด TUI แบบโต้ตอบ, print mode, RPC mode และการรัน shell ด้วยเครื่องหมาย bang (`!`) ที่ผู้ใช้เริ่มต้นเอง

## ขอบเขตและพื้นผิวรันไทม์

มีพื้นผิวการประมวลผล bash สองแบบที่แตกต่างกันใน coding-agent:

1. **พื้นผิว Tool-call** (`toolName: "bash"`): ใช้เมื่อโมเดลเรียก bash tool
   - จุดเข้า: `BashTool.execute()`
2. **พื้นผิวคำสั่ง User bang** (`!cmd` จากอินพุตแบบโต้ตอบหรือคำสั่ง RPC `bash`): เส้นทาง helper ระดับ session
   - จุดเข้า: `AgentSession.executeBash()`

ทั้งสองเส้นทางในที่สุดใช้ `executeBash()` ใน `src/exec/bash-executor.ts` สำหรับการประมวลผลแบบ non-PTY แต่เฉพาะเส้นทาง tool-call เท่านั้นที่รันตรรกะ normalization/interception และ tool renderer

## ไปป์ไลน์ tool-call แบบ end-to-end

## 1) การ normalize อินพุตและการรวมพารามิเตอร์

`BashTool.execute()` ทำการ normalize คำสั่งดิบก่อนผ่าน `normalizeBashCommand()`:

- ดึง `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` ที่ท้ายคำสั่งออกเป็น limit แบบมีโครงสร้าง
- ตัด whitespace ส่วนหน้าและส่วนท้าย
- คง whitespace ภายในไว้ครบถ้วน

จากนั้นรวม limit ที่ดึงออกมากับ tool args ที่ระบุไว้ชัดเจน:

- args `head`/`tail` ที่ระบุชัดเจนจะ override ค่าที่ดึงออกมา
- ค่าที่ดึงออกมาใช้เป็น fallback เท่านั้น

### ข้อควรระวัง

คอมเมนต์ใน `bash-normalize.ts` กล่าวถึงการลบ `2>&1` แต่การ implement ปัจจุบันไม่ได้ลบออก พฤติกรรมรันไทม์ยังคงถูกต้อง (stdout/stderr ถูกรวมไว้แล้ว) แต่พฤติกรรม normalization แคบกว่าที่คอมเมนต์บอกไว้

## 2) การสกัดกั้นเสริม (เส้นทางคำสั่งที่ถูกบล็อก)

หาก `bashInterceptor.enabled` เป็น true, `BashTool` จะโหลดกฎจาก settings และรัน `checkBashInterception()` กับคำสั่งที่ normalize แล้ว

พฤติกรรมการสกัดกั้น:

- คำสั่งถูกบล็อก **เฉพาะ** เมื่อ:
  - กฎ regex ตรงกัน และ
  - tool ที่แนะนำมีอยู่ใน `ctx.toolNames`
- กฎ regex ที่ไม่ถูกต้องจะถูกข้ามอย่างเงียบ ๆ
- เมื่อถูกบล็อก `BashTool` จะ throw `ToolError` พร้อมข้อความ:
  - `Blocked: ...`
  - รวมคำสั่งต้นฉบับ

รูปแบบกฎเริ่มต้น (กำหนดในโค้ด) กำหนดเป้าหมายการใช้งานผิดวัตถุประสงค์ทั่วไป:

- ตัวอ่านไฟล์ (`cat`, `head`, `tail`, ...)
- เครื่องมือค้นหา (`grep`, `rg`, ...)
- ตัวค้นหาไฟล์ (`find`, `fd`, ...)
- โปรแกรมแก้ไขแบบ in-place (`sed -i`, `perl -i`, `awk -i inplace`)
- การเขียนด้วย shell redirection (`echo ... > file`, heredoc redirection)

### ข้อควรระวัง

`InterceptionResult` รวม `suggestedTool` ไว้ แต่ปัจจุบัน `BashTool` แสดงเฉพาะข้อความ (ไม่มี field suggested-tool แบบมีโครงสร้างใน `details`)

## 3) การตรวจสอบ CWD และการ clamp timeout

`cwd` ถูก resolve โดยอ้างอิงจาก session cwd (`resolveToCwd`) จากนั้นตรวจสอบผ่าน `stat`:

- path ไม่มีอยู่ -> `ToolError("Working directory does not exist: ...")`
- ไม่ใช่ไดเรกทอรี -> `ToolError("Working directory is not a directory: ...")`

Timeout ถูก clamp ไว้ที่ `[1, 3600]` วินาที และแปลงเป็นมิลลิวินาที

## 4) การจัดสรร artifact

ก่อนการประมวลผล tool จะจัดสรร artifact path/id (best-effort) สำหรับจัดเก็บผลลัพธ์ที่ถูกตัดทอน

- การจัดสรร artifact ที่ล้มเหลวไม่ถือเป็น fatal (การประมวลผลดำเนินต่อไปโดยไม่มีไฟล์ spill ของ artifact)
- artifact id/path ถูกส่งเข้าไปในเส้นทางการประมวลผลสำหรับการบันทึกผลลัพธ์เต็มรูปแบบเมื่อมีการตัดทอน

## 5) การเลือกการประมวลผลแบบ PTY กับ non-PTY

`BashTool` เลือกการประมวลผลแบบ PTY เฉพาะเมื่อเป็นจริงทั้งหมด:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- context ของ tool มี UI (`ctx.hasUI === true` และ `ctx.ui` ถูกตั้งค่า)

มิฉะนั้นจะใช้ `executeBash()` แบบ non-interactive

ซึ่งหมายความว่า print mode และ RPC/tool contexts แบบ non-UI จะใช้ non-PTY เสมอ

## เอนจินการประมวลผลแบบ non-interactive (`executeBash`)

## โมเดลการนำ shell session กลับมาใช้ใหม่

`executeBash()` cache instance `Shell` แบบ native ไว้ใน map ระดับ process-global โดย key จาก:

- shell path
- command prefix ที่กำหนดค่าไว้
- snapshot path
- shell env ที่ serialize แล้ว
- agent session key เสริม

สำหรับการประมวลผลระดับ session, `AgentSession.executeBash()` ส่ง `sessionKey: this.sessionId` เพื่อแยก reuse ต่อ session

เส้นทาง tool-call **ไม่** ส่ง `sessionKey` ดังนั้นขอบเขต reuse จะอิงจาก shell config/snapshot/env

## พฤติกรรม shell config และ snapshot

ในแต่ละการเรียก executor จะโหลด settings shell config (`shell`, `env`, optional `prefix`)

หาก shell ที่เลือกรวม `bash` ไว้ จะพยายาม `getOrCreateSnapshot()`:

- snapshot จะ capture aliases/functions/options จาก user rc
- การสร้าง snapshot เป็นแบบ best-effort
- หากล้มเหลวจะ fallback เป็นไม่มี snapshot

หาก `prefix` ถูกกำหนดค่าไว้ คำสั่งจะกลายเป็น:

```text
<prefix> <command>
```

## การสตรีมและการยกเลิก

`Shell.run()` สตรีม chunk ไปยัง callback Executor ส่ง chunk แต่ละอันเข้า `OutputSink` และ callback `onChunk` เสริม

การยกเลิก:

- signal ที่ถูก abort จะ trigger `shellSession.abort(...)`
- timeout จากผลลัพธ์ native จะถูก map ไปเป็น `cancelled: true` + ข้อความ annotation
- การยกเลิกที่ชัดเจนจะ return `cancelled: true` + annotation เช่นกัน

ไม่มีการ throw exception ภายใน executor สำหรับ timeout/cancel แต่จะ return `BashResult` แบบมีโครงสร้างและให้ caller map ความหมายของข้อผิดพลาด

## เส้นทาง PTY แบบโต้ตอบ (`runInteractiveBashPty`)

เมื่อเปิดใช้งาน PTY tool จะรัน `runInteractiveBashPty()` ซึ่งเปิด overlay console component และขับเคลื่อน `PtySession` แบบ native

จุดเด่นของพฤติกรรม:

- virtual terminal xterm-headless แสดงผล viewport ใน overlay
- อินพุตจากแป้นพิมพ์ถูก normalize (รวมถึง Kitty sequences และการจัดการ application cursor mode)
- `esc` ขณะรันอยู่จะ kill PTY session
- การปรับขนาด terminal จะ propagate ไปยัง PTY (`session.resize(cols, rows)`)

ค่าเริ่มต้น hardening ของสภาพแวดล้อมถูก inject สำหรับการรันแบบ unattended:

- ปิดใช้งาน pager (`PAGER=cat`, `GIT_PAGER=cat`, ฯลฯ)
- ปิดใช้งาน editor prompts (`GIT_EDITOR=true`, `EDITOR=true`, ...)
- ลด terminal/auth prompts (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`)
- flag automation ของ package-manager/tool สำหรับพฤติกรรม non-interactive

ผลลัพธ์ PTY ถูก normalize (`CRLF`/`CR` เป็น `LF`, `sanitizeText`) และเขียนลงใน `OutputSink` รวมถึงรองรับ artifact spill

เมื่อเกิดข้อผิดพลาดในการเริ่มต้น/รันไทม์ของ PTY sink จะได้รับบรรทัด `PTY error: ...` และคำสั่งจะสิ้นสุดด้วย exit code ที่ไม่ได้กำหนด

## การจัดการผลลัพธ์: การสตรีม การตัดทอน artifact spill

ทั้งเส้นทาง PTY และ non-PTY ใช้ `OutputSink`

## ความหมายของ OutputSink

- เก็บ tail buffer แบบ UTF-8-safe ไว้ในหน่วยความจำ (`DEFAULT_MAX_BYTES` ปัจจุบัน 50KB)
- ติดตาม total bytes/lines ที่เห็น
- หาก artifact path มีอยู่และผลลัพธ์ overflow (หรือไฟล์ active อยู่แล้ว) จะเขียน stream เต็มรูปแบบไปยังไฟล์ artifact
- เมื่อ memory threshold overflow จะ trim in-memory buffer เป็น tail (safe ต่อ UTF-8 boundary)
- ทำเครื่องหมาย `truncated` เมื่อเกิด overflow/file spill

`dump()` return:

- `output` (มี prefix annotation ที่เป็นไปได้)
- `truncated`
- `totalLines/totalBytes`
- `outputLines/outputBytes`
- `artifactId` หากไฟล์ artifact active อยู่

### ข้อควรระวังสำหรับผลลัพธ์ที่ยาว

การตัดทอนรันไทม์อ้างอิงจาก byte-threshold ใน `OutputSink` (ค่าเริ่มต้น 50KB) ไม่ได้บังคับใช้ hard cap 2000 บรรทัดในเส้นทางโค้ดนี้

## การอัปเดต tool แบบ live

สำหรับการประมวลผลแบบ non-PTY, `BashTool` ใช้ `TailBuffer` แยกต่างหากสำหรับการอัปเดตบางส่วนและส่ง snapshot `onUpdate` ขณะที่คำสั่งกำลังรัน

สำหรับการประมวลผลแบบ PTY การแสดงผลแบบ live จะถูกจัดการโดย UI overlay แบบ custom ไม่ใช่ผ่าน text chunk ของ `onUpdate`

## การกำหนดรูปร่างผลลัพธ์ metadata และการ map ข้อผิดพลาด

หลังการประมวลผล:

1. การจัดการ `cancelled`:
   - หาก abort signal ถูก abort -> throw `ToolAbortError` (ความหมาย abort)
   - มิฉะนั้น -> throw `ToolError` (ถือเป็น tool failure)
2. PTY `timedOut` -> throw `ToolError`
3. ใช้ head/tail filter กับข้อความผลลัพธ์สุดท้าย (`applyHeadTail`, head ก่อน tail)
4. ผลลัพธ์ว่างเปล่ากลายเป็น `(no output)`
5. แนบ truncation metadata ผ่าน `toolResult(...).truncationFromSummary(result, { direction: "tail" })`
6. การ map exit-code:
   - ไม่มี exit code -> `ToolError("... missing exit status")`
   - exit ไม่เป็น zero -> `ToolError("... Command exited with code N")`
   - exit เป็น zero -> ผลลัพธ์ success

โครงสร้าง payload ของ success:

- `content`: ข้อความผลลัพธ์
- `details.meta.truncation` เมื่อถูกตัดทอน รวมถึง:
  - `direction`, `truncatedBy`, total/output line+byte counts
  - `shownRange`
  - `artifactId` เมื่อมี

เนื่องจาก built-in tool ถูก wrap ด้วย `wrapToolWithMetaNotice()` ข้อความแจ้งเตือนการตัดทอนจะถูกเพิ่มต่อท้ายเนื้อหาข้อความสุดท้ายโดยอัตโนมัติ (เช่น: `Full: artifact://<id>`)

## เส้นทางการแสดงผล

## Tool-call renderer (`bashToolRenderer`)

`bashToolRenderer` ใช้สำหรับข้อความ tool-call (`toolCall` / `toolResult`):

- โหมด collapsed แสดง preview แบบตัดทอน visual-line
- โหมด expanded แสดงข้อความผลลัพธ์ที่มีอยู่ทั้งหมดในขณะนั้น
- บรรทัด warning รวม truncation reason และ `artifact://<id>` เมื่อถูกตัดทอน
- ค่า timeout (จาก args) แสดงในบรรทัด metadata ที่ footer

### ข้อควรระวัง: การขยาย artifact เต็มรูปแบบ

`BashRenderContext` มี `isFullOutput` แต่ context builder ของ renderer ปัจจุบันไม่ได้ตั้งค่าสำหรับผลลัพธ์ bash tool expanded view ยังคงใช้ข้อความที่มีอยู่แล้วใน result content (tail/truncated output) เว้นแต่ caller อื่นจะให้เนื้อหา artifact เต็มรูปแบบ

## User bang-command component (`BashExecutionComponent`)

`BashExecutionComponent` ใช้สำหรับคำสั่ง `!` ของผู้ใช้ในโหมดโต้ตอบ (ไม่ใช่การเรียก tool ของโมเดล):

- สตรีม chunk แบบ live
- preview แบบ collapsed เก็บ 20 logical line ล่าสุด
- จำกัดบรรทัดที่ 4000 ตัวอักษรต่อบรรทัด
- แสดงคำเตือน truncation + artifact เมื่อมี metadata
- ทำเครื่องหมาย cancelled/error/exit state แยกต่างหาก

Component นี้ถูกเชื่อมโดย `CommandController.handleBashCommand()` และได้รับข้อมูลจาก `AgentSession.executeBash()`

## ความแตกต่างของพฤติกรรมตามโหมด

| พื้นผิว                        | เส้นทางเข้า                                           | มีสิทธิ์ใช้ PTY                                                      | UX ผลลัพธ์แบบ live                                                       | การแสดงข้อผิดพลาด                               |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Tool call แบบโต้ตอบ            | `BashTool.execute`                                    | ใช่ เมื่อ `bash.virtualTerminal=on` และมี UI และ `PI_NO_PTY!=1`     | PTY overlay (โต้ตอบ) หรือ streamed tail updates                         | Tool error กลายเป็น `toolResult.isError`         |
| Tool call แบบ print mode       | `BashTool.execute`                                    | ไม่ (ไม่มี UI context)                                               | ไม่มี TUI overlay; ผลลัพธ์ปรากฏใน event stream/final assistant text flow | การ map tool error เหมือนเดิม                    |
| RPC tool call (agent tooling)  | `BashTool.execute`                                    | โดยปกติไม่มี UI -> non-PTY                                          | Structured tool events/results                                           | การ map tool error เหมือนเดิม                    |
| คำสั่ง bang แบบโต้ตอบ (`!`)   | `AgentSession.executeBash` + `BashExecutionComponent` | ไม่ (ใช้ executor โดยตรง)                                            | Dedicated bash execution component                                       | Controller catch exceptions และแสดง UI error     |
| คำสั่ง RPC `bash`              | `rpc-mode` -> `session.executeBash`                   | ไม่                                                                  | Return `BashResult` โดยตรง                                              | Consumer จัดการ field ที่ return มา             |

## ข้อควรระวังในการดำเนินการ

- Interceptor บล็อกคำสั่งเฉพาะเมื่อ tool ที่แนะนำมีอยู่ใน context ในขณะนั้น
- หากการจัดสรร artifact ล้มเหลว การตัดทอนยังคงเกิดขึ้นแต่ไม่มี back-reference `artifact://` ที่ใช้ได้
- Shell session cache ไม่มีการ eviction ที่ชัดเจนในโมดูลนี้ อายุการใช้งานถูกกำหนดในระดับ process
- PTY และ non-PTY มีพื้นผิว timeout ที่แตกต่างกัน:
  - PTY แสดง field ผลลัพธ์ `timedOut` ที่ชัดเจน
  - non-PTY map timeout เป็น `cancelled + annotation` summary

## ไฟล์การ implement

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — จุดเข้า tool, normalization/interception, การเลือก PTY/non-PTY, การ map result/error, bash tool renderer
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — การ normalize คำสั่งและการกรอง head/tail หลังรัน
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — การ matching กฎ interceptor และข้อความคำสั่งที่ถูกบล็อก
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — executor แบบ non-PTY, การนำ shell session กลับมาใช้ใหม่, การเชื่อมต่อการยกเลิก, การ integrate output sink
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY runtime, overlay UI, การ normalize อินพุต, ค่าเริ่มต้น env แบบ non-interactive
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` truncation/artifact spill และ summary metadata
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — helpers การจัดสรร artifact และ streaming tail buffer
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — รูปร่าง truncation metadata + wrapper การ inject notice
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` ระดับ session, การบันทึกข้อความ, วงจร abort
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — component การประมวลผลคำสั่ง `!` แบบโต้ตอบ
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — การเชื่อมต่อ UI stream/update completion ของคำสั่ง `!` แบบโต้ตอบ
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — พื้นผิวคำสั่ง RPC `bash` และ `abort_bash`
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — การ resolve `artifact://<id>`
