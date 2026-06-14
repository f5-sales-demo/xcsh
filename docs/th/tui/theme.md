---
title: เอกสารอ้างอิงการจัดธีม
description: >-
  เอกสารอ้างอิงการจัดธีม TUI พร้อม color tokens การตั้งค่าฟอนต์
  และการปรับแต่งธีม
sidebar:
  order: 3
  label: การจัดธีม
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# เอกสารอ้างอิงการจัดธีม

เอกสารนี้อธิบายการทำงานของระบบธีมใน coding-agent ในปัจจุบัน ได้แก่ schema การโหลด พฤติกรรม runtime และรูปแบบความล้มเหลว

## สิ่งที่ระบบธีมควบคุม

ระบบธีมขับเคลื่อน:

- color tokens สำหรับ foreground/background ที่ใช้ทั่ว TUI
- อะแดปเตอร์การจัดรูปแบบ markdown (`getMarkdownTheme()`)
- อะแดปเตอร์ selector/editor/settings list (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- symbol preset + symbol overrides (`unicode`, `nerd`, `ascii`)
- สีสำหรับ syntax highlighting ที่ใช้โดย native highlighter (`@f5xc-salesdemos/pi-natives`)
- สีของ segment ใน status line

การดำเนินการหลัก: `src/modes/theme/theme.ts`

## รูปแบบ Theme JSON

ไฟล์ธีมเป็น JSON object ที่ตรวจสอบความถูกต้องตาม runtime schema ใน `theme.ts` (`ThemeJsonSchema`) และสะท้อนโดย `src/modes/theme/theme-schema.json`

ฟิลด์ระดับบนสุด:

- `name` (จำเป็น)
- `colors` (จำเป็น; color tokens ทั้งหมดต้องมี)
- `vars` (ไม่บังคับ; ตัวแปรสีที่ใช้ซ้ำได้)
- `export` (ไม่บังคับ; สีสำหรับ HTML export)
- `symbols` (ไม่บังคับ)
  - `preset` (ไม่บังคับ: `unicode | nerd | ascii`)
  - `overrides` (ไม่บังคับ: overrides แบบ key/value สำหรับ `SymbolKey`)

ค่าสีรับ:

- hex string (`"#RRGGBB"`)
- ดัชนีสี 256 สี (`0..255`)
- สตริงอ้างอิงตัวแปร (แก้ไขผ่าน `vars`)
- สตริงว่าง (`""`) หมายถึงค่าเริ่มต้นของ terminal (`\x1b[39m` fg, `\x1b[49m` bg)

## Color tokens ที่จำเป็น (ปัจจุบัน)

tokens ทั้งหมดด้านล่างต้องมีใน `colors`

### ข้อความและขอบหลัก (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### บล็อกพื้นหลัง (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### ข้อความ message/tool (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Tool diff + syntax highlighting (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### ขอบสำหรับ mode/thinking (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### สีของ segment ใน status line (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## tokens ที่ไม่บังคับ

### ส่วน `export` (ไม่บังคับ)

ใช้สำหรับ theming helpers สำหรับ HTML export:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

หากละไว้ โค้ด export จะคำนวณค่าเริ่มต้นจากสีธีมที่แก้ไขแล้ว

### ส่วน `symbols` (ไม่บังคับ)

- `symbols.preset` กำหนดชุด symbol เริ่มต้นระดับธีม
- `symbols.overrides` สามารถ override ค่า `SymbolKey` แต่ละรายการได้

ลำดับความสำคัญ runtime:

1. `symbolPreset` override จาก settings (หากตั้งค่าไว้)
2. `symbols.preset` จาก theme JSON
3. fallback `"unicode"`

override key ที่ไม่ถูกต้องจะถูกละเว้นและบันทึกลอก (`logger.debug`)

## แหล่งธีมแบบ built-in เทียบกับแบบกำหนดเอง

ลำดับการค้นหาธีม (`loadThemeJson`):

1. ธีมที่ฝังแบบ built-in (`defaults/xcsh-dark.json` และ `defaults/xcsh-light.json` ที่คอมไพล์เป็น `defaultThemes`)
2. ไฟล์ธีมกำหนดเอง: `<customThemesDir>/<name>.json`

ไดเรกทอรีธีมกำหนดเองมาจาก `getCustomThemesDir()`:

- ค่าเริ่มต้น: `~/.xcsh/agent/themes`
- ถูก override โดย `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` คืนค่าชื่อแบบ built-in + กำหนดเองที่รวมกัน เรียงลำดับแล้ว โดยแบบ built-in มีความสำคัญเหนือกว่าเมื่อชื่อชนกัน

## การโหลด ตรวจสอบ และการแก้ไข

สำหรับไฟล์ธีมกำหนดเอง:

1. อ่าน JSON
2. parse JSON
3. ตรวจสอบความถูกต้องตาม `ThemeJsonSchema`
4. แก้ไขการอ้างอิง `vars` แบบ recursive
5. แปลงค่าที่แก้ไขแล้วเป็น ANSI ตามโหมดความสามารถของ terminal

พฤติกรรมการตรวจสอบความถูกต้อง:

- color tokens ที่จำเป็นแต่หายไป: ข้อความแสดงข้อผิดพลาดแบบจัดกลุ่มอย่างชัดเจน
- ประเภท/ค่า token ที่ไม่ถูกต้อง: ข้อผิดพลาดการตรวจสอบความถูกต้องพร้อม JSON path
- ไฟล์ธีมที่ไม่รู้จัก: `Theme not found: <name>`

พฤติกรรมการอ้างอิงตัวแปร:

- รองรับการอ้างอิงแบบ nested
- throw เมื่อการอ้างอิงตัวแปรหายไป
- throw เมื่อเกิดการอ้างอิงแบบวงกลม

## พฤติกรรมโหมดสี terminal

การตรวจจับโหมดสี (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` ใน `dumb`, `linux`, หรือว่างเปล่า => 256color
- มิฉะนั้น => truecolor

พฤติกรรมการแปลง:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- numeric -> `38;5` / `48;5` ANSI
- `""` -> reset fg/bg เป็นค่าเริ่มต้น

## พฤติกรรมการสลับธีมขณะ runtime

### ธีมเริ่มต้น (`initTheme`)

`main.ts` เริ่มต้นธีมด้วย settings:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

การเลือก auto theme slot ใช้การตรวจจับพื้นหลัง `COLORFGBG`:

- parse ดัชนีพื้นหลังจาก `COLORFGBG`
- `< 8` => dark slot (`theme.dark`)
- `>= 8` => light slot (`theme.light`)
- parse ล้มเหลว => dark slot

ค่าเริ่มต้นปัจจุบันจาก settings schema:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### การสลับอย่างชัดเจน (`setTheme`)

- โหลดธีมที่เลือก
- อัปเดต `theme` singleton ส่วนกลาง
- เริ่ม watcher ตามต้องการ
- เรียก callback `onThemeChange`

เมื่อล้มเหลว:

- fallback ไปยังแบบ built-in `dark`
- คืนค่า `{ success: false, error }`

### การสลับแบบ preview (`previewTheme`)

- ใช้ธีม preview ชั่วคราวกับ `theme` ส่วนกลาง
- **ไม่** เปลี่ยน settings ที่บันทึกไว้ด้วยตัวเอง
- คืนค่า success/error โดยไม่มีการแทนที่ fallback

Settings UI ใช้สิ่งนี้สำหรับ preview แบบ live และกู้คืนธีมก่อนหน้าเมื่อยกเลิก

## Watchers และการโหลดซ้ำแบบ live

เมื่อเปิดใช้งาน watcher (`setTheme(..., true)` / การเริ่มต้นแบบ interactive):

- ดูเฉพาะ custom file path `<customThemesDir>/<currentTheme>.json` เท่านั้น
- แบบ built-in จะไม่ถูกดูโดยพฤตินัย
- file `change`: พยายามโหลดซ้ำ (debounced)
- file `rename`/ลบ: fallback ไปยัง `dark` ปิด watcher

โหมด auto ยังติดตั้ง listener `SIGWINCH` และสามารถประเมิน dark/light slot mapping ซ้ำเมื่อ terminal state เปลี่ยนแปลงได้

## พฤติกรรมโหมดตาบอดสี

`colorBlindMode` เปลี่ยนเฉพาะ token เดียวขณะ runtime:

- `toolDiffAdded` ถูกปรับด้วย HSV (สีเขียวเลื่อนไปทางน้ำเงิน)
- การปรับจะใช้เฉพาะเมื่อค่าที่แก้ไขแล้วเป็น hex string

tokens อื่นๆ ไม่เปลี่ยนแปลง

## ที่เก็บ theme settings

theme settings ที่เกี่ยวข้องถูกบันทึกโดย `Settings` ไปยัง global config YAML:

- path: `<agentDir>/config.yml`
- agent dir เริ่มต้น: `~/.xcsh/agent`
- ไฟล์เริ่มต้นที่มีผล: `~/.xcsh/agent/config.yml`

keys ที่บันทึก:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

มี legacy migration: `theme: "name"` แบบ flat เดิมจะถูก migrate ไปยัง `theme.dark` หรือ `theme.light` แบบ nested ตามการตรวจจับความสว่าง

## การสร้างธีมกำหนดเอง (เชิงปฏิบัติ)

1. สร้างไฟล์ในไดเรกทอรีธีมกำหนดเอง เช่น `~/.xcsh/agent/themes/my-theme.json`
2. ใส่ `name`, `vars` ที่ไม่บังคับ และ color tokens ใน `colors` **ทั้งหมดที่จำเป็น**
3. ใส่ `symbols` และ `export` ตามต้องการ
4. เลือกธีมใน Settings (`Display -> Dark theme` หรือ `Display -> Light theme`) ขึ้นอยู่กับ auto slot ที่ต้องการ

โครงสร้างขั้นต่ำ ทุก key ใน `colors` จำเป็นต้องมี — runtime validator
(`additionalProperties: false`) ปฏิเสธทั้ง key ที่หายไปและ key ที่ไม่รู้จัก
สำหรับการดำเนินการอ้างอิงที่มีให้ดูที่
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
และ [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)

status line มีระบบสีสองแบบที่ทำงานคู่ขนานซึ่งระบุไว้ใน issue #242:

- สีข้อความ Hex (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) ขับเคลื่อนการ
  render แบบ non-powerline
- ดัชนีสี 256 สี (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  ขับเคลื่อนการเติมสี segment แบบ powerline ซึ่งเป็นอิสระจาก hex keys ด้านบน —
  ต้องตั้งค่าทั้งสองอย่าง

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

ใช้ขั้นตอนนี้:

1. เริ่มโหมด interactive (watcher เปิดใช้งานตั้งแต่เริ่มต้น)
2. เปิด settings และ preview ค่าธีม (live `previewTheme`)
3. สำหรับไฟล์ธีมกำหนดเอง แก้ไข JSON ขณะทำงานและยืนยันการโหลดซ้ำอัตโนมัติเมื่อบันทึก
4. ทดสอบ surface ที่สำคัญ:
   - การ render markdown
   - tool blocks (pending/success/error)
   - การ render diff (added/removed/context)
   - ความอ่านง่ายของ status line
   - การเปลี่ยนขอบระดับ thinking
   - สีขอบโหมด bash/python
5. ตรวจสอบ symbol preset ทั้งสองแบบหากธีมของคุณขึ้นอยู่กับความกว้าง/รูปลักษณ์ของ glyph

## ข้อจำกัดและข้อควรระวังที่แท้จริง

- `colors` tokens ทั้งหมดจำเป็นสำหรับธีมกำหนดเอง
- `export` และ `symbols` ไม่บังคับ
- `$schema` ใน theme JSON เป็นข้อมูลเท่านั้น การตรวจสอบความถูกต้อง runtime ถูกบังคับใช้โดย compiled TypeBox schema ในโค้ด
- ความล้มเหลวของ `setTheme` จะ fallback ไปยัง `dark`; ความล้มเหลวของ `previewTheme` จะไม่แทนที่ธีมปัจจุบัน
- ข้อผิดพลาดการโหลดซ้ำของ File watcher จะคงธีมที่โหลดอยู่ปัจจุบันไว้จนกว่าจะโหลดซ้ำสำเร็จหรือเส้นทาง fallback ถูกเรียกใช้งาน
