---
title: การค้นพบและการแก้ไขการกำหนดค่า
description: >-
  วิธีที่ xcsh ค้นพบ แก้ไข และจัดเลเยอร์การกำหนดค่าจากรูทของโปรเจกต์ ผู้ใช้
  และองค์กร
sidebar:
  order: 1
  label: การกำหนดค่า
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# การค้นพบและการแก้ไขการกำหนดค่า

เอกสารนี้อธิบายวิธีที่ coding-agent แก้ไขการกำหนดค่าในปัจจุบัน: รูทใดถูกสแกน การทำงานของลำดับความสำคัญ และการนำการกำหนดค่าที่แก้ไขแล้วไปใช้โดย settings, skills, hooks, เครื่องมือ และส่วนขยาย

## ขอบเขต

การนำไปใช้หลัก:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

จุดรวมสำคัญ:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## ขั้นตอนการแก้ไข (แผนภาพ)

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

## 1) รูทของการกำหนดค่าและลำดับแหล่งที่มา

## รูทมาตรฐาน

`src/config.ts` กำหนดรายการลำดับความสำคัญของแหล่งที่มาแบบคงที่:

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

helpers ทั่วไปใน `src/config.ts` **ไม่รวม** `.pi` ในลำดับการค้นพบแหล่งที่มา

---

## 2) helpers การค้นพบหลัก (`src/config.ts`)

## `getConfigDirs(subpath, options)`

ส่งคืนรายการที่เรียงลำดับ:

- รายการระดับผู้ใช้ก่อน (ตามลำดับความสำคัญของแหล่งที่มา)
- จากนั้นรายการระดับโปรเจกต์ (ตามลำดับความสำคัญเดียวกัน)

ตัวเลือก:

- `user` (ค่าเริ่มต้น `true`)
- `project` (ค่าเริ่มต้น `true`)
- `cwd` (ค่าเริ่มต้น `getProjectDir()`)
- `existingOnly` (ค่าเริ่มต้น `false`)

API นี้ใช้สำหรับการค้นหาการกำหนดค่าแบบไดเรกทอรี (commands, hooks, tools, agents เป็นต้น)

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

ค้นหาไฟล์ที่มีอยู่ไฟล์แรกจากฐานที่เรียงลำดับแล้ว ส่งคืนการจับคู่แรก (เฉพาะพาธ หรือ พาธ+ข้อมูลเมตา)

## `findAllNearestProjectConfigDirs(subpath, cwd)`

เดินขึ้นไปในไดเรกทอรีแม่และส่งคืน **ไดเรกทอรีที่ใกล้ที่สุดต่อฐานแหล่งที่มา** (`.xcsh`, `.claude`, `.codex`, `.gemini`) จากนั้นจัดเรียงผลลัพธ์ตามลำดับความสำคัญของแหล่งที่มา

ใช้เมื่อการกำหนดค่าโปรเจกต์ควรสืบทอดจากไดเรกทอรีบรรพบุรุษ (พฤติกรรม monorepo/nested workspace)

---

## 3) wrapper ไฟล์การกำหนดค่า (`ConfigFile<T>` ใน `src/config.ts`)

`ConfigFile<T>` คือตัวโหลดที่ตรวจสอบ schema สำหรับไฟล์การกำหนดค่าเดียว

รูปแบบที่รองรับ:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

พฤติกรรม:

- ตรวจสอบข้อมูลที่แยกวิเคราะห์ด้วย AJV กับ TypeBox schema ที่ให้มา
- แคชผลการโหลดจนกว่าจะเรียก `invalidate()`
- ส่งคืนผลลัพธ์ tri-state ผ่าน `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` พร้อม schema/parse context)

ยังรองรับการ migration แบบ Legacy:

- หากพาธเป้าหมายเป็น `.yml`/`.yaml` จะมีการ migration อัตโนมัติครั้งเดียวจาก sibling `.json` (`migrateJsonToYml`)

---

## 4) โมเดลการแก้ไข Settings (`src/config/settings.ts`)

โมเดล settings รันไทม์มีการจัดเลเยอร์:

1. Global settings: `~/.xcsh/agent/config.yml`
2. Project settings: ค้นพบผ่าน settings capability (`settings.json` จาก providers)
3. Runtime overrides: อยู่ใน memory ไม่มีการบันทึกถาวร
4. Schema defaults: จาก `SETTINGS_SCHEMA`

เส้นทางการอ่านที่มีผล:

`defaults <- global <- project <- overrides`

พฤติกรรมการเขียน:

- `settings.set(...)` เขียนไปยังเลเยอร์ **global** (`config.yml`) และจัดคิวการบันทึกในเบื้องหลัง
- Project settings อ่านได้อย่างเดียวจากการค้นพบ capability

## พฤติกรรม Migration ที่ยังใช้งานอยู่

เมื่อเริ่มต้น หาก `config.yml` ไม่มีอยู่:

1. Migration จาก `~/.xcsh/agent/settings.json` (เปลี่ยนชื่อเป็น `.bak` เมื่อสำเร็จ)
2. รวมกับ legacy DB settings จาก `agent.db`
3. เขียนผลลัพธ์ที่รวมแล้วไปยัง `config.yml`

การ migration ระดับ field ใน `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- มิลลิวินาที `ask.timeout` -> วินาที เมื่อค่าเก่าดูเหมือนเป็น ms (`> 1000`)
- Legacy flat `theme: "..."` -> โครงสร้าง `theme.dark/theme.light`

---

## 5) การรวม Capability/discovery

การโหลดการกำหนดค่าที่ไม่ใช่ core ส่วนใหญ่ไหลผ่าน capability registry (`src/capability/index.ts` + `src/discovery/index.ts`)

## การเรียงลำดับ Provider

Providers ถูกจัดเรียงตามลำดับความสำคัญตัวเลข (สูงกว่าก่อน) ตัวอย่างลำดับความสำคัญ:

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

## Dedup semantics

Capabilities กำหนด `key(item)`:

- key เดียวกัน => รายการแรกชนะ (รายการที่มีลำดับความสำคัญสูงกว่า/โหลดก่อน)
- ไม่มี key (`undefined`) => ไม่มี dedup รายการทั้งหมดถูกเก็บไว้

Keys ที่เกี่ยวข้อง:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: ไม่มี dedup (รายการทั้งหมดถูกเก็บรักษาไว้)

---

## 6) พฤติกรรม Native `.xcsh` provider (`src/discovery/builtin.ts`)

Native provider (`id: native`) อ่านจาก:

- project: `<cwd>/.xcsh/...`
- user: `~/.xcsh/agent/...`

### กฎการรับไดเรกทอรี

`builtin.ts` รวมรูทการกำหนดค่าเฉพาะเมื่อไดเรกทอรีมีอยู่ **และไม่ว่างเปล่า** (`ifNonEmptyDir`)

### การโหลดเฉพาะ Scope

- Skills: `skills/*/SKILL.md`
- Slash commands: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` และ `tools/<name>/index.ts`
- Extension modules: ค้นพบใน `extensions/` (+ legacy `settings.json.extensions` string array)
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings capability: `settings.json`

### ความละเอียดอ่อนของการค้นหาโปรเจกต์ที่ใกล้ที่สุด

สำหรับ `SYSTEM.md` และ `AGENTS.md` native provider ใช้การค้นหาไดเรกทอรี `.xcsh` ของโปรเจกต์ที่ใกล้ที่สุดในบรรพบุรุษ (walk-up) แต่ยังคงต้องการให้ไดเรกทอรี `.xcsh` ไม่ว่างเปล่า

---

## 7) วิธีที่ subsystems หลักใช้การกำหนดค่า

## Settings subsystem

- `Settings.init()` โหลด global `config.yml` + รายการ `settings.json` capability ของโปรเจกต์ที่ค้นพบ
- เฉพาะรายการ capability ที่มี `level === "project"` เท่านั้นที่ถูกรวมเข้าเลเยอร์โปรเจกต์

## Skills subsystem

- `extensibility/skills.ts` โหลดผ่าน `loadCapability(skillCapability.id, { cwd })`
- ใช้ source toggles และ filters (`ignoredSkills`, `includeSkills`, custom dirs)
- Legacy-named toggles ยังคงมีอยู่ (`skills.enablePiUser`, `skills.enablePiProject`) แต่ใช้ควบคุม native provider (`provider === "native"`)

## Hooks subsystem

- `discoverAndLoadHooks()` แก้ไขพาธ hook จาก hook capability + พาธที่กำหนดค่าอย่างชัดเจน
- จากนั้นโหลด modules ผ่าน Bun import

## Tools subsystem

- `discoverAndLoadCustomTools()` แก้ไขพาธ tool จาก tool capability + plugin tool paths + พาธที่กำหนดค่าอย่างชัดเจน
- ไฟล์ tool แบบ declarative `.md/.json` เป็นเพียง metadata เท่านั้น การโหลด executable คาดหวัง code modules

## Extensions subsystem

- `discoverAndLoadExtensions()` แก้ไข extension modules จาก extension-module capability บวกกับพาธที่ชัดเจน
- การนำไปใช้ปัจจุบันจงใจเก็บเฉพาะรายการ capability ที่มี `_source.provider === "native"` ก่อนโหลด

---

## 8) กฎลำดับความสำคัญที่ควรพึ่งพา

ใช้โมเดลความคิดนี้:

1. ลำดับไดเรกทอรีแหล่งที่มาจาก `config.ts` กำหนดลำดับพาธผู้สมัคร
2. ลำดับความสำคัญของ capability provider กำหนดลำดับความสำคัญข้าม provider
3. Capability key dedup กำหนดพฤติกรรมการชนกัน (first wins สำหรับ keyed capabilities)
4. Logic การรวม subsystem เฉพาะสามารถเปลี่ยนลำดับความสำคัญที่มีผลเพิ่มเติม (โดยเฉพาะ settings)

### ข้อแม้เฉพาะ Settings

รายการ settings capability ไม่ถูก deduplicate; `Settings.#loadProjectSettings()` deep-merges รายการโปรเจกต์ตามลำดับที่ส่งคืน เนื่องจากการ merge ใช้ค่าของรายการที่อยู่หลังทับค่าก่อนหน้า พฤติกรรม override ที่มีผลขึ้นอยู่กับลำดับการ emit ของ provider ไม่ใช่แค่ semantics ของ capability key เท่านั้น

---

## 9) พฤติกรรม Legacy/compatibility ที่ยังคงมีอยู่

- การ migration JSON -> YAML ของ `ConfigFile` สำหรับไฟล์ที่กำหนดเป้าหมายเป็น YAML
- การ migration Settings จาก `settings.json` และ `agent.db` ไปยัง `config.yml`
- การ migration key ของ Settings (`queueMode`, `ask.timeout`, flat `theme`)
- ความเข้ากันได้ของ extension manifest: loader รับทั้งส่วน manifest `package.json.xcsh` และ `package.json.pi`
- Legacy setting names `skills.enablePiUser` / `skills.enablePiProject` ยังคงเป็น active gates สำหรับ native skill source

หากพาธ compatibility เหล่านี้ถูกลบออกจากโค้ด ให้อัปเดตเอกสารนี้ทันที เนื่องจากพฤติกรรมรันไทม์หลายอย่างยังคงพึ่งพาพวกมันในปัจจุบัน
