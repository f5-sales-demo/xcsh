---
title: Plugin Manager and Installer Plumbing
description: >-
  รายละเอียดภายในของ Plugin manager ครอบคลุมการติดตั้ง การตรวจสอบความถูกต้อง
  การแก้ไข dependency และการจัดการวงจรชีวิต
sidebar:
  order: 5
  label: Plugin manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Plugin manager และ installer plumbing

เอกสารนี้อธิบายว่าการดำเนินการ `xcsh plugin` เปลี่ยนแปลงสถานะ plugin บนดิสก์อย่างไร และ plugin ที่ติดตั้งแล้วกลายเป็นความสามารถรันไทม์ได้อย่างไร (ปัจจุบันรองรับ tools, การแก้ไขเส้นทาง hooks/commands พร้อมใช้งาน)

## ขอบเขตและสถาปัตยกรรม

มีการใช้งานการจัดการ plugin สองแบบใน codebase:

1. **เส้นทางที่ใช้งานจริงโดยคำสั่ง CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **โมดูลตัวช่วยแบบเก่า (Legacy)**: ฟังก์ชัน installer (`src/extensibility/plugins/installer.ts`)

การทำงานของคำสั่ง `xcsh plugin ...` ผ่าน `PluginManager`

`installer.ts` ยังคงมีเอกสารเกี่ยวกับการตรวจสอบความปลอดภัยและพฤติกรรมระบบไฟล์ที่สำคัญ แต่ไม่ใช่เส้นทางที่ใช้โดย `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`

## วงจรชีวิต: จากการเรียกใช้ CLI ไปจนถึงความพร้อมใช้งานรันไทม์

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

### จุดเข้าใช้งานคำสั่ง

- `src/commands/plugin.ts` กำหนดคำสั่ง/flags และส่งต่อไปยัง `runPluginCommand`
- `src/cli/plugin-cli.ts` จับคู่คำสั่งย่อยกับเมธอดของ `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- ไม่มี action `update` แยกต่างหาก; การอัปเดตทำโดยรัน `install` ซ้ำพร้อมระบุ package/version spec ใหม่

## โมเดลบนดิสก์

สถานะ plugin ส่วนกลางอยู่ภายใต้ `~/.xcsh/plugins`:

- `package.json` — dependency manifest ที่ใช้โดย `bun install`/`bun uninstall`
- `node_modules/` — แพ็กเกจ plugin ที่ติดตั้งแล้วหรือ symlinks
- `xcsh-plugins.lock.json` — สถานะรันไทม์:
  - เปิด/ปิดใช้งานต่อ plugin
  - ชุดฟีเจอร์ที่เลือกต่อ plugin
  - การตั้งค่า plugin ที่ถูกบันทึก

การ override เฉพาะโปรเจกต์อยู่ที่:

- `<cwd>/.xcsh/plugin-overrides.json`

Override เป็นแบบอ่านอย่างเดียวจากมุมมองของ manager/loader (ไม่มีเส้นทางเขียนที่นี่) และสามารถปิดใช้งาน plugin หรือ override ฟีเจอร์/การตั้งค่าสำหรับโปรเจกต์นี้ได้

## การแยกวิเคราะห์ plugin spec และการตีความ metadata

## ไวยากรณ์ install spec

`parsePluginSpec` (`parser.ts`) รองรับ:

- `pkg` -> `features: null` (พฤติกรรมค่าเริ่มต้น)
- `pkg[*]` -> เปิดใช้งานฟีเจอร์ทั้งหมดใน manifest
- `pkg[]` -> ไม่เปิดใช้งานฟีเจอร์ที่เป็นตัวเลือก
- `pkg[a,b]` -> เปิดใช้งานฟีเจอร์ที่ระบุชื่อ
- `@scope/pkg@1.2.3[feat]` -> แพ็กเกจแบบ scoped + ระบุเวอร์ชัน พร้อมการเลือกฟีเจอร์แบบชัดเจน

`extractPackageName` ตัดส่วนเวอร์ชันออกสำหรับการค้นหาเส้นทางบนดิสก์หลังติดตั้ง

## แหล่ง manifest และฟิลด์ที่จำเป็น

Manifest ถูกแก้ไขตามลำดับ:

1. `package.json.xcsh`
2. fallback `package.json.pi`
3. fallback `{ version: package.version }`

ผลกระทบ:

- ไม่มีการตรวจสอบ schema อย่างเข้มงวดใน manager/loader
- แพ็กเกจที่ไม่มี `xcsh`/`pi` ยังคงสามารถติดตั้งและแสดงรายการได้
- การโหลด plugin รันไทม์ (`getEnabledPlugins`) ข้ามแพ็กเกจที่ไม่มี manifest `xcsh`/`pi`
- `manifest.version` จะถูกเขียนทับจาก `version` ของแพ็กเกจเสมอ

`package.json` JSON ที่มีรูปแบบไม่ถูกต้องเป็นข้อผิดพลาดร้ายแรงขณะอ่าน; รูปแบบ manifest ที่ไม่ถูกต้องอาจล้มเหลวในภายหลังเมื่อฟิลด์เฉพาะถูกใช้งานเท่านั้น

## ขั้นตอนการติดตั้ง/อัปเดต (`PluginManager.install`)

1. แยกวิเคราะห์ไวยากรณ์วงเล็บฟีเจอร์จาก install spec
2. ตรวจสอบชื่อแพ็กเกจตาม regex + รายการปฏิเสธ shell-metacharacter
3. ตรวจสอบว่า `package.json` ของ plugin มีอยู่ (`xcsh-plugins`, แผนที่ private dependencies)
4. รัน `bun install <packageSpec>` ใน `~/.xcsh/plugins`
5. อ่าน `node_modules/<name>/package.json` ของแพ็กเกจที่ติดตั้ง
6. แก้ไข manifest และคำนวณ `enabledFeatures`:
   - `[*]`: ฟีเจอร์ที่ประกาศทั้งหมด (หรือ `null` หากไม่มีแผนที่ฟีเจอร์)
   - `[a,b]`: ตรวจสอบว่าแต่ละฟีเจอร์มีอยู่ในแผนที่ฟีเจอร์ของ manifest
   - `[]`: รายการฟีเจอร์ว่าง
   - bare spec: `null` (ใช้นโยบายค่าเริ่มต้นในภายหลังใน loader)
7. Upsert สถานะรันไทม์ใน lockfile: `{ version, enabledFeatures, enabled: true }`

### ความหมายของการอัปเดต

เนื่องจากการอัปเดตขับเคลื่อนด้วยการติดตั้ง:

- `xcsh plugin install pkg@newVersion` อัปเดต dependency และเวอร์ชันใน lockfile
- การตั้งค่าที่มีอยู่ยังคงอยู่; รายการสถานะถูกเขียนทับสำหรับ version/features/enabled
- ไม่มีตรรกะ "ตรวจสอบการอัปเดต" แยกต่างหากหรือการย้ายข้อมูลแบบ transactional

## ขั้นตอนการลบ (`PluginManager.uninstall`)

1. ตรวจสอบชื่อแพ็กเกจ
2. รัน `bun uninstall <name>` ในไดเรกทอรี plugin
3. ลบสถานะรันไทม์ของ plugin จาก lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

หากคำสั่ง uninstall ล้มเหลว สถานะรันไทม์จะไม่ถูกเปลี่ยนแปลง

## ขั้นตอนการแสดงรายการ (`PluginManager.list`)

1. อ่านแผนที่ dependency ของ plugin จาก `~/.xcsh/plugins/package.json`
2. โหลดการกำหนดค่ารันไทม์จาก lockfile (ไม่พบไฟล์ -> ค่าเริ่มต้นว่าง)
3. โหลด override ของโปรเจกต์ (`<cwd>/.xcsh/plugin-overrides.json`, ข้อผิดพลาดในการแยกวิเคราะห์/อ่าน -> ออบเจกต์ว่างพร้อมคำเตือน)
4. สำหรับแต่ละ dependency ที่มี package.json ที่แก้ไขได้:
   - สร้างเรกคอร์ด `InstalledPlugin`
   - รวมสถานะฟีเจอร์/การเปิดใช้งาน:
     - ฐานจาก lockfile (หรือค่าเริ่มต้น)
     - override ของโปรเจกต์สามารถแทนที่การเลือกฟีเจอร์
     - รายการ `disabled` ของโปรเจกต์ปิดบัง plugin เป็นปิดใช้งาน

นี่คือสถานะที่มีผลซึ่งใช้โดยเอาต์พุตสถานะ CLI และการดำเนินการ settings/features

## ขั้นตอนการเชื่อมโยง (`PluginManager.link`)

`link` รองรับการพัฒนา plugin ในเครื่องโดย symlink แพ็กเกจในเครื่องไปยัง `~/.xcsh/plugins/node_modules/<pkg.name>`

พฤติกรรม:

1. แก้ไข `localPath` ตาม cwd ของ manager
2. ต้องการ `package.json` ในเครื่องและฟิลด์ `name`
3. ตรวจสอบว่าไดเรกทอรี plugin มีอยู่
4. สำหรับชื่อแบบ scoped สร้างไดเรกทอรี scope
5. ลบเส้นทางที่มีอยู่ที่ตำแหน่ง link เป้าหมาย
6. สร้าง symlink
7. เพิ่มรายการ lockfile รันไทม์ที่เปิดใช้งานพร้อมฟีเจอร์เริ่มต้น (`null`)

ข้อควรระวัง: `PluginManager.link` ปัจจุบันไม่บังคับใช้การตรวจสอบขอบเขตเส้นทาง `cwd` ที่มีอยู่ใน `installer.ts` แบบเก่า (`normalizedPath.startsWith(normalizedCwd)`) ดังนั้นความน่าเชื่อถือเป็นความรับผิดชอบของผู้เรียก

## การโหลดรันไทม์: จาก plugin ที่ติดตั้งแล้วไปจนถึงความสามารถที่เรียกใช้ได้

## เกตการค้นพบ

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) อ่าน:

- dependency manifest ของ plugin (`package.json`)
- สถานะรันไทม์จาก lockfile
- override ของโปรเจกต์ผ่าน `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

การกรอง:

- ข้ามหากไม่มี package.json ของ plugin
- ข้ามหากไม่มี manifest (`xcsh`/`pi`)
- ข้ามหากถูกปิดใช้งานทั่วไปใน lockfile
- ข้ามหากถูกปิดใช้งานในโปรเจกต์

## การแก้ไขเส้นทางความสามารถ

สำหรับแต่ละ plugin ที่เปิดใช้งาน:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

แต่ละ resolver รวมรายการพื้นฐานบวกรายการฟีเจอร์:

- รายการฟีเจอร์ที่ชัดเจน -> เฉพาะฟีเจอร์ที่เลือก
- `enabledFeatures === null` -> เปิดใช้งานฟีเจอร์ที่ทำเครื่องหมาย `default: true`

ไฟล์ที่หายไปจะถูกข้ามอย่างเงียบ ๆ (ตรวจสอบด้วย `existsSync`)

## ความแตกต่างในการเชื่อมต่อรันไทม์ปัจจุบัน

- **Tools ถูกเชื่อมต่อเข้ากับรันไทม์ในปัจจุบัน** ผ่าน `discoverAndLoadCustomTools` (`custom-tools/loader.ts`) ซึ่งเรียก `getAllPluginToolPaths(cwd)`
- เส้นทางถูกกำจัดรายการซ้ำด้วยเส้นทางสัมบูรณ์ที่แก้ไขแล้วในการค้นพบ custom tool (ชุด `seen`, เส้นทางแรกชนะ)
- **Hooks/commands resolvers มีอยู่** และถูก export แต่เส้นทางโค้ดนี้ไม่ได้เชื่อมต่อเข้ากับ runtime registry ในลักษณะเดียวกับที่ tools ถูกเชื่อมต่อในปัจจุบัน

## รายละเอียดการจัดการ Lock/สถานะ

`PluginManager` แคชการกำหนดค่ารันไทม์ในหน่วยความจำต่ออินสแตนซ์ (`#runtimeConfig`) และโหลดแบบ lazy ครั้งเดียว

พฤติกรรมการโหลด:

- lockfile หายไป -> `{ plugins: {}, settings: {} }`
- ข้อผิดพลาดในการอ่าน/แยกวิเคราะห์ lockfile -> คำเตือน + ค่าเริ่มต้นว่างเหมือนกัน

พฤติกรรมการบันทึก:

- เขียน lockfile JSON แบบ pretty-printed ทั้งหมดในแต่ละการเปลี่ยนแปลง

ไม่มีการล็อกข้ามโปรเซสหรือกลยุทธ์การรวม; ผู้เขียนที่ทำงานพร้อมกันสามารถเขียนทับกันได้

## การตรวจสอบความปลอดภัยและขอบเขตความน่าเชื่อถือ

## การตรวจสอบอินพุต/แพ็กเกจ

เส้นทาง manager ที่ใช้งานจริงบังคับใช้การตรวจสอบชื่อแพ็กเกจ:

- regex สำหรับ package specs แบบ scoped/unscoped (อาจมีเวอร์ชัน)
- รายการปฏิเสธ shell metacharacter แบบชัดเจน (`[;&|`$(){}[]<>\\]`)

สิ่งนี้จำกัดความเสี่ยงของ command-injection เมื่อเรียกใช้ `bun install/uninstall`

## ขอบเขตความน่าเชื่อถือของระบบไฟล์

- โค้ด plugin ทำงานในโปรเซสเมื่อโมดูล custom tool ถูก import; ไม่มีการ sandbox
- เส้นทางสัมพัทธ์ของ manifest ถูกรวมกับไดเรกทอรีแพ็กเกจ plugin และตรวจสอบการมีอยู่เท่านั้น
- แพ็กเกจ plugin เป็นโค้ดที่เชื่อถือได้เมื่อติดตั้งแล้ว

## การตรวจสอบเฉพาะ installer แบบเก่า

`installer.ts` รวมการตรวจสอบ link-time เพิ่มเติมที่ไม่ได้สะท้อนใน `PluginManager.link`:

- เส้นทางในเครื่องต้องแก้ไขภายใน cwd ของโปรเจกต์
- การป้องกันเพิ่มเติมสำหรับชื่อแพ็กเกจ/path traversal สำหรับการตั้งชื่อเป้าหมาย symlink

เนื่องจาก CLI ใช้ `PluginManager` การป้องกัน link ที่เข้มงวดกว่าเหล่านี้จึงไม่อยู่ในเส้นทางหลักในปัจจุบัน

## ความล้มเหลว ความสำเร็จบางส่วน และพฤติกรรมการย้อนกลับ

Plugin manager ไม่ใช่ transactional

| ขั้นตอนการดำเนินการ | พฤติกรรมเมื่อล้มเหลว | การย้อนกลับ |
| --- | --- | --- |
| `bun install` ล้มเหลว | การติดตั้งหยุดทำงานพร้อม stderr | ไม่มี (ยังไม่มีการเขียนสถานะ) |
| ติดตั้งสำเร็จ จากนั้นการตรวจสอบ manifest/feature ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการย้อนกลับ uninstall; dependency อาจยังอยู่ใน `node_modules`/`package.json` |
| ติดตั้งสำเร็จ จากนั้นการเขียน lockfile ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการย้อนกลับแพ็กเกจที่ติดตั้ง |
| `bun uninstall` สำเร็จ การเขียน lockfile ล้มเหลว | คำสั่งล้มเหลว | แพ็กเกจถูกลบ สถานะรันไทม์ที่ค้างอาจยังอยู่ |
| `link` ลบเป้าหมายเก่าแล้วการสร้าง symlink ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการกู้คืน link/dir ก่อนหน้า |

ในการปฏิบัติจริง `doctor --fix` สามารถซ่อมแซมความไม่สอดคล้องบางอย่างได้ (`bun install`, การล้างค่ากำหนดค่าที่ไม่มีเจ้าของ, การล้างฟีเจอร์ที่ไม่ถูกต้อง) แต่เป็นแบบพยายามอย่างดีที่สุด

## สรุปพฤติกรรม manifest ที่มีรูปแบบไม่ถูกต้อง/หายไป

- ไม่มีฟิลด์ `xcsh`/`pi`:
  - install/list: ยอมรับได้ (manifest ขั้นต่ำ)
  - การค้นพบ plugin ที่เปิดใช้งานรันไทม์: ข้ามเนื่องจากไม่ใช่ plugin
- ฟีเจอร์ที่หายไปซึ่งอ้างอิงโดย install spec หรือ `features --set/--enable`: ข้อผิดพลาดร้ายแรงพร้อมรายการฟีเจอร์ที่มี
- `plugin-overrides.json` ไม่ถูกต้อง: ถูกละเว้นพร้อม fallback เป็น `{}` ทั้งในเส้นทาง manager และ loader
- เส้นทางไฟล์ tool/hook/command ที่หายไปซึ่งอ้างอิงโดย manifest: ถูกละเว้นอย่างเงียบ ๆ ระหว่างการขยาย resolver; ถูกทำเครื่องหมายเป็นข้อผิดพลาดเฉพาะโดย `doctor`

## ความแตกต่างของโหมดและลำดับความสำคัญ

- `--dry-run` (install): ส่งคืนผลลัพธ์การติดตั้งแบบสังเคราะห์ ไม่มีการเขียนระบบไฟล์/เครือข่าย/สถานะ
- `--json`: การจัดรูปแบบเอาต์พุตเท่านั้น ไม่เปลี่ยนแปลงพฤติกรรม
- Override ของโปรเจกต์มีความสำคัญเหนือ lockfile ส่วนกลางสำหรับมุมมองฟีเจอร์/การตั้งค่าเสมอ
- การเปิดใช้งานที่มีผลคือ `runtimeEnabled && !projectDisabled`

## ไฟล์การใช้งาน

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — การประกาศคำสั่ง CLI และการจับคู่ flag
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — การส่งต่อ action, ตัวจัดการคำสั่งที่ผู้ใช้เห็น
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — การใช้งานจริงของ install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — ตัวช่วย installer แบบเก่าและการตรวจสอบความปลอดภัย link เพิ่มเติม
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — การค้นพบ plugin ที่เปิดใช้งานและการแก้ไขเส้นทาง tool/hook/command
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — ตัวช่วยการแยกวิเคราะห์ install spec และชื่อแพ็กเกจ
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — สัญญาประเภท manifest/runtime/override
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — การเชื่อมต่อรันไทม์สำหรับโมดูล tool ที่ plugin ให้มา
