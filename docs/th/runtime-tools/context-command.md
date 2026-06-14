---
title: F5 XC Contexts
description: >-
  เชื่อมต่อ xcsh กับ F5 Distributed Cloud tenants -- สร้าง สลับ และจัดการ
  authentication contexts
sidebar:
  order: 1
  label: F5 XC Contexts
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC Contexts

xcsh เชื่อมต่อกับ F5 Distributed Cloud ผ่าน **contexts** -- ชุดข้อมูลรับรองที่มีชื่อซึ่งผูก URL ของ tenant, API token และ namespace เข้าด้วยกัน หากคุณเคยใช้ `kubectl config use-context` หรือ `kubectx` มาก่อน ขั้นตอนการทำงานจะเหมือนกันทุกประการ: สร้าง context สลับระหว่าง context ด้วยชื่อ และใช้ `-` เพื่อสลับกลับ

## เริ่มต้นใช้งาน

### 1. สร้าง context แรกของคุณ

คุณต้องการข้อมูลสามอย่างจาก F5 XC คอนโซล ของคุณ ได้แก่ URL ของ tenant, API token และ namespace (ไม่บังคับ)

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

หรือใช้ตัวช่วยสร้างแบบมีคำแนะนำหากคุณต้องการแบบทีละขั้นตอน:

```
/context wizard
```

### 2. เปิดใช้งาน

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ F5XC_TENANT     acme                                         │
│ F5XC_API_URL    https://acme.console.ves.volterra.io         │
│ F5XC_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ F5XC_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

เมื่อเปิดใช้งานแล้ว xcsh จะนำข้อมูลรับรองของ tenant เข้าสู่เซสชันของคุณ agent สามารถเรียกใช้ F5 XC API ได้ และบรรทัดสถานะจะแสดง context ที่ใช้งานอยู่

### 3. เพิ่ม context เพิ่มเติมและสลับระหว่างกัน

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

สลับด้วยชื่อ -- ไม่จำเป็นต้องใช้คำกริยาคำสั่งย่อย:

```
/context staging
```

สลับกลับไปยัง context ก่อนหน้า (แบบเดียวกับ `cd -`):

```
/context -
```

การเรียก `/context -` สองครั้งจะพาคุณกลับไปจุดเริ่มต้น

### 4. ดูสิ่งที่คุณมี

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

เครื่องหมาย `*` ระบุ context ที่ใช้งานอยู่

## คำสั่งที่ใช้บ่อย

| คำสั่ง | สิ่งที่ทำ |
|---|---|
| `/context` | แสดงรายการ context ทั้งหมด |
| `/context <name>` | สลับไปยัง context |
| `/context -` | สลับไปยัง context ก่อนหน้า |
| `/context show` | แสดงรายละเอียด context ที่ใช้งานอยู่ (token จะถูกปิดบัง) |
| `/context status` | แสดงสถานะการยืนยันตัวตนปัจจุบัน |

## วงจรชีวิตของ Context

| คำสั่ง | สิ่งที่ทำ |
|---|---|
| `/context create <name> <url> <token> [namespace]` | สร้าง context |
| `/context delete <name> --confirm` | ลบ context (ต้องใช้ `--confirm`) |
| `/context rename <old> <new>` | เปลี่ยนชื่อ context |
| `/context validate <name>` | ทดสอบข้อมูลรับรองโดยไม่ต้องสลับ |
| `/context export [name] [--include-token]` | ส่งออกเป็น JSON (token จะถูกปิดบังโดยค่าเริ่มต้น) |
| `/context import <path-or-json> [--overwrite]` | นำเข้าจากไฟล์หรือ JSON แบบอินไลน์ |
| `/context wizard` | การตั้งค่าแบบมีคำแนะนำทีละขั้นตอน |

## การสลับ namespace

แต่ละ context มี namespace เริ่มต้น สลับได้โดยไม่ต้องเปลี่ยน context:

```
/context namespace system
```

การเติมข้อความอัตโนมัติด้วย Tab จะแสดงชื่อ namespace จาก tenant ที่ใช้งานอยู่

## ตัวแปรสภาพแวดล้อมบน Context

Context สามารถพกพาตัวแปรสภาพแวดล้อมเพิ่มเติมที่จะถูกนำเข้าสู่เซสชันของคุณเมื่อเปิดใช้งาน มีประโยชน์สำหรับการกำหนดค่าเฉพาะ tenant ที่ไม่ได้เป็นส่วนหนึ่งของชุดข้อมูลรับรอง

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

ชื่อแทน: `add` = `set`, `remove`/`clear` = `unset`

## การเติมข้อความอัตโนมัติด้วย Tab

พิมพ์ `/context ` แล้วกด Tab รายการดรอปดาวน์จะแสดง:

1. **ชื่อ Context** -- พร้อมคำแนะนำ URL ของ tenant เพื่อให้คุณแยกแยะ tenant ได้
2. **`-`** -- จะปรากฏขึ้นเมื่อคุณเคยสลับมาก่อน โดยแสดง context ที่คุณจะสลับไป
3. **คำสั่งย่อย** -- `list`, `create`, `delete` และอื่นๆ

ชื่อ context จะปรากฏก่อนเนื่องจากการสลับเป็นการกระทำที่พบบ่อยที่สุด

การเติมข้อความอัตโนมัติระดับคำสั่งย่อยก็ทำงานได้เช่นกัน: `/context activate <Tab>` จะเติมชื่อ context, `/context namespace <Tab>` จะเติม namespace, `/context unset <Tab>` จะเติมชื่อ key ของตัวแปรสภาพแวดล้อมที่รู้จัก

## กฎการตั้งชื่อ

ชื่อ context ต้องมี 1-64 ตัวอักษร: ตัวอักษร ตัวเลข ขีดกลาง และขีดล่าง

ชื่อที่ชนกับคำสั่งย่อยจะถูกปฏิเสธ:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

ชุดชื่อสงวนทั้งหมด: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help` การเปรียบเทียบไม่คำนึงถึงตัวพิมพ์เล็กและใหญ่

## การแทนที่ด้วยตัวแปรสภาพแวดล้อม

หาก `F5XC_API_URL` และ `F5XC_API_TOKEN` ถูกตั้งค่าในสภาพแวดล้อม shell ของคุณก่อนเปิด xcsh ค่าเหล่านี้จะมีความสำคัญเหนือกว่า context ใดๆ ซึ่งมีประโยชน์สำหรับ CI/CD pipeline หรือเซสชันครั้งเดียวที่คุณไม่ต้องการสร้าง context แบบถาวร

เมื่อทำงานในโหมดนี้ `/context` จะแสดงข้อมูลรับรองที่มาจากตัวแปรสภาพแวดล้อมพร้อมป้ายกำกับ `(via env vars)`

## พฤติกรรมของ context ก่อนหน้า

- **ขอบเขตเซสชัน**: context ก่อนหน้าจะรีเซ็ตเมื่อคุณรีสตาร์ท xcsh ไม่มีการบันทึกลงดิสก์
- **Ping-pong**: `/context -` สองครั้งจะพาคุณกลับไปจุดเริ่มต้น
- **ปลอดภัยเมื่อมีการเปลี่ยนแปลง**: หากคุณลบ context ก่อนหน้า ตัวชี้จะถูกล้าง หากคุณเปลี่ยนชื่อ ตัวชี้จะติดตามชื่อใหม่
- **การเปิดใช้งานซ้ำไม่มีผล**: `/context production` ขณะอยู่ที่ `production` อยู่แล้วจะไม่รีเซ็ตตัวชี้ context ก่อนหน้า

## หลักการออกแบบ

UX ของ `/context` ปฏิบัติตาม:

- **kubectx**: `kubectx <name>` สำหรับการสลับ, `kubectx -` สำหรับ context ก่อนหน้า, `kubectx` เพียงอย่างเดียวสำหรับการแสดงรายการ
- **kubectl**: `kubectl config use-context` สำหรับรูปแบบชัดเจน
- **Shell**: `cd -` / `OLDPWD` สำหรับการติดตาม directory ก่อนหน้า
