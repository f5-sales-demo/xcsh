---
title: การทำงานภายในของ Provider Streaming
description: >-
  การนำ provider streaming ไปใช้งาน พร้อมการแยกวิเคราะห์ SSE การนับโทเค็น
  และการจัดการ backpressure
sidebar:
  order: 2
  label: การทำงานภายในของ Streaming
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# การทำงานภายในของ Provider Streaming

เอกสารนี้อธิบายว่า token/tool streaming ถูกทำให้เป็นมาตรฐานอย่างไรใน `@f5xc-salesdemos/pi-ai` จากนั้นจึงถูกส่งต่อผ่าน `@f5xc-salesdemos/pi-agent-core` และ session events ของ coding-agent

## ขั้นตอนการทำงานแบบ End-to-End

1. `streamSimple()` (`packages/ai/src/stream.ts`) แมปตัวเลือกทั่วไปและส่งต่อไปยัง provider stream function
2. Provider stream functions (`anthropic.ts`, `openai-responses.ts`, `google.ts`) แปลง stream events ที่เป็นของ provider นั้น ๆ ให้เป็นลำดับ `AssistantMessageEvent` แบบรวมศูนย์
3. แต่ละ provider จะส่ง events เข้าสู่ `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) ซึ่งจะควบคุมอัตรา delta events และเปิดเผย:
   - async iteration สำหรับการอัปเดตแบบเพิ่มทีละน้อย
   - `result()` สำหรับ `AssistantMessage` ขั้นสุดท้าย
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) รับ events เหล่านั้น แก้ไขสถานะ assistant ที่กำลังดำเนินการ และส่ง events `message_update` ที่บรรจุ `assistantMessageEvent` ดิบ
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) สมัครรับ agent events บันทึกข้อความ ขับเคลื่อน extension hooks และใช้ session behaviors (retry, compaction, TTSR, streaming-edit abort checks)

## สัญญา Stream แบบรวมศูนย์ใน `@f5xc-salesdemos/pi-ai`

ทุก provider ส่ง events ในรูปแบบเดียวกัน (`AssistantMessageEvent` ใน `packages/ai/src/types.ts`):

- `start`
- ชุดสามของ content block lifecycle:
  - text: `text_start` → `text_delta`* → `text_end`
  - thinking: `thinking_start` → `thinking_delta`* → `thinking_end`
  - tool call: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- terminal event:
  - `done` พร้อม `reason: "stop" | "length" | "toolUse"`
  - หรือ `error` พร้อม `reason: "aborted" | "error"`

`AssistantMessageEventStream` รับประกัน:

- ผลลัพธ์สุดท้ายถูก resolve โดย terminal event (`done` หรือ `error`)
- deltas ถูกรวมกลุ่ม/ควบคุมอัตรา (~50ms)
- deltas ที่บัฟเฟอร์ไว้จะถูก flush ก่อน non-delta events และก่อนการเสร็จสิ้น

## พฤติกรรมการควบคุมอัตรา Delta และการทำให้สอดคล้องกัน

`AssistantMessageEventStream` จัดการ `text_delta`, `thinking_delta`, และ `toolcall_delta` เป็น events ที่สามารถรวมได้:

- buffered deltas จะถูกรวมเฉพาะเมื่อ **type + contentIndex** ตรงกัน
- การรวมจะเก็บ snapshot `partial` ล่าสุดไว้
- non-delta events บังคับให้ flush ทันที

ซึ่งช่วยให้ provider streams ที่มีความถี่สูงทำงานได้ราบรื่นขึ้นสำหรับ TUI/event consumers แต่ไม่ใช่ backpressure ของ provider: providers ยังคงผลิตข้อมูลด้วยความเร็วเต็มที่ ในขณะที่ local stream ทำการบัฟเฟอร์

## รายละเอียดการทำให้เป็นมาตรฐานของ Provider

## Anthropic (`anthropic-messages`)

แหล่งที่มา: `packages/ai/src/providers/anthropic.ts`

จุดการทำให้เป็นมาตรฐาน:

- `message_start` เริ่มต้นการใช้งาน (input/output/cache tokens)
- `content_block_start` แมปไปยัง text/thinking/toolcall starts
- `content_block_delta` แมป:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` อัปเดต `thinkingSignature` เท่านั้น (ไม่มี event)
- `content_block_stop` ส่ง `*_end` ที่สอดคล้องกัน
- `message_delta.stop_reason` แมปผ่าน `mapStopReason()`

การ streaming ของ Tool-call argument:

- แต่ละ tool block บรรจุ `partialJson` ภายใน
- ทุก JSON delta ต่อท้ายเข้าใน `partialJson`
- `arguments` ถูก parse ใหม่ในทุก delta ผ่าน `parseStreamingJson()`
- `toolcall_end` parse อีกครั้งหนึ่ง จากนั้นลบ `partialJson` ออก

## OpenAI Responses (`openai-responses`)

แหล่งที่มา: `packages/ai/src/providers/openai-responses.ts`

จุดการทำให้เป็นมาตรฐาน:

- `response.output_item.added` เริ่ม reasoning/text/function-call blocks
- reasoning summary events (`response.reasoning_summary_text.delta`) กลายเป็น `thinking_delta`
- output/refusal deltas กลายเป็น `text_delta`
- `response.function_call_arguments.delta` กลายเป็น `toolcall_delta`
- `response.output_item.done` ส่ง `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` แมป status ไปยัง stop reason และ usage

การ streaming ของ Tool-call argument:

- รูปแบบการสะสม `partialJson` เหมือนกับ Anthropic
- providers ที่ส่งเฉพาะ `response.function_call_arguments.done` ยังคง populate args สุดท้าย
- tool call IDs ถูกทำให้เป็นมาตรฐานเป็น `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

แหล่งที่มา: `packages/ai/src/providers/google.ts`

จุดการทำให้เป็นมาตรฐาน:

- วนซ้ำ `candidate.content.parts`
- text parts ถูกแบ่งเป็น thinking กับ text โดย `isThinkingPart(part)`
- การเปลี่ยน block จะปิด block ก่อนหน้าก่อนเริ่ม block ใหม่
- `part.functionCall` ถูกจัดการเป็น tool call สมบูรณ์ (start/delta/end ส่งทันที)
- finish reason แมปโดย `mapStopReason()` จาก `google-shared.ts`

การ streaming ของ Tool-call argument:

- function call args มาถึงเป็น structured object ไม่ใช่ incremental JSON text
- การนำไปใช้งานส่ง `toolcall_delta` สังเคราะห์หนึ่งรายการที่บรรจุ `JSON.stringify(arguments)`
- ไม่ต้องการ partial JSON parser สำหรับ Google ในเส้นทางนี้

## การสะสมและการกู้คืน partial tool-call JSON

พฤติกรรมที่ใช้ร่วมกันสำหรับ Anthropic/OpenAI Responses ใช้ `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. ลอง `JSON.parse`
2. fallback ไปยัง `partial-json` parser สำหรับ fragments ที่ไม่สมบูรณ์
3. ถ้าทั้งคู่ล้มเหลว คืนค่า `{}`

ผลที่ตามมา:

- argument deltas ที่ผิดรูปแบบหรือถูกตัดทอนจะไม่ทำให้การประมวลผล stream หยุดทำงานทันที
- `arguments` ที่กำลังดำเนินการอาจเป็น `{}` ชั่วคราว
- deltas ที่ถูกต้องในภายหลังสามารถกู้คืน structured arguments ได้เนื่องจากการ parse ถูกลองใหม่ทุกครั้งที่ต่อท้าย
- `toolcall_end` สุดท้ายลอง parse อีกครั้งก่อนการส่ง

## Stop reasons เทียบกับ transport/runtime errors

Provider stop reasons ถูกแมปไปยัง `stopReason` แบบมาตรฐาน:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, กรณี safety/refusal→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, กลุ่ม safety/prohibited/malformed-function-call→`error`

ความหมายของ Error แบ่งออกเป็นสองขั้นตอน:

1. **ความหมาย Model completion** (finish reason/status ที่ provider รายงาน)
2. **Transport/runtime failure** (network/client/parser/abort exceptions)

ถ้า provider stream ส่ง exception หรือส่งสัญญาณความล้มเหลว แต่ละ provider wrapper จะจับและส่ง terminal `error` event ที่มี:

- `stopReason = "aborted"` เมื่อ abort signal ถูกตั้งค่า
- มิฉะนั้น `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## พฤติกรรมเมื่อ chunk/SSE parse ล้มเหลว

สำหรับเส้นทาง provider เหล่านี้ การจัดการ chunk/SSE framing ดำเนินการโดย vendor SDK streams (Anthropic SDK, OpenAI SDK, Google SDK) โค้ดนี้ไม่ได้นำ SSE decoder แบบกำหนดเองมาใช้

พฤติกรรมที่พบในการนำไปใช้งานปัจจุบัน:

- การ parse chunk/SSE ที่ผิดรูปแบบในระดับ SDK จะปรากฏเป็น exception หรือ stream `error` event
- provider wrapper แปลงสิ่งนั้นเป็น unified terminal `error` event
- ไม่มีการ resume/retry เฉพาะ provider ภายใน stream function เอง
- retry ระดับสูงกว่าจัดการใน `AgentSession` auto-retry logic (message-level retry ไม่ใช่ stream-chunk replay)

## ขอบเขตการยกเลิก

การยกเลิกถูกแบ่งเป็นชั้น:

- คำร้องขอ AI provider: `options.signal` ถูกส่งเข้าไปใน provider client stream call
- Provider wrapper: หลังจาก stream loop สัญญาณ aborted บังคับให้ใช้เส้นทาง error (`"Request was aborted"`)
- Agent loop: ตรวจสอบ `signal.aborted` ก่อนจัดการ provider event แต่ละรายการ และสามารถสังเคราะห์ aborted assistant message จาก partial ล่าสุด
- Session/agent controls: `AgentSession.abort()` -> `agent.abort()` -> การยกเลิก shared abort controller

การยกเลิกการเรียกใช้ tool แยกออกจากการยกเลิก model stream:

- tool runners ใช้ `AbortSignal.any([agentSignal, steeringAbortSignal])`
- steering interrupts สามารถยกเลิกการเรียกใช้ tool ที่เหลืออยู่ ในขณะที่รักษา tool results ที่ผลิตไปแล้ว

## ขอบเขต Backpressure

ไม่มีกลไก backpressure แบบแข็งกร้าวระหว่าง provider SDK stream และ downstream consumers:

- `EventStream` ใช้ in-memory queues ที่ไม่มีขนาดสูงสุด
- การควบคุมอัตราจะลดอัตราการอัปเดต UI แต่ไม่ชะลอการรับข้อมูลจาก provider
- หาก consumers ล่าช้าอย่างมีนัยสำคัญ queued events อาจเติบโตจนกว่าจะเสร็จสิ้น

การออกแบบปัจจุบันให้ความสำคัญกับการตอบสนองและการจัดลำดับที่เรียบง่ายมากกว่าการควบคุมการไหลแบบ bounded-buffer

## วิธีที่ stream events ปรากฏเป็น agent/session events

`agentLoop.streamAssistantResponse()` เชื่อม `AssistantMessageEvent` กับ `AgentEvent`:

- เมื่อ `start`: ส่ง placeholder assistant message และส่ง `message_start`
- เมื่อ block events (`text_*`, `thinking_*`, `toolcall_*`): อัปเดต assistant message ล่าสุด ส่ง `message_update` พร้อม `assistantMessageEvent` ดิบ
- เมื่อ terminal (`done`/`error`): resolve ข้อความสุดท้ายจาก `response.result()` ส่ง `message_end`

`AgentSession` จากนั้นรับ events เหล่านั้นสำหรับพฤติกรรมระดับ session:

- TTSR ดู `message_update.assistantMessageEvent` สำหรับ `text_delta` และ `toolcall_delta`
- streaming edit guard ตรวจสอบ `toolcall_delta`/`toolcall_end` บนการเรียก `edit` และสามารถยกเลิกได้ก่อนกำหนด
- persistence เขียนข้อความที่สรุปแล้วที่ `message_end`
- auto-retry ตรวจสอบ `stopReason === "error"` ของ assistant บวกกับ heuristics ของ `errorMessage`

## ความรับผิดชอบแบบรวมศูนย์เทียบกับเฉพาะ Provider

รวมศูนย์ (สัญญาทั่วไป):

- รูปแบบ event (`AssistantMessageEvent`)
- การดึงผลลัพธ์สุดท้าย (`done`/`error`)
- กฎการควบคุมอัตรา delta + การรวม
- โมเดลการส่งต่อ agent/session event

เฉพาะ Provider (ไม่ได้แยกออกมาอย่างสมบูรณ์):

- taxonomies ของ upstream event และ logic การแมป
- ตารางการแปล stop-reason
- ข้อตกลง tool-call ID
- ความหมายและลายเซ็นของ reasoning/thinking block
- ความหมายของ usage token และเวลาที่พร้อมใช้งาน
- ข้อจำกัดการแปลงข้อความตาม API แต่ละรายการ

## ไฟล์การนำไปใช้งาน

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — provider dispatch, option mapping, API key/session plumbing
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — generic stream queue + assistant delta throttling
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — partial JSON parsing สำหรับ streamed tool arguments
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — Anthropic event translation และการสะสม tool JSON delta
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — OpenAI Responses event translation และการแมป status
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — Gemini stream chunk-to-block translation
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — Gemini finish-reason mapping และกฎการแปลงที่ใช้ร่วมกัน
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — provider stream consumption และ `message_update` bridging
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การจัดการระดับ session ของ streaming updates, abort, retry และ persistence
