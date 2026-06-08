---
title: TTSR Injection Lifecycle
description: >-
  TTSR (tool-use, tool-result, system-reminder) injection lifecycle for context
  management.
sidebar:
  order: 9
  label: TTSR injection
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# วงจรชีวิตของ TTSR Injection

เอกสารนี้ครอบคลุมเส้นทางการทำงานปัจจุบันของ Time Traveling Stream Rules (TTSR) ตั้งแต่การค้นพบกฎไปจนถึงการขัดจังหวะสตรีม, การ inject ในรอบ retry, การแจ้งเตือน extension และการจัดการ session-state

## ไฟล์การ implement

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. ฟีดการค้นพบและการลงทะเบียนกฎ

เมื่อสร้าง session, `createAgentSession()` จะโหลดกฎที่ค้นพบทั้งหมดและสร้าง `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### พฤติกรรมการตัดรายการซ้ำก่อนลงทะเบียน

`loadCapability("rules")` จะตัดรายการซ้ำโดยใช้ `rule.name` ด้วยความหมายว่าตัวแรกชนะ (ลำดับความสำคัญของ provider ที่สูงกว่ามาก่อน) รายการซ้ำที่ถูกบดบังจะถูกลบออกก่อนการลงทะเบียน TTSR

### พฤติกรรมของ `TtsrManager.addRule()`

การลงทะเบียนจะถูกข้ามเมื่อ:

- `rule.ttsrTrigger` ไม่มีอยู่
- กฎที่มี `rule.name` เดียวกันถูกลงทะเบียนไว้แล้วใน manager นี้
- regex คอมไพล์ไม่สำเร็จ (`new RegExp(rule.ttsrTrigger)` โยน error)

Trigger ที่เป็น regex ไม่ถูกต้องจะถูกบันทึกเป็นคำเตือนและถูกละเว้น การเริ่มต้น session จะดำเนินต่อไป

### ข้อควรระวังเรื่องการตั้งค่า

`TtsrSettings.enabled` ถูกโหลดเข้า manager แต่ปัจจุบันไม่ได้ถูกตรวจสอบในการควบคุมระหว่าง runtime หากมีกฎอยู่ การจับคู่จะยังคงทำงาน

## 2. วงจรชีวิตของ Streaming Monitor

การตรวจจับ TTSR ทำงานภายใน `AgentSession.#handleAgentEvent`

### เริ่มต้นเทิร์น

เมื่อ `turn_start` เกิดขึ้น บัฟเฟอร์สตรีมจะถูกรีเซ็ต:

- `ttsrManager.resetBuffer()`

### ระหว่างการสตรีม (`message_update`)

เมื่อมีการอัปเดตจาก assistant และมีกฎอยู่:

- ตรวจสอบ `text_delta` และ `toolcall_delta`
- เพิ่ม delta เข้าบัฟเฟอร์ของ manager
- เรียก `check(buffer)`

`check()` จะวนซ้ำกฎที่ลงทะเบียนไว้และคืนค่ากฎทั้งหมดที่ตรงกันและผ่านนโยบายการทำซ้ำ (`#canTrigger`)

## 3. การตัดสินใจ trigger และเส้นทางการยกเลิกทันที

เมื่อมีกฎหนึ่งข้อขึ้นไปที่ตรงกัน:

1. `markInjected(matches)` จะบันทึกชื่อกฎในสถานะ injection ของ manager
2. กฎที่ตรงกันจะถูกจัดคิวใน `#pendingTtsrInjections`
3. `#ttsrAbortPending = true`
4. `agent.abort()` จะถูกเรียกทันที
5. event `ttsr_triggered` จะถูก emit แบบ asynchronous (fire-and-forget)
6. งาน retry จะถูกกำหนดเวลาผ่าน `setTimeout(..., 50)`

การยกเลิกจะไม่ถูกบล็อกรอ callback ของ extension

## 4. การกำหนดเวลา retry, โหมด context และการ inject reminder

หลังจาก timeout 50ms:

1. `#ttsrAbortPending = false`
2. อ่าน `ttsrManager.getSettings().contextMode`
3. ถ้า `contextMode === "discard"` จะทิ้งผลลัพธ์บางส่วนของ assistant ด้วย `agent.popMessage()`
4. สร้างเนื้อหา injection จากกฎที่รอดำเนินการโดยใช้เทมเพลต `ttsr-interrupt.md`
5. เพิ่มข้อความผู้ใช้สังเคราะห์ที่มีบล็อก `<system-interrupt ...>` หนึ่งบล็อกต่อกฎ
6. เรียก `agent.continue()` เพื่อ retry การสร้าง

payload ของเทมเพลตคือ:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

Injection ที่รอดำเนินการจะถูกล้างหลังจากสร้างเนื้อหา

### พฤติกรรมของ `contextMode` กับผลลัพธ์บางส่วน

- `discard`: ข้อความ assistant ที่ถูกยกเลิก/บางส่วนจะถูกลบออกก่อน retry
- `keep`: ผลลัพธ์บางส่วนของ assistant จะยังคงอยู่ในสถานะการสนทนา; reminder จะถูกเพิ่มต่อท้าย

## 5. นโยบายการทำซ้ำและตรรกะ gap

`TtsrManager` ติดตาม `#messageCount` และ `lastInjectedAt` ต่อกฎแต่ละข้อ

### `repeatMode: "once"`

กฎจะ trigger ได้เพียงครั้งเดียวหลังจากมีบันทึก injection แล้ว

### `repeatMode: "after-gap"`

กฎจะ trigger ซ้ำได้เมื่อ:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` จะเพิ่มขึ้นเมื่อ `turn_end` ดังนั้น gap จะถูกวัดเป็นเทิร์นที่เสร็จสมบูรณ์ ไม่ใช่ stream chunk

## 6. การ emit event และพื้นผิว extension/hook

### Event ของ session

`AgentSessionEvent` ประกอบด้วย:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Extension runner

`#emitSessionEvent()` จะส่ง event ไปยัง:

- ตัวรับฟัง extension (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- ผู้สมัครสมาชิก session ภายใน

### การกำหนดชนิดของ Hook และ custom-tool

- extension API เปิดเผย `on("ttsr_triggered", ...)`
- hook API เปิดเผย `on("ttsr_triggered", ...)`
- custom tool ได้รับ `onSession({ reason: "ttsr_triggered", rules })`

### ความแตกต่างในการแสดงผลโหมดโต้ตอบ

โหมดโต้ตอบใช้ `session.isTtsrAbortPending` เพื่อระงับการแสดงเหตุผลการหยุดของ assistant ที่ถูกยกเลิกในรูปแบบความล้มเหลวที่มองเห็นได้ระหว่างการขัดจังหวะ TTSR และแสดง `TtsrNotificationComponent` เมื่อ event มาถึง

## 7. การเก็บข้อมูลถาวรและสถานะการกลับมาทำงาน (การ implement ปัจจุบัน)

`SessionManager` มีการรองรับ schema เต็มรูปแบบสำหรับการเก็บข้อมูลกฎที่ถูก inject:

- ชนิดรายการ: `ttsr_injection`
- API สำหรับเพิ่ม: `appendTtsrInjection(ruleNames)`
- API สำหรับสอบถาม: `getInjectedTtsrRules()`
- การสร้าง context ใหม่รวมถึง `SessionContext.injectedTtsrRules`

`TtsrManager` ยังรองรับการกู้คืนผ่าน `restoreInjected(ruleNames)`

### สถานะการเชื่อมต่อปัจจุบัน

ในเส้นทางการทำงานปัจจุบัน:

- `AgentSession` ไม่ได้เพิ่มรายการ `ttsr_injection` เมื่อ TTSR ถูก trigger
- `createAgentSession()` ไม่ได้กู้คืน `existingSession.injectedTtsrRules` กลับเข้า `ttsrManager`

ผลกระทบสุทธิ: การระงับกฎที่ถูก inject จะมีผลในหน่วยความจำสำหรับกระบวนการที่ทำงานอยู่เท่านั้น แต่ปัจจุบันยังไม่มีการเก็บข้อมูลถาวร/กู้คืนข้ามการโหลดใหม่/กลับมาทำงานของ session ผ่านเส้นทางนี้

## 8. ขอบเขตของ race condition และการรับประกันลำดับ

### Abort กับ retry callback

- abort เป็น synchronous จากมุมมองของ TTSR handler (`agent.abort()` ถูกเรียกทันที)
- retry ถูกเลื่อนออกไปด้วย timer (`50ms`)
- การแจ้งเตือน extension เป็น asynchronous และตั้งใจไม่รอก่อนการกำหนดเวลา abort/retry

### การจับคู่หลายรายการในหน้าต่างสตรีมเดียวกัน

`check()` จะคืนค่ากฎที่มีสิทธิ์ตรงกันทั้งหมดในปัจจุบัน กฎเหล่านี้จะถูก inject เป็นชุดเดียวในข้อความ retry ถัดไป

### ระหว่าง abort กับ continue

ระหว่างหน้าต่าง timer สถานะอาจเปลี่ยนแปลงได้ (การขัดจังหวะจากผู้ใช้, การดำเนินการโหมด, event เพิ่มเติม) การเรียก retry เป็นแบบ best-effort: `agent.continue().catch(() => {})` จะกลืน error ที่ตามมา

## 9. สรุปกรณีพิเศษ

- regex `ttsr_trigger` ไม่ถูกต้อง: ถูกข้ามพร้อมคำเตือน; กฎอื่นยังคงทำงานต่อ
- ชื่อกฎซ้ำกันที่ชั้น capability: รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะถูกบดบังก่อนการลงทะเบียน
- ชื่อซ้ำกันที่ชั้น manager: การลงทะเบียนครั้งที่สองจะถูกละเว้น
- `contextMode: "keep"`: ผลลัพธ์บางส่วนที่ละเมิดกฎอาจยังคงอยู่ใน context ก่อนการ retry ด้วย reminder
- Repeat-after-gap ขึ้นอยู่กับการเพิ่มจำนวนเทิร์นที่ `turn_end`; chunk ระหว่างเทิร์นจะไม่เลื่อนตัวนับ gap
