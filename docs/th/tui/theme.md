---
title: เอกสารอ้างอิงการปรับแต่งธีม
description: >-
  เอกสารอ้างอิงการปรับแต่งธีม TUI พร้อมโทเค็นสี การตั้งค่าฟอนต์
  และการปรับแต่งธีม
sidebar:
  order: 3
  label: การปรับแต่งธีม
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# เอกสารอ้างอิงการปรับแต่งธีม

เอกสารนี้อธิบายการทำงานของระบบธีมใน coding-agent ในปัจจุบัน ได้แก่ สคีมา การโหลด พฤติกรรมระหว่างรันไทม์ และรูปแบบความล้มเหลว

## สิ่งที่ระบบธีมควบคุม

ระบบธีมขับเคลื่อน:

- โทเค็นสีพื้นหน้า/พื้นหลังที่ใช้ทั่วทั้ง TUI
- อะแดปเตอร์การจัดรูปแบบ markdown (`getMarkdownTheme()`)
- อะแดปเตอร์รายการตัวเลือก/ตัวแก้ไข/รายการการตั้งค่า (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- ชุดสัญลักษณ์พรีเซ็ต + การแทนที่สัญลักษณ์ (`unicode`, `nerd`, `ascii`)
- สีการไฮไลต์ไวยากรณ์ที่ใช้โดย native highlighter (`@f5xc-salesdemos/pi-natives`)
- สีของเซกเมนต์บรรทัดสถานะ

การดำเนินการหลัก: `src/modes/theme/theme.ts`

## รูปแบบ JSON ของธีม

ไฟล์ธีมเป็นออบเจ็กต์ JSON ที่ถูกตรวจสอบความถูกต้องกับสคีมารันไทม์ใน `theme.ts` (`ThemeJsonSchema`) และสะท้อนโดย `src/modes/theme/theme-schema.json`

ฟิลด์ระดับบนสุด:

- `name` (จำเป็น)
- `colors` (จำเป็น; โทเค็นสีทั้งหมดจำเป็น)
- `vars` (ไม่บังคับ; ตัวแปรสีที่ใช้ซ้ำได้)
- `export` (ไม่บังคับ; สีสำหรับการส่งออก HTML)
- `symbols` (ไม่บังคับ)
  - `preset` (ไม่บังคับ: `unicode | nerd | ascii`)
  - `overrides` (ไม่บังคับ: การแทนที่ค่าคีย์สำหรับ `SymbolKey`)

ค่าสีรองรับ:

- สตริง hex (`"#RRGGBB"`)
- ดัชนีสี 256 สี (`0..255`)
- สตริงอ้างอิงตัวแปร (แก้ไขผ่าน `vars`)
- สตริงว่าง (`""`) หมายถึงค่าเริ่มต้นของเทอร์มินัล (`\x1b[39m` fg, `\x1b[49m` bg)

## โทเค็นสีที่จำเป็น (ปัจจุบัน)

โทเค็นทั้งหมดด้านล่างจำเป็นต้องมีใน `colors`

### ข้อความหลักและขอบ (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### บล็อกพื้นหลัง (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### ข้อความข้อความ/เครื่องมือ (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Tool diff + การไฮไลต์ไวยากรณ์ (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### ขอบโหมด/การคิด (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### สีของเซกเมนต์บรรทัดสถานะ (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## โทเค็นที่ไม่บังคับ

### ส่วน `export` (ไม่บังคับ)

ใช้สำหรับตัวช่วยการปรับแต่งธีมการส่งออก HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

หากละไว้ โค้ดส่งออกจะดึงค่าเริ่มต้นจากสีธีมที่แก้ไขแล้ว

### ส่วน `symbols` (ไม่บังคับ)

- `symbols.preset` กำหนดชุดสัญลักษณ์เริ่มต้นระดับธีม
- `symbols.overrides` สามารถแทนที่ค่า `SymbolKey` แต่ละค่าได้

ลำดับความสำคัญรันไทม์:

1. การแทนที่ `symbolPreset` ในการตั้งค่า (ถ้ากำหนดไว้)
2. `symbols.preset` ใน theme JSON
3. ค่าสำรอง `"unicode"`

คีย์การแทนที่ที่ไม่ถูกต้องจะถูกละเว้นและบันทึกลอก (`logger.debug`)

## แหล่งธีมในตัว vs ธีมที่กำหนดเอง

ลำดับการค้นหาธีม (`loadThemeJson`):

1. ธีมที่ฝังในตัว (`defaults/xcsh-dark.json` และ `defaults/xcsh-light.json` ที่คอมไพล์เป็น `defaultThemes`)
2. ไฟล์ธีมที่กำหนดเอง: `<customThemesDir>/<name>.json`

ไดเรกทอรีธีมที่กำหนดเองมาจาก `getCustomThemesDir()`:

- ค่าเริ่มต้น: `~/.xcsh/agent/themes`
- แทนที่ด้วย `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` ส่งคืนชื่อที่รวมธีมในตัว + ธีมที่กำหนดเองเรียงลำดับแล้ว โดยธีมในตัวมีความสำคัญก่อนเมื่อชื่อซ้ำกัน

## การโหลด การตรวจสอบ และการแก้ไข

สำหรับไฟล์ธีมที่กำหนดเอง:

1. อ่าน JSON
2. แยกวิเคราะห์ JSON
3. ตรวจสอบกับ `ThemeJsonSchema`
4. แก้ไขการอ้างอิง `vars` แบบเรียกซ้ำ
5. แปลงค่าที่แก้ไขแล้วเป็น ANSI ตามโหมดความสามารถของเทอร์มินัล

พฤติกรรมการตรวจสอบ:

- โทเค็นสีที่จำเป็นขาดหายไป: ข้อความแสดงข้อผิดพลาดแบบจัดกลุ่มชัดเจน
- ประเภท/ค่าโทเค็นไม่ถูกต้อง: ข้อผิดพลาดการตรวจสอบพร้อมพาธ JSON
- ไม่พบไฟล์ธีม: `Theme not found: <name>`

พฤติกรรมการอ้างอิงตัวแปร:

- รองรับการอ้างอิงแบบซ้อน
- ส่งข้อผิดพลาดเมื่อการอ้างอิงตัวแปรขาดหายไป
- ส่งข้อผิดพลาดเมื่อมีการอ้างอิงแบบวงกลม

## พฤติกรรมโหมดสีของเทอร์มินัล

การตรวจจับโหมดสี (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` ใน `dumb`, `linux`, หรือว่างเปล่า => 256color
- มิฉะนั้น => truecolor

พฤติกรรมการแปลง:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- ตัวเลข -> `38;5` / `48;5` ANSI
- `""` -> รีเซ็ต fg/bg เริ่มต้น

## พฤติกรรมการสลับระหว่างรันไทม์

### ธีมเริ่มต้น (`initTheme`)

`main.ts` เริ่มต้นธีมด้วยการตั้งค่า:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

การเลือกสล็อตธีมอัตโนมัติใช้การตรวจจับพื้นหลัง `COLORFGBG`:

- แยกวิเคราะห์ดัชนีพื้นหลังจาก `COLORFGBG`
- `< 8` => สล็อตมืด (`theme.dark`)
- `>= 8` => สล็อตสว่าง (`theme.light`)
- การแยกวิเคราะห์ล้มเหลว => สล็อตมืด

ค่าเริ่มต้นปัจจุบันจากสคีมาการตั้งค่า:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### การสลับโดยตรง (`setTheme`)

- โหลดธีมที่เลือก
- อัปเดต singleton `theme` ส่วนกลาง
- เริ่มต้น watcher ตามต้องการ
- เรียกใช้ callback `onThemeChange`

เมื่อล้มเหลว:

- ใช้ธีม `dark` ในตัวเป็นตัวสำรอง
- ส่งคืน `{ success: false, error }`

### การสลับตัวอย่าง (`previewTheme`)

- ใช้ธีมตัวอย่างชั่วคราวกับ `theme` ส่วนกลาง
- **ไม่** เปลี่ยนแปลงการตั้งค่าที่บันทึกไว้ด้วยตัวเอง
- ส่งคืนสำเร็จ/ข้อผิดพลาดโดยไม่มีการแทนที่ fallback

UI การตั้งค่าใช้สิ่งนี้สำหรับการแสดงตัวอย่างแบบสด และกู้คืนธีมก่อนหน้าเมื่อยกเลิก

## Watchers และการโหลดซ้ำแบบสด

เมื่อเปิดใช้งาน watcher (`setTheme(..., true)` / การเริ่มต้นแบบอินเทอร์แอคทีฟ):

- ดูเฉพาะพาธไฟล์ที่กำหนดเอง `<customThemesDir>/<currentTheme>.json`
- ธีมในตัวแทบไม่ถูกดู
- ไฟล์ `change`: พยายามโหลดซ้ำ (debounced)
- ไฟล์ `rename`/ลบ: ใช้ `dark` เป็นตัวสำรอง ปิด watcher

โหมดอัตโนมัติยังติดตั้ง listener `SIGWINCH` และสามารถประเมินการแมปสล็อตมืด/สว่างใหม่เมื่อสถานะเทอร์มินัลเปลี่ยนแปลง

## พฤติกรรมโหมดตาบอดสี

`colorBlindMode` เปลี่ยนเพียงหนึ่งโทเค็นระหว่างรันไทม์:

- `toolDiffAdded` ถูกปรับด้วย HSV (เขียวเปลี่ยนไปทางน้ำเงิน)
- การปรับใช้เฉพาะเมื่อค่าที่แก้ไขแล้วเป็นสตริง hex

โทเค็นอื่นไม่เปลี่ยนแปลง

## ตำแหน่งที่บันทึกการตั้งค่าธีม

การตั้งค่าที่เกี่ยวข้องกับธีมถูกบันทึกโดย `Settings` ไปยัง YAML การกำหนดค่าส่วนกลาง:

- พาธ: `<agentDir>/config.yml`
- ไดเรกทอรี agent เริ่มต้น: `~/.xcsh/agent`
- ไฟล์เริ่มต้นที่มีผล: `~/.xcsh/agent/config.yml`

คีย์ที่บันทึก:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

มีการย้ายข้อมูลเดิม: `theme: "name"` แบบแบนเดิมถูกย้ายไปเป็น `theme.dark` หรือ `theme.light` แบบซ้อนตามการตรวจจับความสว่าง

## การสร้างธีมที่กำหนดเอง (เชิงปฏิบัติ)

1. สร้างไฟล์ในไดเรกทอรีธีมที่กำหนดเอง เช่น `~/.xcsh/agent/themes/my-theme.json`
2. รวม `name`, `vars` ที่ไม่บังคับ และโทเค็น `colors` **ทั้งหมดที่จำเป็น**
3. รวม `symbols` และ `export` ตามต้องการ
4. เลือกธีมในการตั้งค่า (`Display -> Dark theme` หรือ `Display -> Light theme`) ขึ้นอยู่กับสล็อตอัตโนมัติที่ต้องการ

โครงสร้างขั้นต่ำ ทุกคีย์ใน `colors` จำเป็น — ตัวตรวจสอบรันไทม์
(`additionalProperties: false`) ปฏิเสธทั้งคีย์ที่ขาดหายไปและคีย์ที่ไม่รู้จัก
สำหรับการดำเนินการอ้างอิงที่จัดส่งแล้ว ดูที่
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
และ [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)

บรรทัดสถานะมีระบบสีสองแบบคู่ขนานที่บันทึกไว้ในปัญหา #242:

- สีข้อความ hex (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) ขับเคลื่อนการเรนเดอร์แบบไม่ใช้ powerline
- ดัชนีพาเลตต์สี 256 สี (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  ขับเคลื่อนการเติม powerline segment เป็นอิสระจากคีย์ hex ด้านบน —
  ทั้งสองต้องถูกกำหนด

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

## การทดสอบธีมที่กำหนดเอง

ใช้ขั้นตอนนี้:

1. เริ่มโหมดอินเทอร์แอคทีฟ (เปิดใช้งาน watcher ตั้งแต่เริ่มต้น)
2. เปิดการตั้งค่าและดูตัวอย่างค่าธีม (สด `previewTheme`)
3. สำหรับไฟล์ธีมที่กำหนดเอง ให้แก้ไข JSON ขณะรันและยืนยันการโหลดซ้ำอัตโนมัติเมื่อบันทึก
4. ทดสอบพื้นผิวสำคัญ:
   - การเรนเดอร์ markdown
   - บล็อก tool (pending/success/error)
   - การเรนเดอร์ diff (added/removed/context)
   - ความอ่านออกได้ของบรรทัดสถานะ
   - การเปลี่ยนแปลงขอบระดับการคิด
   - สีขอบโหมด bash/python
5. ตรวจสอบชุดสัญลักษณ์ทั้งสองหากธีมของคุณขึ้นอยู่กับความกว้าง/ลักษณะของ glyph

## ข้อจำกัดและข้อควรระวังที่แท้จริง

- โทเค็น `colors` ทั้งหมดจำเป็นสำหรับธีมที่กำหนดเอง
- `export` และ `symbols` ไม่บังคับ
- `$schema` ใน theme JSON เป็นเพียงข้อมูล; การตรวจสอบรันไทม์ถูกบังคับใช้โดยสคีมา TypeBox ที่คอมไพล์แล้วในโค้ด
- ความล้มเหลวของ `setTheme` ใช้ `dark` เป็นตัวสำรอง; ความล้มเหลวของ `previewTheme` ไม่แทนที่ธีมปัจจุบัน
- ข้อผิดพลาดการโหลดซ้ำของ file watcher จะรักษาธีมที่โหลดอยู่ปัจจุบันจนกว่าการโหลดซ้ำสำเร็จหรือมีการเรียกพาธ fallback
