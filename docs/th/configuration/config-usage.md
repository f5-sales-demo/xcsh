---
title: การค้นพบและการแก้ไขการกำหนดค่า
description: >-
  วิธีที่ xcsh ค้นพบ แก้ไข และจัดชั้นการกำหนดค่าจากรูทของโปรเจกต์ ผู้ใช้
  และองค์กร
sidebar:
  order: 1
  label: การกำหนดค่า
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# การค้นพบและการแก้ไขการกำหนดค่า

เอกสารนี้อธิบายวิธีที่ coding-agent แก้ไขการกำหนดค่าในปัจจุบัน: รูทใดบ้างที่ถูกสแกน วิธีการทำงานของลำดับความสำคัญ และวิธีที่การกำหนดค่าที่แก้ไขแล้วถูกใช้งานโดย settings, skills, hooks, tools, และ extensions

## ขอบเขต

การดำเนินการหลัก:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

จุดเชื่อมต่อหลัก:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## กระบวนการแก้ไข (ภาพรวม)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) รูทการกำหนดค่าและลำดับแหล่งที่มา

## รูทมาตรฐาน

`src/config.ts` กำหนดรายการลำดับความสำคัญแหล่งที่มาแบบตายตัว:

1. `.xcsh` (native)
2. `.claude`
3. `.codex`
4. `.gemini`

ฐานระดับผู้ใช้:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

ฐานระดับโปรเจกต์:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` คือ `.xcsh` (`packages/utils/src/dirs.ts`)

## ข้อจำกัดสำคัญ

helpers ทั่วไปใน `src/config.ts` **ไม่** รวม `.pi` ในลำดับการค้นพบแหล่งที่มา

---

## 2) helpers การค้นพบหลัก (`src/config.ts`)

## `getConfigDirs(subpath, options)`

คืนค่ารายการที่เรียงลำดับแล้ว:

- รายการระดับผู้ใช้ก่อน (ตามลำดับความสำคัญของแหล่งที่มา)
- จากนั้นรายการระดับโปรเจกต์ (ตามลำดับความสำคัญเดียวกัน)

ตัวเลือก:

- `user` (ค่าเริ่มต้น `true`)
- `project` (ค่าเริ่มต้น `true`)
- `cwd` (ค่าเริ่มต้น `getProjectDir()`)
- `existingOnly` (ค่าเริ่มต้น `false`)

API นี้ใช้สำหรับการค้นหาการกำหนดค่าแบบไดเรกทอรี (commands, hooks, tools, agents เป็นต้น)

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

ค้นหาไฟล์ที่มีอยู่แรกสุดข้ามฐานที่เรียงลำดับแล้ว คืนค่าการจับคู่แรก (path เท่านั้น หรือ path พร้อม metadata)

## `findAllNearestProjectConfigDirs(subpath, cwd)`

เดินขึ้นไปตามไดเรกทอรีพาเรนต์และคืนค่า **ไดเรกทอรีที่มีอยู่ใกล้ที่สุดต่อแต่ละฐานแหล่งที่มา** (`.xcsh`, `.claude`, `.codex`, `.gemini`) จากนั้นเรียงลำดับผลลัพธ์ตามลำดับความสำคัญแหล่งที่มา

ใช้เมื่อการกำหนดค่าโปรเจกต์ควรสืบทอดจากไดเรกทอรีบรรพบุรุษ (พฤติกรรม monorepo/nested workspace)

---

## 3) wrapper ไฟล์การกำหนดค่า (`ConfigFile<T>` ใน `src/config.ts`)

`ConfigFile<T>` คือตัวโหลดที่ตรวจสอบ schema สำหรับไฟล์การกำหนดค่าเดี่ยว

รูปแบบที่รองรับ:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

พฤติกรรม:

- ตรวจสอบข้อมูลที่แยกวิเคราะห์แล้วด้วย AJV เทียบกับ TypeBox schema ที่ให้มา
- แคชผลลัพธ์การโหลดจนกว่าจะเรียก `invalidate()`
- คืนค่าผลลัพธ์แบบ tri-state ผ่าน `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` พร้อม schema/parse context)

ยังคงรองรับการ migration แบบ legacy:

- หากเส้นทางเป้าหมายเป็น `.yml`/`.yaml` ไฟล์ `.json` ที่อยู่ข้างๆ จะถูก migrate อัตโนมัติหนึ่งครั้ง (`migrateJsonToYml`)

---

## 4) โมเดลการแก้ไข Settings (`src/config/settings.ts`)

โมเดล runtime settings มีการจัดชั้นดังนี้:

1. Global settings: `~/.xcsh/agent/config.yml`
2. Project settings: ค้นพบผ่าน settings capability (`settings.json` จาก providers)
3. Runtime overrides: อยู่ใน memory ไม่บันทึกถาวร
4. Schema defaults: จาก `SETTINGS_SCHEMA`

เส้นทางการอ่านที่มีผล:

`defaults <- global <- project <- overrides`

พฤติกรรมการเขียน:

- `settings.set(...)` เขียนไปยังชั้น **global** (`config.yml`) และจัดคิวการบันทึกแบบ background
- Project settings เป็นแบบอ่านอย่างเดียวจากการค้นพบ capability

## พฤติกรรมการ migration ที่ยังคงทำงานอยู่

เมื่อเริ่มต้น หากไม่พบ `config.yml`:

1. Migrate จาก `~/.xcsh/agent/settings.json` (เปลี่ยนชื่อเป็น `.bak` เมื่อสำเร็จ)
2. รวมกับ legacy DB settings จาก `agent.db`
3. เขียนผลลัพธ์ที่รวมแล้วไปยัง `config.yml`

การ migration ระดับ field ใน `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` มิลลิวินาที -> วินาที เมื่อค่าเก่าดูเหมือน ms (`> 1000`)
- Legacy flat `theme: "..."` -> โครงสร้าง `theme.dark/theme.light`

---

## 5) การเชื่อมต่อ Capability/discovery

การโหลดการกำหนดค่าที่ไม่ใช่ core ส่วนใหญ่ไหลผ่าน capability registry (`src/capability/index.ts` + `src/discovery/index.ts`)

## การเรียงลำดับ Provider

Providers จะถูกเรียงลำดับตามค่าลำดับความสำคัญแบบตัวเลข (สูงกว่าชนะ) ตัวอย่างลำดับความสำคัญ:

- Native OMP (`builtin.ts`): `100`
- Claude: `80`
- Codex / agents / Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## พฤติกรรม Dedup

Capabilities กำหนด `key(item)`:

- key เดียวกัน => รายการแรกชนะ (รายการที่มีลำดับความสำคัญสูงกว่า/โหลดก่อน)
- ไม่มี key (`undefined`) => ไม่มี dedup รายการทั้งหมดถูกเก็บไว้

Keys ที่เกี่ยวข้อง:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: ไม่มี dedup (รายการทั้งหมดถูกเก็บไว้)

---

## 6) พฤติกรรม native `.xcsh` provider (`src/discovery/builtin.ts`)

Native provider (`id: native`) อ่านจาก:

- project: `<cwd>/.xcsh/...`
- user: `~/.xcsh/agent/...`

### กฎการรับไดเรกทอรี

`builtin.ts` รวมรูท config เฉพาะเมื่อไดเรกทอรีมีอยู่ **และไม่ว่างเปล่า** (`ifNonEmptyDir`)

### การโหลดตาม Scope

- Skills: `skills/*/SKILL.md`
- Slash commands: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` และ `tools/<name>/index.ts`
- Extension modules: ค้นพบภายใต้ `extensions/` (+ legacy `settings.json.extensions` string array)
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings capability: `settings.json`

### ความละเอียดอ่อนของการค้นหาโปรเจกต์ที่ใกล้ที่สุด

สำหรับ `SYSTEM.md` และ `AGENTS.md` native provider ใช้การค้นหาไดเรกทอรี `.xcsh` โปรเจกต์ที่ใกล้ที่สุด (walk-up) แต่ยังคงต้องการให้ไดเรกทอรี `.xcsh` ไม่ว่างเปล่า

---

## 7) วิธีที่ subsystems หลักใช้การกำหนดค่า

## Settings subsystem

- `Settings.init()` โหลด global `config.yml` + รายการ project `settings.json` capability ที่ค้นพบ
- เฉพาะรายการ capability ที่มี `level === "project"` เท่านั้นที่ถูกรวมเข้าชั้น project

## Skills subsystem

- `extensibility/skills.ts` โหลดผ่าน `loadCapability(skillCapability.id, { cwd })`
- ใช้ source toggles และ filters (`ignoredSkills`, `includeSkills`, custom dirs)
- Legacy-named toggles ยังคงมีอยู่ (`skills.enablePiUser`, `skills.enablePiProject`) แต่ใช้เป็น gate สำหรับ native provider (`provider === "native"`)

## Hooks subsystem

- `discoverAndLoadHooks()` แก้ไข hook paths จาก hook capability + explicit configured paths
- จากนั้นโหลด modules ผ่าน Bun import

## Tools subsystem

- `discoverAndLoadCustomTools()` แก้ไข tool paths จาก tool capability + plugin tool paths + explicit configured paths
- ไฟล์ tool แบบ declarative `.md/.json` เป็นเพียง metadata เท่านั้น การโหลด executable คาดหวัง code modules

## Extensions subsystem

- `discoverAndLoadExtensions()` แก้ไข extension modules จาก extension-module capability บวกกับ explicit paths
- การดำเนินการปัจจุบันจงใจเก็บเฉพาะรายการ capability ที่มี `_source.provider === "native"` ก่อนโหลด

---

## 8) กฎลำดับความสำคัญที่ควรพึ่งพา

ใช้ mental model นี้:

1. การเรียงลำดับไดเรกทอรีแหล่งที่มาจาก `config.ts` กำหนดลำดับ path ของผู้สมัคร
2. ลำดับความสำคัญ capability provider กำหนดลำดับความสำคัญข้าม providers
3. Capability key dedup กำหนดพฤติกรรมการชนกัน (ชนะแรกสำหรับ keyed capabilities)
4. Logic การรวม subsystem-specific สามารถเปลี่ยนลำดับความสำคัญที่มีผลเพิ่มเติมได้ (โดยเฉพาะ settings)

### ข้อแม้เฉพาะ Settings

รายการ settings capability ไม่ถูก deduplicate; `Settings.#loadProjectSettings()` deep-merges รายการ project ตามลำดับที่คืนมา เนื่องจากการ merge ใช้ค่ารายการหลังทับค่ารายการก่อน พฤติกรรมการ override ที่มีผลจึงขึ้นอยู่กับลำดับการ emit ของ provider ไม่ใช่แค่ semantics ของ capability key

---

## 9) พฤติกรรม Legacy/ความเข้ากันได้ที่ยังคงมีอยู่

- `ConfigFile` JSON -> YAML migration สำหรับไฟล์ที่กำหนดเป้าหมายเป็น YAML
- Settings migration จาก `settings.json` และ `agent.db` ไปยัง `config.yml`
- Settings key migrations (`queueMode`, `ask.timeout`, flat `theme`)
- Extension manifest compatibility: loader รับทั้งส่วน manifest `package.json.xcsh` และ `package.json.pi`
- Legacy setting names `skills.enablePiUser` / `skills.enablePiProject` ยังคงเป็น gates ที่ทำงานสำหรับ native skill source

หากเส้นทางความเข้ากันได้เหล่านี้ถูกลบออกในโค้ด ให้อัปเดตเอกสารนี้ทันที เนื่องจากพฤติกรรม runtime หลายอย่างยังคงพึ่งพาพวกมันในปัจจุบัน
