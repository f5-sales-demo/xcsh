---
title: F5 XC Contexts
description: >-
  เชื่อมต่อ xcsh กับ F5 Distributed Cloud tenants -- สร้าง สลับ
  และจัดการบริบทการยืนยันตัวตน
sidebar:
  order: 1
  label: F5 XC Contexts
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC Contexts

xcsh เชื่อมต่อกับ F5 Distributed Cloud ผ่าน **contexts** -- ชุดข้อมูลประจำตัวที่มีชื่อ ซึ่งผูก URL ของ tenant, API token และ namespace เข้าด้วยกัน หากคุณเคยใช้ `kubectl config use-context` หรือ `kubectx` มาก่อน การทำงานจะเหมือนกันทุกประการ: สร้าง context, สลับระหว่าง context ด้วยชื่อ และใช้ `-` เพื่อสลับกลับ

## เริ่มต้นใช้งาน

### 1. สร้าง context แรกของคุณ

คุณต้องการสิ่งสามอย่างจาก F5 XC คอนโซล ของคุณ: URL ของ tenant, API token และ namespace (ไม่บังคับ)

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

หรือใช้วิซาร์ดแบบมีคำแนะนำหากคุณต้องการขั้นตอนทีละขั้น:

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

เมื่อเปิดใช้งานแล้ว xcsh จะฉีดข้อมูลประจำตัวของ tenant เข้าสู่เซสชันของคุณ ตัวแทนสามารถเรียกใช้ F5 XC API ได้แล้ว และแถบสถานะจะแสดง context ที่ใช้งานอยู่

### 3. เพิ่ม context เพิ่มเติมและสลับระหว่างกัน

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

สลับด้วยชื่อ -- ไม่จำเป็นต้องใช้คำกริยาย่อย:

```
/context staging
```

สลับกลับไปยัง context ก่อนหน้า (แบบ `cd -`):

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

เครื่องหมาย `*` แสดง context ที่ใช้งานอยู่

## คำสั่งที่ใช้ประจำวัน

| คำสั่ง | การทำงาน |
|---|---|
| `/context` | แสดงรายการ context ทั้งหมด |
| `/context <name>` | สลับไปยัง context |
| `/context -` | สลับไปยัง context ก่อนหน้า |
| `/context show` | แสดงรายละเอียด context ที่ใช้งานอยู่ (ปิดบัง token) |
| `/context status` | แสดงสถานะการยืนยันตัวตนปัจจุบัน |

## วงจรชีวิตของ context

| คำสั่ง | การทำงาน |
|---|---|
| `/context create <name> <url> <token> [namespace]` | สร้าง context |
| `/context delete <name> --confirm` | ลบ context (ต้องใช้ `--confirm`) |
| `/context rename <old> <new>` | เปลี่ยนชื่อ context |
| `/context validate <name>` | ทดสอบข้อมูลประจำตัวโดยไม่สลับ context |
| `/context export [name] [--include-token]` | ส่งออกเป็น JSON (ปิดบัง token โดยค่าเริ่มต้น) |
| `/context import <path-or-json> [--overwrite]` | นำเข้าจากไฟล์หรือ JSON แบบอินไลน์ |
| `/context wizard` | การตั้งค่าแบบโต้ตอบพร้อมคำแนะนำ |

## การสลับ namespace

แต่ละ context มี namespace เริ่มต้น สลับ namespace โดยไม่เปลี่ยน context:

```
/context namespace system
```

การเติมอัตโนมัติด้วย Tab จะแสดงชื่อ namespace จาก tenant ที่ใช้งานอยู่

## ตัวแปรสภาพแวดล้อมใน context

Context สามารถเก็บตัวแปรสภาพแวดล้อมเพิ่มเติมที่จะถูกฉีดเข้าสู่เซสชันของคุณเมื่อเปิดใช้งาน มีประโยชน์สำหรับการกำหนดค่าเฉพาะ tenant ที่ไม่ได้เป็นส่วนหนึ่งของชุดข้อมูลประจำตัว

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

นามแฝง: `add` = `set`, `remove`/`clear` = `unset`

## การเติมอัตโนมัติด้วย Tab

พิมพ์ `/context ` แล้วกด Tab รายการดรอปดาวน์จะแสดง:

1. **ชื่อ context** -- พร้อมคำใบ้ URL ของ tenant เพื่อให้คุณแยกแยะ tenant ได้
2. **`-`** -- ปรากฏเมื่อคุณเคยสลับมาก่อน แสดง context ที่จะสลับไป
3. **คำสั่งย่อย** -- `list`, `create`, `delete` เป็นต้น

ชื่อ context ปรากฏก่อนเนื่องจากการสลับเป็นการกระทำที่พบบ่อยที่สุด

การเติมอัตโนมัติในระดับคำสั่งย่อยก็ใช้งานได้เช่นกัน: `/context activate <Tab>` เติมชื่อ context, `/context namespace <Tab>` เติม namespace, `/context unset <Tab>` เติมคีย์ตัวแปรสภาพแวดล้อมที่รู้จัก

## กฎการตั้งชื่อ

ชื่อ context ต้องมีความยาว 1-64 ตัวอักษร: ตัวอักษร, ตัวเลข, เครื่องหมายยัติภังค์, เครื่องหมายขีดล่าง

ชื่อที่ซ้ำกับคำสั่งย่อยจะถูกปฏิเสธ:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

ชุดคำสงวนทั้งหมด: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help` การเปรียบเทียบไม่คำนึงถึงตัวพิมพ์เล็กและใหญ่

## การแทนที่ด้วยตัวแปรสภาพแวดล้อม

หาก `F5XC_API_URL` และ `F5XC_API_TOKEN` ถูกตั้งค่าในสภาพแวดล้อม shell ของคุณก่อนเปิดใช้งาน xcsh ค่าเหล่านั้นจะมีความสำคัญเหนือกว่า context ใด ๆ ซึ่งมีประโยชน์สำหรับ CI/CD pipeline หรือเซสชันครั้งเดียวที่คุณไม่ต้องการสร้าง context ถาวร

เมื่อทำงานในโหมดนี้ `/context` จะแสดงข้อมูลประจำตัวที่มาจากสภาพแวดล้อมพร้อมป้ายกำกับ `(via env vars)`

## พฤติกรรมของ context ก่อนหน้า

- **ขอบเขตเซสชัน**: context ก่อนหน้าจะรีเซ็ตเมื่อคุณรีสตาร์ท xcsh ไม่มีการบันทึกลงดิสก์
- **Ping-pong**: `/context -` สองครั้งจะพาคุณกลับไปยังจุดเริ่มต้น
- **ปลอดภัยจากการเปลี่ยนแปลง**: หากคุณลบ context ก่อนหน้า ตัวชี้จะถูกล้าง หากคุณเปลี่ยนชื่อ ตัวชี้จะติดตามชื่อใหม่
- **การเปิดใช้งานซ้ำไม่มีผล**: `/context production` เมื่ออยู่บน `production` อยู่แล้วจะไม่รีเซ็ตตัวชี้ก่อนหน้า

## แบบแผนการออกแบบ

UX ของ `/context` เป็นไปตาม:

- **kubectx**: `kubectx <name>` สำหรับการสลับ, `kubectx -` สำหรับก่อนหน้า, `kubectx` เปล่า ๆ สำหรับการแสดงรายการ
- **kubectl**: `kubectl config use-context` สำหรับรูปแบบที่ชัดเจน
- **Shell**: `cd -` / `OLDPWD` สำหรับการติดตามไดเรกทอรีก่อนหน้า
