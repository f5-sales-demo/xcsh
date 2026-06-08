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

# Bash tool runtime

เอกสารนี้อธิบายเส้นทางรันไทม์ของ **เครื่องมือ `bash`** ที่ใช้โดย agent tool calls ตั้งแต่การทำให้คำสั่งเป็นมาตรฐาน (normalization) ไปจนถึงการประมวลผล การตัดทอน/artifacts และการแสดงผล

นอกจากนี้ยังระบุจุดที่พฤติกรรมแตกต่างกันในโหมด TUI แบบโต้ตอบ โหมด print โหมด RPC และการประมวลผล shell แบบ bang (`!`) ที่ผู้ใช้เป็นผู้เริ่ม

## ขอบเขตและ runtime surfaces

มี bash execution surfaces สองแบบที่แตกต่างกันใน coding-agent:

1. **Tool-call surface** (`toolName: "bash"`): ใช้เมื่อโมเดลเรียกใช้เครื่องมือ bash
   - จุดเริ่มต้น: `BashTool.execute()`
2. **User bang-command surface** (`!cmd` จาก interactive input หรือคำสั่ง RPC `bash`): เส้นทางตัวช่วยระดับ session
   - จุดเริ่มต้น: `AgentSession.executeBash()`

ทั้งสองใช้ `executeBash()` ใน `src/exec/bash-executor.ts` สำหรับการประมวลผลแบบ non-PTY ในท้ายที่สุด แต่เฉพาะเส้นทาง tool-call เท่านั้นที่รันตรรกะ normalization/interception และ tool renderer

## ไปป์ไลน์ tool-call แบบ end-to-end

## 1) การทำให้อินพุตเป็นมาตรฐานและการรวมพารามิเตอร์

`BashTool.execute()` จะทำให้คำสั่งดิบเป็นมาตรฐานก่อนผ่าน `normalizeBashCommand()`:

- แยก `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` ที่ต่อท้ายออกเป็นขีดจำกัดแบบมีโครงสร้าง
- ตัดช่องว่างต่อท้าย/นำหน้าออก
- คงช่องว่างภายในไว้ตามเดิม

จากนั้นรวมขีดจำกัดที่แยกออกมาเข้ากับ tool args ที่ระบุอย่างชัดเจน:

- args `head`/`tail` ที่ระบุอย่างชัดเจนจะแทนที่ค่าที่แยกออกมา
- ค่าที่แยกออกมาเป็นเพียง fallback เท่านั้น

### ข้อควรระวัง

คอมเมนต์ใน `bash-normalize.ts` กล่าวถึงการตัด `2>&1` ออก แต่การ implement ปัจจุบันไม่ได้ลบมันออก พฤติกรรมรันไทม์ยังคงถูกต้อง (stdout/stderr ถูกรวมเข้าด้วยกันอยู่แล้ว) แต่พฤติกรรม normalization แคบกว่าที่คอมเมนต์ระบุ

## 2) การดักจับเพิ่มเติม (เส้นทางคำสั่งที่ถูกบล็อก)

หาก `bashInterceptor.enabled` เป็น true `BashTool` จะโหลดกฎจากการตั้งค่าและรัน `checkBashInterception()` กับคำสั่งที่ผ่านการ normalize แล้ว

พฤติกรรมการดักจับ:

- คำสั่งจะถูกบล็อก **เฉพาะเมื่อ**:
  - กฎ regex ตรงกัน และ
  - เครื่องมือที่แนะนำมีอยู่ใน `ctx.toolNames`
- กฎ regex ที่ไม่ถูกต้องจะถูกข้ามไปอย่างเงียบ ๆ
- เมื่อถูกบล็อก `BashTool` จะ throw `ToolError` พร้อมข้อความ:
  - `Blocked: ...`
  - รวมคำสั่งต้นฉบับ

รูปแบบกฎเริ่มต้น (ที่กำหนดในโค้ด) มุ่งเป้าไปที่การใช้งานผิดที่พบบ่อย:

- ตัวอ่านไฟล์ (`cat`, `head`, `tail`, ...)
- เครื่องมือค้นหา (`grep`, `rg`, ...)
- ตัวค้นหาไฟล์ (`find`, `fd`, ...)
- ตัวแก้ไขแบบ in-place (`sed -i`, `perl -i`, `awk -i inplace`)
- การเขียนด้วย shell redirection (`echo ... > file`, heredoc redirection)

### ข้อควรระวัง

`InterceptionResult` มี `suggestedTool` แต่ `BashTool` ปัจจุบันแสดงเฉพาะข้อความ (ไม่มีฟิลด์ suggested-tool แบบมีโครงสร้างใน `details`)

## 3) การตรวจสอบ CWD และการจำกัด timeout

`cwd` จะถูก resolve เทียบกับ session cwd (`resolveToCwd`) จากนั้นตรวจสอบผ่าน `stat`:

- ไม่พบเส้นทาง -> `ToolError("Working directory does not exist: ...")`
- ไม่ใช่ไดเรกทอรี -> `ToolError("Working directory is not a directory: ...")`

Timeout ถูกจำกัดอยู่ในช่วง `[1, 3600]` วินาที และแปลงเป็นมิลลิวินาที

## 4) การจัดสรร Artifact

ก่อนการประมวลผล เครื่องมือจะจัดสรร artifact path/id (แบบ best-effort) สำหรับการจัดเก็บเอาต์พุตที่ถูกตัดทอน

- การจัดสรร artifact ที่ล้มเหลวไม่ใช่ข้อผิดพลาดร้ายแรง (การประมวลผลดำเนินต่อโดยไม่มีไฟล์ artifact spill)
- artifact id/path จะถูกส่งเข้าไปในเส้นทางการประมวลผลเพื่อเก็บเอาต์พุตเต็มเมื่อเกิดการตัดทอน

## 5) การเลือกการประมวลผลแบบ PTY vs non-PTY

`BashTool` จะเลือกการประมวลผลแบบ PTY เฉพาะเมื่อเงื่อนไขทั้งหมดเป็นจริง:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- tool context มี UI (`ctx.hasUI === true` และ `ctx.ui` ถูกตั้งค่า)

มิฉะนั้นจะใช้ `executeBash()` แบบ non-interactive

นั่นหมายความว่า print mode และ non-UI RPC/tool contexts จะใช้ non-PTY เสมอ

## เอนจินประมวลผลแบบ non-interactive (`executeBash`)

## โมเดลการนำ shell session กลับมาใช้ซ้ำ

`executeBash()` แคชอินสแตนซ์ `Shell` ดั้งเดิมไว้ในแมประดับกระบวนการ โดยมีคีย์จาก:

- shell path
- command prefix ที่กำหนดค่าไว้
- snapshot path
- shell env ที่ถูก serialize แล้ว
- agent session key เพิ่มเติม (ถ้ามี)

สำหรับการประมวลผลระดับ session `AgentSession.executeBash()` จะส่ง `sessionKey: this.sessionId` เพื่อแยกการใช้ซ้ำต่อ session

เส้นทาง tool-call **ไม่** ส่ง `sessionKey` ดังนั้นขอบเขตการใช้ซ้ำจึงขึ้นอยู่กับ shell config/snapshot/env

## การกำหนดค่า shell และพฤติกรรม snapshot

ในแต่ละการเรียก executor จะโหลดการกำหนดค่า shell จากการตั้งค่า (`shell`, `env`, `prefix` เพิ่มเติม)

หาก shell ที่เลือกมี `bash` จะพยายาม `getOrCreateSnapshot()`:

- snapshot จับ aliases/functions/options จาก user rc
- การสร้าง snapshot เป็นแบบ best-effort
- ความล้มเหลวจะ fallback เป็นไม่มี snapshot

หากกำหนดค่า `prefix` ไว้ คำสั่งจะกลายเป็น:

```text
<prefix> <command>
```

## การสตรีมและการยกเลิก

`Shell.run()` สตรีม chunks ไปยัง callback executor ส่ง chunk แต่ละตัวเข้าสู่ `OutputSink` และ `onChunk` callback เพิ่มเติม

การยกเลิก:

- สัญญาณ aborted จะทริกเกอร์ `shellSession.abort(...)`
- timeout จากผลลัพธ์ดั้งเดิมจะถูกแมปเป็น `cancelled: true` + ข้อความ annotation
- การยกเลิกอย่างชัดเจนจะคืน `cancelled: true` + annotation เช่นเดียวกัน

ไม่มีการ throw exception ภายใน executor สำหรับ timeout/cancel; มันคืน `BashResult` แบบมีโครงสร้างและปล่อยให้ผู้เรียกแมป error semantics

## เส้นทาง PTY แบบโต้ตอบ (`runInteractiveBashPty`)

เมื่อเปิดใช้งาน PTY เครื่องมือจะรัน `runInteractiveBashPty()` ซึ่งเปิดคอมโพเนนต์ overlay console และขับเคลื่อน `PtySession` ดั้งเดิม

จุดเด่นของพฤติกรรม:

- xterm-headless virtual terminal แสดง viewport ใน overlay
- อินพุตแป้นพิมพ์ถูก normalize (รวมถึงการจัดการ Kitty sequences และ application cursor mode)
- `esc` ขณะทำงานจะ kill PTY session
- การปรับขนาด terminal ถูกส่งต่อไปยัง PTY (`session.resize(cols, rows)`)

ค่าเริ่มต้น environment hardening ถูกฉีดเข้าไปสำหรับการรันแบบ unattended:

- ปิดการใช้งาน pagers (`PAGER=cat`, `GIT_PAGER=cat`, ฯลฯ)
- ปิดการใช้งาน editor prompts (`GIT_EDITOR=true`, `EDITOR=true`, ...)
- ลด terminal/auth prompts (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`)
- แฟล็ก automation ของ package-manager/tool สำหรับพฤติกรรมแบบ non-interactive

เอาต์พุต PTY ถูก normalize (`CRLF`/`CR` เป็น `LF`, `sanitizeText`) และเขียนลงใน `OutputSink` รวมถึงรองรับ artifact spill

เมื่อเกิดข้อผิดพลาด PTY startup/runtime sink จะได้รับบรรทัด `PTY error: ...` และคำสั่งจะจบลงด้วย exit code เป็น undefined

## การจัดการเอาต์พุต: การสตรีม การตัดทอน artifact spill

ทั้งเส้นทาง PTY และ non-PTY ใช้ `OutputSink`

## ความหมายของ OutputSink

- เก็บ tail buffer แบบ UTF-8-safe ในหน่วยความจำ (`DEFAULT_MAX_BYTES`, ปัจจุบัน 50KB)
- ติดตาม bytes/lines ทั้งหมดที่เห็น
- หากมี artifact path อยู่และเอาต์พุตล้น (หรือไฟล์ถูกเปิดใช้งานอยู่แล้ว) จะเขียนสตรีมเต็มลงไฟล์ artifact
- เมื่อเกินขีดจำกัดหน่วยความจำ จะตัด buffer ในหน่วยความจำเป็น tail (ปลอดภัยตามขอบเขต UTF-8)
- ทำเครื่องหมาย `truncated` เมื่อเกิดการล้น/file spill

`dump()` คืนค่า:

- `output` (อาจมี prefix หมายเหตุ)
- `truncated`
- `totalLines/totalBytes`
- `outputLines/outputBytes`
- `artifactId` หากไฟล์ artifact ถูกเปิดใช้งาน

### ข้อควรระวังเรื่องเอาต์พุตยาว

การตัดทอนรันไทม์เป็นแบบ byte-threshold ใน `OutputSink` (ค่าเริ่มต้น 50KB) มันไม่ได้บังคับขีดจำกัด 2000 บรรทัดแบบตายตัวในเส้นทางโค้ดนี้

## การอัปเดตเครื่องมือแบบสด

สำหรับการประมวลผลแบบ non-PTY `BashTool` ใช้ `TailBuffer` แยกต่างหากสำหรับการอัปเดตบางส่วน และส่ง `onUpdate` snapshots ขณะที่คำสั่งกำลังทำงาน

สำหรับการประมวลผลแบบ PTY การแสดงผลแบบสดจะถูกจัดการโดย custom UI overlay ไม่ใช่โดย `onUpdate` text chunks

## การกำหนดรูปร่างผลลัพธ์ เมตาดาตา และการแมปข้อผิดพลาด

หลังการประมวลผล:

1. การจัดการ `cancelled`:
   - หากสัญญาณ abort ถูก aborted -> throw `ToolAbortError` (abort semantics)
   - มิฉะนั้น -> throw `ToolError` (ถือเป็น tool failure)
2. PTY `timedOut` -> throw `ToolError`
3. ใช้ตัวกรอง head/tail กับข้อความเอาต์พุตสุดท้าย (`applyHeadTail`, head ก่อนแล้วตามด้วย tail)
4. เอาต์พุตว่างจะกลายเป็น `(no output)`
5. แนบเมตาดาตาการตัดทอนผ่าน `toolResult(...).truncationFromSummary(result, { direction: "tail" })`
6. การแมป exit-code:
   - ไม่มี exit code -> `ToolError("... missing exit status")`
   - exit ไม่ใช่ศูนย์ -> `ToolError("... Command exited with code N")`
   - exit เป็นศูนย์ -> ผลลัพธ์สำเร็จ

โครงสร้าง payload สำเร็จ:

- `content`: ข้อความเอาต์พุต
- `details.meta.truncation` เมื่อถูกตัดทอน รวมถึง:
  - `direction`, `truncatedBy`, จำนวน total/output line+byte
  - `shownRange`
  - `artifactId` เมื่อมี

เนื่องจาก built-in tools ถูกห่อด้วย `wrapToolWithMetaNotice()` ข้อความแจ้งเตือนการตัดทอนจะถูกต่อท้าย text content สุดท้ายโดยอัตโนมัติ (เช่น: `Full: artifact://<id>`)

## เส้นทางการแสดงผล

## Tool-call renderer (`bashToolRenderer`)

`bashToolRenderer` ใช้สำหรับข้อความ tool-call (`toolCall` / `toolResult`):

- โหมดย่อแสดงตัวอย่างที่ถูกตัดทอนตาม visual-line
- โหมดขยายแสดงข้อความเอาต์พุตทั้งหมดที่มีอยู่ในปัจจุบัน
- บรรทัดคำเตือนรวมเหตุผลการตัดทอนและ `artifact://<id>` เมื่อถูกตัดทอน
- ค่า timeout (จาก args) แสดงในบรรทัดเมตาดาตาส่วนท้าย

### ข้อควรระวัง: การขยาย artifact เต็ม

`BashRenderContext` มี `isFullOutput` แต่ตัวสร้าง renderer context ปัจจุบันไม่ได้ตั้งค่าสำหรับผลลัพธ์เครื่องมือ bash มุมมองแบบขยายยังคงใช้ข้อความที่อยู่ใน result content แล้ว (เอาต์พุต tail/ที่ถูกตัดทอน) เว้นแต่ผู้เรียกอื่นจะให้เนื้อหา artifact เต็ม

## คอมโพเนนต์คำสั่ง bang ของผู้ใช้ (`BashExecutionComponent`)

`BashExecutionComponent` ใช้สำหรับคำสั่ง `!` ของผู้ใช้ในโหมดโต้ตอบ (ไม่ใช่ model tool calls):

- สตรีม chunks แบบสด
- ตัวอย่างแบบย่อเก็บ 20 บรรทัดตรรกะล่าสุด
- จำกัดบรรทัดที่ 4000 ตัวอักษรต่อบรรทัด
- แสดงคำเตือนการตัดทอน + artifact เมื่อมีเมตาดาตา
- ทำเครื่องหมายสถานะ cancelled/error/exit แยกกัน

คอมโพเนนต์นี้ถูกเชื่อมต่อโดย `CommandController.handleBashCommand()` และรับข้อมูลจาก `AgentSession.executeBash()`

## ความแตกต่างของพฤติกรรมตามโหมด

| Surface                        | เส้นทางเข้า                                          | สามารถใช้ PTY ได้                                                    | UX เอาต์พุตแบบสด                                                        | การแสดงข้อผิดพลาด                               |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Interactive tool call          | `BashTool.execute`                                    | ได้ เมื่อ `bash.virtualTerminal=on` และมี UI และ `PI_NO_PTY!=1`     | PTY overlay (โต้ตอบ) หรือ streamed tail updates                         | Tool errors กลายเป็น `toolResult.isError`        |
| Print mode tool call           | `BashTool.execute`                                    | ไม่ (ไม่มี UI context)                                              | ไม่มี TUI overlay; เอาต์พุตปรากฏใน event stream/final assistant text flow | การแมป tool error เหมือนกัน                      |
| RPC tool call (agent tooling)  | `BashTool.execute`                                    | มักจะไม่มี UI -> non-PTY                                            | Structured tool events/results                                           | การแมป tool error เหมือนกัน                      |
| Interactive bang command (`!`) | `AgentSession.executeBash` + `BashExecutionComponent` | ไม่ (ใช้ executor โดยตรง)                                           | คอมโพเนนต์ bash execution เฉพาะ                                        | Controller จับ exceptions และแสดงข้อผิดพลาดใน UI |
| RPC `bash` command             | `rpc-mode` -> `session.executeBash`                   | ไม่                                                                  | คืน `BashResult` โดยตรง                                                 | ผู้ใช้จัดการฟิลด์ที่คืนมาเอง                    |

## ข้อควรระวังในการดำเนินงาน

- Interceptor จะบล็อกคำสั่งเฉพาะเมื่อเครื่องมือที่แนะนำมีอยู่ใน context ปัจจุบัน
- หากการจัดสรร artifact ล้มเหลว การตัดทอนยังคงเกิดขึ้นแต่ไม่มีการอ้างอิงกลับ `artifact://`
- แคช shell session ไม่มีการขับออก (eviction) อย่างชัดเจนในโมดูลนี้; อายุการใช้งานอยู่ในระดับกระบวนการ
- PTY และ non-PTY timeout surfaces แตกต่างกัน:
  - PTY แสดงฟิลด์ผลลัพธ์ `timedOut` อย่างชัดเจน
  - non-PTY แมป timeout เป็น `cancelled + annotation` summary

## ไฟล์การ implement

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — จุดเริ่มต้นของเครื่องมือ, normalization/interception, การเลือก PTY/non-PTY, การแมปผลลัพธ์/ข้อผิดพลาด, bash tool renderer
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — การ normalize คำสั่งและการกรอง head/tail หลังการรัน
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — การจับคู่กฎ interceptor และข้อความคำสั่งที่ถูกบล็อก
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — non-PTY executor, การนำ shell session กลับมาใช้ซ้ำ, การเชื่อมต่อการยกเลิก, การรวม output sink
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY runtime, overlay UI, การ normalize อินพุต, ค่าเริ่มต้น env แบบ non-interactive
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — การตัดทอน/artifact spill ของ `OutputSink` และเมตาดาตาสรุป
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — ตัวช่วยการจัดสรร artifact และ streaming tail buffer
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — รูปร่างเมตาดาตาการตัดทอน + wrapper การฉีดข้อความแจ้งเตือน
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` ระดับ session, การบันทึกข้อความ, วงจรชีวิต abort
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — คอมโพเนนต์การประมวลผลคำสั่ง `!` แบบโต้ตอบ
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — การเชื่อมต่อสำหรับ UI stream/update completion ของคำสั่ง `!` แบบโต้ตอบ
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — surface คำสั่ง RPC `bash` และ `abort_bash`
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — การ resolve `artifact://<id>`
