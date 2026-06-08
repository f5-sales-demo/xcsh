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

# เอกสารอ้างอิงธีม

เอกสารนี้อธิบายวิธีการทำงานของระบบธีมใน coding-agent ในปัจจุบัน: สคีมา, การโหลด, พฤติกรรมขณะรันไทม์ และโหมดความล้มเหลว

## สิ่งที่ระบบธีมควบคุม

ระบบธีมขับเคลื่อน:

- โทเค็นสี foreground/background ที่ใช้ทั่วทั้ง TUI
- อะแดปเตอร์การจัดรูปแบบ markdown (`getMarkdownTheme()`)
- อะแดปเตอร์ selector/editor/settings list (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- พรีเซ็ตสัญลักษณ์ + การแทนที่สัญลักษณ์ (`unicode`, `nerd`, `ascii`)
- สีไฮไลต์ซินแทกซ์ที่ใช้โดย native highlighter (`@f5xc-salesdemos/pi-natives`)
- สีของเซกเมนต์แถบสถานะ

การดำเนินการหลัก: `src/modes/theme/theme.ts`

## โครงสร้าง JSON ของธีม

ไฟล์ธีมเป็นอ็อบเจกต์ JSON ที่ตรวจสอบความถูกต้องกับสคีมาขณะรันไทม์ใน `theme.ts` (`ThemeJsonSchema`) และมิเรอร์โดย `src/modes/theme/theme-schema.json`

ฟิลด์ระดับบนสุด:

- `name` (จำเป็น)
- `colors` (จำเป็น; โทเค็นสีทั้งหมดจำเป็น)
- `vars` (ไม่บังคับ; ตัวแปรสีที่นำกลับมาใช้ได้)
- `export` (ไม่บังคับ; สีสำหรับส่งออก HTML)
- `symbols` (ไม่บังคับ)
  - `preset` (ไม่บังคับ: `unicode | nerd | ascii`)
  - `overrides` (ไม่บังคับ: คู่คีย์/ค่าสำหรับแทนที่ `SymbolKey`)

ค่าสีรองรับ:

- สตริง hex (`"#RRGGBB"`)
- ดัชนีสี 256 (`0..255`)
- สตริงอ้างอิงตัวแปร (แปลงผ่าน `vars`)
- สตริงว่าง (`""`) หมายถึงค่าเริ่มต้นของเทอร์มินัล (`\x1b[39m` fg, `\x1b[49m` bg)

## โทเค็นสีที่จำเป็น (ปัจจุบัน)

โทเค็นทั้งหมดด้านล่างจำเป็นต้องมีใน `colors`

### ข้อความหลักและเส้นขอบ (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### บล็อกพื้นหลัง (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### ข้อความข้อความ/เครื่องมือ (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Tool diff + ไฮไลต์ซินแทกซ์ (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### เส้นขอบโหมด/การคิด (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### สีเซกเมนต์แถบสถานะ (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## โทเค็นที่ไม่บังคับ

### ส่วน `export` (ไม่บังคับ)

ใช้สำหรับตัวช่วยธีมการส่งออก HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

หากละไว้ โค้ดส่งออกจะอนุมานค่าเริ่มต้นจากสีธีมที่แปลงแล้ว

### ส่วน `symbols` (ไม่บังคับ)

- `symbols.preset` ตั้งค่าชุดสัญลักษณ์เริ่มต้นระดับธีม
- `symbols.overrides` สามารถแทนที่ค่า `SymbolKey` แต่ละตัวได้

ลำดับความสำคัญขณะรันไทม์:

1. การแทนที่ `symbolPreset` ในการตั้งค่า (หากตั้งไว้)
2. `symbols.preset` ใน JSON ของธีม
3. ค่าเริ่มต้น `"unicode"`

คีย์แทนที่ที่ไม่ถูกต้องจะถูกเพิกเฉยและบันทึกล็อก (`logger.debug`)

## แหล่งที่มาธีมในตัว vs กำหนดเอง

ลำดับการค้นหาธีม (`loadThemeJson`):

1. ธีมในตัวที่ฝังไว้ (`defaults/xcsh-dark.json` และ `defaults/xcsh-light.json` ที่คอมไพล์เข้า `defaultThemes`)
2. ไฟล์ธีมกำหนดเอง: `<customThemesDir>/<name>.json`

ไดเรกทอรีธีมกำหนดเองมาจาก `getCustomThemesDir()`:

- ค่าเริ่มต้น: `~/.xcsh/agent/themes`
- แทนที่ด้วย `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` ส่งคืนรายชื่อรวมของธีมในตัว + กำหนดเอง เรียงลำดับ โดยธีมในตัวมีความสำคัญเหนือกว่าเมื่อชื่อซ้ำกัน

## การโหลด, การตรวจสอบความถูกต้อง และการแปลง

สำหรับไฟล์ธีมกำหนดเอง:

1. อ่าน JSON
2. แยกวิเคราะห์ JSON
3. ตรวจสอบความถูกต้องกับ `ThemeJsonSchema`
4. แปลงการอ้างอิง `vars` แบบเรียกซ้ำ
5. แปลงค่าที่แปลงแล้วเป็น ANSI ตามโหมดความสามารถของเทอร์มินัล

พฤติกรรมการตรวจสอบความถูกต้อง:

- โทเค็นสีที่จำเป็นขาดหาย: ข้อความแสดงข้อผิดพลาดแบบจัดกลุ่มอย่างชัดเจน
- ประเภท/ค่าโทเค็นไม่ถูกต้อง: ข้อผิดพลาดการตรวจสอบพร้อม JSON path
- ไฟล์ธีมไม่รู้จัก: `Theme not found: <name>`

พฤติกรรมการอ้างอิงตัวแปร:

- รองรับการอ้างอิงซ้อน
- เกิดข้อผิดพลาดเมื่อการอ้างอิงตัวแปรขาดหาย
- เกิดข้อผิดพลาดเมื่อการอ้างอิงเป็นวงกลม

## พฤติกรรมโหมดสีเทอร์มินัล

การตรวจจับโหมดสี (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` เป็น `dumb`, `linux` หรือว่างเปล่า => 256color
- นอกจากนี้ => truecolor

พฤติกรรมการแปลง:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- ตัวเลข -> `38;5` / `48;5` ANSI
- `""` -> รีเซ็ต fg/bg เริ่มต้น

## พฤติกรรมการสลับขณะรันไทม์

### ธีมเริ่มต้น (`initTheme`)

`main.ts` เริ่มต้นธีมพร้อมการตั้งค่า:

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

### การสลับแบบระบุ (`setTheme`)

- โหลดธีมที่เลือก
- อัปเดต singleton `theme` ส่วนกลาง
- เริ่ม watcher ตามต้องการ
- เรียก callback `onThemeChange`

เมื่อล้มเหลว:

- ย้อนกลับไปใช้ธีมในตัว `dark`
- ส่งคืน `{ success: false, error }`

### การสลับแบบดูตัวอย่าง (`previewTheme`)

- ใช้ธีมดูตัวอย่างชั่วคราวกับ `theme` ส่วนกลาง
- **ไม่**เปลี่ยนการตั้งค่าที่บันทึกถาวรด้วยตัวเอง
- ส่งคืนสำเร็จ/ข้อผิดพลาดโดยไม่มีการแทนที่ย้อนกลับ

UI การตั้งค่าใช้สิ่งนี้สำหรับการดูตัวอย่างสดและคืนค่าธีมก่อนหน้าเมื่อยกเลิก

## Watcher และการโหลดใหม่แบบสด

เมื่อเปิดใช้งาน watcher (`setTheme(..., true)` / การเริ่มต้นแบบโต้ตอบ):

- ดูเฉพาะพาธไฟล์กำหนดเอง `<customThemesDir>/<currentTheme>.json`
- ธีมในตัวจะไม่ถูกดูอย่างมีประสิทธิภาพ
- ไฟล์ `change`: พยายามโหลดใหม่ (debounced)
- ไฟล์ `rename`/ลบ: ย้อนกลับไป `dark`, ปิด watcher

โหมดอัตโนมัติยังติดตั้ง listener `SIGWINCH` และสามารถประเมินการแมปสล็อตมืด/สว่างใหม่เมื่อสถานะเทอร์มินัลเปลี่ยนแปลง

## พฤติกรรมโหมดตาบอดสี

`colorBlindMode` เปลี่ยนเพียงโทเค็นเดียวขณะรันไทม์:

- `toolDiffAdded` ถูกปรับ HSV (เขียวเลื่อนไปทางน้ำเงิน)
- การปรับจะถูกใช้เฉพาะเมื่อค่าที่แปลงแล้วเป็นสตริง hex

โทเค็นอื่นไม่เปลี่ยนแปลง

## ตำแหน่งที่การตั้งค่าธีมถูกบันทึกถาวร

การตั้งค่าที่เกี่ยวกับธีมถูกบันทึกถาวรโดย `Settings` ไปยังไฟล์ config YAML ส่วนกลาง:

- พาธ: `<agentDir>/config.yml`
- ไดเรกทอรี agent เริ่มต้น: `~/.xcsh/agent`
- ไฟล์เริ่มต้นที่ใช้จริง: `~/.xcsh/agent/config.yml`

คีย์ที่บันทึกถาวร:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

มีการย้ายข้อมูลแบบเก่า: `theme: "name"` แบบแบนเดิมจะถูกย้ายไปเป็น `theme.dark` หรือ `theme.light` แบบซ้อนตามการตรวจจับความสว่าง

## การสร้างธีมกำหนดเอง (เชิงปฏิบัติ)

1. สร้างไฟล์ในไดเรกทอรีธีมกำหนดเอง เช่น `~/.xcsh/agent/themes/my-theme.json`
2. ใส่ `name`, `vars` ที่ไม่บังคับ และโทเค็น `colors` ที่จำเป็น**ทั้งหมด**
3. ใส่ `symbols` และ `export` ตามต้องการ
4. เลือกธีมในการตั้งค่า (`Display -> Dark theme` หรือ `Display -> Light theme`) ขึ้นอยู่กับสล็อตอัตโนมัติที่คุณต้องการ

โครงร่างขั้นต่ำ ทุกคีย์ใน `colors` จำเป็น — ตัวตรวจสอบขณะรันไทม์
(`additionalProperties: false`) ปฏิเสธทั้งคีย์ที่ขาดหายและคีย์ที่ไม่รู้จัก
สำหรับการดำเนินการอ้างอิงที่มาพร้อมกัน ดูที่
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
และ [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)

แถบสถานะมีระบบสีคู่ขนานสองระบบที่บันทึกไว้ใน issue #242:

- สีข้อความแบบ hex (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) ขับเคลื่อนการเรนเดอร์แบบ non-powerline
- ดัชนีพาเลตต์สี 256 (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  ขับเคลื่อนการเติมเซกเมนต์ powerline ทั้งสองเป็นอิสระจากคีย์ hex ด้านบน —
  ต้องตั้งค่าทั้งสอง

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

1. เริ่มโหมดโต้ตอบ (watcher เปิดใช้งานตั้งแต่เริ่มต้น)
2. เปิดการตั้งค่าและดูตัวอย่างค่าธีม (ใช้ `previewTheme` แบบสด)
3. สำหรับไฟล์ธีมกำหนดเอง แก้ไข JSON ขณะที่กำลังทำงานและยืนยันการโหลดใหม่อัตโนมัติเมื่อบันทึก
4. ทดสอบพื้นผิวที่สำคัญ:
   - การเรนเดอร์ markdown
   - บล็อกเครื่องมือ (รอดำเนินการ/สำเร็จ/ข้อผิดพลาด)
   - การเรนเดอร์ diff (เพิ่ม/ลบ/บริบท)
   - ความสามารถอ่านได้ของแถบสถานะ
   - การเปลี่ยนเส้นขอบระดับการคิด
   - สีเส้นขอบโหมด bash/python
5. ตรวจสอบความถูกต้องทั้งพรีเซ็ตสัญลักษณ์หากธีมของคุณขึ้นอยู่กับความกว้าง/ลักษณะของ glyph

## ข้อจำกัดและข้อควรระวังที่แท้จริง

- โทเค็น `colors` ทั้งหมดจำเป็นสำหรับธีมกำหนดเอง
- `export` และ `symbols` ไม่บังคับ
- `$schema` ใน JSON ของธีมเป็นข้อมูลเพื่อการอ้างอิง; การตรวจสอบขณะรันไทม์บังคับใช้โดยสคีมา TypeBox ที่คอมไพล์แล้วในโค้ด
- ความล้มเหลวของ `setTheme` ย้อนกลับไป `dark`; ความล้มเหลวของ `previewTheme` ไม่แทนที่ธีมปัจจุบัน
- ข้อผิดพลาดการโหลดใหม่ของ file watcher จะคงธีมที่โหลดอยู่ปัจจุบันจนกว่าจะโหลดใหม่สำเร็จหรือเส้นทาง fallback ถูกเรียกใช้
