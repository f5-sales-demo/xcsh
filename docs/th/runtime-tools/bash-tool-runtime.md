---
title: Bash Tool Runtime
description: >-
  Bash tool runtime พร้อมการจัดการกระบวนการ shell, การแซนด์บ็อกซ์, การหมดเวลา,
  และการสตรีมเอาต์พุต
sidebar:
  order: 1
  label: Bash tool
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bash tool runtime

เอกสารนี้อธิบายเส้นทาง runtime ของ **`bash` tool** ที่ใช้โดย agent tool calls ตั้งแต่การ normalize คำสั่งจนถึงการดำเนินการ, การตัดทอน/artifacts, และการแสดงผล

นอกจากนี้ยังระบุจุดที่พฤติกรรมแตกต่างกันใน interactive TUI, print mode, RPC mode, และการดำเนินการ shell แบบ bang (`!`) ที่ผู้ใช้เริ่มต้นเอง

## ขอบเขตและพื้นผิว runtime

มีพื้นผิวการดำเนินการ bash สองแบบที่แตกต่างกันใน coding-agent:

1. **พื้นผิว tool-call** (`toolName: "bash"`): ใช้เมื่อ model เรียก bash tool
   - จุดเริ่มต้น: `BashTool.execute()`
2. **พื้นผิว user bang-command** (`!cmd` จาก interactive input หรือ RPC `bash` command): เส้นทาง helper ระดับ session
   - จุดเริ่มต้น: `AgentSession.executeBash()`

ทั้งสองเส้นทางในท้ายที่สุดใช้ `executeBash()` ใน `src/exec/bash-executor.ts` สำหรับการดำเนินการแบบ non-PTY แต่เฉพาะเส้นทาง tool-call เท่านั้นที่รัน normalization/interception และ logic ของ tool renderer

## End-to-end tool-call pipeline

## 1) การ normalize input และการรวม parameter

`BashTool.execute()` normalize คำสั่งดิบก่อนผ่าน `normalizeBashCommand()`:

- ดึง `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` ที่ต่อท้ายออกมาเป็น structured limits,
- ตัด whitespace ที่ส่วนหัวและส่วนท้ายออก,
- คงสภาพ whitespace ภายในไว้

จากนั้นรวม extracted limits กับ explicit tool args:

- explicit `head`/`tail` args แทนที่ค่าที่ดึงออกมา,
- ค่าที่ดึงออกมาใช้เป็น fallback เท่านั้น

### ข้อควรระวัง

comment ใน `bash-normalize.ts` ระบุถึงการตัด `2>&1` ออก แต่ implementation ปัจจุบันไม่ได้ลบออก พฤติกรรม runtime ยังคงถูกต้อง (stdout/stderr ถูกรวมไว้แล้ว) แต่พฤติกรรม normalization แคบกว่าที่ comment ระบุไว้

## 2) Optional interception (เส้นทาง blocked-command)

หาก `bashInterceptor.enabled` เป็น true, `BashTool` จะโหลด rules จาก settings และรัน `checkBashInterception()` กับคำสั่งที่ normalize แล้ว

พฤติกรรม interception:

- คำสั่งจะถูกบล็อก **เฉพาะ** เมื่อ:
  - regex rule ตรงกัน และ
  - tool ที่แนะนำมีอยู่ใน `ctx.toolNames`
- invalid regex rules จะถูกข้ามไปโดยไม่แสดงข้อผิดพลาด
- เมื่อถูกบล็อก, `BashTool` จะ throw `ToolError` พร้อมข้อความ:
  - `Blocked: ...`
  - รวมคำสั่งเดิมด้วย

รูปแบบ rule เริ่มต้น (กำหนดในโค้ด) มุ่งเป้าหมายที่การใช้งานผิดที่พบบ่อย:

- file readers (`cat`, `head`, `tail`, ...)
- search tools (`grep`, `rg`, ...)
- file finders (`find`, `fd`, ...)
- in-place editors (`sed -i`, `perl -i`, `awk -i inplace`)
- shell redirection writes (`echo ... > file`, heredoc redirection)

### ข้อควรระวัง

`InterceptionResult` มี `suggestedTool` แต่ `BashTool` ปัจจุบันแสดงเพียงข้อความ message เท่านั้น (ไม่มี structured suggested-tool field ใน `details`)

## 3) การตรวจสอบ CWD และการจำกัด timeout

`cwd` จะถูก resolve ตาม session cwd (`resolveToCwd`) จากนั้นตรวจสอบผ่าน `stat`:

- path ที่ไม่มีอยู่ -> `ToolError("Working directory does not exist: ...")`
- ไม่ใช่ directory -> `ToolError("Working directory is not a directory: ...")`

Timeout ถูกจำกัดไว้ที่ `[1, 3600]` วินาที และแปลงเป็น milliseconds

## 4) การจัดสรร artifact

ก่อนการดำเนินการ tool จะจัดสรร artifact path/id (best-effort) สำหรับการจัดเก็บเอาต์พุตที่ถูกตัดทอน

- การจัดสรร artifact ที่ล้มเหลวไม่ถือว่าร้ายแรง (การดำเนินการจะดำเนินต่อไปโดยไม่มี artifact spill file),
- artifact id/path จะถูกส่งต่อไปยังเส้นทางการดำเนินการสำหรับการเก็บข้อมูลเต็มรูปแบบเมื่อถูกตัดทอน

## 5) การเลือกใช้ PTY หรือ non-PTY

`BashTool` จะเลือกใช้ PTY execution เมื่อเงื่อนไขทั้งหมดเป็นจริง:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- tool context มี UI (`ctx.hasUI === true` และ `ctx.ui` ถูกกำหนด)

มิฉะนั้นจะใช้ `executeBash()` แบบ non-interactive

ซึ่งหมายความว่า print mode และ non-UI RPC/tool contexts จะใช้ non-PTY เสมอ

## Non-interactive execution engine (`executeBash`)

## โมเดลการนำ shell session กลับมาใช้ใหม่

`executeBash()` cache instance `Shell` แบบ native ใน process-global map โดยใช้ key จาก:

- shell path,
- configured command prefix,
- snapshot path,
- serialized shell env,
- optional agent session key

สำหรับการดำเนินการระดับ session, `AgentSession.executeBash()` จะส่ง `sessionKey: this.sessionId` เพื่อแยกการนำกลับมาใช้ใหม่ต่อ session

เส้นทาง tool-call **ไม่ได้** ส่ง `sessionKey` ดังนั้นขอบเขตการนำกลับมาใช้ใหม่จะอิงตาม shell config/snapshot/env

## พฤติกรรม shell config และ snapshot

ในแต่ละการเรียก executor จะโหลด shell config ของ settings (`shell`, `env`, optional `prefix`)

หาก shell ที่เลือกรวม `bash` ไว้ด้วย จะพยายาม `getOrCreateSnapshot()`:

- snapshot จะ capture aliases/functions/options จาก user rc,
- การสร้าง snapshot เป็น best-effort,
- หากล้มเหลวจะ fallback ไปใช้แบบไม่มี snapshot

หากกำหนด `prefix` ไว้ คำสั่งจะกลายเป็น:

```text
<prefix> <command>
```

## Streaming และการยกเลิก

`Shell.run()` stream chunks ไปยัง callback Executor จะส่งต่อแต่ละ chunk ไปยัง `OutputSink` และ optional `onChunk` callback

การยกเลิก:

- abort signal จะ trigger `shellSession.abort(...)`,
- timeout จาก native result จะถูก map เป็น `cancelled: true` + annotation text,
- การยกเลิกอย่างชัดเจนจะ return `cancelled: true` + annotation เช่นกัน

ไม่มีการ throw exception ภายใน executor สำหรับ timeout/cancel; จะ return `BashResult` แบบ structured และปล่อยให้ caller จัดการ error semantics

## เส้นทาง interactive PTY (`runInteractiveBashPty`)

เมื่อเปิดใช้งาน PTY, tool จะรัน `runInteractiveBashPty()` ซึ่งเปิด overlay console component และขับเคลื่อน `PtySession` แบบ native

ลักษณะพฤติกรรม:

- xterm-headless virtual terminal แสดงผล viewport ใน overlay,
- keyboard input ถูก normalize (รวมถึง Kitty sequences และการจัดการ application cursor mode),
- `esc` ขณะรันจะ kill PTY session,
- terminal resize จะส่งต่อไปยัง PTY (`session.resize(cols, rows)`)

มีการ inject environment hardening defaults สำหรับ unattended runs:

- pagers ถูกปิดใช้งาน (`PAGER=cat`, `GIT_PAGER=cat`, ฯลฯ),
- editor prompts ถูกปิดใช้งาน (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- terminal/auth prompts ถูกลดลง (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- package-manager/tool automation flags สำหรับพฤติกรรม non-interactive

PTY output ถูก normalize (`CRLF`/`CR` เป็น `LF`, `sanitizeText`) และเขียนลงใน `OutputSink` รวมถึงรองรับ artifact spill

เมื่อเกิดข้อผิดพลาดในการเริ่มต้น/runtime ของ PTY, sink จะได้รับบรรทัด `PTY error: ...` และคำสั่งจะสิ้นสุดโดยไม่มี exit code

## การจัดการเอาต์พุต: streaming, การตัดทอน, artifact spill

ทั้งเส้นทาง PTY และ non-PTY ใช้ `OutputSink`

## Semantics ของ OutputSink

- เก็บ tail buffer แบบ in-memory ที่ปลอดภัยสำหรับ UTF-8 (`DEFAULT_MAX_BYTES`, ปัจจุบัน 50KB),
- ติดตาม total bytes/lines ที่เห็น,
- หาก artifact path มีอยู่และเอาต์พุต overflow (หรือ file active อยู่แล้ว) จะเขียน full stream ไปยัง artifact file,
- เมื่อ memory threshold overflow จะตัด in-memory buffer เหลือเฉพาะส่วนท้าย (ปลอดภัยสำหรับ UTF-8 boundary),
- ทำเครื่องหมาย `truncated` เมื่อเกิด overflow/file spill

`dump()` คืนค่า:

- `output` (อาจมี annotated prefix),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` หาก artifact file ทำงานอยู่

### ข้อควรระวังสำหรับ long-output

Runtime truncation อิงตาม byte-threshold ใน `OutputSink` (ค่าเริ่มต้น 50KB) ไม่มีการบังคับใช้ hard cap ที่ 2000 บรรทัดในเส้นทาง code นี้

## Live tool updates

สำหรับ non-PTY execution, `BashTool` ใช้ `TailBuffer` แยกต่างหากสำหรับ partial updates และ emit `onUpdate` snapshots ขณะที่คำสั่งกำลังรัน

สำหรับ PTY execution การแสดงผลสดจะจัดการโดย custom UI overlay ไม่ใช่โดย `onUpdate` text chunks

## Result shaping, metadata, และการ map error

หลังการดำเนินการ:

1. การจัดการ `cancelled`:
   - หาก abort signal ถูก abort -> throw `ToolAbortError` (abort semantics),
   - มิฉะนั้น -> throw `ToolError` (ถือเป็น tool failure)
2. PTY `timedOut` -> throw `ToolError`
3. apply head/tail filters กับ final output text (`applyHeadTail`, head แล้วตาม tail)
4. เอาต์พุตว่างเปล่าจะกลายเป็น `(no output)`
5. attach truncation metadata ผ่าน `toolResult(...).truncationFromSummary(result, { direction: "tail" })`
6. exit-code mapping:
   - ไม่มี exit code -> `ToolError("... missing exit status")`
   - exit ที่ไม่ใช่ศูนย์ -> `ToolError("... Command exited with code N")`
   - exit เป็นศูนย์ -> success result

โครงสร้าง success payload:

- `content`: text output,
- `details.meta.truncation` เมื่อถูกตัดทอน รวมถึง:
  - `direction`, `truncatedBy`, total/output line+byte counts,
  - `shownRange`,
  - `artifactId` เมื่อมี

เนื่องจาก built-in tools ถูก wrap ด้วย `wrapToolWithMetaNotice()` ข้อความแจ้ง truncation จึงถูก append ไปยัง final text content โดยอัตโนมัติ (เช่น: `Full: artifact://<id>`)

## เส้นทางการแสดงผล

## Tool-call renderer (`bashToolRenderer`)

`bashToolRenderer` ใช้สำหรับ tool-call messages (`toolCall` / `toolResult`):

- collapsed mode แสดง visual-line-truncated preview,
- expanded mode แสดง output text ที่มีอยู่ทั้งหมดในขณะนั้น,
- warning line รวม truncation reason และ `artifact://<id>` เมื่อถูกตัดทอน,
- timeout value (จาก args) แสดงใน footer metadata line

### ข้อควรระวัง: การขยาย full artifact

`BashRenderContext` มี `isFullOutput` แต่ context builder ของ renderer ปัจจุบันไม่ได้กำหนดค่านี้สำหรับ bash tool results expanded view ยังคงใช้ text ที่อยู่ใน result content แล้ว (tail/truncated output) เว้นแต่ผู้เรียกอื่นจะให้ full artifact content

## User bang-command component (`BashExecutionComponent`)

`BashExecutionComponent` ใช้สำหรับ `!` commands ของผู้ใช้ใน interactive mode (ไม่ใช่ model tool calls):

- stream chunks แบบ live,
- collapsed preview เก็บ 20 logical lines ล่าสุด,
- line clamp ที่ 4000 chars ต่อบรรทัด,
- แสดง truncation + artifact warnings เมื่อมี metadata,
- ทำเครื่องหมาย cancelled/error/exit state แยกกัน

component นี้ถูก wire โดย `CommandController.handleBashCommand()` และรับข้อมูลจาก `AgentSession.executeBash()`

## ความแตกต่างของพฤติกรรมตาม mode

| พื้นผิว | เส้นทาง entry | PTY eligible | Live output UX | การแสดง error |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Interactive tool call | `BashTool.execute` | ใช่ เมื่อ `bash.virtualTerminal=on` และมี UI และ `PI_NO_PTY!=1` | PTY overlay (interactive) หรือ streamed tail updates | Tool errors กลายเป็น `toolResult.isError` |
| Print mode tool call | `BashTool.execute` | ไม่ (ไม่มี UI context) | ไม่มี TUI overlay; เอาต์พุตปรากฏใน event stream/final assistant text flow | การ map tool error เหมือนเดิม |
| RPC tool call (agent tooling) | `BashTool.execute` | มักไม่มี UI -> non-PTY | Structured tool events/results | การ map tool error เหมือนเดิม |
| Interactive bang command (`!`) | `AgentSession.executeBash` + `BashExecutionComponent` | ไม่ (ใช้ executor โดยตรง) | Dedicated bash execution component | Controller catch exceptions และแสดง UI error |
| RPC `bash` command | `rpc-mode` -> `session.executeBash` | ไม่ | Return `BashResult` โดยตรง | Consumer จัดการ returned fields |

## ข้อควรระวังในการปฏิบัติงาน

- Interceptor จะบล็อกคำสั่งเฉพาะเมื่อ suggested tool มีอยู่ใน context ในขณะนั้น
- หากการจัดสรร artifact ล้มเหลว การตัดทอนยังคงเกิดขึ้น แต่ไม่มี `artifact://` back-reference
- Shell session cache ไม่มีการ eviction อย่างชัดเจนในโมดูลนี้; lifetime อยู่ในระดับ process
- พื้นผิว timeout ของ PTY และ non-PTY แตกต่างกัน:
  - PTY แสดง `timedOut` result field อย่างชัดเจน,
  - non-PTY map timeout เป็น `cancelled + annotation` summary

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
