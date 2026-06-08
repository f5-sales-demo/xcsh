---
title: Task Agent Discovery and Selection
description: >-
  Task agent discovery and selection logic for routing work to specialized
  subagent types.
sidebar:
  order: 6
  label: Task agent discovery
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# การค้นหาและเลือก Task Agent

เอกสารนี้อธิบายวิธีที่ระบบย่อย task ค้นหาคำจำกัดความของ agent รวมจากหลายแหล่ง และแก้ไข agent ที่ร้องขอในเวลาดำเนินการ

เอกสารครอบคลุมพฤติกรรมรันไทม์ตามที่ถูกนำไปใช้งานในปัจจุบัน รวมถึงลำดับความสำคัญ การจัดการคำจำกัดความที่ไม่ถูกต้อง และข้อจำกัดด้าน spawn/depth ที่อาจทำให้ agent ไม่สามารถใช้งานได้ในทางปฏิบัติ

## ไฟล์การนำไปใช้งาน

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## รูปแบบคำจำกัดความของ Agent

Task agent จะถูกทำให้เป็นมาตรฐานเป็น `AgentDefinition` (`src/task/types.ts`):

- `name`, `description`, `systemPrompt` (จำเป็นสำหรับ agent ที่โหลดอย่างถูกต้อง)
- ตัวเลือกเพิ่มเติม `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- ตัวเลือกเพิ่มเติม `filePath`

การแยกวิเคราะห์มาจาก frontmatter ผ่าน `parseAgentFields()` (`src/discovery/helpers.ts`):

- `name` หรือ `description` ที่ขาดหาย => ไม่ถูกต้อง (`null`) ผู้เรียกถือว่าเป็นการแยกวิเคราะห์ล้มเหลว
- `tools` ยอมรับ CSV หรือ array; หากระบุ `submit_result` จะถูกเพิ่มโดยอัตโนมัติ
- `spawns` ยอมรับ `*`, CSV หรือ array
- พฤติกรรมความเข้ากันได้ย้อนหลัง: หาก `spawns` ขาดหายแต่ `tools` มี `task` อยู่ `spawns` จะกลายเป็น `*`
- `output` จะถูกส่งผ่านเป็นข้อมูล schema แบบทึบ

## Bundled agents

Bundled agent ถูกฝังในเวลา build (`src/task/agents.ts`) โดยใช้ text imports

`EMBEDDED_AGENT_DEFS` กำหนด:

- `explore`, `plan`, `designer`, `reviewer` จากไฟล์ prompt
- `task` และ `quick_task` จากเนื้อหา `task.md` ที่ใช้ร่วมกันบวกกับ frontmatter ที่ถูกฉีดเข้าไป

เส้นทางการโหลด:

1. `loadBundledAgents()` แยกวิเคราะห์ markdown ที่ฝังไว้ด้วย `parseAgent(..., "bundled", "fatal")`
2. ผลลัพธ์ถูกแคชในหน่วยความจำ (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` เป็นการรีเซ็ตแคชสำหรับการทดสอบเท่านั้น

เนื่องจากการแยกวิเคราะห์ bundled ใช้ `level: "fatal"` frontmatter ของ bundled ที่มีรูปแบบผิดจะ throw และอาจทำให้การค้นหาล้มเหลวทั้งหมด

## การค้นหาจากระบบไฟล์และปลั๊กอิน

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) รวม agent จากหลายแห่งก่อนที่จะเพิ่ม bundled definitions ต่อท้าย

### อินพุตของการค้นหา

1. ไดเรกทอรี agent จากการตั้งค่าผู้ใช้จาก `getConfigDirs("agents", { project: false })`
2. ไดเรกทอรี agent ของโปรเจกต์ที่ใกล้ที่สุดจาก `findAllNearestProjectConfigDirs("agents", cwd)`
3. Plugin roots ของ Claude (`listClaudePluginRoots(home)`) พร้อมไดเรกทอรีย่อย `agents/`
4. Bundled agents (`loadBundledAgents()`)

### ลำดับแหล่งที่มาจริง

ลำดับกลุ่มแหล่งที่มามาจาก `getConfigDirs("", { project: false })` ซึ่งได้มาจาก `priorityList` ใน `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

สำหรับแต่ละกลุ่มแหล่งที่มา ลำดับการค้นหาคือ:

1. ไดเรกทอรีโปรเจกต์ที่ใกล้ที่สุดสำหรับแหล่งนั้น (หากพบ)
2. ไดเรกทอรีผู้ใช้สำหรับแหล่งนั้น

หลังจากไดเรกทอรีกลุ่มแหล่งที่มาทั้งหมด ไดเรกทอรี `agents/` ของปลั๊กอินจะถูกเพิ่มต่อท้าย (ปลั๊กอินขอบเขตโปรเจกต์ก่อน จากนั้นขอบเขตผู้ใช้)

Bundled agents จะถูกเพิ่มต่อท้ายเป็นลำดับสุดท้าย

### ข้อควรระวังสำคัญ: คอมเมนต์ที่ล้าสมัย vs โค้ดปัจจุบัน

คอมเมนต์ส่วนหัวของ `discovery.ts` ยังกล่าวถึง `.pi` และไม่ได้กล่าวถึง `.codex`/`.gemini` ลำดับรันไทม์จริงถูกขับเคลื่อนโดย `src/config.ts` และปัจจุบันใช้ `.xcsh`, `.claude`, `.codex`, `.gemini`

## กฎการรวมและการชนกัน

การค้นหาใช้การตัดซ้ำแบบ first-wins ตาม `agent.name` ที่ตรงกันทุกประการ:

- `Set<string>` ติดตามชื่อที่เห็นแล้ว
- Agent ที่โหลดจะถูกแผ่ออกตามลำดับไดเรกทอรีและเก็บไว้เฉพาะหากชื่อยังไม่เคยเห็น
- Bundled agents ถูกกรองเทียบกับ set เดียวกันและจะถูกเพิ่มเฉพาะหากยังไม่เคยเห็น

ผลที่ตามมา:

- โปรเจกต์มีความสำคัญเหนือกว่าผู้ใช้สำหรับกลุ่มแหล่งที่มาเดียวกัน
- กลุ่มแหล่งที่มาที่มีความสำคัญสูงกว่ามีความสำคัญเหนือกว่ากลุ่มที่ต่ำกว่า (`.xcsh` ก่อน `.claude` เป็นต้น)
- Agent ที่ไม่ใช่ bundled มีความสำคัญเหนือกว่า bundled agents ที่มีชื่อเดียวกัน
- การจับคู่ชื่อเป็นแบบ case-sensitive (`Task` และ `task` เป็นคนละตัวกัน)
- ภายในไดเรกทอรีหนึ่ง ไฟล์ markdown จะถูกอ่านตามลำดับตัวอักษรของชื่อไฟล์ก่อนการตัดซ้ำ

## พฤติกรรมไฟล์ agent ที่ไม่ถูกต้อง/ขาดหาย

ต่อไดเรกทอรี (`loadAgentsFromDir`):

- ไดเรกทอรีที่อ่านไม่ได้/ขาดหาย: ถือว่าว่างเปล่า (`readdir(...).catch(() => [])`)
- การอ่านไฟล์หรือการแยกวิเคราะห์ล้มเหลว: บันทึกคำเตือน ข้ามไฟล์
- เส้นทางการแยกวิเคราะห์ใช้ `parseAgent(..., level: "warn")`

พฤติกรรมความล้มเหลวของ frontmatter มาจาก `parseFrontmatter`:

- ข้อผิดพลาดการแยกวิเคราะห์ที่ระดับ `warn` จะบันทึกคำเตือน
- ตัวแยกวิเคราะห์จะ fallback ไปยังตัวแยกวิเคราะห์แบบบรรทัด `key: value` แบบง่าย
- หากฟิลด์ที่จำเป็นยังขาดหายอยู่ `parseAgentFields` จะล้มเหลว จากนั้น `AgentParsingError` จะถูก throw และถูกจับโดยผู้เรียก (ข้ามไฟล์)

ผลสุทธิ: ไฟล์ custom agent ที่เสียหายหนึ่งไฟล์จะไม่ยกเลิกการค้นหาไฟล์อื่น

## การค้นหาและเลือก Agent

การค้นหาเป็นการค้นหาเชิงเส้นตามชื่อที่ตรงกันทุกประการ:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

ในการดำเนินการ task (`TaskTool.execute`):

1. agent จะถูกค้นหาใหม่ในเวลาเรียก (`discoverAgents(this.session.cwd)`)
2. `params.agent` ที่ร้องขอจะถูกแก้ไขผ่าน `getAgent`
3. agent ที่ขาดหายจะส่งคืนการตอบสนอง tool ทันที:
   - `Unknown agent "...". Available: ...`
   - ไม่มี subprocess ทำงาน

### คำอธิบาย vs การค้นหาเวลาดำเนินการ

`TaskTool.create()` สร้างคำอธิบาย tool จากผลการค้นหาในเวลาเริ่มต้น (`buildDescription`)

`execute()` ค้นหา agent ใหม่อีกครั้ง ดังนั้นชุดรันไทม์อาจแตกต่างจากสิ่งที่ถูกแสดงในคำอธิบาย tool ก่อนหน้าหากไฟล์ agent เปลี่ยนแปลงระหว่างเซสชัน

## การป้องกัน structured-output และลำดับความสำคัญของ schema

ลำดับความสำคัญของ output schema ในรันไทม์ใน `TaskTool.execute`:

1. `output` จาก frontmatter ของ agent
2. `params.schema` ของการเรียก task
3. `outputSchema` ของเซสชันหลัก

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

ข้อความการป้องกันในเวลา prompt ใน `src/prompts/tools/task.md` เตือนเกี่ยวกับพฤติกรรมที่ไม่ตรงกันสำหรับ agent ที่ใช้ structured-output (`explore`, `reviewer`): คำสั่งรูปแบบ output ในเนื้อหาอาจขัดแย้งกับ schema ในตัวและสร้าง output ที่เป็น `null`

นี่เป็นแนวทาง ไม่ใช่ตรรกะการตรวจสอบรันไทม์แบบเข้มงวดใน `discoverAgents`

## ปฏิสัมพันธ์ของการค้นหาคำสั่ง

`src/task/commands.ts` เป็นโครงสร้างพื้นฐานคู่ขนานสำหรับคำสั่ง workflow (ไม่ใช่คำจำกัดความของ agent) แต่ทำตามรูปแบบโดยรวมเดียวกัน:

- ค้นหาจาก capability providers ก่อน
- ตัดซ้ำตามชื่อด้วย first-wins
- เพิ่ม bundled commands ต่อท้ายหากยังไม่เคยเห็น
- ค้นหาตามชื่อที่ตรงกันทุกประการผ่าน `getCommand`

ใน `src/task/index.ts` ตัวช่วยคำสั่งจะถูก re-export ร่วมกับตัวช่วยการค้นหา agent การค้นหา agent เองไม่ได้ขึ้นอยู่กับการค้นหาคำสั่งในรันไทม์

## ข้อจำกัดความพร้อมใช้งานนอกเหนือจากการค้นหา

Agent อาจถูกค้นพบได้แต่ยังคงไม่พร้อมใช้งานเนื่องจากการป้องกันการดำเนินการ

### นโยบาย spawn ของ parent

`TaskTool.execute` ตรวจสอบ `session.getSessionSpawns()`:

- `"*"` => อนุญาตทุกตัว
- `""` => ปฏิเสธทั้งหมด
- รายการ CSV => อนุญาตเฉพาะชื่อที่ระบุ

หากถูกปฏิเสธ: การตอบสนองทันที `Cannot spawn '...'. Allowed: ...`

### ตัวป้องกัน self-recursion ผ่านตัวแปรสภาพแวดล้อมที่ถูกบล็อก

`PI_BLOCKED_AGENT` จะถูกอ่านในเวลาสร้าง tool หากคำขอตรงกัน การดำเนินการจะถูกปฏิเสธพร้อมข้อความป้องกันการเรียกซ้ำ

### การจำกัดความลึกของการเรียกซ้ำ (ความพร้อมใช้งานของ task tool ภายในเซสชันลูก)

ใน `runSubprocess` (`src/task/executor.ts`):

- ความลึกถูกคำนวณจาก `taskDepth`
- `task.maxRecursionDepth` ควบคุมจุดตัด
- เมื่อถึงความลึกสูงสุด:
  - `task` tool จะถูกลบออกจากรายการ tool ของลูก
  - `spawns` env ของลูกจะถูกตั้งค่าเป็นว่าง

ดังนั้นระดับที่ลึกกว่าจะไม่สามารถ spawn task เพิ่มเติมได้แม้ว่าคำจำกัดความ agent จะรวม `spawns` ไว้ก็ตาม

## ข้อควรระวังโหมด Plan (การนำไปใช้งานปัจจุบัน)

`TaskTool.execute` คำนวณ `effectiveAgent` สำหรับโหมด plan (เพิ่ม plan-mode prompt ข้างหน้า บังคับใช้ชุด tool แบบอ่านอย่างเดียว ล้าง spawns) แต่ `runSubprocess` ถูกเรียกด้วย `agent` แทนที่จะเป็น `effectiveAgent`

ผลในปัจจุบัน:

- model override / thinking level / output schema ถูกได้มาจาก `effectiveAgent`
- system prompt และข้อจำกัด tool/spawn จาก `effectiveAgent` ไม่ได้ถูกส่งผ่านในเส้นทางการเรียกนี้

นี่เป็นข้อควรระวังด้านการนำไปใช้งานที่ควรทราบเมื่ออ่านความคาดหวังพฤติกรรมของโหมด plan
