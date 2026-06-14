---
title: Bash Tool Runtime
description: >-
  Bash tool runtime พร้อมการจัดการกระบวนการ shell, sandboxing, timeout,
  และการสตรีมเอาต์พุต
sidebar:
  order: 1
  label: เครื่องมือ Bash
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bash tool runtime

เอกสารนี้อธิบายเส้นทาง runtime ของ **`bash` tool** ที่ใช้โดยการเรียกใช้ agent tool ตั้งแต่การ normalization คำสั่ง ไปจนถึงการดำเนินการ, การตัดทอน/artifacts, และการเรนเดอร์

นอกจากนี้ยังระบุจุดที่พฤติกรรมแตกต่างกันในโหมด interactive TUI, print mode, RPC mode, และการรันคำสั่ง shell ด้วย bang (`!`) ที่ผู้ใช้เริ่มต้น

## ขอบเขตและพื้นผิว runtime

มีพื้นผิวการรัน bash สองแบบที่แตกต่างกันใน coding-agent:

1. **พื้นผิว tool-call** (`toolName: "bash"`): ใช้เมื่อ model เรียกใช้ bash tool
   - Entry point: `BashTool.execute()`
2. **พื้นผิว user bang-command** (`!cmd` จาก interactive input หรือ RPC `bash` command): เส้นทาง helper ระดับ session
   - Entry point: `AgentSession.executeBash()`

ทั้งสองในที่สุดใช้ `executeBash()` ใน `src/exec/bash-executor.ts` สำหรับการรันแบบ non-PTY แต่เฉพาะเส้นทาง tool-call เท่านั้นที่รัน normalization/interception และ logic ของ tool renderer

## pipeline tool-call แบบ end-to-end

## 1) การ normalization input และการผสาน parameter

`BashTool.execute()` ทำการ normalize คำสั่งดิบก่อนผ่าน `normalizeBashCommand()`:

- แยก `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` ที่ต่อท้ายออกมาเป็น structured limits,
- ตัด whitespace ที่ต่อท้าย/นำหน้า,
- คง whitespace ภายในไว้ตามเดิม

จากนั้นผสาน extracted limits กับ explicit tool args:

- explicit `head`/`tail` args จะ override ค่าที่ถูกแยกออกมา,
- ค่าที่แยกออกมาใช้เป็น fallback เท่านั้น

### ข้อควรระวัง

คอมเมนต์ใน `bash-normalize.ts` กล่าวถึงการลบ `2>&1` แต่การ implementation ปัจจุบันไม่ได้ลบออก พฤติกรรม runtime ยังคงถูกต้อง (stdout/stderr ถูกรวมเข้าด้วยกันแล้ว) แต่พฤติกรรมการ normalization แคบกว่าที่คอมเมนต์ระบุ

## 2) Interception แบบเลือกได้ (เส้นทาง blocked-command)

หาก `bashInterceptor.enabled` เป็น true, `BashTool` จะโหลด rules จาก settings และรัน `checkBashInterception()` กับคำสั่งที่ถูก normalize แล้ว

พฤติกรรม Interception:

- คำสั่งจะถูกบล็อก **เฉพาะเมื่อ**:
  - regex rule ตรงกัน และ
  - suggested tool ปรากฏใน `ctx.toolNames`
- invalid regex rules จะถูกข้ามอย่างเงียบๆ
- เมื่อถูกบล็อก, `BashTool` จะ throw `ToolError` พร้อมข้อความ:
  - `Blocked: ...`
  - รวมคำสั่งต้นฉบับ

รูปแบบ rule เริ่มต้น (กำหนดในโค้ด) กำหนดเป้าหมายการใช้งานที่ผิดปกติทั่วไป:

- file readers (`cat`, `head`, `tail`, ...)
- search tools (`grep`, `rg`, ...)
- file finders (`find`, `fd`, ...)
- in-place editors (`sed -i`, `perl -i`, `awk -i inplace`)
- shell redirection writes (`echo ... > file`, heredoc redirection)

### ข้อควรระวัง

`InterceptionResult` รวม `suggestedTool` แต่ `BashTool` ปัจจุบันแสดงเฉพาะข้อความ (ไม่มี structured suggested-tool field ใน `details`)

## 3) การตรวจสอบ CWD และการ clamp timeout

`cwd` ถูก resolve relative กับ session cwd (`resolveToCwd`) จากนั้นตรวจสอบผ่าน `stat`:

- path ที่ไม่มีอยู่ -> `ToolError("Working directory does not exist: ...")`
- ไม่ใช่ directory -> `ToolError("Working directory is not a directory: ...")`

Timeout ถูก clamp เป็น `[1, 3600]` วินาที และแปลงเป็นมิลลิวินาที

## 4) การจัดสรร Artifact

ก่อนการรัน tool จะจัดสรร artifact path/id (แบบ best-effort) สำหรับการเก็บเอาต์พุตที่ถูกตัดทอน

- การจัดสรร artifact ที่ล้มเหลวไม่ถือเป็น fatal (การรันดำเนินต่อโดยไม่มี artifact spill file),
- artifact id/path ถูกส่งเข้าไปในเส้นทางการรันสำหรับการคงเอาต์พุตแบบเต็มเมื่อมีการตัดทอน

## 5) การเลือก PTY vs non-PTY

`BashTool` เลือกการรันแบบ PTY เฉพาะเมื่อเงื่อนไขทั้งหมดเป็นจริง:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- tool context มี UI (`ctx.hasUI === true` และ `ctx.ui` ถูกตั้งค่า)

มิฉะนั้นจะใช้ `executeBash()` แบบ non-interactive

นั่นหมายความว่า print mode และ non-UI RPC/tool contexts จะใช้ non-PTY เสมอ

## engine การรัน non-interactive (`executeBash`)

## โมเดลการนำ shell session กลับมาใช้ใหม่

`executeBash()` cache instance ของ native `Shell` ใน process-global map โดยใช้ key จาก:

- shell path,
- configured command prefix,
- snapshot path,
- serialized shell env,
- optional agent session key

สำหรับการรันระดับ session, `AgentSession.executeBash()` ส่ง `sessionKey: this.sessionId` เพื่อแยก reuse ต่อ session

เส้นทาง tool-call **ไม่** ส่ง `sessionKey` ดังนั้น reuse scope จะอิงตาม shell config/snapshot/env

## พฤติกรรม shell config และ snapshot

ในแต่ละ call, executor โหลด settings shell config (`shell`, `env`, optional `prefix`)

หาก selected shell รวม `bash`, จะพยายาม `getOrCreateSnapshot()`:

- snapshot จับ aliases/functions/options จาก user rc,
- การสร้าง snapshot เป็นแบบ best-effort,
- เมื่อล้มเหลวจะ fallback เป็นไม่มี snapshot

หากมีการกำหนด `prefix`, คำสั่งจะกลายเป็น:

```text
<prefix> <command>
```

## การสตรีมและการยกเลิก

`Shell.run()` สตรีม chunks ไปยัง callback. Executor ส่ง chunk แต่ละอันเข้า `OutputSink` และ optional `onChunk` callback

การยกเลิก:

- สัญญาณที่ถูก abort จะ trigger `shellSession.abort(...)`,
- timeout จาก native result ถูกแมปเป็น `cancelled: true` + annotation text,
- การยกเลิกอย่างชัดแจ้งก็คืนค่า `cancelled: true` + annotation เช่นกัน

ไม่มีการ throw exception ภายใน executor สำหรับ timeout/cancel แต่จะคืนค่า structured `BashResult` และให้ผู้เรียกแมป error semantics

## เส้นทาง PTY แบบ interactive (`runInteractiveBashPty`)

เมื่อ PTY เปิดใช้งาน, tool จะรัน `runInteractiveBashPty()` ซึ่งเปิด overlay console component และขับเคลื่อน native `PtySession`

ไฮไลท์พฤติกรรม:

- xterm-headless virtual terminal เรนเดอร์ viewport ใน overlay,
- keyboard input ถูก normalize (รวมถึง Kitty sequences และการจัดการ application cursor mode),
- `esc` ขณะรันจะ kill PTY session,
- terminal resize ถูกส่งต่อไปยัง PTY (`session.resize(cols, rows)`)

Environment hardening defaults ถูกฉีดสำหรับการรันแบบ unattended:

- pagers ถูกปิดใช้งาน (`PAGER=cat`, `GIT_PAGER=cat`, ฯลฯ),
- editor prompts ถูกปิดใช้งาน (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- terminal/auth prompts ลดลง (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- package-manager/tool automation flags สำหรับพฤติกรรม non-interactive

เอาต์พุต PTY ถูก normalize (`CRLF`/`CR` เป็น `LF`, `sanitizeText`) และเขียนเข้า `OutputSink` รวมถึงรองรับ artifact spill

เมื่อเกิดข้อผิดพลาดขณะเริ่มต้น/runtime ของ PTY, sink จะรับบรรทัด `PTY error: ...` และคำสั่งจะสิ้นสุดพร้อม exit code ที่ไม่ได้กำหนด

## การจัดการเอาต์พุต: การสตรีม, การตัดทอน, artifact spill

ทั้งเส้นทาง PTY และ non-PTY ใช้ `OutputSink`

## Semantics ของ OutputSink

- เก็บ in-memory UTF-8-safe tail buffer (`DEFAULT_MAX_BYTES`, ปัจจุบัน 50KB),
- ติดตาม total bytes/lines ที่เห็น,
- หาก artifact path มีอยู่และเอาต์พุต overflow (หรือไฟล์ active อยู่แล้ว), เขียน full stream ไปยัง artifact file,
- เมื่อ memory threshold overflow, ตัด in-memory buffer เป็น tail (ปลอดภัยต่อ UTF-8 boundary),
- ทำเครื่องหมาย `truncated` เมื่อ overflow/file spill เกิดขึ้น

`dump()` คืนค่า:

- `output` (อาจมี annotated prefix),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` หาก artifact file ใช้งานอยู่

### ข้อควรระวัง Long-output

Runtime truncation อิงตาม byte-threshold ใน `OutputSink` (default 50KB) ไม่มีการบังคับ hard cap 2000 บรรทัดในเส้นทางโค้ดนี้

## Live tool updates

สำหรับการรันแบบ non-PTY, `BashTool` ใช้ `TailBuffer` แยกต่างหากสำหรับ partial updates และ emit `onUpdate` snapshots ขณะที่คำสั่งกำลังรัน

สำหรับการรันแบบ PTY, live rendering ถูกจัดการโดย custom UI overlay ไม่ใช่โดย `onUpdate` text chunks

## การจัดรูปแบบผลลัพธ์, metadata, และการแมป error

หลังการรัน:

1. การจัดการ `cancelled`:
   - หาก abort signal ถูก abort -> throw `ToolAbortError` (abort semantics),
   - มิฉะนั้น -> throw `ToolError` (ถือว่าเป็น tool failure)
2. PTY `timedOut` -> throw `ToolError`
3. ใช้ head/tail filters กับ output text สุดท้าย (`applyHeadTail`, head ก่อน tail)
4. เอาต์พุตว่างกลายเป็น `(no output)`
5. แนบ truncation metadata ผ่าน `toolResult(...).truncationFromSummary(result, { direction: "tail" })`
6. การแมป exit-code:
   - ไม่มี exit code -> `ToolError("... missing exit status")`
   - exit ที่ไม่ใช่ศูนย์ -> `ToolError("... Command exited with code N")`
   - exit เป็นศูนย์ -> success result

โครงสร้าง success payload:

- `content`: text output,
- `details.meta.truncation` เมื่อถูกตัดทอน รวมถึง:
  - `direction`, `truncatedBy`, total/output line+byte counts,
  - `shownRange`,
  - `artifactId` เมื่อมี

เนื่องจาก built-in tools ถูก wrap ด้วย `wrapToolWithMetaNotice()`, truncation notice text จะถูกผนวกต่อท้าย final text content โดยอัตโนมัติ (ตัวอย่าง: `Full: artifact://<id>`)

## เส้นทาง Rendering

## Tool-call renderer (`bashToolRenderer`)

`bashToolRenderer` ใช้สำหรับ tool-call messages (`toolCall` / `toolResult`):

- collapsed mode แสดง visual-line-truncated preview,
- expanded mode แสดงเอาต์พุตทั้งหมดที่มีอยู่ในปัจจุบัน,
- warning line รวม truncation reason และ `artifact://<id>` เมื่อถูกตัดทอน,
- ค่า timeout (จาก args) แสดงใน footer metadata line

### ข้อควรระวัง: full artifact expansion

`BashRenderContext` มี `isFullOutput` แต่ current renderer context builder ไม่ได้ตั้งค่าสำหรับ bash tool results ปัจจุบัน expanded view ยังคงใช้ text ที่อยู่ใน result content แล้ว (tail/truncated output) เว้นแต่ผู้เรียกอื่นจะให้ full artifact content

## User bang-command component (`BashExecutionComponent`)

`BashExecutionComponent` ใช้สำหรับคำสั่ง `!` ของผู้ใช้ในโหมด interactive (ไม่ใช่ model tool calls):

- สตรีม chunks แบบ live,
- collapsed preview เก็บ 20 logical lines สุดท้าย,
- line clamp ที่ 4000 chars ต่อบรรทัด,
- แสดง truncation + artifact warnings เมื่อ metadata มีอยู่,
- ทำเครื่องหมาย cancelled/error/exit state แยกกัน

Component นี้ถูก wire โดย `CommandController.handleBashCommand()` และรับข้อมูลจาก `AgentSession.executeBash()`

## ความแตกต่างพฤติกรรมตามโหมด

| พื้นผิว                              | เส้นทาง entry                                         | PTY eligible                                                         | Live output UX                                                               | การแสดง error                                         |
| ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Interactive tool call                | `BashTool.execute`                                    | ใช่, เมื่อ `bash.virtualTerminal=on` และ UI มีอยู่ และ `PI_NO_PTY!=1` | PTY overlay (interactive) หรือ streamed tail updates                         | Tool errors กลายเป็น `toolResult.isError`             |
| Print mode tool call                 | `BashTool.execute`                                    | ไม่ (ไม่มี UI context)                                               | ไม่มี TUI overlay; เอาต์พุตปรากฏใน event stream/final assistant text flow   | การแมป tool error เหมือนกัน                           |
| RPC tool call (agent tooling)        | `BashTool.execute`                                    | โดยปกติไม่มี UI -> non-PTY                                           | Structured tool events/results                                               | การแมป tool error เหมือนกัน                           |
| Interactive bang command (`!`)       | `AgentSession.executeBash` + `BashExecutionComponent` | ไม่ (ใช้ executor โดยตรง)                                            | Dedicated bash execution component                                           | Controller จับ exceptions และแสดง UI error            |
| RPC `bash` command                   | `rpc-mode` -> `session.executeBash`                   | ไม่                                                                  | คืนค่า `BashResult` โดยตรง                                                  | Consumer จัดการ returned fields                       |

## ข้อควรระวังในการปฏิบัติงาน

- Interceptor บล็อกคำสั่งเฉพาะเมื่อ suggested tool มีอยู่ใน context ในปัจจุบัน
- หากการจัดสรร artifact ล้มเหลว การตัดทอนยังคงเกิดขึ้นแต่ไม่มี `artifact://` back-reference ให้ใช้
- Shell session cache ไม่มีการ eviction อย่างชัดแจ้งในโมดูลนี้ อายุการใช้งานถูกกำหนดขอบเขตตาม process
- PTY และ non-PTY timeout surfaces แตกต่างกัน:
  - PTY เปิดเผย `timedOut` result field อย่างชัดแจ้ง,
  - non-PTY แมป timeout เป็น `cancelled + annotation` summary

## ไฟล์ implementation

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — tool entrypoint, normalization/interception, การเลือก PTY/non-PTY, result/error mapping, bash tool renderer
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — command normalization และ post-run head/tail filtering
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — interceptor rule matching และ blocked-command messages
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — non-PTY executor, shell session reuse, cancellation wiring, output sink integration
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY runtime, overlay UI, input normalization, non-interactive env defaults
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` truncation/artifact spill และ summary metadata
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — artifact allocation helpers และ streaming tail buffer
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — truncation metadata shape + notice injection wrapper
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — session-level `executeBash`, message recording, abort lifecycle
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — interactive `!` command execution component
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — wiring สำหรับ interactive `!` command UI stream/update completion
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC `bash` และ `abort_bash` command surface
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>` resolution
