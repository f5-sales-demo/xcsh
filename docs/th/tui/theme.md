---
title: Theming Reference
description: >-
  TUI theming reference with color tokens, font settings, and theme
  customization.
sidebar:
  order: 3
  label: Theming
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# เอกสารอ้างอิงระบบธีม

เอกสารนี้อธิบายวิธีการทำงานของระบบธีมใน coding-agent ในปัจจุบัน: สคีมา การโหลด พฤติกรรมขณะรันไทม์ และโหมดความล้มเหลว

## สิ่งที่ระบบธีมควบคุม

ระบบธีมขับเคลื่อน:

- โทเค็นสีพื้นหน้า/พื้นหลังที่ใช้ทั่ว TUI
- อะแดปเตอร์การจัดรูปแบบ markdown (`getMarkdownTheme()`)
- อะแดปเตอร์ตัวเลือก/เอดิเตอร์/รายการตั้งค่า (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- ชุดสัญลักษณ์พรีเซ็ต + การแทนที่สัญลักษณ์ (`unicode`, `nerd`, `ascii`)
- สีสำหรับการเน้นไวยากรณ์ที่ใช้โดยตัวเน้นไวยากรณ์ดั้งเดิม (`@f5xc-salesdemos/pi-natives`)
- สีของส่วนต่างๆ ในแถบสถานะ

การใช้งานหลัก: `src/modes/theme/theme.ts`

## รูปแบบ JSON ของธีม

ไฟล์ธีมเป็นอ็อบเจกต์ JSON ที่ถูกตรวจสอบความถูกต้องตามสคีมาขณะรันไทม์ใน `theme.ts` (`ThemeJsonSchema`) และมีไฟล์คู่ขนานที่ `src/modes/theme/theme-schema.json`

ฟิลด์ระดับบนสุด:

- `name` (จำเป็น)
- `colors` (จำเป็น; โทเค็นสีทั้งหมดจำเป็น)
- `vars` (ไม่บังคับ; ตัวแปรสีที่ใช้ซ้ำได้)
- `export` (ไม่บังคับ; สีสำหรับการส่งออก HTML)
- `symbols` (ไม่บังคับ)
  - `preset` (ไม่บังคับ: `unicode | nerd | ascii`)
  - `overrides` (ไม่บังคับ: คู่คีย์/ค่าสำหรับการแทนที่ `SymbolKey`)

ค่าสีรองรับ:

- สตริง hex (`"#RRGGBB"`)
- ดัชนีสี 256 สี (`0..255`)
- สตริงอ้างอิงตัวแปร (แก้ไขผ่าน `vars`)
- สตริงว่าง (`""`) หมายถึงค่าเริ่มต้นของเทอร์มินัล (`\x1b[39m` fg, `\x1b[49m` bg)

## โทเค็นสีที่จำเป็น (ปัจจุบัน)

โทเค็นทั้งหมดด้านล่างจำเป็นใน `colors`

### ข้อความหลักและเส้นขอบ (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### บล็อกพื้นหลัง (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### ข้อความข้อความ/เครื่องมือ (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### diff ของเครื่องมือ + การเน้นไวยากรณ์ (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### เส้นขอบโหมด/การคิด (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### สีส่วนต่างๆ ของแถบสถานะ (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## โทเค็นที่ไม่บังคับ

### ส่วน `export` (ไม่บังคับ)

ใช้สำหรับตัวช่วยธีมในการส่งออก HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

หากละเว้น โค้ดส่งออกจะสร้างค่าเริ่มต้นจากสีธีมที่แก้ไขแล้ว

### ส่วน `symbols` (ไม่บังคับ)

- `symbols.preset` ตั้งค่าชุดสัญลักษณ์เริ่มต้นระดับธีม
- `symbols.overrides` สามารถแทนที่ค่า `SymbolKey` แต่ละตัวได้

ลำดับความสำคัญขณะรันไทม์:

1. การแทนที่ `symbolPreset` จากการตั้งค่า (หากกำหนดไว้)
2. `symbols.preset` ใน JSON ของธีม
3. ค่าสำรอง `"unicode"`

คีย์การแทนที่ที่ไม่ถูกต้องจะถูกเพิกเฉยและบันทึกลงบันทึก (`logger.debug`)

## แหล่งธีมในตัว vs กำหนดเอง

ลำดับการค้นหาธีม (`loadThemeJson`):

1. ธีมในตัวที่ฝังมา (`defaults/xcsh-dark.json` และ `defaults/xcsh-light.json` คอมไพล์เข้าใน `defaultThemes`)
2. ไฟล์ธีมกำหนดเอง: `<customThemesDir>/<name>.json`

ไดเรกทอรีธีมกำหนดเองมาจาก `getCustomThemesDir()`:

- ค่าเริ่มต้น: `~/.xcsh/agent/themes`
- แทนที่ได้โดย `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` ส่งคืนชื่อที่รวมธีมในตัว + กำหนดเอง เรียงลำดับ โดยธีมในตัวมีความสำคัญกว่าเมื่อชื่อซ้ำกัน

## การโหลด การตรวจสอบ และการแก้ไข

สำหรับไฟล์ธีมกำหนดเอง:

1. อ่าน JSON
2. แยกวิเคราะห์ JSON
3. ตรวจสอบความถูกต้องตาม `ThemeJsonSchema`
4. แก้ไขการอ้างอิง `vars` แบบวนซ้ำ
5. แปลงค่าที่แก้ไขแล้วเป็น ANSI ตามโหมดความสามารถของเทอร์มินัล

พฤติกรรมการตรวจสอบ:

- โทเค็นสีที่จำเป็นขาดหาย: ข้อความแสดงข้อผิดพลาดแบบจัดกลุ่มอย่างชัดเจน
- ประเภท/ค่าโทเค็นไม่ถูกต้อง: ข้อผิดพลาดการตรวจสอบพร้อมเส้นทาง JSON
- ไฟล์ธีมที่ไม่รู้จัก: `Theme not found: <name>`

พฤติกรรมการอ้างอิงตัวแปร:

- รองรับการอ้างอิงแบบซ้อน
- โยนข้อผิดพลาดเมื่อการอ้างอิงตัวแปรขาดหาย
- โยนข้อผิดพลาดเมื่อมีการอ้างอิงแบบวนรอบ

## พฤติกรรมโหมดสีของเทอร์มินัล

การตรวจจับโหมดสี (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` ใน `dumb`, `linux`, หรือว่าง => 256color
- กรณีอื่น => truecolor

พฤติกรรมการแปลง:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- ตัวเลข -> `38;5` / `48;5` ANSI
- `""` -> รีเซ็ต fg/bg เป็นค่าเริ่มต้น

## พฤติกรรมการสลับขณะรันไทม์

### ธีมเริ่มต้น (`initTheme`)

`main.ts` เริ่มต้นธีมพร้อมการตั้งค่า:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

การเลือกช่องธีมอัตโนมัติใช้การตรวจจับพื้นหลัง `COLORFGBG`:

- แยกวิเคราะห์ดัชนีพื้นหลังจาก `COLORFGBG`
- `< 8` => ช่องมืด (`theme.dark`)
- `>= 8` => ช่องสว่าง (`theme.light`)
- แยกวิเคราะห์ล้มเหลว => ช่องมืด

ค่าเริ่มต้นปัจจุบันจากสคีมาการตั้งค่า:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### การสลับแบบชัดเจน (`setTheme`)

- โหลดธีมที่เลือก
- อัปเดตซิงเกิลตัน `theme` ส่วนกลาง
- เริ่มตัวเฝ้าดูไฟล์ (ถ้าต้องการ)
- เรียก callback `onThemeChange`

เมื่อล้มเหลว:

- ย้อนกลับไปใช้ธีมในตัว `dark`
- ส่งคืน `{ success: false, error }`

### การสลับแบบดูตัวอย่าง (`previewTheme`)

- ใช้ธีมตัวอย่างชั่วคราวกับ `theme` ส่วนกลาง
- **ไม่**เปลี่ยนการตั้งค่าที่บันทึกไว้ด้วยตัวเอง
- ส่งคืนความสำเร็จ/ข้อผิดพลาดโดยไม่มีการแทนที่สำรอง

UI การตั้งค่าใช้สิ่งนี้สำหรับการดูตัวอย่างแบบเรียลไทม์ และคืนค่าธีมก่อนหน้าเมื่อยกเลิก

## ตัวเฝ้าดูไฟล์และการโหลดซ้ำแบบเรียลไทม์

เมื่อเปิดใช้งานตัวเฝ้าดู (`setTheme(..., true)` / การเริ่มต้นแบบโต้ตอบ):

- เฝ้าดูเฉพาะเส้นทางไฟล์กำหนดเอง `<customThemesDir>/<currentTheme>.json`
- ธีมในตัวจะไม่ถูกเฝ้าดู
- ไฟล์ `change`: พยายามโหลดซ้ำ (หน่วงเวลา)
- ไฟล์ `rename`/ลบ: ย้อนกลับไปใช้ `dark` ปิดตัวเฝ้าดู

โหมดอัตโนมัติยังติดตั้งตัวฟัง `SIGWINCH` และสามารถประเมินการแมปช่องมืด/สว่างใหม่เมื่อสถานะเทอร์มินัลเปลี่ยนแปลง

## พฤติกรรมโหมดตาบอดสี

`colorBlindMode` เปลี่ยนเพียงหนึ่งโทเค็นขณะรันไทม์:

- `toolDiffAdded` ถูกปรับค่า HSV (สีเขียวถูกเลื่อนไปทางสีน้ำเงิน)
- การปรับจะใช้เฉพาะเมื่อค่าที่แก้ไขแล้วเป็นสตริง hex

โทเค็นอื่นๆ ไม่มีการเปลี่ยนแปลง

## ตำแหน่งที่บันทึกการตั้งค่าธีม

การตั้งค่าที่เกี่ยวข้องกับธีมถูกบันทึกโดย `Settings` ไปยังไฟล์กำหนดค่า YAML ส่วนกลาง:

- เส้นทาง: `<agentDir>/config.yml`
- ไดเรกทอรี agent เริ่มต้น: `~/.xcsh/agent`
- ไฟล์เริ่มต้นที่ใช้จริง: `~/.xcsh/agent/config.yml`

คีย์ที่บันทึก:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

มีการย้ายข้อมูลแบบเก่า: `theme: "name"` แบบแบนเดิมจะถูกย้ายไปเป็น `theme.dark` หรือ `theme.light` แบบซ้อนตามการตรวจจับความสว่าง

## การสร้างธีมกำหนดเอง (ภาคปฏิบัติ)

1. สร้างไฟล์ในไดเรกทอรีธีมกำหนดเอง เช่น `~/.xcsh/agent/themes/my-theme.json`
2. รวม `name`, `vars` ที่ไม่บังคับ, และโทเค็น `colors` ที่จำเป็น**ทั้งหมด**
3. รวม `symbols` และ `export` ได้ตามต้องการ
4. เลือกธีมในการตั้งค่า (`Display -> Dark theme` หรือ `Display -> Light theme`) ขึ้นอยู่กับช่องอัตโนมัติที่คุณต้องการ

โครงร่างขั้นต่ำ ทุกคีย์ใน `colors` จำเป็น — ตัวตรวจสอบขณะรันไทม์
(`additionalProperties: false`) ปฏิเสธทั้งคีย์ที่ขาดหายและคีย์ที่ไม่รู้จัก
สำหรับการใช้งานอ้างอิงที่มาพร้อมโปรแกรมดูที่
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
และ [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)

แถบสถานะมีระบบสีคู่ขนานสองระบบที่บันทึกไว้ใน issue #242:

- สีข้อความ hex (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) ขับเคลื่อนการแสดงผลแบบไม่ใช่ powerline
- ดัชนีพาเลตสี 256 สี (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  ขับเคลื่อนการเติมส่วน powerline ค่าเหล่านี้เป็นอิสระจากคีย์ hex ด้านบน —
  ต้องตั้งค่าทั้งสองระบบ

```json
{
  "name": "my-theme",
  "vars": {
    "accent": "#7aa2f7",
    "muted": 244
  },
  "colors": {
    "accent": "accent",
    "chromeAccent": "accent",
    "spinnerAccent": "accent",
    "contentAccent": "muted",
    "border": "#4c566a",
    "borderAccent": "accent",
    "borderMuted": "muted",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "muted",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "muted",

    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accent",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "muted",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "accent",

    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "muted",

    "syntaxComment": "#565f89",
    "syntaxKeyword": "#bb9af7",
    "syntaxFunction": "#7aa2f7",
    "syntaxVariable": "#c0caf5",
    "syntaxString": "#9ece6a",
    "syntaxNumber": "#ff9e64",
    "syntaxType": "#2ac3de",
    "syntaxOperator": "#89ddff",
    "syntaxPunctuation": "#9aa5ce",
    "syntaxControl": "#bb9af7",

    "thinkingOff": 240,
    "thinkingMinimal": 244,
    "thinkingLow": "#7aa2f7",
    "thinkingMedium": "#2ac3de",
    "thinkingHigh": "#bb9af7",
    "thinkingXhigh": "#f7768e",

    "bashMode": "#2ac3de",
    "pythonMode": "#bb9af7",

    "statusLineBg": "#16161e",
    "statusLineSep": 240,
    "statusLineModel": "#bb9af7",
    "statusLinePath": "#7aa2f7",
    "statusLineGitClean": "#9ece6a",
    "statusLineGitDirty": "#e0af68",
    "statusLineContext": "#2ac3de",
    "statusLineSpend": "#7dcfff",
    "statusLineStaged": "#9ece6a",
    "statusLineDirty": "#e0af68",
    "statusLineUntracked": "#f7768e",
    "statusLineOutput": "#c0caf5",
    "statusLineCost": "#ff9e64",
    "statusLineSubagents": "#bb9af7",

    "statusLineOsIconBg": 7,
    "statusLineOsIconFg": 232,
    "statusLinePathBg": 4,
    "statusLinePathFg": 254,
    "statusLineGitCleanBg": 2,
    "statusLineGitCleanFg": 0,
    "statusLineGitDirtyBg": 3,
    "statusLineGitDirtyFg": 0,
    "statusLineGitStagedBg": 64,
    "statusLineGitStagedFg": 0,
    "statusLineGitUntrackedBg": 39,
    "statusLineGitUntrackedFg": 0,
    "statusLineGitConflictBg": 1,
    "statusLineGitConflictFg": 7,
    "statusLinePlanModeBg": 236,
    "statusLinePlanModeFg": 117,
    "statusLineProfileF5xcBg": "accent",
    "statusLineProfileF5xcFg": 231
  }
}
```

## การทดสอบธีมกำหนดเอง

ใช้ขั้นตอนการทำงานนี้:

1. เริ่มโหมดโต้ตอบ (ตัวเฝ้าดูเปิดใช้งานตั้งแต่เริ่มต้น)
2. เปิดการตั้งค่าและดูตัวอย่างค่าธีม (`previewTheme` แบบเรียลไทม์)
3. สำหรับไฟล์ธีมกำหนดเอง แก้ไข JSON ขณะรันอยู่และยืนยันการโหลดซ้ำอัตโนมัติเมื่อบันทึก
4. ทดสอบพื้นผิวที่สำคัญ:
   - การแสดงผล markdown
   - บล็อกเครื่องมือ (รอดำเนินการ/สำเร็จ/ข้อผิดพลาด)
   - การแสดงผล diff (เพิ่ม/ลบ/บริบท)
   - ความสามารถในการอ่านแถบสถานะ
   - การเปลี่ยนเส้นขอบระดับการคิด
   - สีเส้นขอบโหมด bash/python
5. ตรวจสอบชุดสัญลักษณ์ทั้งสองหากธีมของคุณขึ้นอยู่กับความกว้าง/ลักษณะของสัญลักษณ์

## ข้อจำกัดและข้อควรระวังที่แท้จริง

- โทเค็น `colors` ทั้งหมดจำเป็นสำหรับธีมกำหนดเอง
- `export` และ `symbols` ไม่บังคับ
- `$schema` ใน JSON ของธีมเป็นเพียงข้อมูล; การตรวจสอบขณะรันไทม์ถูกบังคับใช้โดยสคีมา TypeBox ที่คอมไพล์แล้วในโค้ด
- ความล้มเหลวของ `setTheme` จะย้อนกลับไปใช้ `dark`; ความล้มเหลวของ `previewTheme` จะไม่แทนที่ธีมปัจจุบัน
- ข้อผิดพลาดในการโหลดซ้ำของตัวเฝ้าดูไฟล์จะคงธีมที่โหลดอยู่ปัจจุบันจนกว่าจะมีการโหลดซ้ำสำเร็จหรือเส้นทางสำรองถูกเรียกใช้
