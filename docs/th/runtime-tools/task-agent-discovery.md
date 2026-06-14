---
title: การค้นพบและการเลือก Task Agent
description: >-
  ตรรกะการค้นพบและการเลือก task agent สำหรับการกำหนดเส้นทางงานไปยัง subagent
  ประเภทเฉพาะทาง
sidebar:
  order: 6
  label: การค้นพบ Task agent
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# การค้นพบและการเลือก Task Agent

เอกสารนี้อธิบายวิธีที่ระบบย่อย task ค้นพบคำจำกัดความของ agent ผสานหลายแหล่งเข้าด้วยกัน และแก้ไข agent ที่ร้องขอในเวลาประมวลผล

เนื้อหาครอบคลุมพฤติกรรม runtime ตามที่นำไปใช้งานในปัจจุบัน รวมถึงลำดับความสำคัญ การจัดการคำจำกัดความที่ไม่ถูกต้อง และข้อจำกัดด้าน spawn/depth ที่อาจทำให้ agent ไม่สามารถใช้งานได้จริง

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

- `name`, `description`, `systemPrompt` (จำเป็นสำหรับ agent ที่โหลดได้อย่างถูกต้อง)
- ตัวเลือก `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- ตัวเลือก `filePath`

การแยกวิเคราะห์มาจาก frontmatter ผ่าน `parseAgentFields()` (`src/discovery/helpers.ts`):

- ขาด `name` หรือ `description` => ไม่ถูกต้อง (`null`) ผู้เรียกถือว่าเป็นความล้มเหลวในการแยกวิเคราะห์
- `tools` รับ CSV หรืออาร์เรย์ หากระบุ จะเพิ่ม `submit_result` โดยอัตโนมัติ
- `spawns` รับ `*`, CSV หรืออาร์เรย์
- พฤติกรรมความเข้ากันได้ย้อนหลัง: หาก `spawns` ขาดหายแต่ `tools` มี `task` อยู่ `spawns` จะกลายเป็น `*`
- `output` จะถูกส่งต่อเป็นข้อมูล schema แบบ opaque

## Bundled Agents

Bundled agents จะถูกฝังไว้ในเวลา build (`src/task/agents.ts`) โดยใช้การ import ข้อความ

`EMBEDDED_AGENT_DEFS` กำหนด:

- `explore`, `plan`, `designer`, `reviewer` จากไฟล์ prompt
- `task` และ `quick_task` จาก body ของ `task.md` ที่ใช้ร่วมกัน บวกกับ frontmatter ที่ inject เข้ามา

เส้นทางการโหลด:

1. `loadBundledAgents()` แยกวิเคราะห์ markdown ที่ฝังด้วย `parseAgent(..., "bundled", "fatal")`
2. ผลลัพธ์จะถูกแคชไว้ในหน่วยความจำ (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` ใช้สำหรับรีเซ็ตแคชในการทดสอบเท่านั้น

เนื่องจากการแยกวิเคราะห์ bundled ใช้ `level: "fatal"` frontmatter ที่มีรูปแบบผิดจะ throw และอาจทำให้การค้นพบล้มเหลวทั้งหมด

## การค้นพบจากระบบไฟล์และปลั๊กอิน

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) ผสาน agent จากหลายแหล่งก่อนที่จะต่อท้ายคำจำกัดความแบบ bundled

### อินพุตการค้นพบ

1. ไดเรกทอรี agent ของ user config จาก `getConfigDirs("agents", { project: false })`
2. ไดเรกทอรี agent ของ project ที่ใกล้ที่สุดจาก `findAllNearestProjectConfigDirs("agents", cwd)`
3. Claude plugin roots (`listClaudePluginRoots(home)`) พร้อม subdirectory `agents/`
4. Bundled agents (`loadBundledAgents()`)

### ลำดับแหล่งข้อมูลจริง

ลำดับของกลุ่มแหล่งข้อมูลมาจาก `getConfigDirs("", { project: false })` ซึ่งได้มาจาก `priorityList` ใน `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

สำหรับแต่ละกลุ่มแหล่งข้อมูล ลำดับการค้นพบคือ:

1. ไดเรกทอรี project ที่ใกล้ที่สุดสำหรับแหล่งข้อมูลนั้น (หากพบ)
2. ไดเรกทอรี user สำหรับแหล่งข้อมูลนั้น

หลังจากไดเรกทอรีกลุ่มแหล่งข้อมูลทั้งหมด ไดเรกทอรี `agents/` ของปลั๊กอินจะถูกต่อท้าย (ปลั๊กอิน project-scope ก่อน จากนั้น user-scope)

Bundled agents จะถูกต่อท้ายเป็นลำดับสุดท้าย

### ข้อควรระวังสำคัญ: ความคิดเห็นที่ล้าสมัย vs โค้ดปัจจุบัน

ความคิดเห็นในส่วนหัวของ `discovery.ts` ยังคงกล่าวถึง `.pi` และไม่ได้กล่าวถึง `.codex`/`.gemini` ลำดับ runtime จริงขับเคลื่อนโดย `src/config.ts` และปัจจุบันใช้ `.xcsh`, `.claude`, `.codex`, `.gemini`

## กฎการผสานและการชนกัน

การค้นพบใช้การลบรายการซ้ำแบบ first-wins ตามชื่อ `agent.name` ที่แน่นอน:

- `Set<string>` ติดตามชื่อที่เห็นแล้ว
- Loaded agents จะถูกทำให้แบนในลำดับไดเรกทอรีและเก็บไว้เฉพาะถ้าชื่อยังไม่เคยเห็น
- Bundled agents จะถูกกรองกับชุดเดียวกันและเพิ่มเฉพาะถ้ายังไม่เคยเห็น

ผลที่ตามมา:

- Project จะแทนที่ user สำหรับกลุ่มแหล่งข้อมูลเดียวกัน
- กลุ่มแหล่งข้อมูลที่มีลำดับความสำคัญสูงกว่าจะแทนที่ลำดับต่ำกว่า (`.xcsh` ก่อน `.claude` เป็นต้น)
- Agent ที่ไม่ใช่ bundled จะแทนที่ bundled agents ที่มีชื่อเดียวกัน
- การจับคู่ชื่อคำนึงถึงตัวพิมพ์ใหญ่-เล็ก (`Task` และ `task` แตกต่างกัน)
- ภายในไดเรกทอรีเดียว ไฟล์ markdown จะถูกอ่านตามลำดับชื่อไฟล์แบบ lexicographic ก่อนการลบรายการซ้ำ

## พฤติกรรมเมื่อ agent ไม่ถูกต้องหรือไม่มีไฟล์

สำหรับแต่ละไดเรกทอรี (`loadAgentsFromDir`):

- ไดเรกทอรีที่อ่านไม่ได้/ไม่มี: ถือว่าว่างเปล่า (`readdir(...).catch(() => [])`)
- ความล้มเหลวในการอ่านหรือแยกวิเคราะห์ไฟล์: บันทึกคำเตือน ข้ามไฟล์
- เส้นทางการแยกวิเคราะห์ใช้ `parseAgent(..., level: "warn")`

พฤติกรรมความล้มเหลวของ frontmatter มาจาก `parseFrontmatter`:

- ข้อผิดพลาดในการแยกวิเคราะห์ที่ระดับ `warn` จะบันทึกคำเตือน
- parser จะ fallback ไปที่ parser แบบ `key: value` บรรทัดอย่างง่าย
- หาก field ที่จำเป็นยังขาดอยู่ `parseAgentFields` จะล้มเหลว จากนั้น `AgentParsingError` จะถูก throw และถูก catch โดยผู้เรียก (ข้ามไฟล์)

ผลสุทธิ: ไฟล์ custom agent ที่เสียหายไฟล์เดียวไม่ทำให้การค้นพบไฟล์อื่นหยุด

## การค้นหาและการเลือก Agent

การค้นหาเป็นการค้นหาเชิงเส้นตามชื่อที่แน่นอน:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

ในการประมวลผล task (`TaskTool.execute`):

1. agents จะถูกค้นพบใหม่ในเวลาเรียกใช้ (`discoverAgents(this.session.cwd)`)
2. `params.agent` ที่ร้องขอจะถูกแก้ไขผ่าน `getAgent`
3. หากไม่พบ agent จะส่งคืน tool response ทันที:
   - `Unknown agent "...". Available: ...`
   - ไม่มีการรัน subprocess

### การค้นพบในเวลาคำอธิบายเทียบกับเวลาประมวลผล

`TaskTool.create()` สร้างคำอธิบาย tool จากผลการค้นพบในเวลาเริ่มต้น (`buildDescription`)

`execute()` ค้นพบ agents ใหม่อีกครั้ง ดังนั้นชุด runtime อาจแตกต่างจากที่แสดงในคำอธิบาย tool ก่อนหน้า หากไฟล์ agent เปลี่ยนแปลงระหว่าง session

## Guardrails ของ Structured-output และลำดับความสำคัญของ Schema

ลำดับความสำคัญของ output schema ในเวลา runtime ใน `TaskTool.execute`:

1. `output` ของ agent frontmatter
2. `params.schema` ของการเรียก task
3. `outputSchema` ของ parent session

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

ข้อความ guardrail ในเวลา prompt ใน `src/prompts/tools/task.md` เตือนเกี่ยวกับพฤติกรรมที่ไม่ตรงกันสำหรับ structured-output agents (`explore`, `reviewer`): คำสั่งรูปแบบ output ในรูปแบบร้อยแก้วอาจขัดแย้งกับ schema ที่ built-in และสร้าง output เป็น `null`

นี่คือคำแนะนำ ไม่ใช่ตรรกะการตรวจสอบ runtime ใน `discoverAgents`

## การโต้ตอบกับการค้นพบคำสั่ง

`src/task/commands.ts` เป็นโครงสร้างพื้นฐานแบบขนานสำหรับ workflow commands (ไม่ใช่คำจำกัดความ agent) แต่ปฏิบัติตามรูปแบบโดยรวมเดียวกัน:

- ค้นพบจาก capability providers ก่อน
- ลบรายการซ้ำตามชื่อด้วย first-wins
- ต่อท้าย bundled commands หากยังไม่เคยเห็น
- ค้นหาตามชื่อที่แน่นอนผ่าน `getCommand`

ใน `src/task/index.ts` command helpers จะถูก re-export พร้อมกับ agent discovery helpers การค้นพบ agent เองไม่ได้ขึ้นอยู่กับการค้นพบคำสั่งในเวลา runtime

## ข้อจำกัดความพร้อมใช้งานที่นอกเหนือจากการค้นพบ

Agent อาจถูกค้นพบได้แต่ยังไม่สามารถใช้งานได้จริงเนื่องจาก guardrails ในการประมวลผล

### นโยบาย Spawn ของ Parent

`TaskTool.execute` ตรวจสอบ `session.getSessionSpawns()`:

- `"*"` => อนุญาตทั้งหมด
- `""` => ปฏิเสธทั้งหมด
- รายการ CSV => อนุญาตเฉพาะชื่อที่ระบุ

หากถูกปฏิเสธ: ส่งคืน `Cannot spawn '...'. Allowed: ...` ทันที

### การป้องกัน Self-recursion แบบ Blocked ด้วย env

`PI_BLOCKED_AGENT` จะถูกอ่านในเวลาสร้าง tool หากคำขอตรงกัน การประมวลผลจะถูกปฏิเสธพร้อมข้อความป้องกัน recursion

### การ Gate Recursion-depth (ความพร้อมใช้งานของ task tool ภายใน child sessions)

ใน `runSubprocess` (`src/task/executor.ts`):

- depth คำนวณจาก `taskDepth`
- `task.maxRecursionDepth` ควบคุมจุดตัด
- เมื่อถึง depth สูงสุด:
  - `task` tool จะถูกลบออกจากรายการ tool ของ child
  - `spawns` env ของ child จะถูกตั้งค่าเป็นว่างเปล่า

ดังนั้นระดับที่ลึกกว่าไม่สามารถ spawn task เพิ่มเติมได้แม้ว่าคำจำกัดความ agent จะมี `spawns` อยู่ก็ตาม

## ข้อควรระวังของโหมด Plan (การนำไปใช้งานปัจจุบัน)

`TaskTool.execute` คำนวณ `effectiveAgent` สำหรับโหมด plan (เพิ่ม plan-mode prompt ไว้ข้างหน้า บังคับใช้ชุด tool แบบอ่านอย่างเดียว ล้าง spawns) แต่ `runSubprocess` ถูกเรียกด้วย `agent` แทนที่จะเป็น `effectiveAgent`

ผลที่เกิดขึ้นในปัจจุบัน:

- การ override model / ระดับการคิด / output schema มาจาก `effectiveAgent`
- system prompt และข้อจำกัด tool/spawn จาก `effectiveAgent` จะไม่ถูกส่งผ่านในเส้นทางการเรียกนี้

นี่เป็นข้อควรระวังในการนำไปใช้งานที่ควรทราบเมื่ออ่านพฤติกรรมที่คาดหวังของโหมด plan
