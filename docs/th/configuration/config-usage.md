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

เอกสารนี้อธิบายวิธีที่ coding-agent แก้ไขการกำหนดค่าในปัจจุบัน: รูทใดที่ถูกสแกน ลำดับความสำคัญทำงานอย่างไร และการกำหนดค่าที่แก้ไขแล้วถูกใช้โดย settings, skills, hooks, tools และ extensions อย่างไร

## ขอบเขต

การ implement หลัก:

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

## 1) รูทการกำหนดค่าและลำดับแหล่งข้อมูล

## รูทมาตรฐาน

`src/config.ts` กำหนดรายการลำดับความสำคัญของแหล่งข้อมูลแบบตายตัว:

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

ตัวช่วยทั่วไปใน `src/config.ts` **ไม่** รวม `.pi` ในลำดับการค้นพบแหล่งข้อมูล

---

## 2) ตัวช่วยการค้นพบหลัก (`src/config.ts`)

## `getConfigDirs(subpath, options)`

ส่งคืนรายการตามลำดับ:

- รายการระดับผู้ใช้ก่อน (ตามลำดับความสำคัญของแหล่งข้อมูล)
- จากนั้นรายการระดับโปรเจกต์ (ตามลำดับความสำคัญของแหล่งข้อมูลเดียวกัน)

ตัวเลือก:

- `user` (ค่าเริ่มต้น `true`)
- `project` (ค่าเริ่มต้น `true`)
- `cwd` (ค่าเริ่มต้น `getProjectDir()`)
- `existingOnly` (ค่าเริ่มต้น `false`)

API นี้ใช้สำหรับการค้นหาการกำหนดค่าแบบไดเรกทอรี (commands, hooks, tools, agents เป็นต้น)

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

ค้นหาไฟล์แรกที่มีอยู่จริงข้ามฐานที่เรียงลำดับแล้ว ส่งคืนผลลัพธ์แรกที่ตรงกัน (เฉพาะ path หรือ path+metadata)

## `findAllNearestProjectConfigDirs(subpath, cwd)`

เดินขึ้นไปตามไดเรกทอรีแม่และส่งคืน **ไดเรกทอรีที่ใกล้ที่สุดที่มีอยู่ต่อฐานแหล่งข้อมูล** (`.xcsh`, `.claude`, `.codex`, `.gemini`) จากนั้นเรียงลำดับผลลัพธ์ตามลำดับความสำคัญของแหล่งข้อมูล

ใช้สิ่งนี้เมื่อการกำหนดค่าโปรเจกต์ควรสืบทอดจากไดเรกทอรีบรรพบุรุษ (พฤติกรรม monorepo/nested workspace)

---

## 3) ตัวห่อหุ้มไฟล์การกำหนดค่า (`ConfigFile<T>` ใน `src/config.ts`)

`ConfigFile<T>` คือตัวโหลดที่ผ่านการตรวจสอบ schema สำหรับไฟล์การกำหนดค่าเดี่ยว

รูปแบบที่รองรับ:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

พฤติกรรม:

- ตรวจสอบข้อมูลที่แยกวิเคราะห์แล้วด้วย AJV เทียบกับ TypeBox schema ที่ระบุ
- แคชผลลัพธ์การโหลดจนกว่าจะเรียก `invalidate()`
- ส่งคืนผลลัพธ์แบบ tri-state ผ่าน `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` พร้อมบริบท schema/parse)

การย้ายข้อมูลแบบเก่ายังคงรองรับ:

- หาก path เป้าหมายคือ `.yml`/`.yaml` ไฟล์ `.json` ข้างเคียงจะถูกย้ายอัตโนมัติหนึ่งครั้ง (`migrateJsonToYml`)

---

## 4) โมเดลการแก้ไข Settings (`src/config/settings.ts`)

โมเดล settings ขณะรันไทม์จัดเป็นเลเยอร์:

1. Settings ทั่วไป: `~/.xcsh/agent/config.yml`
2. Settings โปรเจกต์: ค้นพบผ่าน settings capability (`settings.json` จาก providers)
3. การ override ขณะรันไทม์: ในหน่วยความจำ ไม่ถาวร
4. ค่าเริ่มต้นของ Schema: จาก `SETTINGS_SCHEMA`

เส้นทางการอ่านที่มีผล:

`defaults <- global <- project <- overrides`

พฤติกรรมการเขียน:

- `settings.set(...)` เขียนไปยังเลเยอร์ **global** (`config.yml`) และจัดคิวการบันทึกแบบ background
- Settings โปรเจกต์เป็นแบบอ่านอย่างเดียวจากการค้นพบ capability

## พฤติกรรมการย้ายข้อมูลยังคงทำงานอยู่

เมื่อเริ่มต้น หาก `config.yml` หายไป:

1. ย้ายจาก `~/.xcsh/agent/settings.json` (เปลี่ยนชื่อเป็น `.bak` เมื่อสำเร็จ)
2. รวมกับ settings DB แบบเก่าจาก `agent.db`
3. เขียนผลลัพธ์ที่รวมแล้วไปยัง `config.yml`

การย้ายข้อมูลระดับฟิลด์ใน `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` มิลลิวินาที -> วินาที เมื่อค่าเก่าดูเหมือน ms (`> 1000`)
- โครงสร้าง `theme: "..."` แบบ flat เก่า -> โครงสร้าง `theme.dark/theme.light`

---

## 5) การรวม Capability/Discovery

ขั้นตอนการโหลดการกำหนดค่าที่ไม่ใช่หลักส่วนใหญ่ผ่าน capability registry (`src/capability/index.ts` + `src/discovery/index.ts`)

## ลำดับ Provider

Providers จะถูกเรียงตาม priority แบบตัวเลข (สูงกว่าก่อน) ตัวอย่าง priorities:

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

## ความหมายของการตัดซ้ำ

Capabilities กำหนด `key(item)`:

- key เดียวกัน => รายการแรกชนะ (รายการที่มี priority สูงกว่า/โหลดก่อน)
- ไม่มี key (`undefined`) => ไม่ตัดซ้ำ รายการทั้งหมดถูกเก็บไว้

Key ที่เกี่ยวข้อง:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: ไม่ตัดซ้ำ (รายการทั้งหมดถูกเก็บไว้)

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

สำหรับ `SYSTEM.md` และ `AGENTS.md` native provider ใช้การค้นหาไดเรกทอรี `.xcsh` ของโปรเจกต์บรรพบุรุษที่ใกล้ที่สุด (เดินขึ้น) แต่ยังคงต้องการให้ไดเรกทอรี `.xcsh` ไม่ว่างเปล่า

---

## 7) ระบบย่อมหลักใช้การกำหนดค่าอย่างไร

## ระบบย่อย Settings

- `Settings.init()` โหลด `config.yml` ทั่วไป + รายการ capability `settings.json` ของโปรเจกต์ที่ค้นพบ
- เฉพาะรายการ capability ที่มี `level === "project"` เท่านั้นที่ถูกรวมเข้าในเลเยอร์โปรเจกต์

## ระบบย่อย Skills

- `extensibility/skills.ts` โหลดผ่าน `loadCapability(skillCapability.id, { cwd })`
- ใช้ตัวสลับแหล่งข้อมูลและตัวกรอง (`ignoredSkills`, `includeSkills`, custom dirs)
- ตัวสลับที่ตั้งชื่อแบบเก่ายังคงมีอยู่ (`skills.enablePiUser`, `skills.enablePiProject`) แต่ควบคุม native provider (`provider === "native"`)

## ระบบย่อย Hooks

- `discoverAndLoadHooks()` แก้ไข hook paths จาก hook capability + paths ที่กำหนดค่าไว้อย่างชัดเจน
- จากนั้นโหลดโมดูลผ่าน Bun import

## ระบบย่อย Tools

- `discoverAndLoadCustomTools()` แก้ไข tool paths จาก tool capability + plugin tool paths + paths ที่กำหนดค่าไว้อย่างชัดเจน
- ไฟล์ tool แบบ declarative `.md/.json` เป็น metadata เท่านั้น; การโหลดแบบ executable คาดหวังโมดูลโค้ด

## ระบบย่อย Extensions

- `discoverAndLoadExtensions()` แก้ไข extension modules จาก extension-module capability บวกกับ paths ที่ระบุอย่างชัดเจน
- การ implement ปัจจุบันตั้งใจเก็บเฉพาะรายการ capability ที่มี `_source.provider === "native"` ก่อนโหลด

---

## 8) กฎลำดับความสำคัญที่สามารถพึ่งพาได้

ใช้แบบจำลองทางความคิดนี้:

1. ลำดับไดเรกทอรีแหล่งข้อมูลจาก `config.ts` กำหนดลำดับ path ที่เป็นตัวเลือก
2. Priority ของ capability provider กำหนดลำดับความสำคัญข้าม provider
3. การตัดซ้ำ capability key กำหนดพฤติกรรมการชน (รายการแรกชนะสำหรับ capabilities ที่มี key)
4. ลอจิกการรวมเฉพาะระบบย่อมสามารถเปลี่ยนลำดับความสำคัญที่มีผลได้เพิ่มเติม (โดยเฉพาะ settings)

### ข้อควรระวังเฉพาะ Settings

รายการ settings capability ไม่ถูกตัดซ้ำ; `Settings.#loadProjectSettings()` ทำ deep-merge รายการโปรเจกต์ตามลำดับที่ส่งคืน เนื่องจากการรวมใช้ค่าของรายการที่มาทีหลังทับรายการที่มาก่อน พฤติกรรมการ override ที่มีผลจึงขึ้นอยู่กับลำดับการปล่อยของ provider ไม่ใช่แค่ความหมายของ capability key

---

## 9) พฤติกรรมแบบเก่า/ความเข้ากันได้ที่ยังคงมีอยู่

- การย้ายข้อมูล JSON -> YAML ของ `ConfigFile` สำหรับไฟล์ที่กำหนดเป้าหมาย YAML
- การย้ายข้อมูล Settings จาก `settings.json` และ `agent.db` ไปยัง `config.yml`
- การย้ายข้อมูล settings key (`queueMode`, `ask.timeout`, flat `theme`)
- ความเข้ากันได้ของ extension manifest: ตัวโหลดรับทั้งส่วน manifest `package.json.xcsh` และ `package.json.pi`
- ชื่อ setting แบบเก่า `skills.enablePiUser` / `skills.enablePiProject` ยังคงเป็นตัวควบคุมที่ทำงานอยู่สำหรับแหล่งข้อมูล native skill

หากเส้นทางความเข้ากันได้เหล่านี้ถูกลบออกในโค้ด ให้อัปเดตเอกสารนี้ทันที; พฤติกรรมขณะรันไทม์หลายอย่างยังคงพึ่งพาสิ่งเหล่านี้อยู่ในปัจจุบัน
