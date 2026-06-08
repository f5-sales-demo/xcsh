---
title: Configuration Discovery and Resolution
description: >-
  วิธีที่ xcsh ค้นหา แก้ไข และจัดลำดับชั้นการกำหนดค่าจากรากโปรเจกต์ ผู้ใช้
  และองค์กร
sidebar:
  order: 1
  label: Configuration
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# การค้นหาและการแก้ไขการกำหนดค่า

เอกสารนี้อธิบายวิธีที่ coding-agent แก้ไขการกำหนดค่าในปัจจุบัน: รากใดบ้างที่ถูกสแกน ลำดับความสำคัญทำงานอย่างไร และการกำหนดค่าที่แก้ไขแล้วถูกใช้โดย settings, skills, hooks, tools และ extensions อย่างไร

## ขอบเขต

การนำไปใช้งานหลัก:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

จุดเชื่อมต่อสำคัญ:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## ขั้นตอนการแก้ไข (แบบภาพ)

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

## 1) รากการกำหนดค่าและลำดับแหล่งที่มา

## รากมาตรฐาน

`src/config.ts` กำหนดรายการลำดับความสำคัญของแหล่งที่มาแบบคงที่:

1. `.xcsh` (ดั้งเดิม)
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

คืนค่ารายการที่เรียงลำดับ:

- รายการระดับผู้ใช้ก่อน (ตามลำดับความสำคัญของแหล่งที่มา)
- จากนั้นรายการระดับโปรเจกต์ (ตามลำดับความสำคัญของแหล่งที่มาเดียวกัน)

ตัวเลือก:

- `user` (ค่าเริ่มต้น `true`)
- `project` (ค่าเริ่มต้น `true`)
- `cwd` (ค่าเริ่มต้น `getProjectDir()`)
- `existingOnly` (ค่าเริ่มต้น `false`)

API นี้ใช้สำหรับการค้นหาการกำหนดค่าแบบไดเรกทอรี (commands, hooks, tools, agents เป็นต้น)

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

ค้นหาไฟล์ที่มีอยู่ตัวแรกจากฐานที่เรียงลำดับ คืนค่าผลลัพธ์แรกที่ตรง (เฉพาะเส้นทาง หรือ เส้นทาง+เมตาดาต้า)

## `findAllNearestProjectConfigDirs(subpath, cwd)`

เดินขึ้นไปตามไดเรกทอรีแม่และคืนค่า **ไดเรกทอรีที่มีอยู่ใกล้ที่สุดต่อฐานแหล่งที่มา** (`.xcsh`, `.claude`, `.codex`, `.gemini`) จากนั้นเรียงลำดับผลลัพธ์ตามลำดับความสำคัญของแหล่งที่มา

ใช้เมื่อการกำหนดค่าโปรเจกต์ควรสืบทอดจากไดเรกทอรีบรรพบุรุษ (พฤติกรรม monorepo/nested workspace)

---

## 3) ตัวห่อไฟล์การกำหนดค่า (`ConfigFile<T>` ใน `src/config.ts`)

`ConfigFile<T>` คือตัวโหลดที่ตรวจสอบ schema สำหรับไฟล์การกำหนดค่าเดี่ยว

รูปแบบที่รองรับ:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

พฤติกรรม:

- ตรวจสอบข้อมูลที่แยกวิเคราะห์ด้วย AJV เทียบกับ TypeBox schema ที่ให้มา
- แคชผลลัพธ์การโหลดจนกว่าจะเรียก `invalidate()`
- คืนค่าผลลัพธ์แบบสามสถานะผ่าน `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` พร้อมบริบท schema/parse)

ยังรองรับการย้ายข้อมูลแบบเก่า:

- หากเส้นทางเป้าหมายเป็น `.yml`/`.yaml` ไฟล์ `.json` ข้างเคียงจะถูกย้ายโดยอัตโนมัติครั้งเดียว (`migrateJsonToYml`)

---

## 4) โมเดลการแก้ไขการตั้งค่า (`src/config/settings.ts`)

โมเดลการตั้งค่ารันไทม์เป็นแบบหลายชั้น:

1. การตั้งค่าทั่วไป: `~/.xcsh/agent/config.yml`
2. การตั้งค่าโปรเจกต์: ค้นพบผ่าน settings capability (`settings.json` จาก providers)
3. การแทนที่รันไทม์: ในหน่วยความจำ ไม่ถาวร
4. ค่าเริ่มต้นของ Schema: จาก `SETTINGS_SCHEMA`

เส้นทางการอ่านที่มีผล:

`defaults <- global <- project <- overrides`

พฤติกรรมการเขียน:

- `settings.set(...)` เขียนไปยังชั้น **global** (`config.yml`) และจัดคิวการบันทึกแบบพื้นหลัง
- การตั้งค่าโปรเจกต์เป็นแบบอ่านอย่างเดียวจากการค้นหา capability

## พฤติกรรมการย้ายข้อมูลที่ยังทำงานอยู่

เมื่อเริ่มต้น หาก `config.yml` ไม่มี:

1. ย้ายจาก `~/.xcsh/agent/settings.json` (เปลี่ยนชื่อเป็น `.bak` เมื่อสำเร็จ)
2. รวมกับการตั้งค่า legacy DB จาก `agent.db`
3. เขียนผลลัพธ์ที่รวมแล้วไปยัง `config.yml`

การย้ายระดับฟิลด์ใน `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` มิลลิวินาที -> วินาที เมื่อค่าเดิมดูเหมือนเป็น ms (`> 1000`)
- โครงสร้าง Legacy แบบแบน `theme: "..."` -> `theme.dark/theme.light`

---

## 5) การรวม Capability/Discovery

การโหลดการกำหนดค่าที่ไม่ใช่แกนหลักส่วนใหญ่ดำเนินการผ่าน capability registry (`src/capability/index.ts` + `src/discovery/index.ts`)

## ลำดับ Provider

Providers ถูกเรียงลำดับตามลำดับความสำคัญเชิงตัวเลข (สูงกว่าก่อน) ตัวอย่างลำดับความสำคัญ:

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

## ความหมายของ Dedup

Capabilities กำหนด `key(item)`:

- คีย์เดียวกัน => รายการแรกชนะ (รายการที่มีลำดับความสำคัญสูงกว่า/โหลดก่อน)
- ไม่มีคีย์ (`undefined`) => ไม่มี dedup รายการทั้งหมดถูกเก็บไว้

คีย์ที่เกี่ยวข้อง:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: ไม่มี dedup (รายการทั้งหมดถูกเก็บไว้)

---

## 6) พฤติกรรม Native `.xcsh` provider (`src/discovery/builtin.ts`)

Native provider (`id: native`) อ่านจาก:

- โปรเจกต์: `<cwd>/.xcsh/...`
- ผู้ใช้: `~/.xcsh/agent/...`

### กฎการรับเข้าไดเรกทอรี

`builtin.ts` จะรวมรากการกำหนดค่าก็ต่อเมื่อไดเรกทอรีมีอยู่ **และไม่ว่างเปล่า** (`ifNonEmptyDir`)

### การโหลดเฉพาะขอบเขต

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

### รายละเอียดของการค้นหาโปรเจกต์ที่ใกล้ที่สุด

สำหรับ `SYSTEM.md` และ `AGENTS.md` native provider ใช้การค้นหาไดเรกทอรีโปรเจกต์ `.xcsh` ของบรรพบุรุษที่ใกล้ที่สุด (เดินขึ้น) แต่ยังคงต้องการให้ไดเรกทอรี `.xcsh` ไม่ว่างเปล่า

---

## 7) ระบบย่อมหลักใช้การกำหนดค่าอย่างไร

## ระบบย่อย Settings

- `Settings.init()` โหลด `config.yml` ทั่วไป + รายการ capability `settings.json` ของโปรเจกต์ที่ค้นพบ
- เฉพาะรายการ capability ที่มี `level === "project"` เท่านั้นที่ถูกรวมเข้าในชั้นโปรเจกต์

## ระบบย่อย Skills

- `extensibility/skills.ts` โหลดผ่าน `loadCapability(skillCapability.id, { cwd })`
- ใช้ตัวสลับและตัวกรองแหล่งที่มา (`ignoredSkills`, `includeSkills`, custom dirs)
- ตัวสลับที่ตั้งชื่อแบบเก่ายังคงมีอยู่ (`skills.enablePiUser`, `skills.enablePiProject`) แต่ควบคุม native provider (`provider === "native"`)

## ระบบย่อย Hooks

- `discoverAndLoadHooks()` แก้ไขเส้นทาง hook จาก hook capability + เส้นทางที่กำหนดค่าอย่างชัดเจน
- จากนั้นโหลดโมดูลผ่าน Bun import

## ระบบย่อย Tools

- `discoverAndLoadCustomTools()` แก้ไขเส้นทาง tool จาก tool capability + เส้นทาง plugin tool + เส้นทางที่กำหนดค่าอย่างชัดเจน
- ไฟล์ tool แบบ declarative `.md/.json` เป็นเมตาดาต้าเท่านั้น; การโหลดแบบ executable คาดหวังโมดูลโค้ด

## ระบบย่อย Extensions

- `discoverAndLoadExtensions()` แก้ไข extension modules จาก extension-module capability บวกเส้นทางที่ระบุอย่างชัดเจน
- การนำไปใช้งานปัจจุบันจงใจเก็บเฉพาะรายการ capability ที่มี `_source.provider === "native"` ก่อนการโหลด

---

## 8) กฎลำดับความสำคัญที่ควรยึดถือ

ใช้โมเดลทางความคิดนี้:

1. ลำดับไดเรกทอรีแหล่งที่มาจาก `config.ts` กำหนดลำดับเส้นทางที่เป็นตัวเลือก
2. ลำดับความสำคัญของ capability provider กำหนดลำดับความสำคัญข้าม provider
3. Capability key dedup กำหนดพฤติกรรมการชน (ตัวแรกชนะสำหรับ capabilities ที่มีคีย์)
4. ตรรกะการรวมเฉพาะระบบย่อมสามารถเปลี่ยนลำดับความสำคัญที่มีผลได้อีก (โดยเฉพาะ settings)

### ข้อควรระวังเฉพาะ Settings

รายการ Settings capability ไม่ถูก deduplicate; `Settings.#loadProjectSettings()` ทำ deep-merge รายการโปรเจกต์ตามลำดับที่คืนค่า เนื่องจากการรวมจะนำค่าของรายการที่มาทีหลังมาทับรายการที่มาก่อน พฤติกรรมการแทนที่ที่มีผลจึงขึ้นอยู่กับลำดับการปล่อยออกมาของ provider ไม่ใช่เฉพาะความหมายของ capability key

---

## 9) พฤติกรรม Legacy/ความเข้ากันได้ที่ยังคงมีอยู่

- การย้ายข้อมูล `ConfigFile` จาก JSON -> YAML สำหรับไฟล์ที่กำหนดเป้าหมาย YAML
- การย้ายข้อมูลการตั้งค่าจาก `settings.json` และ `agent.db` ไปยัง `config.yml`
- การย้ายคีย์การตั้งค่า (`queueMode`, `ask.timeout`, `theme` แบบแบน)
- ความเข้ากันได้ของ Extension manifest: ตัวโหลดรับทั้งส่วน manifest `package.json.xcsh` และ `package.json.pi`
- ชื่อการตั้งค่าแบบเก่า `skills.enablePiUser` / `skills.enablePiProject` ยังคงเป็นตัวควบคุมที่ทำงานอยู่สำหรับแหล่ง native skill

หากเส้นทางความเข้ากันได้เหล่านี้ถูกลบออกจากโค้ด ให้อัปเดตเอกสารนี้ทันที; พฤติกรรมรันไทม์หลายอย่างยังคงพึ่งพาสิ่งเหล่านี้ในปัจจุบัน
