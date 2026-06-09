---
title: ระบบภายในของตัวจัดการปลั๊กอินและตัวติดตั้ง
description: >-
  รายละเอียดภายในของตัวจัดการปลั๊กอินที่ครอบคลุมการติดตั้ง การตรวจสอบความถูกต้อง
  การแก้ไขการพึ่งพา และการจัดการวงจรชีวิต
sidebar:
  order: 5
  label: ตัวจัดการปลั๊กอิน
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# ระบบภายในของตัวจัดการปลั๊กอินและตัวติดตั้ง

เอกสารนี้อธิบายวิธีที่การดำเนินการ `xcsh plugin` เปลี่ยนแปลงสถานะปลั๊กอินบนดิสก์ และวิธีที่ปลั๊กอินที่ติดตั้งแล้วกลายเป็นความสามารถในเวลาทำงาน (เครื่องมือในปัจจุบัน, การแก้ไขเส้นทางของ hooks/commands พร้อมใช้งาน)

## ขอบเขตและสถาปัตยกรรม

มีการพัฒนาระบบจัดการปลั๊กอินสองแบบในโค้ดเบส:

1. **เส้นทางที่ใช้งานจริงโดยคำสั่ง CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **โมดูลตัวช่วยแบบเก่า**: ฟังก์ชันตัวติดตั้ง (`src/extensibility/plugins/installer.ts`)

การทำงานของคำสั่ง `xcsh plugin ...` จะผ่าน `PluginManager`

`installer.ts` ยังคงมีเอกสารการตรวจสอบความปลอดภัยและพฤติกรรมระบบไฟล์ที่สำคัญ แต่ไม่ใช่เส้นทางที่ใช้โดย `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`

## วงจรชีวิต: จากการเรียกใช้ CLI ไปจนถึงความพร้อมใช้งานในเวลาทำงาน

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

### จุดเริ่มต้นของคำสั่ง

- `src/commands/plugin.ts` กำหนดคำสั่ง/flags และส่งต่อไปยัง `runPluginCommand`
- `src/cli/plugin-cli.ts` จับคู่คำสั่งย่อยกับเมธอดของ `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- ไม่มีการดำเนินการ `update` แยกต่างหาก; การอัปเดตทำได้โดยรัน `install` ใหม่ด้วยแพ็กเกจ/เวอร์ชัน spec ใหม่

## โมเดลบนดิสก์

สถานะปลั๊กอินระดับ global อยู่ภายใต้ `~/.xcsh/plugins`:

- `package.json` — รายการการพึ่งพาที่ใช้โดย `bun install`/`bun uninstall`
- `node_modules/` — แพ็กเกจปลั๊กอินที่ติดตั้งแล้วหรือ symlinks
- `xcsh-plugins.lock.json` — สถานะในเวลาทำงาน:
  - เปิด/ปิดใช้งานต่อปลั๊กอิน
  - ชุดฟีเจอร์ที่เลือกต่อปลั๊กอิน
  - การตั้งค่าปลั๊กอินที่บันทึกไว้

การแทนที่ระดับโปรเจกต์อยู่ที่:

- `<cwd>/.xcsh/plugin-overrides.json`

การแทนที่เป็นแบบอ่านอย่างเดียวจากมุมมองของ manager/loader (ไม่มีเส้นทางการเขียนที่นี่) และสามารถปิดใช้งานปลั๊กอินหรือแทนที่ฟีเจอร์/การตั้งค่าสำหรับโปรเจกต์นี้ได้

## การแยกวิเคราะห์ spec ของปลั๊กอินและการตีความเมตาดาต้า

## ไวยากรณ์ install spec

`parsePluginSpec` (`parser.ts`) รองรับ:

- `pkg` -> `features: null` (พฤติกรรมค่าเริ่มต้น)
- `pkg[*]` -> เปิดใช้งานฟีเจอร์ทั้งหมดในรายการ
- `pkg[]` -> ไม่เปิดใช้งานฟีเจอร์เสริมใดๆ
- `pkg[a,b]` -> เปิดใช้งานฟีเจอร์ที่ระบุชื่อ
- `@scope/pkg@1.2.3[feat]` -> แพ็กเกจแบบ scoped + ระบุเวอร์ชันพร้อมการเลือกฟีเจอร์แบบชัดเจน

`extractPackageName` ตัดส่วนต่อท้ายเวอร์ชันออกเพื่อค้นหาเส้นทางบนดิสก์หลังการติดตั้ง

## แหล่งที่มาของ manifest และฟิลด์ที่จำเป็น

Manifest ถูกแก้ไขตามลำดับ:

1. `package.json.xcsh`
2. ทางเลือกสำรอง `package.json.pi`
3. ทางเลือกสำรอง `{ version: package.version }`

ผลกระทบ:

- ไม่มีการตรวจสอบ schema อย่างเข้มงวดใน manager/loader
- แพ็กเกจที่ไม่มี `xcsh`/`pi` ยังคงสามารถติดตั้งและแสดงรายการได้
- การโหลดปลั๊กอินในเวลาทำงาน (`getEnabledPlugins`) ข้ามแพ็กเกจที่ไม่มี manifest `xcsh`/`pi`
- `manifest.version` จะถูกเขียนทับเสมอจาก `version` ของแพ็กเกจ

`package.json` JSON ที่ผิดรูปแบบเป็นข้อผิดพลาดร้ายแรงในเวลาอ่าน; รูปร่าง manifest ที่ผิดรูปแบบอาจล้มเหลวในภายหลังเฉพาะเมื่อมีการใช้ฟิลด์เฉพาะ

## ขั้นตอนการติดตั้ง/อัปเดต (`PluginManager.install`)

1. แยกวิเคราะห์ไวยากรณ์วงเล็บฟีเจอร์จาก install spec
2. ตรวจสอบชื่อแพ็กเกจด้วย regex + รายการปฏิเสธอักขระ shell-metacharacter
3. ตรวจสอบว่า `package.json` ของปลั๊กอินมีอยู่ (`xcsh-plugins`, แผนที่การพึ่งพาแบบ private)
4. รัน `bun install <packageSpec>` ใน `~/.xcsh/plugins`
5. อ่าน `node_modules/<name>/package.json` ของแพ็กเกจที่ติดตั้ง
6. แก้ไข manifest และคำนวณ `enabledFeatures`:
   - `[*]`: ฟีเจอร์ทั้งหมดที่ประกาศ (หรือ `null` ถ้าไม่มีแผนที่ฟีเจอร์)
   - `[a,b]`: ตรวจสอบว่าแต่ละฟีเจอร์มีอยู่ในแผนที่ฟีเจอร์ของ manifest
   - `[]`: รายการฟีเจอร์ว่าง
   - spec แบบปกติ: `null` (ใช้นโยบายค่าเริ่มต้นในภายหลังใน loader)
7. Upsert สถานะเวลาทำงานใน lockfile: `{ version, enabledFeatures, enabled: true }`

### ความหมายของการอัปเดต

เนื่องจากการอัปเดตขับเคลื่อนด้วยการติดตั้ง:

- `xcsh plugin install pkg@newVersion` อัปเดตการพึ่งพาและเวอร์ชันใน lockfile
- การตั้งค่าที่มีอยู่จะถูกเก็บรักษาไว้; รายการสถานะจะถูกเขียนทับสำหรับ version/features/enabled
- ไม่มีตรรกะ "ตรวจสอบการอัปเดต" แยกต่างหากหรือการโยกย้ายแบบ transactional

## ขั้นตอนการลบ (`PluginManager.uninstall`)

1. ตรวจสอบชื่อแพ็กเกจ
2. รัน `bun uninstall <name>` ในไดเรกทอรีปลั๊กอิน
3. ลบสถานะเวลาทำงานของปลั๊กอินจาก lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

หากคำสั่งถอนการติดตั้งล้มเหลว สถานะเวลาทำงานจะไม่ถูกเปลี่ยนแปลง

## ขั้นตอนการแสดงรายการ (`PluginManager.list`)

1. อ่านแผนที่การพึ่งพาปลั๊กอินจาก `~/.xcsh/plugins/package.json`
2. โหลดการกำหนดค่าเวลาทำงานจาก lockfile (ไฟล์หายไป -> ค่าเริ่มต้นว่าง)
3. โหลดการแทนที่โปรเจกต์ (`<cwd>/.xcsh/plugin-overrides.json`, ข้อผิดพลาดในการแยกวิเคราะห์/อ่าน -> วัตถุว่างพร้อมคำเตือน)
4. สำหรับแต่ละการพึ่งพาที่มี package.json ที่แก้ไขได้:
   - สร้างบันทึก `InstalledPlugin`
   - รวมสถานะฟีเจอร์/การเปิดใช้งาน:
     - ฐานจาก lockfile (หรือค่าเริ่มต้น)
     - การแทนที่โปรเจกต์สามารถแทนที่การเลือกฟีเจอร์
     - รายการ `disabled` ของโปรเจกต์ปิดบังปลั๊กอินว่าปิดใช้งาน

นี่คือสถานะที่มีผลจริงที่ใช้โดยเอาต์พุตสถานะ CLI และการดำเนินการ settings/features

## ขั้นตอนการเชื่อมโยง (`PluginManager.link`)

`link` สนับสนุนการพัฒนาปลั๊กอินในเครื่องโดยสร้าง symlink ของแพ็กเกจในเครื่องไปยัง `~/.xcsh/plugins/node_modules/<pkg.name>`

พฤติกรรม:

1. แก้ไข `localPath` เทียบกับ cwd ของ manager
2. ต้องการ `package.json` ในเครื่องและฟิลด์ `name`
3. ตรวจสอบว่าไดเรกทอรีปลั๊กอินมีอยู่
4. สำหรับชื่อแบบ scoped ให้สร้างไดเรกทอรี scope
5. ลบเส้นทางที่มีอยู่ที่ตำแหน่งลิงก์เป้าหมาย
6. สร้าง symlink
7. เพิ่มรายการ lockfile เวลาทำงานที่เปิดใช้งานด้วยฟีเจอร์เริ่มต้น (`null`)

ข้อควรระวัง: `PluginManager.link` ปัจจุบันไม่บังคับใช้การตรวจสอบขอบเขตเส้นทาง `cwd` ที่มีอยู่ใน `installer.ts` แบบเก่า (`normalizedPath.startsWith(normalizedCwd)`) ดังนั้นความไว้วางใจเป็นความรับผิดชอบของผู้เรียกใช้

## การโหลดในเวลาทำงาน: จากปลั๊กอินที่ติดตั้งไปสู่ความสามารถที่เรียกใช้ได้

## จุดกรองการค้นพบ

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) อ่าน:

- รายการการพึ่งพาปลั๊กอิน (`package.json`)
- สถานะเวลาทำงานจาก lockfile
- การแทนที่โปรเจกต์ผ่าน `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

การกรอง:

- ข้ามถ้าไม่มี package.json ของปลั๊กอิน
- ข้ามถ้าไม่มี manifest (`xcsh`/`pi`)
- ข้ามถ้าปิดใช้งานระดับ global ใน lockfile
- ข้ามถ้าปิดใช้งานระดับโปรเจกต์

## การแก้ไขเส้นทางความสามารถ

สำหรับแต่ละปลั๊กอินที่เปิดใช้งาน:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

แต่ละ resolver รวมรายการฐานบวกรายการฟีเจอร์:

- รายการฟีเจอร์ที่ชัดเจน -> เฉพาะฟีเจอร์ที่เลือก
- `enabledFeatures === null` -> เปิดใช้งานฟีเจอร์ที่ทำเครื่องหมาย `default: true`

ไฟล์ที่หายไปจะถูกข้ามอย่างเงียบๆ (การป้องกันด้วย `existsSync`)

## ความแตกต่างของการเชื่อมต่อในเวลาทำงานปัจจุบัน

- **เครื่องมือถูกเชื่อมต่อเข้ากับเวลาทำงานในปัจจุบัน** ผ่าน `discoverAndLoadCustomTools` (`custom-tools/loader.ts`) ซึ่งเรียก `getAllPluginToolPaths(cwd)`
- เส้นทางถูกกำจัดรายการซ้ำโดยเส้นทางสัมบูรณ์ที่แก้ไขแล้วในการค้นพบเครื่องมือแบบกำหนดเอง (ชุด `seen`, เส้นทางแรกชนะ)
- **Resolver ของ hooks/commands มีอยู่** และถูกส่งออก แต่เส้นทางโค้ดนี้ไม่ได้เชื่อมต่อเข้ากับ registry ในเวลาทำงานในแบบเดียวกับที่เครื่องมือถูกเชื่อมต่อ

## รายละเอียดการจัดการ lock/สถานะ

`PluginManager` แคชการกำหนดค่าเวลาทำงานในหน่วยความจำต่ออินสแตนซ์ (`#runtimeConfig`) และโหลดแบบ lazy ครั้งเดียว

พฤติกรรมการโหลด:

- lockfile หายไป -> `{ plugins: {}, settings: {} }`
- การอ่าน/แยกวิเคราะห์ lockfile ล้มเหลว -> คำเตือน + ค่าเริ่มต้นว่างเหมือนกัน

พฤติกรรมการบันทึก:

- เขียน lockfile JSON แบบ pretty-printed ทั้งหมดทุกครั้งที่มีการเปลี่ยนแปลง

ไม่มีการล็อกข้ามกระบวนการหรือกลยุทธ์การรวม; ผู้เขียนพร้อมกันสามารถเขียนทับกันได้

## การตรวจสอบความปลอดภัยและขอบเขตความไว้วางใจ

## การตรวจสอบอินพุต/แพ็กเกจ

เส้นทาง manager ที่ใช้งานจริงบังคับใช้การตรวจสอบชื่อแพ็กเกจ:

- regex สำหรับ spec แพ็กเกจแบบ scoped/unscoped (เลือกได้พร้อมเวอร์ชัน)
- รายการปฏิเสธอักขระ shell metacharacter อย่างชัดเจน (`[;&|`$(){}[]<>\\]`)

สิ่งนี้จำกัดความเสี่ยงของ command-injection เมื่อเรียกใช้ `bun install/uninstall`

## ขอบเขตความไว้วางใจระบบไฟล์

- โค้ดปลั๊กอินทำงานภายในกระบวนการเดียวกันเมื่อโมดูลเครื่องมือแบบกำหนดเองถูก import; ไม่มี sandboxing
- เส้นทางสัมพัทธ์ของ manifest ถูกรวมกับไดเรกทอรีแพ็กเกจปลั๊กอินและตรวจสอบเฉพาะการมีอยู่เท่านั้น
- แพ็กเกจปลั๊กอินเองเป็นโค้ดที่เชื่อถือได้เมื่อติดตั้งแล้ว

## การตรวจสอบเฉพาะตัวติดตั้งแบบเก่า

`installer.ts` รวมการตรวจสอบเพิ่มเติมในเวลาเชื่อมโยงที่ไม่ได้สะท้อนใน `PluginManager.link`:

- เส้นทางในเครื่องต้องแก้ไขภายใน cwd ของโปรเจกต์
- การป้องกัน path traversal เพิ่มเติมสำหรับชื่อแพ็กเกจ/เป้าหมาย symlink

เนื่องจาก CLI ใช้ `PluginManager` การป้องกันการเชื่อมโยงที่เข้มงวดกว่าเหล่านี้จึงไม่อยู่บนเส้นทางหลักในปัจจุบัน

## ความล้มเหลว ความสำเร็จบางส่วน และพฤติกรรมการย้อนกลับ

ตัวจัดการปลั๊กอินไม่ใช่แบบ transactional

| ขั้นตอนการดำเนินการ | พฤติกรรมเมื่อล้มเหลว | การย้อนกลับ |
| --- | --- | --- |
| `bun install` ล้มเหลว | การติดตั้งหยุดด้วย stderr | ไม่มี (ยังไม่มีการเขียนสถานะ) |
| ติดตั้งสำเร็จ จากนั้นการตรวจสอบ manifest/ฟีเจอร์ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการย้อนกลับการถอนการติดตั้ง; การพึ่งพาอาจยังคงอยู่ใน `node_modules`/`package.json` |
| ติดตั้งสำเร็จ จากนั้นการเขียน lockfile ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการย้อนกลับแพ็กเกจที่ติดตั้ง |
| `bun uninstall` สำเร็จ การเขียน lockfile ล้มเหลว | คำสั่งล้มเหลว | แพ็กเกจถูกลบ สถานะเวลาทำงานที่ค้างอาจยังคงอยู่ |
| `link` ลบเป้าหมายเดิมแล้วการสร้าง symlink ล้มเหลว | คำสั่งล้มเหลว | ไม่มีการกู้คืนลิงก์/ไดเรกทอรีก่อนหน้า |

ในเชิงปฏิบัติ `doctor --fix` สามารถซ่อมแซมการเบี่ยงเบนบางอย่างได้ (`bun install`, การล้างการกำหนดค่าที่ไม่มีเจ้าของ, การล้างฟีเจอร์ที่ไม่ถูกต้อง) แต่เป็นความพยายามอย่างดีที่สุด

## สรุปพฤติกรรมของ manifest ที่ผิดรูปแบบ/หายไป

- ฟิลด์ `xcsh`/`pi` หายไป:
  - install/list: ยอมรับ (manifest ขั้นต่ำ)
  - การค้นพบปลั๊กอินที่เปิดใช้งานในเวลาทำงาน: ข้ามเนื่องจากไม่ใช่ปลั๊กอิน
- ฟีเจอร์ที่หายไปที่อ้างอิงโดย install spec หรือ `features --set/--enable`: ข้อผิดพลาดร้ายแรงพร้อมรายการฟีเจอร์ที่มี
- `plugin-overrides.json` ที่ไม่ถูกต้อง: ถูกละเว้นพร้อม fallback เป็น `{}` ในทั้งเส้นทาง manager และ loader
- เส้นทางไฟล์ tool/hook/command ที่หายไปที่อ้างอิงโดย manifest: ถูกละเว้นอย่างเงียบๆ ระหว่างการขยาย resolver; ถูกแจ้งเป็นข้อผิดพลาดเฉพาะโดย `doctor`

## ความแตกต่างของโหมดและลำดับความสำคัญ

- `--dry-run` (install): ส่งคืนผลลัพธ์การติดตั้งสังเคราะห์ ไม่มีการเขียนระบบไฟล์/เครือข่าย/สถานะ
- `--json`: การจัดรูปแบบเอาต์พุตเท่านั้น ไม่มีการเปลี่ยนแปลงพฤติกรรม
- การแทนที่โปรเจกต์จะมีความสำคัญเหนือ lockfile ระดับ global สำหรับมุมมอง feature/settings เสมอ
- การเปิดใช้งานที่มีผลจริงคือ `runtimeEnabled && !projectDisabled`

## ไฟล์การพัฒนา

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — การประกาศคำสั่ง CLI และการจับคู่ flag
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — การจ่ายงาน action, ตัวจัดการคำสั่งที่ผู้ใช้มองเห็น
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — การพัฒนา install/remove/list/link/state/doctor ที่ใช้งานจริง
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — ตัวช่วยตัวติดตั้งแบบเก่าและการตรวจสอบความปลอดภัยการเชื่อมโยงเพิ่มเติม
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — การค้นพบปลั๊กอินที่เปิดใช้งานและการแก้ไขเส้นทาง tool/hook/command
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — ตัวช่วยแยกวิเคราะห์ install spec และชื่อแพ็กเกจ
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — สัญญาประเภท manifest/runtime/override
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — การเชื่อมต่อในเวลาทำงานสำหรับโมดูลเครื่องมือที่จัดเตรียมโดยปลั๊กอิน
