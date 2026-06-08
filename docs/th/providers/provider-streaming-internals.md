---
title: Provider Streaming Internals
description: >-
  การใช้งานการสตรีมของ Provider พร้อมการแยกวิเคราะห์ SSE การนับโทเค็น
  และการจัดการ backpressure
sidebar:
  order: 2
  label: Streaming internals
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# รายละเอียดภายในของการสตรีมของ Provider

เอกสารนี้อธิบายวิธีการทำให้การสตรีมโทเค็น/เครื่องมือเป็นมาตรฐานใน `@f5xc-salesdemos/pi-ai` จากนั้นส่งต่อผ่าน `@f5xc-salesdemos/pi-agent-core` และอีเวนต์เซสชันของ `coding-agent`

## ขั้นตอนการทำงานแบบ end-to-end

1. `streamSimple()` (`packages/ai/src/stream.ts`) แมปตัวเลือกทั่วไปและส่งต่อไปยังฟังก์ชันสตรีมของ provider
2. ฟังก์ชันสตรีมของ provider (`anthropic.ts`, `openai-responses.ts`, `google.ts`) แปลงอีเวนต์สตรีมเฉพาะของ provider ให้เป็นลำดับ `AssistantMessageEvent` แบบรวม
3. แต่ละ provider ส่งอีเวนต์เข้าสู่ `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) ซึ่งจำกัดความถี่ของอีเวนต์ delta และเปิดเผย:
   - การวนซ้ำแบบ async สำหรับการอัปเดตแบบเพิ่มทีละส่วน
   - `result()` สำหรับ `AssistantMessage` สุดท้าย
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) รับอีเวนต์เหล่านั้น เปลี่ยนสถานะของ assistant ที่กำลังดำเนินการอยู่ และปล่อยอีเวนต์ `message_update` ที่มี `assistantMessageEvent` ดิบ
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) สมัครรับอีเวนต์ของ agent บันทึกข้อความ ขับเคลื่อน extension hooks และใช้พฤติกรรมระดับเซสชัน (retry, compaction, TTSR, การตรวจสอบยกเลิกการแก้ไขแบบสตรีม)

## สัญญาสตรีมแบบรวมใน `@f5xc-salesdemos/pi-ai`

Provider ทั้งหมดปล่อยรูปแบบเดียวกัน (`AssistantMessageEvent` ใน `packages/ai/src/types.ts`):

- `start`
- กลุ่มวงจรชีวิตของ content block:
  - text: `text_start` → `text_delta`* → `text_end`
  - thinking: `thinking_start` → `thinking_delta`* → `thinking_end`
  - tool call: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- อีเวนต์สิ้นสุด:
  - `done` พร้อม `reason: "stop" | "length" | "toolUse"`
  - หรือ `error` พร้อม `reason: "aborted" | "error"`

`AssistantMessageEventStream` รับประกัน:

- ผลลัพธ์สุดท้ายถูกแก้ไขโดยอีเวนต์สิ้นสุด (`done` หรือ `error`)
- delta ถูกรวมกลุ่ม/จำกัดความถี่ (~50ms)
- delta ที่บัฟเฟอร์ไว้จะถูก flush ก่อนอีเวนต์ที่ไม่ใช่ delta และก่อนการเสร็จสมบูรณ์

## พฤติกรรมการจำกัดความถี่ delta และการทำให้สอดคล้องกัน

`AssistantMessageEventStream` ถือว่า `text_delta`, `thinking_delta`, และ `toolcall_delta` เป็นอีเวนต์ที่สามารถรวมได้:

- delta ที่บัฟเฟอร์ไว้จะถูกรวมเฉพาะเมื่อ **type + contentIndex** ตรงกัน
- การรวมจะเก็บ snapshot `partial` ล่าสุดไว้
- อีเวนต์ที่ไม่ใช่ delta จะบังคับให้ flush ทันที

สิ่งนี้ทำให้สตรีมของ provider ที่มีความถี่สูงราบรื่นขึ้นสำหรับ TUI/ผู้รับอีเวนต์ แต่ไม่ใช่ backpressure ของ provider: provider ยังคงผลิตด้วยความเร็วเต็มที่ ในขณะที่สตรีมในเครื่องจะบัฟเฟอร์

## รายละเอียดการทำให้เป็นมาตรฐานของ Provider

## Anthropic (`anthropic-messages`)

ซอร์ส: `packages/ai/src/providers/anthropic.ts`

จุดการทำให้เป็นมาตรฐาน:

- `message_start` เริ่มต้นการใช้งาน (โทเค็น input/output/cache)
- `content_block_start` แมปเป็น text/thinking/toolcall starts
- `content_block_delta` แมป:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` อัปเดต `thinkingSignature` เท่านั้น (ไม่มีอีเวนต์)
- `content_block_stop` ปล่อย `*_end` ที่ตรงกัน
- `message_delta.stop_reason` แมปผ่าน `mapStopReason()`

การสตรีมอาร์กิวเมนต์ของ tool-call:

- แต่ละ tool block มี `partialJson` ภายใน
- ทุก JSON delta ต่อท้ายเข้า `partialJson`
- `arguments` ถูกแยกวิเคราะห์ใหม่ในทุก delta ผ่าน `parseStreamingJson()`
- `toolcall_end` แยกวิเคราะห์อีกครั้ง จากนั้นลบ `partialJson`

## OpenAI Responses (`openai-responses`)

ซอร์ส: `packages/ai/src/providers/openai-responses.ts`

จุดการทำให้เป็นมาตรฐาน:

- `response.output_item.added` เริ่มต้น reasoning/text/function-call blocks
- อีเวนต์สรุปการให้เหตุผล (`response.reasoning_summary_text.delta`) กลายเป็น `thinking_delta`
- output/refusal deltas กลายเป็น `text_delta`
- `response.function_call_arguments.delta` กลายเป็น `toolcall_delta`
- `response.output_item.done` ปล่อย `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` แมปสถานะเป็นเหตุผลการหยุดและการใช้งาน

การสตรีมอาร์กิวเมนต์ของ tool-call:

- รูปแบบการสะสม `partialJson` เหมือนกับ Anthropic
- provider ที่ส่งเฉพาะ `response.function_call_arguments.done` ยังคงเติม args สุดท้าย
- tool call IDs ถูกทำให้เป็นมาตรฐานเป็น `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

ซอร์ส: `packages/ai/src/providers/google.ts`

จุดการทำให้เป็นมาตรฐาน:

- วนซ้ำ `candidate.content.parts`
- text parts ถูกแยกเป็น thinking กับ text โดย `isThinkingPart(part)`
- การเปลี่ยน block จะปิด block ก่อนหน้าก่อนที่จะเริ่ม block ใหม่
- `part.functionCall` ถูกจัดการเป็น tool call ที่สมบูรณ์ (start/delta/end ถูกปล่อยทันที)
- เหตุผลการเสร็จสิ้นแมปโดย `mapStopReason()` จาก `google-shared.ts`

การสตรีมอาร์กิวเมนต์ของ tool-call:

- args ของ function call มาถึงเป็นอ็อบเจกต์ที่มีโครงสร้าง ไม่ใช่ข้อความ JSON แบบเพิ่มทีละส่วน
- การใช้งานปล่อย `toolcall_delta` สังเคราะห์หนึ่งรายการที่มี `JSON.stringify(arguments)`
- ไม่จำเป็นต้องใช้ partial JSON parser สำหรับ Google ในเส้นทางนี้

## การสะสม JSON บางส่วนของ tool-call และการกู้คืน

พฤติกรรมที่ใช้ร่วมกันสำหรับ Anthropic/OpenAI Responses ใช้ `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. ลอง `JSON.parse`
2. fallback ไปที่ `partial-json` parser สำหรับ fragment ที่ไม่สมบูรณ์
3. ถ้าทั้งสองล้มเหลว ส่งคืน `{}`

ผลกระทบ:

- delta ของอาร์กิวเมนต์ที่ผิดรูปแบบหรือถูกตัดไม่ทำให้การประมวลผลสตรีมหยุดทำงานทันที
- `arguments` ที่กำลังดำเนินการอาจเป็น `{}` ชั่วคราว
- delta ที่ถูกต้องในภายหลังสามารถกู้คืนอาร์กิวเมนต์ที่มีโครงสร้างได้เพราะการแยกวิเคราะห์ถูกลองใหม่ทุกครั้งที่ต่อท้าย
- `toolcall_end` สุดท้ายจะทำการแยกวิเคราะห์อีกครั้งก่อนการปล่อย

## เหตุผลการหยุด vs ข้อผิดพลาดของ transport/runtime

เหตุผลการหยุดของ provider ถูกแมปเป็น `stopReason` ที่เป็นมาตรฐาน:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, กรณี safety/refusal→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, คลาส safety/prohibited/malformed-function-call→`error`

ความหมายของข้อผิดพลาดแบ่งออกเป็นสองขั้นตอน:

1. **ความหมายการเสร็จสมบูรณ์ของโมเดล** (เหตุผลการเสร็จสิ้น/สถานะที่ provider รายงาน)
2. **ความล้มเหลวของ transport/runtime** (ข้อยกเว้นจากเครือข่าย/ไคลเอนต์/parser/abort)

ถ้าสตรีมของ provider โยนข้อยกเว้นหรือส่งสัญญาณความล้มเหลว provider wrapper แต่ละตัวจะดักจับและปล่อยอีเวนต์ `error` สิ้นสุดพร้อม:

- `stopReason = "aborted"` เมื่อ abort signal ถูกตั้งค่า
- มิฉะนั้น `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## พฤติกรรมเมื่อ chunk ผิดรูปแบบ / การแยกวิเคราะห์ SSE ล้มเหลว

สำหรับเส้นทางของ provider เหล่านี้ การจัดกรอบ chunk/SSE ถูกจัดการโดยสตรีม SDK ของผู้จำหน่าย (Anthropic SDK, OpenAI SDK, Google SDK) โค้ดนี้ไม่ได้ใช้ SSE decoder แบบกำหนดเองที่นี่

พฤติกรรมที่สังเกตได้ในการใช้งานปัจจุบัน:

- การแยกวิเคราะห์ chunk/SSE ที่ผิดรูปแบบในระดับ SDK จะปรากฏเป็นข้อยกเว้นหรืออีเวนต์ `error` ของสตรีม
- provider wrapper แปลงสิ่งนั้นเป็นอีเวนต์ `error` สิ้นสุดแบบรวม
- ไม่มีการ resume/retry เฉพาะ provider ภายในฟังก์ชันสตรีมเอง
- การ retry ระดับสูงกว่าถูกจัดการในตรรกะ auto-retry ของ `AgentSession` (retry ระดับข้อความ ไม่ใช่การเล่นซ้ำ stream-chunk)

## ขอบเขตการยกเลิก

การยกเลิกเป็นแบบหลายชั้น:

- คำขอ AI provider: `options.signal` ถูกส่งเข้าสู่การเรียกสตรีมของ provider client
- Provider wrapper: หลังจากลูปสตรีม สัญญาณที่ถูก abort จะบังคับเส้นทางข้อผิดพลาด (`"Request was aborted"`)
- Agent loop: ตรวจสอบ `signal.aborted` ก่อนจัดการอีเวนต์ของ provider แต่ละตัว และสามารถสังเคราะห์ข้อความ assistant ที่ถูก abort จากส่วนที่ได้รับล่าสุด
- Session/agent controls: `AgentSession.abort()` -> `agent.abort()` -> การยกเลิก shared abort controller

การยกเลิกการทำงานของเครื่องมือแยกออกจากการยกเลิกสตรีมของโมเดล:

- tool runners ใช้ `AbortSignal.any([agentSignal, steeringAbortSignal])`
- steering interrupts สามารถยกเลิกการทำงานของเครื่องมือที่เหลือในขณะที่เก็บรักษาผลลัพธ์ของเครื่องมือที่ผลิตไปแล้ว

## ขอบเขตของ backpressure

ไม่มีกลไก backpressure ที่เข้มงวดระหว่างสตรีม SDK ของ provider และผู้บริโภคปลายทาง:

- `EventStream` ใช้คิวในหน่วยความจำที่ไม่มีขนาดสูงสุด
- การจำกัดความถี่ลดอัตราการอัปเดต UI แต่ไม่ชะลอการรับเข้าของ provider
- ถ้าผู้บริโภคล้าหลังอย่างมาก อีเวนต์ที่อยู่ในคิวสามารถเพิ่มขึ้นจนกว่าจะเสร็จสมบูรณ์

การออกแบบปัจจุบันให้ความสำคัญกับความตอบสนองและการเรียงลำดับที่เรียบง่ายมากกว่าการควบคุมการไหลแบบบัฟเฟอร์จำกัด

## วิธีที่อีเวนต์สตรีมปรากฏเป็นอีเวนต์ของ agent/session

`agentLoop.streamAssistantResponse()` เชื่อมต่อ `AssistantMessageEvent` กับ `AgentEvent`:

- เมื่อ `start`: ส่งข้อความ assistant ตัวยึดตำแหน่งและปล่อย `message_start`
- เมื่อเกิดอีเวนต์ block (`text_*`, `thinking_*`, `toolcall_*`): อัปเดตข้อความ assistant ล่าสุด ปล่อย `message_update` พร้อม `assistantMessageEvent` ดิบ
- เมื่อสิ้นสุด (`done`/`error`): แก้ไขข้อความสุดท้ายจาก `response.result()` ปล่อย `message_end`

จากนั้น `AgentSession` รับอีเวนต์เหล่านั้นสำหรับพฤติกรรมระดับเซสชัน:

- TTSR เฝ้าดู `message_update.assistantMessageEvent` สำหรับ `text_delta` และ `toolcall_delta`
- ตัวป้องกันการแก้ไขแบบสตรีมตรวจสอบ `toolcall_delta`/`toolcall_end` ในการเรียก `edit` และสามารถยกเลิกก่อนกำหนดได้
- การบันทึกถาวรเขียนข้อความที่สรุปแล้วที่ `message_end`
- auto-retry ตรวจสอบ `stopReason === "error"` ของ assistant บวกกับ heuristics ของ `errorMessage`

## ความรับผิดชอบแบบรวม vs เฉพาะ provider

แบบรวม (สัญญาร่วม):

- รูปแบบอีเวนต์ (`AssistantMessageEvent`)
- การดึงผลลัพธ์สุดท้าย (`done`/`error`)
- กฎการจำกัดความถี่ delta + การรวม
- โมเดลการแพร่กระจายอีเวนต์ของ agent/session

เฉพาะ provider (ไม่ได้ถูก abstract อย่างสมบูรณ์):

- อนุกรมวิธานอีเวนต์ต้นทางและตรรกะการแมป
- ตารางการแปลเหตุผลการหยุด
- ข้อตกลงการตั้งชื่อ tool-call ID
- ความหมายและลายเซ็นของ reasoning/thinking block
- ความหมายของโทเค็นการใช้งานและจังหวะที่ใช้ได้
- ข้อจำกัดการแปลงข้อความต่อ API

## ไฟล์การใช้งาน

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — การส่งต่อ provider, การแมปตัวเลือก, การจัดการ API key/session
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — คิวสตรีมทั่วไป + การจำกัดความถี่ delta ของ assistant
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — การแยกวิเคราะห์ JSON บางส่วนสำหรับอาร์กิวเมนต์เครื่องมือที่ถูกสตรีม
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — การแปลงอีเวนต์ Anthropic และการสะสม tool JSON delta
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — การแปลงอีเวนต์ OpenAI Responses และการแมปสถานะ
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — การแปลง stream chunk-to-block ของ Gemini
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — การแมปเหตุผลการเสร็จสิ้นของ Gemini และกฎการแปลงที่ใช้ร่วมกัน
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — การรับสตรีมของ provider และการเชื่อมต่อ `message_update`
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การจัดการระดับเซสชันของการอัปเดตแบบสตรีม, การยกเลิก, การ retry, และการบันทึกถาวร
