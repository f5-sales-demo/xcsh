---
title: การค้นหาและเลือก Task Agent
description: >-
  ตรรกะการค้นหาและเลือก task agent สำหรับกำหนดเส้นทางงานไปยัง subagent
  ประเภทเฉพาะทาง
sidebar:
  order: 6
  label: การค้นหา Task agent
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# การค้นหาและเลือก Task Agent

เอกสารนี้อธิบายวิธีที่ระบบย่อย task ค้นหาคำจำกัดความของ agent รวมแหล่งข้อมูลหลายแหล่ง และแก้ไข agent ที่ร้องขอ ณ เวลาดำเนินการ

เนื้อหาครอบคลุมพฤติกรรมรันไทม์ตามที่ใช้งานจริงในปัจจุบัน รวมถึงลำดับความสำคัญ การจัดการคำจำกัดความที่ไม่ถูกต้อง และข้อจำกัดด้าน spawn/depth ที่อาจทำให้ agent ไม่สามารถใช้งานได้อย่างมีประสิทธิภาพ

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

Task agent จะถูก normalize เป็น `AgentDefinition` (`src/task/types.ts`):

- `name`, `description`, `systemPrompt` (จำเป็นสำหรับ agent ที่โหลดได้ถูกต้อง)
- optional: `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- optional: `filePath`

การแยกวิเคราะห์มาจาก frontmatter ผ่าน `parseAgentFields()` (`src/discovery/helpers.ts`):

- ถ้าไม่มี `name` หรือ `description` => ไม่ถูกต้อง (`null`), ผู้เรียกถือว่าเป็นการแยกวิเคราะห์ล้มเหลว
- `tools` รับ CSV หรือ array; ถ้ามีการระบุ `submit_result` จะถูกเพิ่มโดยอัตโนมัติ
- `spawns` รับ `*`, CSV, หรือ array
- พฤติกรรมเข้ากันได้แบบย้อนหลัง: ถ้าไม่มี `spawns` แต่ `tools` มี `task`, `spawns` จะกลายเป็น `*`
- `output` จะถูกส่งผ่านเป็นข้อมูล schema แบบ opaque

## Agent แบบ Bundled

Agent แบบ bundled จะถูกฝังไว้ตอน build time (`src/task/agents.ts`) โดยใช้ text imports

`EMBEDDED_AGENT_DEFS` กำหนด:

- `explore`, `plan`, `designer`, `reviewer` จากไฟล์ prompt
- `task` และ `quick_task` จากเนื้อหา `task.md` ที่ใช้ร่วมกัน พร้อม frontmatter ที่ถูก inject เข้าไป

เส้นทางการโหลด:

1. `loadBundledAgents()` แยกวิเคราะห์ markdown ที่ฝังไว้ด้วย `parseAgent(..., "bundled", "fatal")`
2. ผลลัพธ์ถูกแคชในหน่วยความจำ (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` ใช้สำหรับรีเซ็ตแคชในการทดสอบเท่านั้น

เนื่องจากการแยกวิเคราะห์แบบ bundled ใช้ `level: "fatal"` frontmatter ที่มีรูปแบบไม่ถูกต้องจะ throw error และอาจทำให้การค้นหาล้มเหลวทั้งหมด

## การค้นหาจากระบบไฟล์และ Plugin

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) จะรวม agent จากหลายแหล่งก่อนที่จะเพิ่มคำจำกัดความแบบ bundled

### อินพุตสำหรับการค้นหา

1. ไดเรกทอรี agent จาก user config จาก `getConfigDirs("agents", { project: false })`
2. ไดเรกทอรี agent ของโปรเจกต์ที่ใกล้ที่สุดจาก `findAllNearestProjectConfigDirs("agents", cwd)`
3. Claude plugin roots (`listClaudePluginRoots(home)`) พร้อมไดเรกทอรีย่อย `agents/`
4. Agent แบบ bundled (`loadBundledAgents()`)

### ลำดับแหล่งข้อมูลจริง

ลำดับตระกูลแหล่งข้อมูลมาจาก `getConfigDirs("", { project: false })` ซึ่งได้มาจาก `priorityList` ใน `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

สำหรับแต่ละตระกูลแหล่งข้อมูล ลำดับการค้นหาคือ:

1. ไดเรกทอรีโปรเจกต์ที่ใกล้ที่สุดของแหล่งข้อมูลนั้น (ถ้าพบ)
2. ไดเรกทอรี user ของแหล่งข้อมูลนั้น

หลังจากไดเรกทอรีตระกูลแหล่งข้อมูลทั้งหมด ไดเรกทอรี `agents/` ของ plugin จะถูกเพิ่มต่อท้าย (plugin ขอบเขตโปรเจกต์ก่อน ตามด้วยขอบเขต user)

Agent แบบ bundled จะถูกเพิ่มต่อท้ายเป็นลำดับสุดท้าย

### ข้อควรระวังสำคัญ: ความคิดเห็นที่ล้าสมัยเทียบกับโค้ดปัจจุบัน

ความคิดเห็นส่วนหัวของ `discovery.ts` ยังกล่าวถึง `.pi` และไม่ได้กล่าวถึง `.codex`/`.gemini` ลำดับรันไทม์จริงถูกขับเคลื่อนโดย `src/config.ts` และปัจจุบันใช้ `.xcsh`, `.claude`, `.codex`, `.gemini`

## กฎการรวมและการชนกัน

การค้นหาใช้การกำจัดรายการซ้ำแบบ first-wins ตามชื่อ `agent.name` ที่ตรงกันพอดี:

- `Set<string>` ใช้ติดตามชื่อที่เห็นแล้ว
- Agent ที่โหลดจะถูกแผ่ออกตามลำดับไดเรกทอรีและเก็บไว้เฉพาะเมื่อชื่อยังไม่เคยเห็น
- Agent แบบ bundled จะถูกกรองเทียบกับเซ็ตเดียวกันและจะถูกเพิ่มเฉพาะเมื่อยังไม่เคยเห็น

ผลกระทบ:

- โปรเจกต์มีความสำคัญเหนือ user สำหรับตระกูลแหล่งข้อมูลเดียวกัน
- ตระกูลแหล่งข้อมูลที่มีลำดับสำคัญสูงกว่ามีความสำคัญเหนือลำดับต่ำกว่า (`.xcsh` ก่อน `.claude` เป็นต้น)
- Agent ที่ไม่ใช่ bundled มีความสำคัญเหนือ agent แบบ bundled ที่มีชื่อเดียวกัน
- การจับคู่ชื่อเป็นแบบ case-sensitive (`Task` และ `task` เป็นคนละตัวกัน)
- ภายในไดเรกทอรีเดียว ไฟล์ markdown จะถูกอ่านตามลำดับชื่อไฟล์แบบ lexicographic ก่อนการกำจัดรายการซ้ำ

## พฤติกรรมเมื่อไฟล์ Agent ไม่ถูกต้อง/ไม่มี

ต่อไดเรกทอรี (`loadAgentsFromDir`):

- ไดเรกทอรีที่อ่านไม่ได้/ไม่มี: ถือว่าว่างเปล่า (`readdir(...).catch(() => [])`)
- การอ่านไฟล์หรือแยกวิเคราะห์ล้มเหลว: บันทึกคำเตือน ข้ามไฟล์นั้น
- เส้นทางการแยกวิเคราะห์ใช้ `parseAgent(..., level: "warn")`

พฤติกรรมเมื่อ frontmatter ล้มเหลวมาจาก `parseFrontmatter`:

- ข้อผิดพลาดในการแยกวิเคราะห์ที่ระดับ `warn` จะบันทึกคำเตือน
- parser จะ fallback ไปใช้ parser แบบ `key: value` ต่อบรรทัดอย่างง่าย
- ถ้าฟิลด์ที่จำเป็นยังคงขาดหาย `parseAgentFields` จะล้มเหลว จากนั้น `AgentParsingError` จะถูก throw และถูกจับโดยผู้เรียก (ข้ามไฟล์)

ผลลัพธ์สุทธิ: ไฟล์ custom agent ที่ผิดพลาดหนึ่งไฟล์จะไม่ทำให้การค้นหาไฟล์อื่นหยุดทำงาน

## การค้นหาและเลือก Agent

การค้นหาเป็นแบบค้นหาเชิงเส้นตามชื่อที่ตรงกันพอดี:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

ในการดำเนินการ task (`TaskTool.execute`):

1. agent จะถูกค้นหาใหม่ ณ เวลาที่เรียก (`discoverAgents(this.session.cwd)`)
2. `params.agent` ที่ร้องขอจะถูกแก้ไขผ่าน `getAgent`
3. agent ที่ไม่พบจะส่งคืนการตอบสนอง tool ทันที:
   - `Unknown agent "...". Available: ...`
   - ไม่มี subprocess ทำงาน

### คำอธิบายเทียบกับการค้นหา ณ เวลาดำเนินการ

`TaskTool.create()` สร้างคำอธิบาย tool จากผลลัพธ์การค้นหา ณ เวลาเริ่มต้น (`buildDescription`)

`execute()` จะค้นหา agent ใหม่อีกครั้ง ดังนั้นชุด agent ณ รันไทม์อาจแตกต่างจากที่แสดงในคำอธิบาย tool ก่อนหน้า หากไฟล์ agent มีการเปลี่ยนแปลงระหว่าง session

## การป้องกัน Structured-output และลำดับความสำคัญของ Schema

ลำดับความสำคัญของ output schema ณ รันไทม์ใน `TaskTool.execute`:

1. `output` ของ agent frontmatter
2. `params.schema` ของการเรียก task
3. `outputSchema` ของ session หลัก

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

ข้อความแนะนำการป้องกัน ณ เวลา prompt ใน `src/prompts/tools/task.md` เตือนเกี่ยวกับพฤติกรรมไม่ตรงกันสำหรับ agent แบบ structured-output (`explore`, `reviewer`): คำสั่งรูปแบบ output ในเนื้อหาอาจขัดแย้งกับ schema ในตัวและสร้าง output เป็น `null`

นี่เป็นแนวทาง ไม่ใช่ตรรกะการตรวจสอบรันไทม์แบบ hard ใน `discoverAgents`

## ปฏิสัมพันธ์กับการค้นหา Command

`src/task/commands.ts` เป็นโครงสร้างพื้นฐานแบบคู่ขนานสำหรับ workflow command (ไม่ใช่คำจำกัดความของ agent) แต่ใช้รูปแบบโดยรวมเดียวกัน:

- ค้นหาจาก capability providers ก่อน
- กำจัดรายการซ้ำตามชื่อด้วย first-wins
- เพิ่ม command แบบ bundled ต่อท้ายถ้ายังไม่เคยเห็น
- ค้นหาตามชื่อที่ตรงกันพอดีผ่าน `getCommand`

ใน `src/task/index.ts` ตัวช่วย command จะถูก re-export พร้อมกับตัวช่วยการค้นหา agent การค้นหา agent เองไม่ได้ขึ้นอยู่กับการค้นหา command ณ รันไทม์

## ข้อจำกัดด้านความพร้อมใช้งานนอกเหนือจากการค้นหา

Agent อาจค้นหาได้แต่ยังคงไม่สามารถใช้งานได้เนื่องจากการป้องกันการดำเนินการ

### นโยบาย spawn ของ parent

`TaskTool.execute` ตรวจสอบ `session.getSessionSpawns()`:

- `"*"` => อนุญาตทั้งหมด
- `""` => ปฏิเสธทั้งหมด
- รายการ CSV => อนุญาตเฉพาะชื่อที่ระบุ

ถ้าถูกปฏิเสธ: ส่งคืนการตอบสนอง `Cannot spawn '...'. Allowed: ...` ทันที

### การป้องกันการเรียกซ้ำตัวเองผ่าน env guard

`PI_BLOCKED_AGENT` จะถูกอ่านตอนสร้าง tool ถ้าคำขอตรงกัน การดำเนินการจะถูกปฏิเสธพร้อมข้อความป้องกันการเรียกซ้ำ

### การจำกัดความลึกของการเรียกซ้ำ (ความพร้อมใช้งาน task tool ภายใน child sessions)

ใน `runSubprocess` (`src/task/executor.ts`):

- ความลึกคำนวณจาก `taskDepth`
- `task.maxRecursionDepth` ควบคุมจุดตัด
- เมื่อถึงความลึกสูงสุด:
  - tool `task` จะถูกลบออกจากรายการ tool ของ child
  - `spawns` env ของ child จะถูกตั้งเป็นว่างเปล่า

ดังนั้นระดับที่ลึกกว่าไม่สามารถ spawn task เพิ่มเติมได้แม้ว่าคำจำกัดความของ agent จะรวม `spawns` ไว้

## ข้อควรระวังเกี่ยวกับ Plan mode (การใช้งานปัจจุบัน)

`TaskTool.execute` คำนวณ `effectiveAgent` สำหรับ plan mode (เพิ่ม plan-mode prompt ข้างหน้า บังคับใช้ชุดย่อย tool แบบ read-only ล้าง spawns) แต่ `runSubprocess` จะถูกเรียกด้วย `agent` แทนที่จะเป็น `effectiveAgent`

ผลกระทบในปัจจุบัน:

- model override / thinking level / output schema ได้มาจาก `effectiveAgent`
- system prompt และข้อจำกัด tool/spawn จาก `effectiveAgent` ไม่ได้ถูกส่งผ่านในเส้นทางการเรียกนี้

นี่เป็นข้อควรระวังด้านการใช้งานที่ควรทราบเมื่ออ่านความคาดหวังเกี่ยวกับพฤติกรรม plan-mode
