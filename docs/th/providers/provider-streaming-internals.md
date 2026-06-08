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

เอกสารนี้อธิบายวิธีการทำให้การสตรีมโทเค็น/เครื่องมือเป็นมาตรฐานใน `@f5xc-salesdemos/pi-ai` จากนั้นแพร่กระจายผ่าน `@f5xc-salesdemos/pi-agent-core` และเหตุการณ์เซสชันของ `coding-agent`

## กระบวนการแบบครบวงจร

1. `streamSimple()` (`packages/ai/src/stream.ts`) แมปตัวเลือกทั่วไปและส่งต่อไปยังฟังก์ชันสตรีมของ Provider
2. ฟังก์ชันสตรีมของ Provider (`anthropic.ts`, `openai-responses.ts`, `google.ts`) แปลเหตุการณ์สตรีมเฉพาะของ Provider ให้เป็นลำดับ `AssistantMessageEvent` แบบรวม
3. แต่ละ Provider ส่งเหตุการณ์เข้าสู่ `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) ซึ่งจำกัดอัตราเหตุการณ์ delta และเปิดเผย:
   - การวนซ้ำแบบ async สำหรับการอัปเดตแบบเพิ่มทีละส่วน
   - `result()` สำหรับ `AssistantMessage` สุดท้าย
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) รับเหตุการณ์เหล่านั้น เปลี่ยนแปลงสถานะ assistant ที่กำลังดำเนินการ และส่งเหตุการณ์ `message_update` ที่มี `assistantMessageEvent` ดิบ
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) สมัครรับเหตุการณ์ agent บันทึกข้อความ ขับเคลื่อน extension hooks และใช้พฤติกรรมเซสชัน (retry, compaction, TTSR, การตรวจสอบยกเลิกการแก้ไขแบบสตรีม)

## สัญญาสตรีมแบบรวมใน `@f5xc-salesdemos/pi-ai`

Provider ทั้งหมดส่งรูปแบบเดียวกัน (`AssistantMessageEvent` ใน `packages/ai/src/types.ts`):

- `start`
- ชุดสามเหตุการณ์ของวงจรชีวิต content block:
  - text: `text_start` → `text_delta`* → `text_end`
  - thinking: `thinking_start` → `thinking_delta`* → `thinking_end`
  - tool call: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- เหตุการณ์สิ้นสุด:
  - `done` พร้อม `reason: "stop" | "length" | "toolUse"`
  - หรือ `error` พร้อม `reason: "aborted" | "error"`

`AssistantMessageEventStream` รับประกัน:

- ผลลัพธ์สุดท้ายถูกแก้ไขโดยเหตุการณ์สิ้นสุด (`done` หรือ `error`)
- delta ถูกรวมกลุ่ม/จำกัดอัตรา (~50ms)
- delta ที่ถูกบัฟเฟอร์จะถูก flush ก่อนเหตุการณ์ที่ไม่ใช่ delta และก่อนการเสร็จสมบูรณ์

## พฤติกรรมการจำกัดอัตรา delta และการทำให้สอดคล้อง

`AssistantMessageEventStream` ถือว่า `text_delta`, `thinking_delta` และ `toolcall_delta` เป็นเหตุการณ์ที่สามารถรวมกันได้:

- delta ที่ถูกบัฟเฟอร์จะถูกรวมเฉพาะเมื่อ **type + contentIndex** ตรงกัน
- การรวมจะเก็บ snapshot `partial` ล่าสุด
- เหตุการณ์ที่ไม่ใช่ delta บังคับให้ flush ทันที

สิ่งนี้ทำให้สตรีมของ Provider ที่มีความถี่สูงราบรื่นสำหรับ TUI/ผู้รับเหตุการณ์ แต่ไม่ใช่ backpressure ของ Provider: Provider ยังคงผลิตด้วยความเร็วเต็มที่ ในขณะที่สตรีมท้องถิ่นบัฟเฟอร์

## รายละเอียดการทำให้เป็นมาตรฐานของ Provider

## Anthropic (`anthropic-messages`)

ซอร์ส: `packages/ai/src/providers/anthropic.ts`

จุดทำให้เป็นมาตรฐาน:

- `message_start` เริ่มต้นการใช้งาน (โทเค็น input/output/cache)
- `content_block_start` แมปไปยัง text/thinking/toolcall starts
- `content_block_delta` แมป:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` อัปเดต `thinkingSignature` เท่านั้น (ไม่มีเหตุการณ์)
- `content_block_stop` ส่ง `*_end` ที่สอดคล้องกัน
- `message_delta.stop_reason` แมปผ่าน `mapStopReason()`

การสตรีมอาร์กิวเมนต์ของ tool-call:

- แต่ละ tool block มี `partialJson` ภายใน
- ทุก JSON delta ต่อเข้ากับ `partialJson`
- `arguments` ถูกแยกวิเคราะห์ใหม่ในแต่ละ delta ผ่าน `parseStreamingJson()`
- `toolcall_end` แยกวิเคราะห์อีกครั้ง จากนั้นลบ `partialJson`

## OpenAI Responses (`openai-responses`)

ซอร์ส: `packages/ai/src/providers/openai-responses.ts`

จุดทำให้เป็นมาตรฐาน:

- `response.output_item.added` เริ่มบล็อก reasoning/text/function-call
- เหตุการณ์สรุป reasoning (`response.reasoning_summary_text.delta`) กลายเป็น `thinking_delta`
- output/refusal delta กลายเป็น `text_delta`
- `response.function_call_arguments.delta` กลายเป็น `toolcall_delta`
- `response.output_item.done` ส่ง `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` แมปสถานะเป็น stop reason และ usage

การสตรีมอาร์กิวเมนต์ของ tool-call:

- รูปแบบการสะสม `partialJson` เดียวกันกับ Anthropic
- Provider ที่ส่งเฉพาะ `response.function_call_arguments.done` ก็ยังเติม args สุดท้าย
- tool call ID ถูกทำให้เป็นมาตรฐานเป็น `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

ซอร์ส: `packages/ai/src/providers/google.ts`

จุดทำให้เป็นมาตรฐาน:

- วนซ้ำ `candidate.content.parts`
- text parts ถูกแยกเป็น thinking กับ text โดย `isThinkingPart(part)`
- การเปลี่ยนบล็อกจะปิดบล็อกก่อนหน้าก่อนเริ่มบล็อกใหม่
- `part.functionCall` ถูกถือว่าเป็น tool call ที่สมบูรณ์ (start/delta/end ถูกส่งทันที)
- finish reason แมปโดย `mapStopReason()` จาก `google-shared.ts`

การสตรีมอาร์กิวเมนต์ของ tool-call:

- อาร์กิวเมนต์ function call มาถึงเป็นอ็อบเจกต์ที่มีโครงสร้าง ไม่ใช่ข้อความ JSON แบบเพิ่มทีละส่วน
- การใช้งานส่ง `toolcall_delta` สังเคราะห์หนึ่งรายการที่มี `JSON.stringify(arguments)`
- ไม่จำเป็นต้องใช้ partial JSON parser สำหรับ Google ในเส้นทางนี้

## การสะสม JSON ของ tool-call แบบบางส่วนและการกู้คืน

พฤติกรรมร่วมสำหรับ Anthropic/OpenAI Responses ใช้ `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. ลอง `JSON.parse`
2. fallback ไปยัง `partial-json` parser สำหรับเศษส่วนที่ไม่สมบูรณ์
3. หากทั้งสองล้มเหลว ส่งคืน `{}`

ผลกระทบ:

- delta อาร์กิวเมนต์ที่ผิดรูปแบบหรือถูกตัดจะไม่ทำให้การประมวลผลสตรีมล่มทันที
- `arguments` ที่กำลังดำเนินการอาจเป็น `{}` ชั่วคราว
- delta ที่ถูกต้องในภายหลังสามารถกู้คืนอาร์กิวเมนต์ที่มีโครงสร้างได้เพราะการแยกวิเคราะห์จะลองใหม่ทุกครั้งที่ต่อเพิ่ม
- `toolcall_end` สุดท้ายจะพยายามแยกวิเคราะห์อีกครั้งก่อนส่ง

## Stop reasons เทียบกับข้อผิดพลาด transport/runtime

Stop reason ของ Provider ถูกแมปไปยัง `stopReason` ที่ทำให้เป็นมาตรฐาน:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, กรณี safety/refusal→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, คลาส safety/prohibited/malformed-function-call→`error`

ความหมายของข้อผิดพลาดแบ่งเป็นสองขั้นตอน:

1. **ความหมายของการเสร็จสิ้นโมเดล** (finish reason/status ที่ Provider รายงาน)
2. **ความล้มเหลวของ transport/runtime** (ข้อยกเว้น network/client/parser/abort)

หาก provider stream โยนข้อผิดพลาดหรือส่งสัญญาณความล้มเหลว แต่ละ provider wrapper จะจับและส่งเหตุการณ์ `error` สิ้นสุดพร้อม:

- `stopReason = "aborted"` เมื่อ abort signal ถูกตั้ง
- มิฉะนั้น `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## พฤติกรรมเมื่อ chunk ผิดรูปแบบ / การแยกวิเคราะห์ SSE ล้มเหลว

สำหรับเส้นทาง Provider เหล่านี้ การจัดกรอบ chunk/SSE จะถูกจัดการโดย vendor SDK streams (Anthropic SDK, OpenAI SDK, Google SDK) โค้ดนี้ไม่ได้ใช้ SSE decoder แบบกำหนดเองที่นี่

พฤติกรรมที่สังเกตได้ในการใช้งานปัจจุบัน:

- การแยกวิเคราะห์ chunk/SSE ที่ผิดรูปแบบในระดับ SDK แสดงเป็นข้อยกเว้นหรือเหตุการณ์ `error` ของสตรีม
- provider wrapper แปลงสิ่งนั้นให้เป็นเหตุการณ์ `error` สิ้นสุดแบบรวม
- ไม่มีการ resume/retry เฉพาะ Provider ภายในฟังก์ชันสตรีมเอง
- การ retry ระดับสูงกว่าจะถูกจัดการใน `AgentSession` auto-retry logic (retry ระดับข้อความ ไม่ใช่การเล่นซ้ำ stream-chunk)

## ขอบเขตการยกเลิก

การยกเลิกถูกจัดเป็นชั้น:

- คำขอ AI provider: `options.signal` ถูกส่งเข้าสู่การเรียก provider client stream
- Provider wrapper: หลังจากลูปสตรีม สัญญาณ aborted บังคับเส้นทาง error (`"Request was aborted"`)
- Agent loop: ตรวจสอบ `signal.aborted` ก่อนจัดการแต่ละเหตุการณ์ของ Provider และสามารถสังเคราะห์ข้อความ assistant ที่ถูกยกเลิกจาก partial ล่าสุด
- การควบคุม Session/agent: `AgentSession.abort()` -> `agent.abort()` -> การยกเลิก shared abort controller

การยกเลิกการดำเนินการเครื่องมือแยกจากการยกเลิกสตรีมโมเดล:

- tool runner ใช้ `AbortSignal.any([agentSignal, steeringAbortSignal])`
- steering interrupts สามารถยกเลิกการดำเนินการเครื่องมือที่เหลือในขณะที่รักษาผลลัพธ์เครื่องมือที่ผลิตแล้ว

## ขอบเขต backpressure

ไม่มีกลไก backpressure แบบแข็งระหว่าง provider SDK stream และผู้รับปลายทาง:

- `EventStream` ใช้คิวในหน่วยความจำโดยไม่มีขนาดสูงสุด
- การจำกัดอัตราลดอัตราการอัปเดต UI แต่ไม่ชะลอการรับจาก Provider
- หากผู้รับล่าช้าอย่างมาก เหตุการณ์ในคิวสามารถเพิ่มขึ้นจนกว่าจะเสร็จสมบูรณ์

การออกแบบปัจจุบันให้ความสำคัญกับการตอบสนองและลำดับที่เรียบง่ายมากกว่าการควบคุมการไหลแบบบัฟเฟอร์ที่มีขอบเขต

## วิธีที่เหตุการณ์สตรีมปรากฏเป็นเหตุการณ์ agent/session

`agentLoop.streamAssistantResponse()` เชื่อม `AssistantMessageEvent` ไปยัง `AgentEvent`:

- เมื่อ `start`: ผลักข้อความ assistant ตัวยึดตำแหน่งและส่ง `message_start`
- เมื่อเหตุการณ์บล็อก (`text_*`, `thinking_*`, `toolcall_*`): อัปเดตข้อความ assistant ล่าสุด ส่ง `message_update` พร้อม `assistantMessageEvent` ดิบ
- เมื่อสิ้นสุด (`done`/`error`): แก้ไขข้อความสุดท้ายจาก `response.result()` ส่ง `message_end`

จากนั้น `AgentSession` รับเหตุการณ์เหล่านั้นสำหรับพฤติกรรมระดับเซสชัน:

- TTSR เฝ้าดู `message_update.assistantMessageEvent` สำหรับ `text_delta` และ `toolcall_delta`
- การป้องกันการแก้ไขแบบสตรีมตรวจสอบ `toolcall_delta`/`toolcall_end` ในการเรียก `edit` และสามารถยกเลิกก่อนกำหนด
- การบันทึกถาวรเขียนข้อความที่เสร็จสมบูรณ์แล้วที่ `message_end`
- auto-retry ตรวจสอบ assistant `stopReason === "error"` ร่วมกับ heuristic ของ `errorMessage`

## ความรับผิดชอบแบบรวม เทียบกับ เฉพาะ Provider

แบบรวม (สัญญาร่วม):

- รูปแบบเหตุการณ์ (`AssistantMessageEvent`)
- การดึงผลลัพธ์สุดท้าย (`done`/`error`)
- กฎการจำกัดอัตรา delta + การรวม
- โมเดลการแพร่กระจายเหตุการณ์ agent/session

เฉพาะ Provider (ยังไม่ถูก abstract อย่างสมบูรณ์):

- อนุกรมวิธานเหตุการณ์ต้นทางและตรรกะการแมป
- ตารางแปล stop-reason
- หลักเกณฑ์ tool-call ID
- ความหมายของบล็อก reasoning/thinking และ signatures
- ความหมายของโทเค็น usage และเวลาที่พร้อมใช้งาน
- ข้อจำกัดการแปลงข้อความต่อ API

## ไฟล์การใช้งาน

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — การส่งต่อ Provider, การแมปตัวเลือก, การส่งผ่าน API key/session
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — คิวสตรีมทั่วไป + การจำกัดอัตรา assistant delta
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — การแยกวิเคราะห์ JSON แบบบางส่วนสำหรับอาร์กิวเมนต์เครื่องมือที่ถูกสตรีม
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — การแปลเหตุการณ์ Anthropic และการสะสม tool JSON delta
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — การแปลเหตุการณ์ OpenAI Responses และการแมปสถานะ
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — การแปล stream chunk-to-block ของ Gemini
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — การแมป finish-reason ของ Gemini และกฎการแปลงร่วม
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — การรับสตรีมของ Provider และการเชื่อม `message_update`
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การจัดการการอัปเดตแบบสตรีม การยกเลิก การ retry และการบันทึกถาวรระดับเซสชัน
