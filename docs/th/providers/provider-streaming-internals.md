---
title: รายละเอียดภายในของการสตรีมมิ่งของ Provider
description: >-
  การใช้งานการสตรีมมิ่งของ Provider พร้อมการแยกวิเคราะห์ SSE, การนับโทเค็น,
  และการจัดการ backpressure
sidebar:
  order: 2
  label: รายละเอียดภายในของการสตรีมมิ่ง
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# รายละเอียดภายในของการสตรีมมิ่งของ Provider

เอกสารนี้อธิบายวิธีการทำให้การสตรีมมิ่งของโทเค็น/เครื่องมือเป็นมาตรฐานใน `@f5xc-salesdemos/pi-ai` จากนั้นส่งต่อผ่าน `@f5xc-salesdemos/pi-agent-core` และอีเวนต์เซสชันของ `coding-agent`

## ลำดับการทำงานแบบครบวงจร

1. `streamSimple()` (`packages/ai/src/stream.ts`) แมปตัวเลือกทั่วไปและส่งต่อไปยังฟังก์ชันสตรีมของ provider
2. ฟังก์ชันสตรีมของ provider (`anthropic.ts`, `openai-responses.ts`, `google.ts`) แปลงอีเวนต์สตรีมเฉพาะของ provider ให้เป็นลำดับ `AssistantMessageEvent` แบบรวม
3. แต่ละ provider ผลักอีเวนต์เข้าสู่ `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`) ซึ่งจำกัดอัตราอีเวนต์เดลต้าและเปิดเผย:
   - การวนซ้ำแบบ async สำหรับการอัปเดตแบบเพิ่มทีละส่วน
   - `result()` สำหรับ `AssistantMessage` สุดท้าย
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) บริโภคอีเวนต์เหล่านั้น ปรับเปลี่ยนสถานะผู้ช่วยที่กำลังดำเนินอยู่ และส่งออกอีเวนต์ `message_update` ที่มี `assistantMessageEvent` ดิบ
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) สมัครรับอีเวนต์ของเอเจนต์ จัดเก็บข้อความ ขับเคลื่อน hook ของส่วนขยาย และใช้พฤติกรรมเซสชัน (ลองใหม่, การบีบอัด, TTSR, การตรวจสอบยกเลิกการแก้ไขแบบสตรีมมิ่ง)

## สัญญาสตรีมแบบรวมใน `@f5xc-salesdemos/pi-ai`

provider ทั้งหมดส่งออกรูปแบบเดียวกัน (`AssistantMessageEvent` ใน `packages/ai/src/types.ts`):

- `start`
- ชุดวงจรชีวิตของบล็อกเนื้อหา:
  - ข้อความ: `text_start` → `text_delta`* → `text_end`
  - การคิด: `thinking_start` → `thinking_delta`* → `thinking_end`
  - การเรียกเครื่องมือ: `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- อีเวนต์สิ้นสุด:
  - `done` พร้อม `reason: "stop" | "length" | "toolUse"`
  - หรือ `error` พร้อม `reason: "aborted" | "error"`

`AssistantMessageEventStream` รับประกัน:

- ผลลัพธ์สุดท้ายถูกแก้ไขโดยอีเวนต์สิ้นสุด (`done` หรือ `error`)
- เดลต้าถูกรวมกลุ่ม/จำกัดอัตรา (~50ms)
- เดลต้าที่บัฟเฟอร์ไว้จะถูกส่งออกก่อนอีเวนต์ที่ไม่ใช่เดลต้าและก่อนการเสร็จสมบูรณ์

## พฤติกรรมการจำกัดอัตราเดลต้าและการปรับให้สอดคล้อง

`AssistantMessageEventStream` ถือว่า `text_delta`, `thinking_delta`, และ `toolcall_delta` เป็นอีเวนต์ที่สามารถรวมได้:

- เดลต้าที่บัฟเฟอร์ไว้จะถูกรวมเฉพาะเมื่อ **type + contentIndex** ตรงกัน
- การรวมจะเก็บสแนปช็อต `partial` ล่าสุด
- อีเวนต์ที่ไม่ใช่เดลต้าจะบังคับให้ส่งออกทันที

สิ่งนี้ทำให้สตรีมของ provider ที่มีความถี่สูงราบรื่นสำหรับผู้บริโภค TUI/อีเวนต์ แต่ไม่ใช่ backpressure ของ provider: provider ยังคงผลิตด้วยความเร็วเต็มที่ ในขณะที่สตรีมท้องถิ่นจะบัฟเฟอร์

## รายละเอียดการทำให้เป็นมาตรฐานของ Provider

## Anthropic (`anthropic-messages`)

ซอร์ส: `packages/ai/src/providers/anthropic.ts`

จุดทำให้เป็นมาตรฐาน:

- `message_start` เริ่มต้นการใช้งาน (โทเค็นอินพุต/เอาต์พุต/แคช)
- `content_block_start` แมปไปยังการเริ่มต้น text/thinking/toolcall
- `content_block_delta` แมป:
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` อัปเดต `thinkingSignature` เท่านั้น (ไม่มีอีเวนต์)
- `content_block_stop` ส่งออก `*_end` ที่เกี่ยวข้อง
- `message_delta.stop_reason` แมปผ่าน `mapStopReason()`

การสตรีมมิ่งอาร์กิวเมนต์ของการเรียกเครื่องมือ:

- แต่ละบล็อกเครื่องมือมี `partialJson` ภายใน
- ทุกเดลต้า JSON ต่อท้ายเข้า `partialJson`
- `arguments` ถูกแยกวิเคราะห์ใหม่ในแต่ละเดลต้าผ่าน `parseStreamingJson()`
- `toolcall_end` แยกวิเคราะห์อีกครั้ง จากนั้นลบ `partialJson`

## OpenAI Responses (`openai-responses`)

ซอร์ส: `packages/ai/src/providers/openai-responses.ts`

จุดทำให้เป็นมาตรฐาน:

- `response.output_item.added` เริ่มบล็อก reasoning/text/function-call
- อีเวนต์สรุปการให้เหตุผล (`response.reasoning_summary_text.delta`) กลายเป็น `thinking_delta`
- เดลต้า output/refusal กลายเป็น `text_delta`
- `response.function_call_arguments.delta` กลายเป็น `toolcall_delta`
- `response.output_item.done` ส่งออก `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` แมปสถานะไปยังเหตุผลการหยุดและการใช้งาน

การสตรีมมิ่งอาร์กิวเมนต์ของการเรียกเครื่องมือ:

- รูปแบบการสะสม `partialJson` เดียวกับ Anthropic
- provider ที่ส่งเฉพาะ `response.function_call_arguments.done` ยังคงเติมอาร์กิวเมนต์สุดท้าย
- ID ของการเรียกเครื่องมือถูกทำให้เป็นมาตรฐานเป็น `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

ซอร์ส: `packages/ai/src/providers/google.ts`

จุดทำให้เป็นมาตรฐาน:

- วนซ้ำ `candidate.content.parts`
- ส่วนข้อความถูกแยกเป็น thinking กับ text โดย `isThinkingPart(part)`
- การเปลี่ยนบล็อกจะปิดบล็อกก่อนหน้าก่อนเริ่มบล็อกใหม่
- `part.functionCall` ถูกถือว่าเป็นการเรียกเครื่องมือที่สมบูรณ์ (start/delta/end ถูกส่งออกทันที)
- เหตุผลการเสร็จสิ้นแมปโดย `mapStopReason()` จาก `google-shared.ts`

การสตรีมมิ่งอาร์กิวเมนต์ของการเรียกเครื่องมือ:

- อาร์กิวเมนต์ function call มาถึงเป็นออบเจกต์ที่มีโครงสร้าง ไม่ใช่ข้อความ JSON แบบเพิ่มทีละส่วน
- การใช้งานส่งออก `toolcall_delta` สังเคราะห์หนึ่งรายการที่มี `JSON.stringify(arguments)`
- ไม่จำเป็นต้องใช้ตัวแยกวิเคราะห์ JSON แบบบางส่วนสำหรับ Google ในเส้นทางนี้

## การสะสม JSON แบบบางส่วนของการเรียกเครื่องมือและการกู้คืน

พฤติกรรมร่วมสำหรับ Anthropic/OpenAI Responses ใช้ `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`):

1. ลอง `JSON.parse`
2. ถอยกลับไปใช้ตัวแยกวิเคราะห์ `partial-json` สำหรับชิ้นส่วนที่ไม่สมบูรณ์
3. หากทั้งสองล้มเหลว คืนค่า `{}`

ผลกระทบ:

- เดลต้าอาร์กิวเมนต์ที่ผิดรูปแบบหรือถูกตัดจะไม่ทำให้การประมวลผลสตรีมล่มทันที
- `arguments` ที่กำลังดำเนินอยู่อาจเป็น `{}` ชั่วคราว
- เดลต้าที่ถูกต้องในภายหลังสามารถกู้คืนอาร์กิวเมนต์ที่มีโครงสร้างได้เพราะการแยกวิเคราะห์ถูกลองใหม่ในทุกครั้งที่ต่อท้าย
- `toolcall_end` สุดท้ายจะลองแยกวิเคราะห์อีกครั้งก่อนการส่งออก

## เหตุผลการหยุดเทียบกับข้อผิดพลาดของการขนส่ง/รันไทม์

เหตุผลการหยุดของ provider ถูกแมปไปยัง `stopReason` ที่เป็นมาตรฐาน:

- Anthropic: `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, กรณีความปลอดภัย/การปฏิเสธ→`error`
- OpenAI Responses: `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google: `STOP`→`stop`, `MAX_TOKENS`→`length`, ประเภทความปลอดภัย/ห้าม/function-call ผิดรูปแบบ→`error`

ความหมายของข้อผิดพลาดถูกแบ่งเป็นสองขั้นตอน:

1. **ความหมายการเสร็จสมบูรณ์ของโมเดล** (เหตุผลการเสร็จสิ้น/สถานะที่ provider รายงาน)
2. **ความล้มเหลวของการขนส่ง/รันไทม์** (ข้อยกเว้นเครือข่าย/ไคลเอนต์/ตัวแยกวิเคราะห์/ยกเลิก)

หากสตรีมของ provider โยนข้อยกเว้นหรือส่งสัญญาณความล้มเหลว ตัวห่อหุ้มของแต่ละ provider จะจับและส่งออกอีเวนต์สิ้นสุด `error` พร้อม:

- `stopReason = "aborted"` เมื่อสัญญาณยกเลิกถูกตั้ง
- มิฉะนั้น `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## พฤติกรรมเมื่อชิ้นส่วนผิดรูปแบบ / การแยกวิเคราะห์ SSE ล้มเหลว

สำหรับเส้นทาง provider เหล่านี้ การจัดกรอบ chunk/SSE จัดการโดยสตรีมของ SDK ของผู้จำหน่าย (Anthropic SDK, OpenAI SDK, Google SDK) โค้ดนี้ไม่ได้ใช้ตัวถอดรหัส SSE แบบกำหนดเองที่นี่

พฤติกรรมที่สังเกตได้ในการใช้งานปัจจุบัน:

- การแยกวิเคราะห์ chunk/SSE ที่ผิดรูปแบบในระดับ SDK จะปรากฏเป็นข้อยกเว้นหรืออีเวนต์ `error` ของสตรีม
- ตัวห่อหุ้มของ provider แปลงสิ่งนั้นเป็นอีเวนต์สิ้นสุด `error` แบบรวม
- ไม่มีการดำเนินการต่อ/ลองใหม่เฉพาะ provider ภายในฟังก์ชันสตรีมเอง
- การลองใหม่ในระดับสูงกว่าจัดการใน logic การลองใหม่อัตโนมัติของ `AgentSession` (การลองใหม่ระดับข้อความ ไม่ใช่การเล่นซ้ำ stream-chunk)

## ขอบเขตการยกเลิก

การยกเลิกมีหลายชั้น:

- คำขอ AI provider: `options.signal` ถูกส่งเข้าสู่การเรียกสตรีมของไคลเอนต์ provider
- ตัวห่อหุ้ม provider: หลังจากลูปสตรีม สัญญาณที่ถูกยกเลิกจะบังคับเส้นทางข้อผิดพลาด (`"Request was aborted"`)
- ลูปเอเจนต์: ตรวจสอบ `signal.aborted` ก่อนจัดการแต่ละอีเวนต์ของ provider และสามารถสังเคราะห์ข้อความผู้ช่วยที่ถูกยกเลิกจากบางส่วนล่าสุด
- การควบคุมเซสชัน/เอเจนต์: `AgentSession.abort()` -> `agent.abort()` -> การยกเลิกตัวควบคุมยกเลิกที่ใช้ร่วมกัน

การยกเลิกการทำงานของเครื่องมือแยกจากการยกเลิกสตรีมของโมเดล:

- ตัวรันเครื่องมือใช้ `AbortSignal.any([agentSignal, steeringAbortSignal])`
- การขัดจังหวะแบบ steering สามารถยกเลิกการทำงานของเครื่องมือที่เหลือในขณะที่รักษาผลลัพธ์เครื่องมือที่ผลิตไปแล้ว

## ขอบเขต Backpressure

ไม่มีกลไก backpressure แบบเข้มงวดระหว่างสตรีม SDK ของ provider และผู้บริโภคปลายทาง:

- `EventStream` ใช้คิวในหน่วยความจำที่ไม่มีขนาดสูงสุด
- การจำกัดอัตราลดอัตราการอัปเดต UI แต่ไม่ได้ชะลอการรับจาก provider
- หากผู้บริโภคล่าช้าอย่างมาก อีเวนต์ที่อยู่ในคิวสามารถเพิ่มขึ้นจนกว่าจะเสร็จสมบูรณ์

การออกแบบปัจจุบันให้ความสำคัญกับการตอบสนองและลำดับที่เรียบง่ายมากกว่าการควบคุมการไหลแบบบัฟเฟอร์จำกัด

## วิธีที่อีเวนต์สตรีมปรากฏเป็นอีเวนต์ของเอเจนต์/เซสชัน

`agentLoop.streamAssistantResponse()` เชื่อมต่อ `AssistantMessageEvent` กับ `AgentEvent`:

- เมื่อ `start`: ผลักข้อความผู้ช่วยแบบตัวยึดตำแหน่งและส่งออก `message_start`
- เมื่ออีเวนต์บล็อก (`text_*`, `thinking_*`, `toolcall_*`): อัปเดตข้อความผู้ช่วยล่าสุด ส่งออก `message_update` พร้อม `assistantMessageEvent` ดิบ
- เมื่อสิ้นสุด (`done`/`error`): แก้ไขข้อความสุดท้ายจาก `response.result()` ส่งออก `message_end`

จากนั้น `AgentSession` บริโภคอีเวนต์เหล่านั้นสำหรับพฤติกรรมระดับเซสชัน:

- TTSR เฝ้าดู `message_update.assistantMessageEvent` สำหรับ `text_delta` และ `toolcall_delta`
- ตัวป้องกันการแก้ไขแบบสตรีมมิ่งตรวจสอบ `toolcall_delta`/`toolcall_end` ในการเรียก `edit` และสามารถยกเลิกก่อนได้
- การจัดเก็บข้อมูลเขียนข้อความที่สิ้นสุดแล้วที่ `message_end`
- การลองใหม่อัตโนมัติตรวจสอบ `stopReason === "error"` ของผู้ช่วย พร้อมฮิวริสติกส์ `errorMessage`

## ความรับผิดชอบแบบรวมเทียบกับเฉพาะ Provider

แบบรวม (สัญญาร่วม):

- รูปแบบอีเวนต์ (`AssistantMessageEvent`)
- การดึงผลลัพธ์สุดท้าย (`done`/`error`)
- กฎการจำกัดอัตราเดลต้า + การรวม
- โมเดลการเผยแพร่อีเวนต์ของเอเจนต์/เซสชัน

เฉพาะ Provider (ไม่ได้แยกออกอย่างสมบูรณ์):

- อนุกรมวิธานอีเวนต์ต้นทางและ logic การแมป
- ตารางการแปลเหตุผลการหยุด
- แบบแผน ID ของการเรียกเครื่องมือ
- ความหมายของบล็อก reasoning/thinking และลายเซ็น
- ความหมายของโทเค็นการใช้งานและเวลาที่พร้อมใช้งาน
- ข้อจำกัดการแปลงข้อความต่อ API

## ไฟล์การใช้งาน

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — การส่งต่อ provider, การแมปตัวเลือก, การเชื่อมต่อ API key/เซสชัน
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — คิวสตรีมทั่วไป + การจำกัดอัตราเดลต้าของผู้ช่วย
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — การแยกวิเคราะห์ JSON แบบบางส่วนสำหรับอาร์กิวเมนต์เครื่องมือที่สตรีม
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — การแปลอีเวนต์ Anthropic และการสะสมเดลต้า JSON ของเครื่องมือ
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — การแปลอีเวนต์ OpenAI Responses และการแมปสถานะ
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — การแปล chunk-to-block ของสตรีม Gemini
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — การแมปเหตุผลการเสร็จสิ้นของ Gemini และกฎการแปลงร่วม
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — การบริโภคสตรีม provider และการเชื่อมต่อ `message_update`
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — การจัดการระดับเซสชันของการอัปเดตแบบสตรีมมิ่ง, การยกเลิก, การลองใหม่, และการจัดเก็บข้อมูล
