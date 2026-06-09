---
title: เอกสารอ้างอิงการปรับแต่งธีม
description: >-
  เอกสารอ้างอิงการปรับแต่งธีม TUI พร้อม color tokens การตั้งค่าฟอนต์
  และการปรับแต่งธีม
sidebar:
  order: 3
  label: การปรับแต่งธีม
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# เอกสารอ้างอิงการปรับแต่งธีม

เอกสารนี้อธิบายวิธีการทำงานของระบบธีมใน coding-agent ในปัจจุบัน: schema, การโหลด, พฤติกรรมขณะรันไทม์ และโหมดความล้มเหลว

## สิ่งที่ระบบธีมควบคุม

ระบบธีมขับเคลื่อน:

- โทเค็นสี foreground/background ที่ใช้ทั่วทั้ง TUI
- ตัวปรับแต่งการจัดรูปแบบ markdown (`getMarkdownTheme()`)
- ตัวปรับแต่ง selector/editor/settings list (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- ชุดสัญลักษณ์ preset + การแทนที่สัญลักษณ์ (`unicode`, `nerd`, `ascii`)
- สีไฮไลต์ไวยากรณ์ที่ใช้โดย native highlighter (`@f5xc-salesdemos/pi-natives`)
- สีส่วนแถบสถานะ

การใช้งานหลัก: `src/modes/theme/theme.ts`

## รูปแบบ Theme JSON

ไฟล์ธีมเป็นอ็อบเจกต์ JSON ที่ตรวจสอบความถูกต้องตาม runtime schema ใน `theme.ts` (`ThemeJsonSchema`) และมีสำเนาอยู่ที่ `src/modes/theme/theme-schema.json`

ฟิลด์ระดับบนสุด:

- `name` (จำเป็น)
- `colors` (จำเป็น; โทเค็นสีทั้งหมดจำเป็น)
- `vars` (ไม่บังคับ; ตัวแปรสีที่ใช้ซ้ำได้)
- `export` (ไม่บังคับ; สีสำหรับการส่งออก HTML)
- `symbols` (ไม่บังคับ)
  - `preset` (ไม่บังคับ: `unicode | nerd | ascii`)
  - `overrides` (ไม่บังคับ: การแทนที่ key/value สำหรับ `SymbolKey`)

ค่าสีรองรับ:

- สตริง hex (`"#RRGGBB"`)
- ดัชนีสี 256 สี (`0..255`)
- สตริงอ้างอิงตัวแปร (ถูก resolve ผ่าน `vars`)
- สตริงว่าง (`""`) หมายถึงค่าเริ่มต้นของเทอร์มินัล (`\x1b[39m` fg, `\x1b[49m` bg)

## โทเค็นสีที่จำเป็น (ปัจจุบัน)

โทเค็นทั้งหมดด้านล่างนี้จำเป็นต้องมีใน `colors`

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

### สีส่วนแถบสถานะ (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## โทเค็นที่ไม่บังคับ

### ส่วน `export` (ไม่บังคับ)

ใช้สำหรับตัวช่วยธีมการส่งออก HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

หากไม่ระบุ โค้ดส่งออกจะสร้างค่าเริ่มต้นจากสีธีมที่ถูก resolve แล้ว

### ส่วน `symbols` (ไม่บังคับ)

- `symbols.preset` ตั้งค่าชุดสัญลักษณ์เริ่มต้นระดับธีม
- `symbols.overrides` สามารถแทนที่ค่า `SymbolKey` เฉพาะรายการได้

ลำดับความสำคัญขณะรันไทม์:

1. การแทนที่ `symbolPreset` จากการตั้งค่า (หากตั้งไว้)
2. `symbols.preset` จาก theme JSON
3. ค่าเริ่มต้น `"unicode"`

คีย์การแทนที่ที่ไม่ถูกต้องจะถูกละเว้นและบันทึกลงล็อก (`logger.debug`)

## แหล่งธีมในตัว vs แบบกำหนดเอง

ลำดับการค้นหาธีม (`loadThemeJson`):

1. ธีมในตัวที่ฝังไว้ (`defaults/xcsh-dark.json` และ `defaults/xcsh-light.json` ที่คอมไพล์เข้าใน `defaultThemes`)
2. ไฟล์ธีมแบบกำหนดเอง: `<customThemesDir>/<name>.json`

ไดเรกทอรีธีมแบบกำหนดเองมาจาก `getCustomThemesDir()`:

- ค่าเริ่มต้น: `~/.xcsh/agent/themes`
- แทนที่ด้วย `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` คืนค่ารายชื่อรวมของธีมในตัว + แบบกำหนดเอง เรียงลำดับแล้ว โดยธีมในตัวมีความสำคัญกว่าเมื่อชื่อซ้ำกัน

## การโหลด การตรวจสอบความถูกต้อง และการ resolve

สำหรับไฟล์ธีมแบบกำหนดเอง:

1. อ่าน JSON
2. แยกวิเคราะห์ JSON
3. ตรวจสอบความถูกต้องกับ `ThemeJsonSchema`
4. resolve การอ้างอิง `vars` แบบเวียนซ้ำ
5. แปลงค่าที่ resolve แล้วเป็น ANSI ตามโหมดความสามารถของเทอร์มินัล

พฤติกรรมการตรวจสอบความถูกต้อง:

- โทเค็นสีที่จำเป็นขาดหาย: ข้อความข้อผิดพลาดแบบจัดกลุ่มอย่างชัดเจน
- ชนิด/ค่าโทเค็นไม่ถูกต้อง: ข้อผิดพลาดการตรวจสอบพร้อมเส้นทาง JSON
- ไฟล์ธีมไม่รู้จัก: `Theme not found: <name>`

พฤติกรรมการอ้างอิงตัวแปร:

- รองรับการอ้างอิงแบบซ้อน
- โยนข้อผิดพลาดเมื่อไม่พบตัวแปรที่อ้างอิง
- โยนข้อผิดพลาดเมื่อเกิดการอ้างอิงแบบวงกลม

## พฤติกรรมโหมดสีเทอร์มินัล

การตรวจจับโหมดสี (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` เป็น `dumb`, `linux` หรือว่างเปล่า => 256color
- อื่นๆ => truecolor

พฤติกรรมการแปลง:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- ตัวเลข -> ANSI `38;5` / `48;5`
- `""` -> รีเซ็ต fg/bg เริ่มต้น

## พฤติกรรมการสลับธีมขณะรันไทม์

### ธีมเริ่มต้น (`initTheme`)

`main.ts` เริ่มต้นธีมด้วยการตั้งค่า:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

การเลือกสล็อตธีมอัตโนมัติใช้การตรวจจับพื้นหลังจาก `COLORFGBG`:

- แยกวิเคราะห์ดัชนีพื้นหลังจาก `COLORFGBG`
- `< 8` => สล็อตมืด (`theme.dark`)
- `>= 8` => สล็อตสว่าง (`theme.light`)
- แยกวิเคราะห์ล้มเหลว => สล็อตมืด

ค่าเริ่มต้นปัจจุบันจาก settings schema:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### การสลับแบบระบุตรง (`setTheme`)

- โหลดธีมที่เลือก
- อัปเดต singleton `theme` ระดับ global
- เริ่ม watcher ตามต้องการ (ไม่บังคับ)
- ทริกเกอร์ callback `onThemeChange`

เมื่อล้มเหลว:

- ย้อนกลับไปใช้ธีมในตัว `dark`
- คืนค่า `{ success: false, error }`

### การสลับแบบตัวอย่าง (`previewTheme`)

- ใช้ธีมตัวอย่างชั่วคราวกับ `theme` ระดับ global
- **ไม่** เปลี่ยนการตั้งค่าที่บันทึกถาวรด้วยตัวเอง
- คืนค่า success/error โดยไม่มีการแทนที่แบบ fallback

Settings UI ใช้สิ่งนี้สำหรับการดูตัวอย่างแบบสดและกู้คืนธีมก่อนหน้าเมื่อยกเลิก

## Watchers และการโหลดซ้ำแบบสด

เมื่อเปิดใช้งาน watcher (`setTheme(..., true)` / การเริ่มต้นแบบโต้ตอบ):

- เฝ้าดูเฉพาะเส้นทางไฟล์แบบกำหนดเอง `<customThemesDir>/<currentTheme>.json`
- ธีมในตัวจะไม่ถูกเฝ้าดู
- ไฟล์ `change`: พยายามโหลดซ้ำ (แบบ debounced)
- ไฟล์ `rename`/ลบ: ย้อนกลับไปใช้ `dark` ปิด watcher

โหมดอัตโนมัติยังติดตั้ง listener `SIGWINCH` และสามารถประเมินการแมปสล็อตมืด/สว่างใหม่เมื่อสถานะเทอร์มินัลเปลี่ยนแปลง

## พฤติกรรมโหมดตาบอดสี

`colorBlindMode` เปลี่ยนเพียงหนึ่งโทเค็นขณะรันไทม์:

- `toolDiffAdded` ถูกปรับค่า HSV (เขียวถูกเลื่อนไปทางน้ำเงิน)
- การปรับจะถูกใช้เฉพาะเมื่อค่าที่ resolve แล้วเป็นสตริง hex

โทเค็นอื่นๆ ไม่เปลี่ยนแปลง

## ตำแหน่งที่บันทึกการตั้งค่าธีม

การตั้งค่าที่เกี่ยวกับธีมจะถูกบันทึกถาวรโดย `Settings` ไปยังไฟล์ config YAML ระดับ global:

- เส้นทาง: `<agentDir>/config.yml`
- ไดเรกทอรี agent เริ่มต้น: `~/.xcsh/agent`
- ไฟล์เริ่มต้นจริง: `~/.xcsh/agent/config.yml`

คีย์ที่บันทึกถาวร:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

มีการย้ายข้อมูลจากรูปแบบเก่า: รูปแบบเก่าแบบแบน `theme: "name"` จะถูกย้ายเป็นแบบซ้อน `theme.dark` หรือ `theme.light` ตามการตรวจจับค่าความสว่าง

## การสร้างธีมแบบกำหนดเอง (เชิงปฏิบัติ)

1. สร้างไฟล์ในไดเรกทอรีธีมแบบกำหนดเอง เช่น `~/.xcsh/agent/themes/my-theme.json`
2. รวม `name`, `vars` ที่ไม่บังคับ และโทเค็น `colors` ที่จำเป็น **ทั้งหมด**
3. รวม `symbols` และ `export` ตามต้องการ (ไม่บังคับ)
4. เลือกธีมในการตั้งค่า (`Display -> Dark theme` หรือ `Display -> Light theme`) ขึ้นอยู่กับว่าต้องการใช้สล็อตอัตโนมัติใด

โครงสร้างขั้นต่ำ ทุกคีย์ใน `colors` จำเป็นต้องมี — ตัวตรวจสอบขณะรันไทม์
(`additionalProperties: false`) ปฏิเสธทั้งคีย์ที่ขาดหายและคีย์ที่ไม่รู้จัก
สำหรับการใช้งานอ้างอิงที่มาพร้อมกับระบบ ดูที่
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
และ [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)

แถบสถานะมีระบบสีแบบคู่ขนานสองระบบที่จัดทำเอกสารไว้ใน issue #242:

- สีข้อความ hex (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) ขับเคลื่อนการแสดงผลแบบ non-powerline
- ดัชนีพาเลตสี 256 สี (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  ขับเคลื่อนการเติมสีส่วน powerline ซึ่งเป็นอิสระจากคีย์ hex ข้างต้น —
  ทั้งสองต้องถูกตั้งค่า

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

## การทดสอบธีมแบบกำหนดเอง

ใช้ขั้นตอนการทำงานนี้:

1. เริ่มโหมดโต้ตอบ (watcher เปิดใช้งานตั้งแต่เริ่มต้น)
2. เปิดการตั้งค่าและดูตัวอย่างค่าธีม (`previewTheme` แบบสด)
3. สำหรับไฟล์ธีมแบบกำหนดเอง แก้ไข JSON ขณะรันอยู่และยืนยันการโหลดซ้ำอัตโนมัติเมื่อบันทึก
4. ทดสอบพื้นผิวสำคัญ:
   - การแสดงผล markdown
   - บล็อกเครื่องมือ (pending/success/error)
   - การแสดงผล diff (added/removed/context)
   - ความอ่านง่ายของแถบสถานะ
   - การเปลี่ยนขอบระดับการคิด
   - สีขอบโหมด bash/python
5. ตรวจสอบความถูกต้องของทั้งสองชุดสัญลักษณ์ preset หากธีมของคุณขึ้นอยู่กับความกว้าง/รูปลักษณ์ของกลิฟ

## ข้อจำกัดและข้อควรระวังที่แท้จริง

- โทเค็น `colors` ทั้งหมดจำเป็นสำหรับธีมแบบกำหนดเอง
- `export` และ `symbols` ไม่บังคับ
- `$schema` ใน theme JSON เป็นข้อมูลเพื่อแจ้งให้ทราบเท่านั้น; การตรวจสอบความถูกต้องขณะรันไทม์บังคับใช้โดย TypeBox schema ที่คอมไพล์แล้วในโค้ด
- ความล้มเหลวของ `setTheme` จะย้อนกลับไปใช้ `dark`; ความล้มเหลวของ `previewTheme` จะไม่แทนที่ธีมปัจจุบัน
- ข้อผิดพลาดการโหลดซ้ำของ file watcher จะคงธีมที่โหลดอยู่ในปัจจุบันไว้จนกว่าจะโหลดซ้ำสำเร็จหรือเส้นทาง fallback ถูกทริกเกอร์
