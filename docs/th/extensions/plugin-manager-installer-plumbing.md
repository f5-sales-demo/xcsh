---
title: Plugin Manager and Installer Plumbing
description: >-
  รายละเอียดภายในของ Plugin Manager ครอบคลุมการติดตั้ง การตรวจสอบ
  การแก้ไขการพึ่งพา และการจัดการวงจรชีวิต
sidebar:
  order: 5
  label: Plugin manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# ระบบภายในของ Plugin Manager และ Installer

เอกสารนี้อธิบายวิธีที่การดำเนินการ `xcsh plugin` เปลี่ยนแปลงสถานะของปลั๊กอินบนดิสก์ และวิธีที่ปลั๊กอินที่ติดตั้งแล้วกลายเป็นความสามารถขณะรันไทม์ (เครื่องมือในปัจจุบัน, การแก้ไขเส้นทาง hooks/commands ที่พร้อมใช้งาน)

## ขอบเขตและสถาปัตยกรรม

มีการ implement การจัดการปลั๊กอินสองแบบในโค้ดเบส:

1. **เส้นทางหลักที่ใช้โดยคำสั่ง CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **โมดูลตัวช่วยแบบเก่า**: ฟังก์ชัน installer (`src/extensibility/plugins/installer.ts`)

การเรียกใช้คำสั่ง `xcsh plugin ...` ผ่าน `PluginManager`

`installer.ts` ยังคงบันทึกการตรวจสอบความปลอดภัยและพฤติกรรมระบบไฟล์ที่สำคัญ แต่ไม่ใช่เส้นทางที่ใช้โดย `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`

## วงจรชีวิต: จากการเรียกใช้ CLI ถึงความพร้อมใช้งานขณะรันไทม์

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
- `src/cli/plugin-cli.ts` แมปคำสั่งย่อยไปยังเมธอดของ `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- ไม่มี action `update` แบบชัดเจน; การอัปเดตทำโดยรัน `install` ซ้ำด้วย package/version spec ใหม่

## โมเดลบนดิสก์

สถานะปลั๊กอินแบบ global อยู่ภายใต้ `~/.xcsh/plugins`:

- `package.json` — รายการ dependency ที่ใช้โดย `bun install`/`bun uninstall`
- `node_modules/` — แพ็กเกจปลั๊กอินที่ติดตั้งแล้วหรือ symlinks
- `xcsh-plugins.lock.json` — สถานะรันไทม์:
  - เปิด/ปิดต่อปลั๊กอิน
  - ชุดฟีเจอร์ที่เลือกต่อปลั๊กอิน
  - การตั้งค่าปลั๊กอินที่บันทึกไว้

การ override เฉพาะโปรเจกต์อยู่ที่:

- `<cwd>/.xcsh/plugin-overrides.json`

Override เป็นแบบอ่านอย่างเดียวจากมุมมองของ manager/loader (ไม่มีเส้นทางการเขียนที่นี่) และสามารถปิดปลั๊กอินหรือ override ฟีเจอร์/การตั้งค่าสำหรับโปรเจกต์นี้ได้

## การแยกวิเคราะห์ spec ของปลั๊กอินและการตีความเมตาดาต้า

## ไวยากรณ์ install spec

`parsePluginSpec` (`parser.ts`) รองรับ:

- `pkg` -> `features: null` (พฤติกรรมค่าเริ่มต้น)
- `pkg[*]` -> เปิดใช้งานฟีเจอร์ทั้งหมดใน manifest
- `pkg[]` -> ไม่เปิดใช้งานฟีเจอร์เสริมใดๆ
- `pkg[a,b]` -> เปิดใช้งานฟีเจอร์ตามชื่อ
- `@scope/pkg@1.2.3[feat]` -> แพ็กเกจแบบ scoped + ระบุเวอร์ชัน พร้อมการเลือกฟีเจอร์แบบชัดเจน

`extractPackageName` ตัดส่วน version suffix ออกสำหรับการค้นหาเส้นทางบนดิสก์หลังติดตั้ง

## แหล่งที่มาของ manifest และฟิลด์ที่จำเป็น

Manifest ถูกแก้ไขตามลำดับ:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

ผลที่ตามมา:

- ไม่มีการตรวจสอบ schema อย่างเข้มงวดใน manager/loader
- แพ็กเกจที่ไม่มี `xcsh`/`pi` ยังคงสามารถติดตั้งและแสดงรายการได้
- การโหลดปลั๊กอินขณะรันไทม์ (`getEnabledPlugins`) จะข้ามแพ็กเกจที่ไม่มี manifest `xcsh`/`pi`
- `manifest.version` จะถูกเขียนทับจาก `version` ของแพ็กเกจเสมอ

`package.json` JSON ที่มีรูปแบบไม่ถูกต้องจะเป็นข้อผิดพลาดร้ายแรงในเวลาอ่าน; รูปแบบ manifest ที่ไม่ถูกต้องอาจล้มเหลวในภายหลังเมื่อมีการใช้งานฟิลด์เฉพาะเท่านั้น

## ขั้นตอนการติดตั้ง/อัปเดต (`PluginManager.install`)

1. แยกวิเคราะห์ไวยากรณ์วงเล็บฟีเจอร์จาก install spec
2. ตรวจสอบชื่อแพ็กเกจกับ regex + รายการปฏิเสธอักขระ shell-metacharacter
3. ตรวจสอบให้แน่ใจว่า `package.json` ของปลั๊กอินมีอยู่ (`xcsh-plugins`, แมป dependencies แบบ private)
4. รัน `bun install <packageSpec>` ใน `~/.xcsh/plugins`
5. อ่าน `node_modules/<name>/package.json` ของแพ็กเกจที่ติดตั้ง
6. แก้ไข manifest และคำนวณ `enabledFeatures`:
   - `[*]`: ฟีเจอร์ที่ประกาศทั้งหมด (หรือ `null` ถ้าไม่มีแมปฟีเจอร์)
   - `[a,b]`: ตรวจสอบว่าแต่ละฟีเจอร์มีอยู่ในแมปฟีเจอร์ของ manifest
   - `[]`: รายการฟีเจอร์ว่าง
   - spec แบบธรรมดา: `null` (ใช้นโยบายค่าเริ่มต้นในภายหลังใน loader)
7. Upsert สถานะรันไทม์ใน lockfile: `{ version, enabledFeatures, enabled: true }`

### ความหมายของการอัปเดต

เนื่องจากการอัปเดตขับเคลื่อนด้วยการติดตั้ง:

- `xcsh plugin install pkg@newVersion` อัปเดต dependency และเวอร์ชันใน lockfile
- การตั้งค่าที่มีอยู่ถูกเก็บรักษาไว้; รายการสถานะจะถูกเขียนทับสำหรับ version/features/enabled
- ไม่มี logic "ตรวจสอบการอัปเดต" หรือ transactional migration แยกต่างหาก

## ขั้นตอนการลบ (`PluginManager.uninstall`)

1. ตรวจสอบชื่อแพ็กเกจ
2. รัน `bun uninstall <name>` ในไดเรกทอรีปลั๊กอิน
3. ลบสถานะรันไทม์ของปลั๊กอินจาก lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

ถ้าคำสั่ง uninstall ล้มเหลว สถานะรันไทม์จะไม่ถูกเปลี่ยนแปลง

## ขั้นตอนการแสดงรายการ (`PluginManager.list`)

1. อ่านแมป dependency ของปลั๊กอินจาก `~/.xcsh/plugins/package.json`
2. โหลดการตั้งค่ารันไทม์จาก lockfile (ไฟล์หายไป -> ค่าเริ่มต้นว่าง)
3. โหลด override ของโปรเจกต์ (`<cwd>/.xcsh/plugin-overrides.json`, ข้อผิดพลาดในการแยกวิเคราะห์/อ่าน -> อ็อบเจกต์ว่างพร้อมคำเตือน)
4. สำหรับแต่ละ dependency ที่มี package.json ที่สามารถแก้ไขได้:
   - สร้างเรคอร์ด `InstalledPlugin`
   - รวมสถานะฟีเจอร์/เปิดใช้งาน:
     - ฐานจาก lockfile (หรือค่าเริ่มต้น)
     - override ของโปรเจกต์สามารถแทนที่การเลือกฟีเจอร์ได้
     - รายการ `disabled` ของโปรเจกต์ปิดบังปลั๊กอินว่าถูกปิดใช้งาน

นี่คือสถานะที่มีผลบังคับใช้ที่ใช้โดยเอาต์พุตสถานะ CLI และการดำเนินการ settings/features

## ขั้นตอนการลิงก์ (`PluginManager.link`)

`link` รองรับการพัฒนาปลั๊กอินแบบ local โดยสร้าง symlink ของแพ็กเกจ local ไปยัง `~/.xcsh/plugins/node_modules/<pkg.name>`

พฤติกรรม:

1. แก้ไข `localPath` เทียบกับ cwd ของ manager
2. ต้องการ `package.json` และฟิลด์ `name` แบบ local
3. ตรวจสอบให้แน่ใจว่าไดเรกทอรีปลั๊กอินมีอยู่
4. สำหรับชื่อแบบ scoped สร้างไดเรกทอรี scope
5. ลบเส้นทางที่มีอยู่ในตำแหน่ง target ของลิงก์
6. สร้าง symlink
7. เพิ่มรายการ lockfile รันไทม์ที่เปิดใช้งานด้วยฟีเจอร์เริ่มต้น (`null`)

ข้อควรระวัง: `PluginManager.link` ปัจจุบันไม่บังคับใช้การตรวจสอบขอบเขตเส้นทาง `cwd` ที่มีอยู่ใน `installer.ts` แบบเก่า (`normalizedPath.startsWith(normalizedCwd)`) ดังนั้นความน่าเชื่อถือเป็นความรับผิดชอบของผู้เรียกใช้

## การโหลดรันไทม์: จากปลั๊กอินที่ติดตั้งถึงความสามารถที่เรียกใช้ได้

## ประตูกรองการค้นพบ

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) อ่าน:

- รายการ dependency ของปลั๊กอิน (`package.json`)
- สถานะรันไทม์จาก lockfile
- override ของโปรเจกต์ผ่าน `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

การกรอง:

- ข้ามถ้าไม่มี package.json ของปลั๊กอิน
- ข้ามถ้าไม่มี manifest (`xcsh`/`pi`)
- ข้ามถ้าถูกปิดใช้งานแบบ global ใน lockfile
- ข้ามถ้าถูกปิดใช้งานโดยโปรเจกต์

## การแก้ไขเส้นทางความสามารถ

สำหรับแต่ละปลั๊กอินที่เปิดใช้งาน:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

แต่ละ resolver รวมรายการฐานบวกรายการฟีเจอร์:

- รายการฟีเจอร์แบบชัดเจน -> เฉพาะฟีเจอร์ที่เลือก
- `enabledFeatures === null` -> เปิดใช้งานฟีเจอร์ที่ทำเครื่องหมาย `default: true`

ไฟล์ที่หายไปจะถูกข้ามอย่างเงียบๆ (การป้องกันด้วย `existsSync`)

## ความแตกต่างของการเชื่อมต่อรันไทม์ปัจจุบัน

- **เครื่องมือถูกเชื่อมต่อเข้ากับรันไทม์ในปัจจุบัน** ผ่าน `discoverAndLoadCustomTools` (`custom-tools/loader.ts`) ซึ่งเรียก `getAllPluginToolPaths(cwd)`
- เส้นทางถูกกำจัดรายการซ้ำโดยเส้นทางสัมบูรณ์ที่แก้ไขแล้วในการค้นพบเครื่องมือแบบกำหนดเอง (เซ็ต `seen`, เส้นทางแรกชนะ)
- **Resolvers ของ Hooks/commands มีอยู่** และถูก export แต่เส้นทางโค้ดนี้ยังไม่ได้เชื่อมต่อเข้ากับ registry รันไทม์ในลักษณะเดียวกับที่เครื่องมือถูกเชื่อมต่อ

## รายละเอียดการจัดการ Lock/สถานะ

`PluginManager` แคชการตั้งค่ารันไทม์ในหน่วยความจำต่อ instance (`#runtimeConfig`) และโหลดแบบ lazy ครั้งเดียว

พฤติกรรมการโหลด:

- lockfile หายไป -> `{ plugins: {}, settings: {} }`
- การอ่าน/แยกวิเคราะห์ lockfile ล้มเหลว -> คำเตือน + ค่าเริ่มต้นว่างเหมือนกัน

พฤติกรรมการบันทึก:

- เขียน lockfile JSON แบบจัดรูปแบบสวยงามทั้งหมดในแต่ละการเปลี่ยนแปลง

ไม่มีการล็อกข้ามกระบวนการหรือกลยุทธ์การรวม; ผู้เขียนพร้อมกันสามารถเขียนทับกันได้

## การตรวจสอบความปลอดภัยและขอบเขตความน่าเชื่อถือ

## การตรวจสอบอินพุต/แพ็กเกจ

เส้นทาง manager หลักบังคับใช้การตรวจสอบชื่อแพ็กเกจ:

- regex สำหรับ package specs แบบ scoped/unscoped (อาจมีเวอร์ชัน)
- รายการปฏิเสธอักขระ shell metacharacter แบบชัดเจน (`[;&|`$(){}[]<>\\]`)

สิ่งนี้จำกัดความเสี่ยงของ command-injection เมื่อเรียกใช้ `bun install/uninstall`

## ขอบเขตความน่าเชื่อถือของระบบไฟล์

- โค้ดปลั๊กอินทำงานภายในกระบวนการเมื่อโมดูลเครื่องมือแบบกำหนดเองถูก import; ไม่มี sandboxing
- เส้นทางสัมพัทธ์ของ manifest ถูกรวมกับไดเรกทอรีแพ็กเกจปลั๊กอินและตรวจสอบเฉพาะการมีอยู่เท่านั้น
- แพ็กเกจปลั๊กอินนั้นถือเป็นโค้ดที่เชื่อถือได้เมื่อติดตั้งแล้ว

## การตรวจสอบเฉพาะ installer แบบเก่า

`installer.ts` รวมการตรวจสอบเวลาลิงก์เพิ่มเติมที่ไม่ได้สะท้อนใน `PluginManager.link`:

- เส้นทาง local ต้องแก้ไขภายใน cwd ของโปรเจกต์
- การป้องกัน path traversal สำหรับการตั้งชื่อ target ของ symlink เพิ่มเติม

เนื่องจาก CLI ใช้ `PluginManager` การป้องกันลิงก์ที่เข้มงวดกว่าเหล่านี้จึงไม่ได้อยู่บนเส้นทางหลักในปัจจุบัน

## พฤติกรรมความล้มเหลว ความสำเร็จบางส่วน และการย้อนกลับ

Plugin manager ไม่ใช่แบบ transactional

| ขั้นตอนการดำเนินการ | พฤติกรรมเมื่อล้มเหลว | การย้อนกลับ |
| --- | --- | --- |
| `bun install` ล้มเหลว | การติดตั้งยกเลิกพร้อม stderr | ไม่มี (ยังไม่มีการเขียนสถานะ) |
| ติดตั้งสำเร็จ จากนั้นการตรวจสอบ manifest/feature ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการย้อนกลับ uninstall; dependency อาจยังคงอยู่ใน `node_modules`/`package.json` |
| ติดตั้งสำเร็จ จากนั้นการเขียน lockfile ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการย้อนกลับของแพ็กเกจที่ติดตั้ง |
| `bun uninstall` สำเร็จ, การเขียน lockfile ล้มเหลว | คำสั่งล้มเหลว | แพ็กเกจถูกลบ, สถานะรันไทม์ที่ล้าสมัยอาจยังคงอยู่ |
| `link` ลบ target เก่าแล้วการสร้าง symlink ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการกู้คืนลิงก์/ไดเรกทอรีก่อนหน้า |

ในทางปฏิบัติ `doctor --fix` สามารถซ่อมแซมความคลาดเคลื่อนบางอย่างได้ (`bun install`, ทำความสะอาดการตั้งค่าที่ไม่มีเจ้าของ, ทำความสะอาดฟีเจอร์ที่ไม่ถูกต้อง) แต่เป็นแบบ best-effort

## สรุปพฤติกรรม manifest ที่มีรูปแบบไม่ถูกต้อง/หายไป

- ไม่มีฟิลด์ `xcsh`/`pi`:
  - install/list: ยอมรับได้ (manifest แบบน้อยที่สุด)
  - การค้นพบปลั๊กอินที่เปิดใช้งานขณะรันไทม์: ข้ามเป็นไม่ใช่ปลั๊กอิน
- ฟีเจอร์ที่หายไปที่อ้างอิงโดย install spec หรือ `features --set/--enable`: ข้อผิดพลาดร้ายแรงพร้อมรายการฟีเจอร์ที่พร้อมใช้งาน
- `plugin-overrides.json` ไม่ถูกต้อง: ถูกละเว้นพร้อม fallback เป็น `{}` ในเส้นทางทั้ง manager และ loader
- เส้นทางไฟล์ tool/hook/command ที่หายไปซึ่งอ้างอิงโดย manifest: ถูกละเว้นอย่างเงียบๆ ระหว่างการขยาย resolver; ถูกรายงานเป็นข้อผิดพลาดโดย `doctor` เท่านั้น

## ความแตกต่างของโหมดและลำดับความสำคัญ

- `--dry-run` (install): ส่งคืนผลลัพธ์การติดตั้งแบบสังเคราะห์ ไม่มีการเขียนระบบไฟล์/เครือข่าย/สถานะ
- `--json`: การจัดรูปแบบเอาต์พุตเท่านั้น ไม่มีการเปลี่ยนแปลงพฤติกรรม
- Override ของโปรเจกต์จะมีความสำคัญสูงกว่า lockfile แบบ global สำหรับมุมมอง feature/settings เสมอ
- การเปิดใช้งานที่มีผลบังคับใช้คือ `runtimeEnabled && !projectDisabled`

## ไฟล์ implementation

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — การประกาศคำสั่ง CLI และการแมปแฟล็ก
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — การส่งต่อ action, ตัวจัดการคำสั่งสำหรับผู้ใช้
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementation หลักสำหรับ install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — ตัวช่วย installer แบบเก่าและการตรวจสอบความปลอดภัยลิงก์เพิ่มเติม
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — การค้นพบปลั๊กอินที่เปิดใช้งานและการแก้ไขเส้นทาง tool/hook/command
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — ตัวช่วยแยกวิเคราะห์ install spec และชื่อแพ็กเกจ
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — สัญญาประเภทของ manifest/runtime/override
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — การเชื่อมต่อรันไทม์สำหรับโมดูลเครื่องมือที่ปลั๊กอินจัดเตรียมให้
