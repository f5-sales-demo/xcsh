---
title: ตัวจัดการปลั๊กอินและกลไกการติดตั้ง
description: >-
  ส่วนภายในของตัวจัดการปลั๊กอินที่ครอบคลุมการติดตั้ง การตรวจสอบความถูกต้อง
  การแก้ไขการพึ่งพา และการจัดการวงจรชีวิต
sidebar:
  order: 5
  label: ตัวจัดการปลั๊กอิน
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# ตัวจัดการปลั๊กอินและกลไกการติดตั้ง

เอกสารนี้อธิบายวิธีที่การดำเนินการ `xcsh plugin` เปลี่ยนแปลงสถานะของปลั๊กอินบนดิสก์ และวิธีที่ปลั๊กอินที่ติดตั้งแล้วกลายเป็นความสามารถในรันไทม์ (ปัจจุบันเป็น เครื่องมือ และพาธการแก้ไข hooks/commands ที่ใช้งานได้)

## ขอบเขตและสถาปัตยกรรม

มีการดำเนินการจัดการปลั๊กอินสองแบบในโค้ดเบส:

1. **พาธที่ใช้งานจริงโดยคำสั่ง CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **โมดูลช่วยเหลือรุ่นเก่า**: ฟังก์ชัน installer (`src/extensibility/plugins/installer.ts`)

การดำเนินการคำสั่ง `xcsh plugin ...` ผ่าน `PluginManager`

`installer.ts` ยังคงบันทึกการตรวจสอบความปลอดภัยที่สำคัญและพฤติกรรมระบบไฟล์ แต่ไม่ใช่พาธที่ใช้โดย `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`

## วงจรชีวิต: จากการเรียกใช้ CLI ถึงความพร้อมในรันไทม์

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### จุดเข้าของคำสั่ง

- `src/commands/plugin.ts` กำหนดคำสั่ง/แฟล็กและส่งต่อไปยัง `runPluginCommand`
- `src/cli/plugin-cli.ts` แมปคำสั่งย่อยกับเมธอดของ `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- ไม่มีการกระทำ `update` อย่างชัดเจน การอัปเดตทำโดยการเรียกใช้ `install` ใหม่พร้อมระบุแพ็กเกจ/เวอร์ชันใหม่

## โมเดลบนดิสก์

สถานะปลั๊กอินระดับ Global อยู่ที่ `~/.xcsh/plugins`:

- `package.json` — ไฟล์แมนิเฟสต์การพึ่งพาที่ใช้โดย `bun install`/`bun uninstall`
- `node_modules/` — แพ็กเกจปลั๊กอินที่ติดตั้งแล้วหรือ symlinks
- `xcsh-plugins.lock.json` — สถานะรันไทม์:
  - เปิดใช้งาน/ปิดใช้งานต่อปลั๊กอิน
  - ชุดฟีเจอร์ที่เลือกต่อปลั๊กอิน
  - การตั้งค่าปลั๊กอินที่บันทึกไว้

การแทนที่ในระดับโปรเจกต์อยู่ที่:

- `<cwd>/.xcsh/plugin-overrides.json`

การแทนที่เป็นแบบอ่านอย่างเดียวจากมุมมองของ manager/loader (ไม่มีพาธการเขียน) และสามารถปิดใช้งานปลั๊กอินหรือแทนที่ฟีเจอร์/การตั้งค่าสำหรับโปรเจกต์นี้

## การแยกวิเคราะห์ข้อกำหนดปลั๊กอินและการตีความเมตาดาต้า

## ไวยากรณ์ของ install spec

`parsePluginSpec` (`parser.ts`) รองรับ:

- `pkg` -> `features: null` (พฤติกรรมเริ่มต้น)
- `pkg[*]` -> เปิดใช้งานฟีเจอร์แมนิเฟสต์ทั้งหมด
- `pkg[]` -> ไม่เปิดใช้งานฟีเจอร์เสริมใดๆ
- `pkg[a,b]` -> เปิดใช้งานฟีเจอร์ที่ระบุชื่อ
- `@scope/pkg@1.2.3[feat]` -> แพ็กเกจแบบ scoped + มีเวอร์ชัน พร้อมการเลือกฟีเจอร์อย่างชัดเจน

`extractPackageName` ตัดต่อท้ายเวอร์ชันสำหรับการค้นหาพาธบนดิสก์หลังการติดตั้ง

## แหล่งที่มาของแมนิเฟสต์และฟิลด์ที่จำเป็น

แมนิเฟสต์ถูกแก้ไขดังนี้:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

ผลลัพธ์:

- ไม่มีการตรวจสอบ schema อย่างเข้มงวดใน manager/loader
- แพ็กเกจที่ขาดแมนิเฟสต์ `xcsh`/`pi` ยังคงติดตั้งและแสดงรายการได้
- การโหลดปลั๊กอินในรันไทม์ (`getEnabledPlugins`) จะข้ามแพ็กเกจที่ไม่มีแมนิเฟสต์ `xcsh`/`pi`
- `manifest.version` จะถูกเขียนทับจาก `version` ของแพ็กเกจเสมอ

`package.json` ที่มี JSON ผิดรูปแบบจะเกิดความล้มเหลวอย่างรุนแรงในเวลาอ่าน รูปร่างแมนิเฟสต์ที่ผิดรูปแบบอาจล้มเหลวในภายหลังเฉพาะเมื่อมีการใช้งานฟิลด์เฉพาะ

## ขั้นตอนการติดตั้ง/อัปเดต (`PluginManager.install`)

1. แยกวิเคราะห์ไวยากรณ์วงเล็บฟีเจอร์จาก install spec
2. ตรวจสอบความถูกต้องของชื่อแพ็กเกจกับ regex + รายการปฏิเสธ shell metacharacter
3. ตรวจสอบให้แน่ใจว่า `package.json` ของปลั๊กอินมีอยู่ (`xcsh-plugins`, แผนที่การพึ่งพา private)
4. รัน `bun install <packageSpec>` ใน `~/.xcsh/plugins`
5. อ่าน `package.json` ของแพ็กเกจที่ติดตั้ง `node_modules/<name>/package.json`
6. แก้ไขแมนิเฟสต์และคำนวณ `enabledFeatures`:
   - `[*]`: ฟีเจอร์ทั้งหมดที่ประกาศ (หรือ `null` หากไม่มีแผนที่ฟีเจอร์)
   - `[a,b]`: ตรวจสอบว่าแต่ละฟีเจอร์มีอยู่ในแผนที่ฟีเจอร์ของแมนิเฟสต์
   - `[]`: รายการฟีเจอร์ว่าง
   - bare spec: `null` (ใช้นโยบายค่าเริ่มต้นในภายหลังใน loader)
7. Upsert สถานะรันไทม์ในไฟล์ lock: `{ version, enabledFeatures, enabled: true }`

### ความหมายของการอัปเดต

เนื่องจากการอัปเดตขับเคลื่อนโดย install:

- `xcsh plugin install pkg@newVersion` อัปเดต dependency และเวอร์ชันในไฟล์ lock
- การตั้งค่าที่มีอยู่จะถูกเก็บไว้ รายการสถานะจะถูกเขียนทับสำหรับเวอร์ชัน/ฟีเจอร์/การเปิดใช้งาน
- ไม่มีลอจิก "ตรวจสอบการอัปเดต" หรือการโยกย้ายแบบ transactional แยกต่างหาก

## ขั้นตอนการลบ (`PluginManager.uninstall`)

1. ตรวจสอบความถูกต้องของชื่อแพ็กเกจ
2. รัน `bun uninstall <name>` ในไดเรกทอรีปลั๊กอิน
3. ลบสถานะรันไทม์ของปลั๊กอินออกจากไฟล์ lock:
   - `config.plugins[name]`
   - `config.settings[name]`

หาก uninstall ล้มเหลว สถานะรันไทม์จะไม่ถูกเปลี่ยนแปลง

## ขั้นตอนการแสดงรายการ (`PluginManager.list`)

1. อ่านแผนที่การพึ่งพาปลั๊กอินจาก `~/.xcsh/plugins/package.json`
2. โหลดการกำหนดค่ารันไทม์จากไฟล์ lock (ไม่มีไฟล์ -> ค่าเริ่มต้นว่างเปล่า)
3. โหลดการแทนที่โปรเจกต์ (`<cwd>/.xcsh/plugin-overrides.json`, ข้อผิดพลาดในการแยกวิเคราะห์/อ่าน -> วัตถุว่างพร้อมคำเตือน)
4. สำหรับแต่ละ dependency ที่มี package.json ที่แก้ไขได้:
   - สร้างระเบียน `InstalledPlugin`
   - รวมสถานะฟีเจอร์/การเปิดใช้งาน:
     - ฐานจากไฟล์ lock (หรือค่าเริ่มต้น)
     - การแทนที่โปรเจกต์สามารถแทนที่การเลือกฟีเจอร์
     - รายการ `disabled` ของโปรเจกต์จะปิดการมองเห็นปลั๊กอิน

นี่คือสถานะที่มีผลซึ่งใช้โดยเอาต์พุตสถานะ CLI และการดำเนินการ settings/features

## ขั้นตอนการ link (`PluginManager.link`)

`link` รองรับการพัฒนาปลั๊กอินในเครื่องโดยการสร้าง symlink ของแพ็กเกจในเครื่องไปยัง `~/.xcsh/plugins/node_modules/<pkg.name>`

พฤติกรรม:

1. แก้ไข `localPath` กับ cwd ของ manager
2. กำหนดให้ `package.json` ในเครื่องและฟิลด์ `name` ต้องมีอยู่
3. ตรวจสอบให้แน่ใจว่าไดเรกทอรีปลั๊กอินมีอยู่
4. สำหรับชื่อแบบ scoped ให้สร้างไดเรกทอรี scope
5. ลบพาธที่มีอยู่ที่ตำแหน่งลิงก์เป้าหมาย
6. สร้าง symlink
7. เพิ่มรายการไฟล์ lock รันไทม์ที่เปิดใช้งานพร้อมฟีเจอร์เริ่มต้น (`null`)

ข้อควรระวัง: `PluginManager.link` ปัจจุบันไม่บังคับใช้การตรวจสอบขอบเขตพาธ `cwd` ที่มีอยู่ใน `installer.ts` รุ่นเก่า (`normalizedPath.startsWith(normalizedCwd)`) ดังนั้นความไว้วางใจจึงเป็นความรับผิดชอบของผู้เรียก

## การโหลดรันไทม์: จากปลั๊กอินที่ติดตั้งแล้วถึงความสามารถที่เรียกใช้ได้

## เกตการค้นพบ

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) อ่าน:

- ไฟล์แมนิเฟสต์การพึ่งพาปลั๊กอิน (`package.json`)
- สถานะรันไทม์จากไฟล์ lock
- การแทนที่โปรเจกต์ผ่าน `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

การกรอง:

- ข้ามหาก package.json ของปลั๊กอินไม่มีอยู่
- ข้ามหากแมนิเฟสต์ (`xcsh`/`pi`) ขาดหาย
- ข้ามหากปิดใช้งาน globally ในไฟล์ lock
- ข้ามหากโปรเจกต์ปิดใช้งาน

## การแก้ไขพาธความสามารถ

สำหรับแต่ละปลั๊กอินที่เปิดใช้งาน:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

ตัวแก้ไขแต่ละตัวประกอบด้วยรายการฐานบวกกับรายการฟีเจอร์:

- รายการฟีเจอร์ที่ชัดเจน -> เฉพาะฟีเจอร์ที่เลือก
- `enabledFeatures === null` -> เปิดใช้งานฟีเจอร์ที่ทำเครื่องหมาย `default: true`

ไฟล์ที่ขาดหายจะถูกข้ามอย่างเงียบๆ (การป้องกัน `existsSync`)

## ความแตกต่างในการเชื่อมต่อรันไทม์ปัจจุบัน

- **เครื่องมือถูกเชื่อมต่อเข้ากับรันไทม์ในปัจจุบัน** ผ่าน `discoverAndLoadCustomTools` (`custom-tools/loader.ts`) ซึ่งเรียกใช้ `getAllPluginToolPaths(cwd)`
- พาธถูกตรวจสอบการซ้ำซ้อนโดยพาธสัมบูรณ์ที่แก้ไขแล้วในการค้นพบเครื่องมือแบบกำหนดเอง (ชุด `seen` พาธแรกชนะ)
- **ตัวแก้ไข Hooks/commands มีอยู่** และถูก export แต่พาธโค้ดนี้ปัจจุบันไม่เชื่อมต่อเข้ากับ registry รันไทม์ในลักษณะเดียวกับที่เครื่องมือถูกเชื่อมต่อ

## รายละเอียดการจัดการ Lock/สถานะ

`PluginManager` แคชการกำหนดค่ารันไทม์ในหน่วยความจำต่อ instance (`#runtimeConfig`) และโหลดแบบ lazy ครั้งเดียว

พฤติกรรมการโหลด:

- ไม่มีไฟล์ lock -> `{ plugins: {}, settings: {} }`
- ความล้มเหลวในการอ่าน/แยกวิเคราะห์ไฟล์ lock -> คำเตือน + ค่าเริ่มต้นว่างเปล่าเดิม

พฤติกรรมการบันทึก:

- เขียน JSON ไฟล์ lock แบบเต็มในรูปแบบ pretty-printed ทุกครั้งที่มีการเปลี่ยนแปลง

ไม่มีการล็อกข้ามกระบวนการหรือกลยุทธ์การรวม ผู้เขียนพร้อมกันอาจเขียนทับซึ่งกันและกัน

## การตรวจสอบความปลอดภัยและขอบเขตความน่าเชื่อถือ

## การตรวจสอบ input/แพ็กเกจ

พาธ active manager บังคับใช้การตรวจสอบความถูกต้องของชื่อแพ็กเกจ:

- regex สำหรับ package spec แบบ scoped/unscoped (พร้อมเวอร์ชันเป็นทางเลือก)
- รายการปฏิเสธ shell metacharacter อย่างชัดเจน (`[;&|`$(){}[]<>\\]`)

สิ่งนี้จำกัดความเสี่ยงจากการ command-injection เมื่อเรียกใช้ `bun install/uninstall`

## ขอบเขตความน่าเชื่อถือของระบบไฟล์

- โค้ดปลั๊กอินดำเนินการใน-process เมื่อโมดูลเครื่องมือแบบกำหนดเองถูก import ไม่มี sandboxing
- พาธสัมพัทธ์ของแมนิเฟสต์ถูก join กับไดเรกทอรีแพ็กเกจปลั๊กอินและตรวจสอบเฉพาะว่ามีอยู่
- แพ็กเกจปลั๊กอินเองเป็นโค้ดที่เชื่อถือได้เมื่อติดตั้งแล้ว

## การตรวจสอบเฉพาะ installer รุ่นเก่า

`installer.ts` มีการตรวจสอบเพิ่มเติมในเวลา link ที่ไม่ได้ถ่ายทอดไปยัง `PluginManager.link`:

- พาธในเครื่องต้องแก้ไขภายใน cwd ของโปรเจกต์
- การป้องกันเพิ่มเติมสำหรับชื่อแพ็กเกจ/การข้ามพาธสำหรับการตั้งชื่อเป้าหมาย symlink

เนื่องจาก CLI ใช้ `PluginManager` การป้องกัน link ที่เข้มงวดกว่าเหล่านี้จึงไม่อยู่บนพาธหลักในปัจจุบัน

## พฤติกรรมความล้มเหลว ความสำเร็จบางส่วน และการย้อนกลับ

ตัวจัดการปลั๊กอินไม่ใช่แบบ transactional

| ขั้นตอนการดำเนินการ | พฤติกรรมความล้มเหลว | การย้อนกลับ |
| --- | --- | --- |
| `bun install` ล้มเหลว | การติดตั้งยกเลิกพร้อม stderr | N/A (ยังไม่มีการเขียนสถานะ) |
| การติดตั้งสำเร็จ แล้วการตรวจสอบแมนิเฟสต์/ฟีเจอร์ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการย้อนกลับ uninstall; dependency อาจยังคงอยู่ใน `node_modules`/`package.json` |
| การติดตั้งสำเร็จ แล้วการเขียนไฟล์ lock ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการย้อนกลับของแพ็กเกจที่ติดตั้ง |
| `bun uninstall` สำเร็จ การเขียนไฟล์ lock ล้มเหลว | คำสั่งล้มเหลว | แพ็กเกจถูกลบออก สถานะรันไทม์ที่ล้าสมัยอาจยังคงอยู่ |
| `link` ลบเป้าหมายเดิมแล้วการสร้าง symlink ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการกู้คืน link/ไดเรกทอรีก่อนหน้า |

ในทางปฏิบัติ `doctor --fix` สามารถซ่อมแซมความเบี่ยงเบนบางอย่างได้ (`bun install`, การล้างข้อมูล config ที่เป็น orphan, การล้างข้อมูลฟีเจอร์ที่ไม่ถูกต้อง) แต่เป็นแบบ best-effort

## สรุปพฤติกรรมแมนิเฟสต์ที่ผิดรูปแบบ/ขาดหาย

- ขาดฟิลด์ `xcsh`/`pi`:
  - install/list: ยอมรับได้ (แมนิเฟสต์ขั้นต่ำ)
  - การค้นพบปลั๊กอินที่เปิดใช้งานในรันไทม์: ถูกข้ามในฐานะที่ไม่ใช่ปลั๊กอิน
- ฟีเจอร์ที่ขาดหายซึ่งอ้างอิงโดย install spec หรือ `features --set/--enable`: ข้อผิดพลาดอย่างรุนแรงพร้อมรายการฟีเจอร์ที่ใช้ได้
- `plugin-overrides.json` ที่ไม่ถูกต้อง: ถูกละเว้นพร้อม fallback ไปยัง `{}` ทั้งในพาธ manager และ loader
- พาธไฟล์ tool/hook/command ที่ขาดหายซึ่งอ้างอิงโดยแมนิเฟสต์: ถูกละเว้นอย่างเงียบๆ ระหว่างการขยาย resolver; ถูกทำเครื่องหมายเป็นข้อผิดพลาดเฉพาะโดย `doctor`

## ความแตกต่างของโหมดและลำดับความสำคัญ

- `--dry-run` (install): ส่งคืนผลลัพธ์การติดตั้งสังเคราะห์ ไม่มีการเขียนระบบไฟล์/เครือข่าย/สถานะ
- `--json`: เฉพาะการจัดรูปแบบเอาต์พุต ไม่มีการเปลี่ยนแปลงพฤติกรรม
- การแทนที่โปรเจกต์มีความสำคัญเหนือกว่าไฟล์ lock ระดับ global สำหรับมุมมอง feature/settings เสมอ
- การเปิดใช้งานที่มีผลคือ `runtimeEnabled && !projectDisabled`

## ไฟล์การดำเนินการ

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — การประกาศคำสั่ง CLI และการแมปแฟล็ก
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — การกระจาย action และตัวจัดการคำสั่งที่ผู้ใช้มองเห็น
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — การดำเนินการ install/remove/list/link/state/doctor ที่ใช้งานอยู่
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — ตัวช่วย installer รุ่นเก่าและการตรวจสอบความปลอดภัย link เพิ่มเติม
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — การค้นพบปลั๊กอินที่เปิดใช้งานและการแก้ไขพาธ tool/hook/command
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — ตัวช่วยการแยกวิเคราะห์ install spec และชื่อแพ็กเกจ
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — สัญญาประเภท manifest/runtime/override
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — การเชื่อมต่อรันไทม์สำหรับโมดูลเครื่องมือที่ปลั๊กอินจัดหาให้
