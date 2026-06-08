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

# การค้นหาและการเลือก Task Agent

เอกสารนี้อธิบายวิธีที่ระบบย่อย task ค้นหาคำจำกัดความของ agent รวมจากหลายแหล่ง และแก้ไข agent ที่ร้องขอ ณ เวลาดำเนินการ

เนื้อหาครอบคลุมพฤติกรรมรันไทม์ตามที่ถูกนำไปใช้ในปัจจุบัน รวมถึงลำดับความสำคัญ การจัดการคำจำกัดความที่ไม่ถูกต้อง และข้อจำกัดด้าน spawn/depth ที่สามารถทำให้ agent ไม่พร้อมใช้งานได้

## ไฟล์การใช้งาน

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

- `name`, `description`, `systemPrompt` (จำเป็นสำหรับ loaded agent ที่ถูกต้อง)
- `tools`, `spawns`, `model`, `thinkingLevel`, `output` ที่เป็นทางเลือก
- `source`: `"bundled" | "user" | "project"`
- `filePath` ที่เป็นทางเลือก

การแยกวิเคราะห์มาจาก frontmatter ผ่าน `parseAgentFields()` (`src/discovery/helpers.ts`):

- ไม่มี `name` หรือ `description` => ไม่ถูกต้อง (`null`), ผู้เรียกถือว่าการแยกวิเคราะห์ล้มเหลว
- `tools` รับ CSV หรือ array; หากระบุไว้ `submit_result` จะถูกเพิ่มโดยอัตโนมัติ
- `spawns` รับ `*`, CSV หรือ array
- พฤติกรรมเข้ากันได้ย้อนหลัง: หากไม่มี `spawns` แต่ `tools` มี `task`, `spawns` จะกลายเป็น `*`
- `output` จะถูกส่งผ่านเป็นข้อมูล schema ที่ไม่ถูกตีความ

## Bundled agent

Bundled agent ถูกฝังไว้ในเวลา build (`src/task/agents.ts`) โดยใช้ text import

`EMBEDDED_AGENT_DEFS` กำหนด:

- `explore`, `plan`, `designer`, `reviewer` จากไฟล์ prompt
- `task` และ `quick_task` จาก body `task.md` ที่ใช้ร่วมกัน พร้อม frontmatter ที่ถูกแทรก

เส้นทางการโหลด:

1. `loadBundledAgents()` แยกวิเคราะห์ markdown ที่ฝังไว้ด้วย `parseAgent(..., "bundled", "fatal")`
2. ผลลัพธ์จะถูกแคชในหน่วยความจำ (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` ใช้สำหรับรีเซ็ตแคชในการทดสอบเท่านั้น

เนื่องจากการแยกวิเคราะห์ bundled ใช้ `level: "fatal"` frontmatter ของ bundled ที่ผิดรูปแบบจะ throw error และสามารถทำให้การค้นหาล้มเหลวทั้งหมด

## การค้นหาจากระบบไฟล์และปลั๊กอิน

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) รวม agent จากหลายแหล่งก่อนที่จะต่อท้ายด้วย bundled definition

### อินพุตการค้นหา

1. ไดเรกทอรี agent จากการกำหนดค่าผู้ใช้จาก `getConfigDirs("agents", { project: false })`
2. ไดเรกทอรี agent ของโปรเจกต์ที่ใกล้ที่สุดจาก `findAllNearestProjectConfigDirs("agents", cwd)`
3. รากปลั๊กอิน Claude (`listClaudePluginRoots(home)`) พร้อมไดเรกทอรีย่อย `agents/`
4. Bundled agent (`loadBundledAgents()`)

### ลำดับแหล่งที่มาจริง

ลำดับตระกูลแหล่งที่มามาจาก `getConfigDirs("", { project: false })` ซึ่งได้มาจาก `priorityList` ใน `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

สำหรับแต่ละตระกูลแหล่งที่มา ลำดับการค้นหาคือ:

1. ไดเรกทอรีโปรเจกต์ที่ใกล้ที่สุดสำหรับแหล่งนั้น (ถ้าพบ)
2. ไดเรกทอรีผู้ใช้สำหรับแหล่งนั้น

หลังจากไดเรกทอรีตระกูลแหล่งที่มาทั้งหมด ไดเรกทอรี `agents/` ของปลั๊กอินจะถูกต่อท้าย (ปลั๊กอินระดับโปรเจกต์ก่อน จากนั้นระดับผู้ใช้)

Bundled agent จะถูกต่อท้ายเป็นลำดับสุดท้าย

### ข้อควรระวังที่สำคัญ: คอมเมนต์ที่ล้าสมัย vs โค้ดปัจจุบัน

คอมเมนต์ส่วนหัวของ `discovery.ts` ยังคงกล่าวถึง `.pi` และไม่ได้กล่าวถึง `.codex`/`.gemini` ลำดับรันไทม์จริงถูกขับเคลื่อนโดย `src/config.ts` และปัจจุบันใช้ `.xcsh`, `.claude`, `.codex`, `.gemini`

## กฎการรวมและการชนกัน

การค้นหาใช้การตัดซ้ำแบบ first-wins โดย `agent.name` ที่ตรงกันทุกประการ:

- `Set<string>` ติดตามชื่อที่เห็นแล้ว
- Agent ที่โหลดแล้วจะถูกทำให้แบนตามลำดับไดเรกทอรีและเก็บไว้เฉพาะเมื่อชื่อยังไม่เคยเห็น
- Bundled agent จะถูกกรองกับ set เดียวกันและเพิ่มเฉพาะเมื่อยังไม่เคยเห็น

ผลกระทบ:

- โปรเจกต์แทนที่ผู้ใช้สำหรับตระกูลแหล่งที่มาเดียวกัน
- ตระกูลแหล่งที่มาที่มีลำดับความสำคัญสูงกว่าแทนที่ลำดับที่ต่ำกว่า (`.xcsh` ก่อน `.claude` เป็นต้น)
- Agent ที่ไม่ใช่ bundled แทนที่ bundled agent ที่มีชื่อเดียวกัน
- การจับคู่ชื่อเป็นแบบ case-sensitive (`Task` และ `task` เป็นชื่อที่แตกต่างกัน)
- ภายในไดเรกทอรีเดียว ไฟล์ markdown จะถูกอ่านตามลำดับชื่อไฟล์แบบพจนานุกรมก่อนการตัดซ้ำ

## พฤติกรรมไฟล์ agent ที่ไม่ถูกต้อง/ขาดหาย

ต่อไดเรกทอรี (`loadAgentsFromDir`):

- ไดเรกทอรีที่อ่านไม่ได้/ไม่มี: ถือว่าว่างเปล่า (`readdir(...).catch(() => [])`)
- การอ่านไฟล์หรือการแยกวิเคราะห์ล้มเหลว: บันทึกคำเตือน ข้ามไฟล์
- เส้นทางการแยกวิเคราะห์ใช้ `parseAgent(..., level: "warn")`

พฤติกรรมความล้มเหลวของ frontmatter มาจาก `parseFrontmatter`:

- ข้อผิดพลาดในการแยกวิเคราะห์ที่ระดับ `warn` จะบันทึกคำเตือน
- parser จะ fallback ไปยัง parser แบบบรรทัด `key: value` ที่เรียบง่าย
- หากฟิลด์ที่จำเป็นยังคงขาดหาย `parseAgentFields` จะล้มเหลว จากนั้น `AgentParsingError` จะถูก throw และจับโดยผู้เรียก (ข้ามไฟล์)

ผลลัพธ์สุทธิ: ไฟล์ custom agent ที่ผิดพลาดหนึ่งไฟล์ไม่ทำให้การค้นหาไฟล์อื่นหยุดทำงาน

## การค้นหาและเลือก Agent

การค้นหาเป็นการค้นหาแบบเชิงเส้นตามชื่อที่ตรงกัน:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

ในการดำเนินการ task (`TaskTool.execute`):

1. agent จะถูกค้นหาใหม่ ณ เวลาเรียก (`discoverAgents(this.session.cwd)`)
2. `params.agent` ที่ร้องขอจะถูกแก้ไขผ่าน `getAgent`
3. agent ที่ไม่พบจะส่งคืนการตอบกลับเครื่องมือทันที:
   - `Unknown agent "...". Available: ...`
   - ไม่มี subprocess ทำงาน

### Description vs การค้นหา ณ เวลาดำเนินการ

`TaskTool.create()` สร้างคำอธิบายเครื่องมือจากผลการค้นหา ณ เวลาเริ่มต้น (`buildDescription`)

`execute()` ค้นหา agent ใหม่อีกครั้ง ดังนั้นชุดรันไทม์อาจแตกต่างจากที่ระบุไว้ในคำอธิบายเครื่องมือก่อนหน้า หากไฟล์ agent เปลี่ยนแปลงระหว่างเซสชัน

## กลไกป้องกัน structured-output และลำดับความสำคัญของ schema

ลำดับความสำคัญของ output schema ณ รันไทม์ใน `TaskTool.execute`:

1. `output` ของ frontmatter ของ agent
2. `params.schema` ของการเรียก task
3. `outputSchema` ของ session แม่

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

ข้อความกลไกป้องกันที่ระดับ prompt ใน `src/prompts/tools/task.md` เตือนเกี่ยวกับพฤติกรรมที่ไม่ตรงกันสำหรับ agent ที่มี structured-output (`explore`, `reviewer`): คำสั่งรูปแบบ output ในข้อความร้อยแก้วสามารถขัดแย้งกับ schema ที่ฝังอยู่และผลิตผลลัพธ์ `null`

นี่เป็นแนวทาง ไม่ใช่ตรรกะตรวจสอบรันไทม์แบบแข็งใน `discoverAgents`

## ปฏิสัมพันธ์การค้นหาคำสั่ง

`src/task/commands.ts` เป็นโครงสร้างพื้นฐานคู่ขนานสำหรับคำสั่ง workflow (ไม่ใช่คำจำกัดความ agent) แต่เป็นไปตามรูปแบบโดยรวมเดียวกัน:

- ค้นหาจาก capability provider ก่อน
- ตัดซ้ำตามชื่อแบบ first-wins
- ต่อท้ายคำสั่ง bundled หากยังไม่เคยเห็น
- ค้นหาตามชื่อที่ตรงกันผ่าน `getCommand`

ใน `src/task/index.ts` helper ของคำสั่งจะถูก re-export พร้อมกับ helper ของการค้นหา agent การค้นหา agent เองไม่ได้ขึ้นอยู่กับการค้นหาคำสั่ง ณ รันไทม์

## ข้อจำกัดความพร้อมใช้งานนอกเหนือจากการค้นหา

Agent สามารถค้นพบได้แต่ยังคงไม่พร้อมใช้งานเนื่องจากกลไกป้องกันการดำเนินการ

### นโยบาย spawn ของ parent

`TaskTool.execute` ตรวจสอบ `session.getSessionSpawns()`:

- `"*"` => อนุญาตทั้งหมด
- `""` => ปฏิเสธทั้งหมด
- รายการ CSV => อนุญาตเฉพาะชื่อที่ระบุ

หากถูกปฏิเสธ: ตอบกลับทันที `Cannot spawn '...'. Allowed: ...`

### การป้องกันการเรียกซ้ำตัวเองผ่าน env guard

`PI_BLOCKED_AGENT` จะถูกอ่าน ณ เวลาสร้างเครื่องมือ หากคำร้องขอตรงกัน การดำเนินการจะถูกปฏิเสธพร้อมข้อความป้องกันการเรียกซ้ำ

### การควบคุม recursion-depth (ความพร้อมใช้งานของ task tool ภายใน child session)

ใน `runSubprocess` (`src/task/executor.ts`):

- depth คำนวณจาก `taskDepth`
- `task.maxRecursionDepth` ควบคุมจุดตัด
- เมื่อถึง depth สูงสุด:
  - เครื่องมือ `task` จะถูกลบออกจากรายการเครื่องมือของ child
  - env `spawns` ของ child จะถูกตั้งเป็นว่าง

ดังนั้นระดับที่ลึกกว่าไม่สามารถ spawn task เพิ่มเติมได้แม้ว่าคำจำกัดความของ agent จะรวม `spawns` ไว้

## ข้อควรระวังโหมด Plan (การใช้งานปัจจุบัน)

`TaskTool.execute` คำนวณ `effectiveAgent` สำหรับโหมด plan (เพิ่ม plan-mode prompt ข้างหน้า บังคับชุดเครื่องมือ read-only ล้าง spawns) แต่ `runSubprocess` จะถูกเรียกด้วย `agent` แทนที่จะเป็น `effectiveAgent`

ผลกระทบปัจจุบัน:

- model override / thinking level / output schema ได้มาจาก `effectiveAgent`
- system prompt และข้อจำกัด tool/spawn จาก `effectiveAgent` ไม่ได้ถูกส่งผ่านในเส้นทางการเรียกนี้

นี่เป็นข้อควรระวังของการใช้งานที่ควรทราบเมื่ออ่านความคาดหวังพฤติกรรมโหมด plan
