---
title: F5 XC Contexts
description: >-
  เชื่อมต่อ xcsh กับ F5 Distributed Cloud tenants -- สร้าง สลับ และจัดการ
  authentication contexts
sidebar:
  order: 1
  label: F5 XC Contexts
i18n:
  sourceHash: a9cccbc338f0
  translator: machine
---

# F5 XC Contexts

xcsh เชื่อมต่อกับ F5 Distributed Cloud ผ่าน **contexts** -- ชุดข้อมูลรับรองที่มีชื่อซึ่งผูก tenant URL, API token และ namespace เข้าด้วยกัน หากคุณเคยใช้ `kubectl config use-context` หรือ `kubectx` มาก่อน workflow จะเหมือนกันทุกประการ: สร้าง context, สลับระหว่างกันด้วยชื่อ และใช้ `-` เพื่อสลับกลับ

## เริ่มต้นใช้งาน

### 1. สร้าง context แรกของคุณ

คุณต้องการข้อมูลสามอย่างจาก F5 XC คอนโซล ของคุณ: tenant URL, API token และ namespace (ไม่บังคับ)

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

หรือใช้ guided wizard หากคุณต้องการคำแนะนำทีละขั้นตอน:

```
/context wizard
```

### 2. เปิดใช้งาน

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ XCSH_TENANT     acme                                         │
│ XCSH_API_URL    https://acme.console.ves.volterra.io         │
│ XCSH_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ XCSH_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

เมื่อเปิดใช้งานแล้ว xcsh จะฉีด tenant credentials เข้าไปในเซสชันของคุณ agent สามารถเรียกใช้ F5 XC API ได้แล้ว และแถบสถานะจะแสดง context ที่ใช้งานอยู่

### 3. เพิ่ม contexts เพิ่มเติมและสลับระหว่างกัน

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

สลับด้วยชื่อ -- ไม่จำเป็นต้องใช้คำสั่งย่อย:

```
/context staging
```

สลับกลับไปยัง context ก่อนหน้า (สไตล์ `cd -`):

```
/context -
```

การเรียก `/context -` สองครั้งจะพาคุณกลับไปยังจุดเริ่มต้น

### 4. ดูสิ่งที่คุณมี

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

`*` แสดง context ที่ใช้งานอยู่

## คำสั่งที่ใช้บ่อย

| คำสั่ง | หน้าที่ |
|---|---|
| `/context` | แสดงรายการ contexts ทั้งหมด |
| `/context <name>` | สลับไปยัง context |
| `/context -` | สลับไปยัง context ก่อนหน้า |
| `/context show` | แสดงรายละเอียด context ที่ใช้งานอยู่ (ซ่อน tokens) |
| `/context status` | แสดงสถานะการตรวจสอบสิทธิ์ปัจจุบัน |

## วงจรชีวิตของ Context

| คำสั่ง | หน้าที่ |
|---|---|
| `/context create <name> <url> <token> [namespace]` | สร้าง context |
| `/context delete <name> --confirm` | ลบ context (ต้องใช้ `--confirm`) |
| `/context rename <old> <new>` | เปลี่ยนชื่อ context |
| `/context validate <name>` | ทดสอบข้อมูลรับรองโดยไม่สลับ |
| `/context export [name] [--include-token]` | ส่งออกเป็น JSON (ซ่อน tokens ตามค่าเริ่มต้น) |
| `/context import <path-or-json> [--overwrite]` | นำเข้าจากไฟล์หรือ inline JSON |
| `/context wizard` | การตั้งค่าแบบโต้ตอบที่มีคำแนะนำ |

## การสลับ Namespaces

แต่ละ context มี namespace เริ่มต้น สลับโดยไม่ต้องเปลี่ยน context:

```
/context namespace system
```

Tab completion จะแสดงชื่อ namespace จาก tenant ที่ใช้งานอยู่

## Environment variables บน Contexts

Contexts สามารถพกพา environment variables เพิ่มเติมที่จะถูกฉีดเข้าไปในเซสชันของคุณเมื่อเปิดใช้งาน มีประโยชน์สำหรับการกำหนดค่าต่อ tenant ที่ไม่ได้เป็นส่วนหนึ่งของชุดข้อมูลรับรอง

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Aliases: `add` = `set`, `remove`/`clear` = `unset`

## Tab Completion

พิมพ์ `/context ` แล้วกด Tab dropdown จะแสดง:

1. **ชื่อ Context** -- พร้อม hints ของ tenant URL เพื่อให้คุณแยกแยะ tenants ได้
2. **`-`** -- ปรากฏเมื่อคุณเคยสลับมาก่อน แสดง context ที่คุณจะสลับไป
3. **Subcommands** -- `list`, `create`, `delete` เป็นต้น

ชื่อ context ปรากฏก่อนเนื่องจากการสลับเป็นการกระทำที่ใช้บ่อยที่สุด

Subcommand-level completions ก็ใช้งานได้เช่นกัน: `/context activate <Tab>` สำเร็จรูปชื่อ context, `/context namespace <Tab>` สำเร็จรูป namespaces, `/context unset <Tab>` สำเร็จรูป env var keys ที่รู้จัก

## กฎการตั้งชื่อ

ชื่อ context ต้องมี 1-64 ตัวอักษร: ตัวอักษร, ตัวเลข, ยัติภังค์, เครื่องหมายขีดล่าง

ชื่อที่ชนกับ subcommands จะถูกปฏิเสธ:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

ชุดที่สงวนไว้ทั้งหมด: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help` การเปรียบเทียบไม่คำนึงถึงตัวพิมพ์เล็ก-ใหญ่

## การแทนที่ด้วย Environment Variable

หาก `XCSH_API_URL` และ `XCSH_API_TOKEN` ถูกตั้งค่าใน shell environment ของคุณก่อนเปิด xcsh ค่าเหล่านั้นจะมีความสำคัญเหนือกว่า context ใดๆ ซึ่งมีประโยชน์สำหรับ CI/CD pipelines หรือเซสชันชั่วคราวที่คุณไม่ต้องการสร้าง context ถาวร

เมื่อทำงานในโหมดนี้ `/context` จะแสดงข้อมูลรับรองที่มาจาก environment พร้อมป้ายกำกับ `(via env vars)`

## พฤติกรรมของ Context ก่อนหน้า

- **กำหนดขอบเขตเซสชัน**: context ก่อนหน้าจะรีเซ็ตเมื่อคุณรีสตาร์ท xcsh และไม่ถูกบันทึกลงดิสก์
- **Ping-pong**: `/context -` สองครั้งจะพาคุณกลับไปยังจุดเริ่มต้น
- **ปลอดภัยเมื่อมีการเปลี่ยนแปลง**: หากคุณลบ context ก่อนหน้า ตัวชี้จะถูกล้าง หากคุณเปลี่ยนชื่อ ตัวชี้จะติดตามชื่อใหม่
- **การเปิดใช้งานซ้ำไม่มีผล**: `/context production` เมื่ออยู่บน `production` อยู่แล้วจะไม่รีเซ็ตตัวชี้ก่อนหน้า

## แนวทางการออกแบบ

UX ของ `/context` ปฏิบัติตาม:

- **kubectx**: `kubectx <name>` สำหรับการสลับ, `kubectx -` สำหรับก่อนหน้า, `kubectx` เปล่าสำหรับการแสดงรายการ
- **kubectl**: `kubectl config use-context` สำหรับรูปแบบที่ชัดเจน
- **Shell**: `cd -` / `OLDPWD` สำหรับการติดตาม previous-directory
