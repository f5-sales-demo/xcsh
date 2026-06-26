---
title: โครงสร้างภายในของ Provider Streaming
description: >-
  การใช้งาน Provider Streaming พร้อมการแยกวิเคราะห์ SSE การนับโทเค็น
  และการจัดการ backpressure
sidebar:
  order: 2
  label: โครงสร้างภายในของ Streaming
i18n:
  sourceHash: a32ffa769c4d
  translator: machine
---

# โครงสร้างภายในของ Provider Streaming

เอกสารนี้อธิบายวิธีการที่การ streaming โทเค็น/เครื่องมือถูกทำให้เป็นมาตรฐานใน `@f5-sales-demo/pi-ai` จากนั้นเผยแพร่ผ่าน `@f5-sales-demo/pi-agent-core` และ session events ของ coding-agent

## กระบวนการจากต้นทางถึงปลายทาง

1. `streamSimple()` (`packages/ai/src/stream.ts`) แมปตัวเลือกทั่วไปและส่งไปยังฟังก์ชัน provider stream
2. ฟังก์ชัน provider stream (`anthropic.ts`, `openai-responses.ts`, `google.ts`) แปล stream events เฉพาะของ provider ให้เป็นลำดับ `AssistantMessageEvent` แบบรวมศูนย์
3. แต่ละ provider จะส่ง events เข้าสู่ `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) ซึ่งควบคุมอัตราการส่ง delta events และเปิดเผย:
   - async iteration สำหรับการอัปเดตแบบเพิ่มทีละน้อย
   - `result()` สำหรับ `AssistantMessage` ขั้นสุดท้าย
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) รับ events เหล่านั้น แก้ไขสถานะ assistant ที่กำลังทำงาน และส่ง `message_update` events พร้อม `assistantMessageEvent` ดิบ
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) สมัครรับ agent events บันทึกข้อความ ขับเคลื่อน extension hooks และใช้งาน session behaviors (retry, compaction, TTSR, การตรวจสอบการยกเลิก streaming-edit)

## สัญญา stream แบบรวมศูนย์ใน `@f5-sales-demo/pi-ai`

Provider ทั้งหมดส่ง events ในรูปแบบเดียวกัน (`AssistantMessageEvent` ใน `packages/ai/src/types.ts`):

- `start`
- triplets ของ lifecycle สำหรับ content block:
  - text: `text_start` → `text_delta`* → `text_end`
  - thinking: `thinking_start` → `thinking_delta`* → `thinking_end`
  - tool call: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- terminal event:
  - `done` พร้อม `reason: "stop" | "length" | "toolUse"`
  - หรือ `error` พร้อม `reason: "aborted" | "error"`

`AssistantMessageEventStream` รับประกัน:

- ผลลัพธ์สุดท้ายถูก resolve โดย terminal event (`done` หรือ `error`)
- deltas จะถูกรวมและควบคุมอัตราการส่ง (~50ms)
- deltas ที่ถูกบัฟเฟอร์จะถูก flush ก่อน non-delta events และก่อนการสิ้นสุด

## พฤติกรรมการควบคุมอัตราและการประสาน delta

`AssistantMessageEventStream` จัดการ `text_delta`, `thinking_delta` และ `toolcall_delta` เป็น events ที่รวมกันได้:

- deltas ที่ถูกบัฟเฟอร์จะถูกรวมก็ต่อเมื่อ **type + contentIndex** ตรงกันเท่านั้น
- การรวมจะเก็บ snapshot `partial` ล่าสุดไว้
- non-delta events บังคับให้ flush ทันที

กระบวนการนี้ทำให้ provider streams ความถี่สูงราบรื่นขึ้นสำหรับผู้บริโภค TUI/event แต่ไม่ใช่ backpressure ของ provider: providers ยังคงผลิตข้อมูลด้วยความเร็วเต็มที่ในขณะที่ local stream ทำการบัฟเฟอร์

## รายละเอียดการทำให้ Provider เป็นมาตรฐาน

## Anthropic (`anthropic-messages`)

แหล่งที่มา: `packages/ai/src/providers/anthropic.ts`

จุดที่ทำให้เป็นมาตรฐาน:

- `message_start` เริ่มต้นการใช้งาน (input/output/cache tokens)
- `content_block_start` แมปไปยัง text/thinking/toolcall starts
- `content_block_delta` แมป:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` อัปเดต `thinkingSignature` เท่านั้น (ไม่มี event)
- `content_block_stop` ส่ง `*_end` ที่สอดคล้องกัน
- `message_delta.stop_reason` แมปผ่าน `mapStopReason()`

การ streaming ของ argument สำหรับ tool-call:

- แต่ละ tool block มี `partialJson` ภายใน
- JSON delta ทุกตัวจะต่อท้ายเข้าไปใน `partialJson`
- `arguments` จะถูก parse ใหม่ทุก delta ผ่าน `parseStreamingJson()`
- `toolcall_end` parse อีกครั้งหนึ่งครั้ง จากนั้นลบ `partialJson` ออก

## OpenAI Responses (`openai-responses`)

แหล่งที่มา: `packages/ai/src/providers/openai-responses.ts`

จุดที่ทำให้เป็นมาตรฐาน:

- `response.output_item.added` เริ่มต้น reasoning/text/function-call blocks
- reasoning summary events (`response.reasoning_summary_text.delta`) กลายเป็น `thinking_delta`
- output/refusal deltas กลายเป็น `text_delta`
- `response.function_call_arguments.delta` กลายเป็น `toolcall_delta`
- `response.output_item.done` ส่ง `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` แมป status ไปยัง stop reason และ usage

การ streaming ของ argument สำหรับ tool-call:

- ใช้รูปแบบการสะสม `partialJson` เดียวกับ Anthropic
- providers ที่ส่งเฉพาะ `response.function_call_arguments.done` ยังคง populate args สุดท้ายได้
- tool call IDs ถูกทำให้เป็นมาตรฐานเป็น `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

แหล่งที่มา: `packages/ai/src/providers/google.ts`

จุดที่ทำให้เป็นมาตรฐาน:

- วนซ้ำ `candidate.content.parts`
- ส่วน text ถูกแบ่งเป็น thinking และ text โดย `isThinkingPart(part)`
- การเปลี่ยน block จะปิด block ก่อนหน้าก่อนเริ่ม block ใหม่
- `part.functionCall` ถูกจัดการเป็น tool call ที่สมบูรณ์ (start/delta/end ถูกส่งทันที)
- finish reason ถูกแมปโดย `mapStopReason()` จาก `google-shared.ts`

การ streaming ของ argument สำหรับ tool-call:

- argument ของ function call มาถึงในรูปแบบ structured object ไม่ใช่ JSON text แบบเพิ่มทีละน้อย
- การ implement ส่ง `toolcall_delta` สังเคราะห์หนึ่งตัวที่มี `JSON.stringify(arguments)`
- ไม่จำเป็นต้องใช้ partial JSON parser สำหรับ Google ในเส้นทางนี้

## การสะสมและการกู้คืน partial JSON ของ tool-call

พฤติกรรมที่ใช้ร่วมกันสำหรับ Anthropic/OpenAI Responses ใช้ `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. ลอง `JSON.parse`
2. ใช้ `partial-json` parser เป็น fallback สำหรับ fragments ที่ไม่สมบูรณ์
3. หากทั้งคู่ล้มเหลว ส่งคืน `{}`

ผลกระทบ:

- argument deltas ที่ผิดรูปแบบหรือถูกตัดทอนจะไม่ทำให้การประมวลผล stream หยุดทำงานทันที
- `arguments` ที่กำลังดำเนินการอาจเป็น `{}` ชั่วคราว
- deltas ที่ถูกต้องในภายหลังสามารถกู้คืน arguments ที่มีโครงสร้างได้เนื่องจากการ parse ถูกลองใหม่ทุกครั้งที่มีการต่อท้าย
- `toolcall_end` ขั้นสุดท้ายทำการ parse อีกครั้งหนึ่งครั้งก่อนการส่ง

## Stop reasons กับ transport/runtime errors

Stop reasons ของ provider ถูกแมปไปยัง `stopReason` ที่เป็นมาตรฐาน:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, กรณี safety/refusal→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, คลาส safety/prohibited/malformed-function-call→`error`

ความหมายของ error แบ่งออกเป็นสองขั้นตอน:

1. **ความหมายของการสิ้นสุด model** (finish reason/status ที่ provider รายงาน)
2. **ความล้มเหลวด้าน transport/runtime** (exceptions จาก network/client/parser/abort)

หาก provider stream ส่ง exception หรือส่งสัญญาณความล้มเหลว provider wrapper แต่ละตัวจะดักจับและส่ง terminal `error` event พร้อม:

- `stopReason = "aborted"` เมื่อ abort signal ถูกตั้งค่า
- มิฉะนั้น `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## พฤติกรรมเมื่อ chunk/SSE parse ล้มเหลว

สำหรับเส้นทาง provider เหล่านี้ การจัดการ chunk/SSE framing ดำเนินการโดย vendor SDK streams (Anthropic SDK, OpenAI SDK, Google SDK) โค้ดนี้ไม่ได้ implement custom SSE decoder ที่นี่

พฤติกรรมที่สังเกตได้ในการ implement ปัจจุบัน:

- การ parse chunk/SSE ที่ผิดรูปแบบในระดับ SDK จะแสดงผลเป็น exception หรือ stream `error` event
- provider wrapper แปลงสิ่งนั้นให้เป็น terminal `error` event แบบรวมศูนย์
- ไม่มีการ resume/retry เฉพาะของ provider ภายในฟังก์ชัน stream เอง
- retries ระดับสูงกว่าถูกจัดการใน `AgentSession` auto-retry logic (message-level retry ไม่ใช่ stream-chunk replay)

## ขอบเขตของการยกเลิก

การยกเลิกเป็นแบบหลายชั้น:

- คำขอ AI provider: `options.signal` ถูกส่งเข้าสู่การเรียก stream ของ provider client
- Provider wrapper: หลังจาก stream loop สัญญาณที่ถูก abort บังคับให้ใช้เส้นทาง error (`"Request was aborted"`)
- Agent loop: ตรวจสอบ `signal.aborted` ก่อนจัดการแต่ละ provider event และสามารถสังเคราะห์ assistant message ที่ถูก abort จาก partial ล่าสุด
- การควบคุม Session/agent: `AgentSession.abort()` -> `agent.abort()` -> การยกเลิก shared abort controller

การยกเลิกการ execute เครื่องมือแยกต่างหากจากการยกเลิก model stream:

- tool runners ใช้ `AbortSignal.any([agentSignal, steeringAbortSignal])`
- steering interrupts สามารถยกเลิกการ execute เครื่องมือที่เหลืออยู่ในขณะที่รักษา tool results ที่ผลิตแล้วไว้

## ขอบเขตของ Backpressure

ไม่มีกลไก backpressure แบบ hard ระหว่าง provider SDK stream และผู้บริโภคปลายทาง:

- `EventStream` ใช้ in-memory queues โดยไม่มีขนาดสูงสุด
- การควบคุมอัตราลดอัตราการอัปเดต UI แต่ไม่ได้ชะลอการรับข้อมูลจาก provider
- หากผู้บริโภคล่าช้าอย่างมีนัยสำคัญ events ที่เข้าคิวอาจเพิ่มขึ้นจนกว่าจะสิ้นสุด

การออกแบบปัจจุบันให้ความสำคัญกับการตอบสนองและการจัดลำดับที่เรียบง่ายมากกว่าการควบคุมกระแสข้อมูลแบบ bounded-buffer

## วิธีที่ stream events แสดงเป็น agent/session events

`agentLoop.streamAssistantResponse()` เชื่อม `AssistantMessageEvent` กับ `AgentEvent`:

- เมื่อได้รับ `start`: push placeholder assistant message และส่ง `message_start`
- เมื่อได้รับ block events (`text_*`, `thinking_*`, `toolcall_*`): อัปเดต assistant message ล่าสุด ส่ง `message_update` พร้อม `assistantMessageEvent` ดิบ
- เมื่อได้รับ terminal (`done`/`error`): resolve final message จาก `response.result()` ส่ง `message_end`

`AgentSession` จากนั้นรับ events เหล่านั้นสำหรับพฤติกรรมระดับ session:

- TTSR จับตาดู `message_update.assistantMessageEvent` สำหรับ `text_delta` และ `toolcall_delta`
- streaming edit guard ตรวจสอบ `toolcall_delta`/`toolcall_end` บนการเรียก `edit` และสามารถยกเลิกได้ก่อนกำหนด
- การ persistence เขียนข้อความที่สรุปแล้วที่ `message_end`
- auto-retry ตรวจสอบ assistant `stopReason === "error"` บวกกับ `errorMessage` heuristics

## ความรับผิดชอบแบบรวมศูนย์กับเฉพาะ Provider

แบบรวมศูนย์ (สัญญาร่วม):

- รูปแบบ event (`AssistantMessageEvent`)
- การดึงผลลัพธ์สุดท้าย (`done`/`error`)
- กฎการควบคุมอัตราและการรวม delta
- โมเดลการเผยแพร่ agent/session event

เฉพาะ Provider (ไม่ได้ถูก abstract อย่างสมบูรณ์):

- taxonomies ของ upstream event และ mapping logic
- ตาราง translation ของ stop-reason
- conventions ของ tool-call ID
- ความหมายและ signatures ของ reasoning/thinking block
- ความหมายของ usage token และเวลาที่พร้อมใช้งาน
- ข้อจำกัดการแปลง message ต่อ API

## ไฟล์ที่ implement

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — การ dispatch ของ provider การแมป option และการเชื่อมต่อ API key/session
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — คิว stream ทั่วไปและการควบคุมอัตราของ assistant delta
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — การ parse partial JSON สำหรับ tool arguments ที่ถูก stream
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — การแปล Anthropic event และการสะสม tool JSON delta
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — การแปล OpenAI Responses event และการแมป status
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — การแปล Gemini stream chunk-to-block
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — การแมป Gemini finish-reason และกฎ conversion ที่ใช้ร่วมกัน
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — การรับ provider stream และการเชื่อม `message_update`
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การจัดการระดับ session สำหรับ streaming updates การยกเลิก retry และ persistence
