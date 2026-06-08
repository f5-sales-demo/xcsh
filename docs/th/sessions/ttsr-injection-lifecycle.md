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

เอกสารนี้ครอบคลุมเส้นทางรันไทม์ปัจจุบันของ Time Traveling Stream Rules (TTSR) ตั้งแต่การค้นพบกฎไปจนถึงการขัดจังหวะสตรีม, การฉีด retry, การแจ้งเตือน extension และการจัดการสถานะเซสชัน

## ไฟล์การอิมพลีเมนต์

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

เมื่อสร้างเซสชัน `createAgentSession()` จะโหลดกฎที่ค้นพบทั้งหมดและสร้าง `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### พฤติกรรมการกำจัดรายการซ้ำก่อนการลงทะเบียน

`loadCapability("rules")` กำจัดรายการซ้ำโดยใช้ `rule.name` ด้วยหลักการ first-wins (ลำดับความสำคัญของ provider สูงกว่ามาก่อน) รายการซ้ำที่ถูกบดบังจะถูกลบออกก่อนการลงทะเบียน TTSR

### พฤติกรรมของ `TtsrManager.addRule()`

การลงทะเบียนจะถูกข้ามเมื่อ:

- ไม่มี `rule.ttsrTrigger`
- กฎที่มี `rule.name` เดียวกันถูกลงทะเบียนแล้วใน manager นี้
- regex คอมไพล์ไม่สำเร็จ (`new RegExp(rule.ttsrTrigger)` โยนข้อผิดพลาด)

trigger ที่เป็น regex ไม่ถูกต้องจะถูกบันทึกเป็นคำเตือนและข้ามไป; การเริ่มต้นเซสชันยังคงดำเนินต่อ

### ข้อควรระวังเรื่องการตั้งค่า

`TtsrSettings.enabled` ถูกโหลดเข้า manager แต่ปัจจุบันยังไม่ถูกตรวจสอบในการควบคุมรันไทม์ หากมีกฎอยู่ การจับคู่จะยังคงทำงาน

## 2. วงจรชีวิตของ streaming monitor

การตรวจจับ TTSR ทำงานภายใน `AgentSession.#handleAgentEvent`

### เริ่มต้นเทิร์น

เมื่อ `turn_start` บัฟเฟอร์สตรีมจะถูกรีเซ็ต:

- `ttsrManager.resetBuffer()`

### ระหว่างสตรีม (`message_update`)

เมื่อมีการอัปเดตจาก assistant และมีกฎอยู่:

- ตรวจสอบ `text_delta` และ `toolcall_delta`
- เพิ่ม delta เข้าไปในบัฟเฟอร์ของ manager
- เรียก `check(buffer)`

`check()` วนซ้ำกฎที่ลงทะเบียนไว้และส่งคืนกฎทั้งหมดที่ตรงกันซึ่งผ่านนโยบายการทำซ้ำ (`#canTrigger`)

## 3. การตัดสินใจ trigger และเส้นทางยกเลิกทันที

เมื่อกฎหนึ่งข้อหรือมากกว่าตรงกัน:

1. `markInjected(matches)` บันทึกชื่อกฎในสถานะ injection ของ manager
2. กฎที่ตรงกันจะถูกจัดคิวใน `#pendingTtsrInjections`
3. `#ttsrAbortPending = true`
4. `agent.abort()` ถูกเรียกทันที
5. event `ttsr_triggered` ถูกปล่อยแบบ asynchronous (fire-and-forget)
6. งาน retry ถูกกำหนดเวลาผ่าน `setTimeout(..., 50)`

การยกเลิกจะไม่ถูกบล็อกเพื่อรอ callback ของ extension

## 4. การกำหนดเวลา retry, โหมดบริบท และการฉีด reminder

หลังจาก timeout 50ms:

1. `#ttsrAbortPending = false`
2. อ่าน `ttsrManager.getSettings().contextMode`
3. ถ้า `contextMode === "discard"` ให้ทิ้งเอาต์พุตบางส่วนของ assistant ด้วย `agent.popMessage()`
4. สร้างเนื้อหา injection จากกฎที่รอดำเนินการโดยใช้เทมเพลต `ttsr-interrupt.md`
5. เพิ่มข้อความผู้ใช้สังเคราะห์ที่มีบล็อก `<system-interrupt ...>` หนึ่งบล็อกต่อกฎ
6. เรียก `agent.continue()` เพื่อ retry การสร้าง

เพย์โหลดของเทมเพลตคือ:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

injection ที่รอดำเนินการจะถูกล้างหลังจากสร้างเนื้อหาแล้ว

### พฤติกรรมของ `contextMode` กับเอาต์พุตบางส่วน

- `discard`: ข้อความ assistant ที่ยังไม่สมบูรณ์/ถูกยกเลิกจะถูกลบออกก่อน retry
- `keep`: เอาต์พุตบางส่วนของ assistant ยังคงอยู่ในสถานะการสนทนา; reminder จะถูกเพิ่มต่อท้าย

## 5. นโยบายการทำซ้ำและตรรกะ gap

`TtsrManager` ติดตาม `#messageCount` และ `lastInjectedAt` ต่อกฎ

### `repeatMode: "once"`

กฎสามารถ trigger ได้เพียงครั้งเดียวหลังจากมีบันทึก injection แล้ว

### `repeatMode: "after-gap"`

กฎสามารถ trigger ซ้ำได้เมื่อ:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` เพิ่มขึ้นที่ `turn_end` ดังนั้น gap จะวัดเป็นเทิร์นที่เสร็จสมบูรณ์ ไม่ใช่ stream chunk

## 6. การปล่อย event และพื้นผิว extension/hook

### Event ของเซสชัน

`AgentSessionEvent` ประกอบด้วย:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Extension runner

`#emitSessionEvent()` ส่งต่อ event ไปยัง:

- listener ของ extension (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- subscriber ของเซสชันในเครื่อง

### การกำหนดชนิดของ hook และ custom-tool

- API ของ extension เปิดเผย `on("ttsr_triggered", ...)`
- API ของ hook เปิดเผย `on("ttsr_triggered", ...)`
- custom tool รับ `onSession({ reason: "ttsr_triggered", rules })`

### ความแตกต่างในการแสดงผลโหมดโต้ตอบ

โหมดโต้ตอบใช้ `session.isTtsrAbortPending` เพื่อระงับการแสดงเหตุผลการหยุดของ assistant ที่ถูกยกเลิกเป็นความล้มเหลวที่มองเห็นได้ระหว่างการขัดจังหวะ TTSR และแสดงผล `TtsrNotificationComponent` เมื่อ event มาถึง

## 7. การคงอยู่และสถานะการกลับมาทำงาน (การอิมพลีเมนต์ปัจจุบัน)

`SessionManager` มีการรองรับ schema เต็มรูปแบบสำหรับการคงอยู่ของกฎที่ถูกฉีด:

- ชนิด entry: `ttsr_injection`
- API เพิ่มข้อมูล: `appendTtsrInjection(ruleNames)`
- API สอบถาม: `getInjectedTtsrRules()`
- การสร้างบริบทใหม่รวม `SessionContext.injectedTtsrRules`

`TtsrManager` ยังรองรับการกู้คืนผ่าน `restoreInjected(ruleNames)`

### สถานะการเชื่อมต่อปัจจุบัน

ในเส้นทางรันไทม์ปัจจุบัน:

- `AgentSession` ไม่เพิ่ม entry `ttsr_injection` เมื่อ TTSR trigger
- `createAgentSession()` ไม่กู้คืน `existingSession.injectedTtsrRules` กลับเข้า `ttsrManager`

ผลสุทธิ: การระงับกฎที่ถูกฉีดมีผลบังคับใช้ในหน่วยความจำสำหรับกระบวนการที่กำลังทำงาน แต่ปัจจุบันไม่ได้ถูกคงอยู่/กู้คืนข้ามการโหลดซ้ำ/กลับมาทำงานของเซสชันในเส้นทางนี้

## 8. ขอบเขตของ race และการรับประกันลำดับ

### Abort vs retry callback

- abort เป็น synchronous จากมุมมองของ handler TTSR (`agent.abort()` ถูกเรียกทันที)
- retry ถูกเลื่อนออกไปด้วย timer (`50ms`)
- การแจ้งเตือน extension เป็น asynchronous และตั้งใจไม่ await ก่อนการกำหนดเวลา abort/retry

### หลาย match ในหน้าต่างสตรีมเดียวกัน

`check()` ส่งคืนกฎที่มีสิทธิ์ตรงกันทั้งหมดในปัจจุบัน กฎเหล่านี้จะถูกฉีดเป็นชุดในข้อความ retry ถัดไป

### ระหว่าง abort และ continue

ระหว่างหน้าต่างเวลาของ timer สถานะอาจเปลี่ยนแปลงได้ (การขัดจังหวะจากผู้ใช้, การดำเนินการโหมด, event เพิ่มเติม) การเรียก retry เป็นแบบ best-effort: `agent.continue().catch(() => {})` กลืนข้อผิดพลาดที่ตามมา

## 9. สรุปกรณีขอบ

- regex `ttsr_trigger` ไม่ถูกต้อง: ถูกข้ามพร้อมคำเตือน; กฎอื่นยังคงทำงานต่อ
- ชื่อกฎซ้ำกันที่ชั้น capability: รายการซ้ำที่มีลำดับความสำคัญต่ำกว่าจะถูกบดบังก่อนการลงทะเบียน
- ชื่อซ้ำกันที่ชั้น manager: การลงทะเบียนครั้งที่สองจะถูกข้ามไป
- `contextMode: "keep"`: เอาต์พุตบางส่วนที่ละเมิดสามารถยังคงอยู่ในบริบทก่อน retry ด้วย reminder
- repeat-after-gap ขึ้นอยู่กับการเพิ่มจำนวนเทิร์นที่ `turn_end`; chunk ระหว่างเทิร์นจะไม่เลื่อนตัวนับ gap
