---
title: Configuration Discovery and Resolution
description: >-
  How xcsh discovers, resolves, and layers configuration from project, user, and
  enterprise roots.
sidebar:
  order: 1
  label: Configuration
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# การค้นหาและการแก้ไขการกำหนดค่า

เอกสารนี้อธิบายวิธีที่ coding-agent แก้ไขการกำหนดค่าในปัจจุบัน: รูทใดที่ถูกสแกน ลำดับความสำคัญทำงานอย่างไร และการกำหนดค่าที่แก้ไขแล้วถูกใช้งานโดย settings, skills, hooks, tools และ extensions อย่างไร

## ขอบเขต

การใช้งานหลัก:

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

## ขั้นตอนการแก้ไข (ภาพรวม)

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

`src/config.ts` กำหนดรายการลำดับความสำคัญของแหล่งที่มาแบบตายตัว:

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

## ข้อจำกัดที่สำคัญ

ตัวช่วยทั่วไปใน `src/config.ts` **ไม่** รวม `.pi` ในลำดับการค้นหาแหล่งที่มา

---

## 2) ตัวช่วยการค้นหาหลัก (`src/config.ts`)

## `getConfigDirs(subpath, options)`

ส่งคืนรายการตามลำดับ:

- รายการระดับผู้ใช้ก่อน (ตามลำดับความสำคัญของแหล่งที่มา)
- จากนั้นรายการระดับโปรเจกต์ (ตามลำดับความสำคัญของแหล่งที่มาเดียวกัน)

ตัวเลือก:

- `user` (ค่าเริ่มต้น `true`)
- `project` (ค่าเริ่มต้น `true`)
- `cwd` (ค่าเริ่มต้น `getProjectDir()`)
- `existingOnly` (ค่าเริ่มต้น `false`)

API นี้ใช้สำหรับการค้นหาการกำหนดค่าแบบไดเรกทอรี (commands, hooks, tools, agents เป็นต้น)

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

ค้นหาไฟล์ที่มีอยู่ตัวแรกจากฐานที่เรียงตามลำดับ ส่งคืนผลลัพธ์แรกที่ตรงกัน (เฉพาะเส้นทาง หรือ เส้นทาง+ข้อมูลเมตา)

## `findAllNearestProjectConfigDirs(subpath, cwd)`

เดินขึ้นไปตามไดเรกทอรีหลักและส่งคืน **ไดเรกทอรีที่มีอยู่ใกล้ที่สุดต่อฐานแหล่งที่มา** (`.xcsh`, `.claude`, `.codex`, `.gemini`) จากนั้นเรียงลำดับผลลัพธ์ตามลำดับความสำคัญของแหล่งที่มา

ใช้สิ่งนี้เมื่อการกำหนดค่าระดับโปรเจกต์ควรสืบทอดจากไดเรกทอรีบรรพบุรุษ (พฤติกรรม monorepo/nested workspace)

---

## 3) ตัวห่อไฟล์การกำหนดค่า (`ConfigFile<T>` ใน `src/config.ts`)

`ConfigFile<T>` คือตัวโหลดที่ตรวจสอบ schema สำหรับไฟล์การกำหนดค่าเดี่ยว

รูปแบบที่รองรับ:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

พฤติกรรม:

- ตรวจสอบข้อมูลที่แยกวิเคราะห์ด้วย AJV เทียบกับ TypeBox schema ที่ระบุ
- แคชผลลัพธ์การโหลดจนกว่าจะเรียก `invalidate()`
- ส่งคืนผลลัพธ์สามสถานะผ่าน `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` พร้อมบริบท schema/parse)

การย้ายข้อมูลแบบเก่ายังคงรองรับ:

- หากเส้นทางเป้าหมายเป็น `.yml`/`.yaml` ไฟล์ `.json` ข้างเคียงจะถูกย้ายข้อมูลอัตโนมัติครั้งเดียว (`migrateJsonToYml`)

---

## 4) โมเดลการแก้ไขการตั้งค่า (`src/config/settings.ts`)

โมเดลการตั้งค่ารันไทม์เป็นแบบหลายชั้น:

1. การตั้งค่าทั่วไป: `~/.xcsh/agent/config.yml`
2. การตั้งค่าโปรเจกต์: ค้นพบผ่าน settings capability (`settings.json` จาก providers)
3. การแทนที่รันไทม์: ในหน่วยความจำ ไม่ถาวร
4. ค่าเริ่มต้นของ schema: จาก `SETTINGS_SCHEMA`

เส้นทางการอ่านที่มีผล:

`defaults <- global <- project <- overrides`

พฤติกรรมการเขียน:

- `settings.set(...)` เขียนไปยังชั้น **global** (`config.yml`) และจัดคิวการบันทึกในเบื้องหลัง
- การตั้งค่าโปรเจกต์เป็นแบบอ่านอย่างเดียวจากการค้นพบ capability

## พฤติกรรมการย้ายข้อมูลที่ยังคงทำงานอยู่

เมื่อเริ่มต้น หาก `config.yml` หายไป:

1. ย้ายข้อมูลจาก `~/.xcsh/agent/settings.json` (เปลี่ยนชื่อเป็น `.bak` เมื่อสำเร็จ)
2. รวมกับการตั้งค่า DB แบบเก่าจาก `agent.db`
3. เขียนผลลัพธ์ที่รวมแล้วไปยัง `config.yml`

การย้ายข้อมูลระดับฟิลด์ใน `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` มิลลิวินาที -> วินาที เมื่อค่าเก่าดูเหมือนเป็น ms (`> 1000`)
- โครงสร้างแบบเก่า `theme: "..."` -> `theme.dark/theme.light`

---

## 5) การรวม Capability/discovery

ขั้นตอนการโหลดการกำหนดค่าที่ไม่ใช่แกนหลักส่วนใหญ่ผ่าน capability registry (`src/capability/index.ts` + `src/discovery/index.ts`)

## ลำดับของ Provider

Providers ถูกเรียงตามลำดับความสำคัญเชิงตัวเลข (สูงกว่าก่อน) ตัวอย่างลำดับความสำคัญ:

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

## ความหมายของการกำจัดรายการซ้ำ

Capabilities กำหนด `key(item)`:

- key เดียวกัน => รายการแรกชนะ (รายการที่มีลำดับความสำคัญสูงกว่า/ถูกโหลดก่อน)
- ไม่มี key (`undefined`) => ไม่กำจัดซ้ำ รายการทั้งหมดถูกเก็บไว้

Key ที่เกี่ยวข้อง:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: ไม่กำจัดซ้ำ (รายการทั้งหมดถูกเก็บไว้)

---

## 6) พฤติกรรม Native `.xcsh` provider (`src/discovery/builtin.ts`)

Native provider (`id: native`) อ่านจาก:

- โปรเจกต์: `<cwd>/.xcsh/...`
- ผู้ใช้: `~/.xcsh/agent/...`

### กฎการรับเข้าไดเรกทอรี

`builtin.ts` รวมรูทการกำหนดค่าเฉพาะเมื่อไดเรกทอรีมีอยู่ **และไม่ว่างเปล่า** (`ifNonEmptyDir`)

### การโหลดเฉพาะขอบเขต

- Skills: `skills/*/SKILL.md`
- Slash commands: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` และ `tools/<name>/index.ts`
- Extension modules: ค้นพบภายใต้ `extensions/` (+ อาร์เรย์สตริง `settings.json.extensions` แบบเก่า)
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings capability: `settings.json`

### ความละเอียดของการค้นหาโปรเจกต์ที่ใกล้ที่สุด

สำหรับ `SYSTEM.md` และ `AGENTS.md` native provider ใช้การค้นหาไดเรกทอรีโปรเจกต์ `.xcsh` บรรพบุรุษที่ใกล้ที่สุด (เดินขึ้น) แต่ยังคงต้องการให้ไดเรกทอรี `.xcsh` ไม่ว่างเปล่า

---

## 7) วิธีที่ระบบย่อมหลักใช้การกำหนดค่า

## ระบบย่อย Settings

- `Settings.init()` โหลด global `config.yml` + รายการ capability `settings.json` ของโปรเจกต์ที่ค้นพบ
- เฉพาะรายการ capability ที่มี `level === "project"` เท่านั้นที่ถูกรวมเข้าในชั้นโปรเจกต์

## ระบบย่อย Skills

- `extensibility/skills.ts` โหลดผ่าน `loadCapability(skillCapability.id, { cwd })`
- ใช้ตัวสลับแหล่งที่มาและตัวกรอง (`ignoredSkills`, `includeSkills`, custom dirs)
- ตัวสลับชื่อแบบเก่ายังคงมีอยู่ (`skills.enablePiUser`, `skills.enablePiProject`) แต่ควบคุม native provider (`provider === "native"`)

## ระบบย่อย Hooks

- `discoverAndLoadHooks()` แก้ไขเส้นทาง hook จาก hook capability + เส้นทางที่กำหนดค่าไว้อย่างชัดเจน
- จากนั้นโหลดโมดูลผ่าน Bun import

## ระบบย่อย Tools

- `discoverAndLoadCustomTools()` แก้ไขเส้นทาง tool จาก tool capability + เส้นทาง plugin tool + เส้นทางที่กำหนดค่าไว้อย่างชัดเจน
- ไฟล์ tool แบบ declarative `.md/.json` เป็นข้อมูลเมตาเท่านั้น; การโหลดแบบ executable คาดหวังโมดูลโค้ด

## ระบบย่อย Extensions

- `discoverAndLoadExtensions()` แก้ไข extension modules จาก extension-module capability พร้อมเส้นทางที่ระบุอย่างชัดเจน
- การใช้งานปัจจุบันตั้งใจเก็บเฉพาะรายการ capability ที่มี `_source.provider === "native"` ก่อนการโหลด

---

## 8) กฎลำดับความสำคัญที่ควรยึดถือ

ใช้แบบจำลองทางความคิดนี้:

1. ลำดับไดเรกทอรีแหล่งที่มาจาก `config.ts` กำหนดลำดับเส้นทางตัวเลือก
2. ลำดับความสำคัญของ capability provider กำหนดลำดับความสำคัญข้าม provider
3. การกำจัดรายการซ้ำของ capability key กำหนดพฤติกรรมการชนกัน (รายการแรกชนะสำหรับ capability ที่มี key)
4. ตรรกะการรวมเฉพาะระบบย่อยสามารถเปลี่ยนลำดับความสำคัญที่มีผลได้เพิ่มเติม (โดยเฉพาะ settings)

### ข้อควรระวังเฉพาะ Settings

รายการ settings capability ไม่ถูกกำจัดซ้ำ; `Settings.#loadProjectSettings()` ทำ deep-merge รายการโปรเจกต์ตามลำดับที่ส่งคืน เนื่องจากการ merge ใช้ค่าของรายการที่มาทีหลังทับรายการก่อนหน้า พฤติกรรมการแทนที่ที่มีผลจึงขึ้นอยู่กับลำดับการปล่อยของ provider ไม่ใช่แค่ความหมายของ capability key

---

## 9) พฤติกรรมแบบเก่า/ความเข้ากันได้ที่ยังคงมีอยู่

- การย้ายข้อมูล `ConfigFile` จาก JSON -> YAML สำหรับไฟล์ที่เป้าหมายเป็น YAML
- การย้ายข้อมูล Settings จาก `settings.json` และ `agent.db` ไปยัง `config.yml`
- การย้ายข้อมูล key ของ Settings (`queueMode`, `ask.timeout`, flat `theme`)
- ความเข้ากันได้ของ extension manifest: ตัวโหลดยอมรับทั้งส่วน manifest `package.json.xcsh` และ `package.json.pi`
- ชื่อการตั้งค่าแบบเก่า `skills.enablePiUser` / `skills.enablePiProject` ยังคงเป็นตัวควบคุมที่ทำงานอยู่สำหรับแหล่ง native skill

หากเส้นทางความเข้ากันได้เหล่านี้ถูกลบออกในโค้ด ให้อัปเดตเอกสารนี้ทันที; พฤติกรรมรันไทม์หลายอย่างยังคงพึ่งพาสิ่งเหล่านี้ในปัจจุบัน
