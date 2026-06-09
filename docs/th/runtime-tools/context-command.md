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

xcsh เชื่อมต่อกับ F5 Distributed Cloud ผ่าน **contexts** -- ชุดข้อมูลรับรองที่มีชื่อซึ่งผูก tenant URL, API token และ namespace เข้าด้วยกัน หากคุณเคยใช้ `kubectl config use-context` หรือ `kubectx` ขั้นตอนการทำงานจะเหมือนกัน: สร้าง context, สลับระหว่าง context ด้วยชื่อ และใช้ `-` เพื่อสลับกลับ

## เริ่มต้นใช้งาน

### 1. สร้าง context แรกของคุณ

คุณต้องมีสามสิ่งจากคอนโซล F5 XC ของคุณ: tenant URL, API token และ namespace (ไม่จำเป็น)

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

หรือใช้ wizard แบบมีคำแนะนำหากคุณต้องการการแจ้งเตือนทีละขั้นตอน:

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

เมื่อเปิดใช้งานแล้ว xcsh จะฉีดข้อมูลรับรองของ tenant เข้าสู่เซสชันของคุณ ตอนนี้ agent สามารถเรียก F5 XC API ได้ และบรรทัดสถานะจะแสดง context ที่ใช้งานอยู่

### 3. เพิ่ม context เพิ่มเติมและสลับระหว่าง context

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

สลับด้วยชื่อ -- ไม่จำเป็นต้องใช้ subcommand verb:

```
/context staging
```

สลับกลับไปยัง context ก่อนหน้า (สไตล์ `cd -`):

```
/context -
```

การเรียก `/context -` สองครั้งจะพาคุณกลับไปยังจุดเริ่มต้น

### 4. ดูว่าคุณมีอะไรบ้าง

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

เครื่องหมาย `*` ระบุ context ที่ใช้งานอยู่

## คำสั่งที่ใช้บ่อย

| คำสั่ง | หน้าที่ |
|---|---|
| `/context` | แสดงรายการ context ทั้งหมด |
| `/context <name>` | สลับไปยัง context ที่ระบุ |
| `/context -` | สลับไปยัง context ก่อนหน้า |
| `/context show` | แสดงรายละเอียด context ที่ใช้งานอยู่ (token ถูกซ่อน) |
| `/context status` | แสดงสถานะการยืนยันตัวตนปัจจุบัน |

## วงจรชีวิตของ Context

| คำสั่ง | หน้าที่ |
|---|---|
| `/context create <name> <url> <token> [namespace]` | สร้าง context |
| `/context delete <name> --confirm` | ลบ context (ต้องใช้ `--confirm`) |
| `/context rename <old> <new>` | เปลี่ยนชื่อ context |
| `/context validate <name>` | ทดสอบข้อมูลรับรองโดยไม่สลับ context |
| `/context export [name] [--include-token]` | ส่งออกเป็น JSON (token ถูกซ่อนโดยค่าเริ่มต้น) |
| `/context import <path-or-json> [--overwrite]` | นำเข้าจากไฟล์หรือ JSON แบบ inline |
| `/context wizard` | การตั้งค่าแบบโต้ตอบพร้อมคำแนะนำ |

## การสลับ namespace

แต่ละ context มี namespace เริ่มต้น สลับได้โดยไม่ต้องเปลี่ยน context:

```
/context namespace system
```

การเติมข้อความอัตโนมัติด้วย Tab จะแสดงชื่อ namespace จาก tenant ที่ใช้งานอยู่

## ตัวแปรสภาพแวดล้อมบน context

Context สามารถบรรจุตัวแปรสภาพแวดล้อมเพิ่มเติมที่จะถูกฉีดเข้าสู่เซสชันของคุณเมื่อเปิดใช้งาน มีประโยชน์สำหรับการกำหนดค่าแบบรายผู้ใช้บริการ (per-tenant) ที่ไม่ได้เป็นส่วนหนึ่งของชุดข้อมูลรับรอง

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

นามแฝง: `add` = `set`, `remove`/`clear` = `unset`

## การเติมข้อความอัตโนมัติด้วย Tab

พิมพ์ `/context ` แล้วกด Tab รายการดรอปดาวน์จะแสดง:

1. **ชื่อ context** -- พร้อมคำแนะนำ tenant URL เพื่อให้คุณแยกแยะ tenant ต่างๆ ได้
2. **`-`** -- ปรากฏเมื่อคุณเคยสลับมาก่อน แสดงว่าคุณจะสลับไปยัง context ใด
3. **Subcommands** -- `list`, `create`, `delete` เป็นต้น

ชื่อ context จะปรากฏก่อนเพราะการสลับเป็นการดำเนินการที่พบบ่อยที่สุด

การเติมข้อความอัตโนมัติระดับ subcommand ก็ทำงานได้เช่นกัน: `/context activate <Tab>` เติมชื่อ context, `/context namespace <Tab>` เติมชื่อ namespace, `/context unset <Tab>` เติมคีย์ตัวแปรสภาพแวดล้อมที่รู้จัก

## กฎการตั้งชื่อ

ชื่อ context ต้องมี 1-64 ตัวอักษร: ตัวอักษร, ตัวเลข, ขีดกลาง, ขีดล่าง

ชื่อที่ซ้ำกับ subcommand จะถูกปฏิเสธ:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

ชุดชื่อที่สงวนทั้งหมด: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help` การเปรียบเทียบไม่คำนึงถึงตัวพิมพ์ใหญ่-เล็ก

## การแทนที่ด้วยตัวแปรสภาพแวดล้อม

หาก `F5XC_API_URL` และ `F5XC_API_TOKEN` ถูกตั้งค่าในสภาพแวดล้อม shell ของคุณก่อนเปิด xcsh ค่าเหล่านั้นจะมีความสำคัญเหนือกว่า context ใดๆ ซึ่งมีประโยชน์สำหรับ CI/CD pipelines หรือเซสชันครั้งเดียวที่คุณไม่ต้องการสร้าง context แบบถาวร

เมื่อทำงานในโหมดนี้ `/context` จะแสดงข้อมูลรับรองที่มาจากสภาพแวดล้อมพร้อมป้ายกำกับ `(via env vars)`

## พฤติกรรม context ก่อนหน้า

- **ขอบเขตเซสชัน**: context ก่อนหน้าจะรีเซ็ตเมื่อคุณรีสตาร์ท xcsh ไม่ถูกบันทึกลงดิสก์
- **สลับไปมา**: `/context -` สองครั้งจะพาคุณกลับไปยังจุดเริ่มต้น
- **ปลอดภัยข้ามการเปลี่ยนแปลง**: หากคุณลบ context ก่อนหน้า ตัวชี้จะถูกล้าง หากคุณเปลี่ยนชื่อ ตัวชี้จะติดตามชื่อใหม่
- **การเปิดใช้งานซ้ำไม่มีผล**: `/context production` เมื่ออยู่บน `production` อยู่แล้วจะไม่รีเซ็ตตัวชี้ก่อนหน้า

## หลักการออกแบบ

UX ของ `/context` ดำเนินตาม:

- **kubectx**: `kubectx <name>` สำหรับการสลับ, `kubectx -` สำหรับ context ก่อนหน้า, `kubectx` เปล่าสำหรับแสดงรายการ
- **kubectl**: `kubectl config use-context` สำหรับรูปแบบแบบชัดเจน
- **Shell**: `cd -` / `OLDPWD` สำหรับการติดตามไดเรกทอรีก่อนหน้า
