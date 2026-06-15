---
title: การกำหนดค่าโมเดลและผู้ให้บริการ
description: >-
  รีจิสทรีโมเดลและการกำหนดค่าผู้ให้บริการผ่าน models.yml พร้อมการกำหนดเส้นทาง
  การสำรอง และราคา
sidebar:
  order: 1
  label: โมเดลและผู้ให้บริการ
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# การกำหนดค่าโมเดลและผู้ให้บริการ (`models.yml`)

เอกสารนี้อธิบายว่า coding-agent โหลดโมเดลอย่างไร ใช้การแทนที่อย่างไร แก้ไขข้อมูลรับรองอย่างไร และเลือกโมเดลในขณะรันไทม์อย่างไร

## สิ่งที่ควบคุมพฤติกรรมของโมเดล

ไฟล์การนำไปใช้งานหลัก:

- `src/config/model-registry.ts` — โหลดโมเดลในตัว + โมเดลที่กำหนดเอง, การแทนที่ผู้ให้บริการ, การค้นพบขณะรันไทม์, การรวมการตรวจสอบสิทธิ์
- `src/config/model-resolver.ts` — แยกวิเคราะห์รูปแบบโมเดลและเลือกโมเดล initial/smol/slow
- `src/config/settings-schema.ts` — การตั้งค่าที่เกี่ยวข้องกับโมเดล (`modelRoles`, ค่ากำหนดการส่งของผู้ให้บริการ)
- `src/session/auth-storage.ts` — ลำดับการแก้ไข API key + OAuth
- `packages/ai/src/models.ts` และ `packages/ai/src/types.ts` — ผู้ให้บริการ/โมเดลในตัว และประเภท `Model`/`compat`

## ตำแหน่งไฟล์กำหนดค่าและพฤติกรรมเดิม

เส้นทางกำหนดค่าเริ่มต้น:

- `~/.xcsh/agent/models.yml`

พฤติกรรมเดิมที่ยังมีอยู่:

- หาก `models.yml` ไม่มีอยู่และ `models.json` มีอยู่ในตำแหน่งเดียวกัน ไฟล์จะถูกย้ายไปเป็น `models.yml`
- เส้นทางกำหนดค่า `.json` / `.jsonc` ที่ระบุอย่างชัดเจนยังคงรองรับเมื่อส่งผ่านทางโปรแกรมไปยัง `ModelRegistry`

## โครงสร้าง `models.yml`

```yaml
configVersion: 1  # optional — written by auto-config, used for migration detection
providers:
  <provider-id>:
    # provider-level config
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` คือจำนวนเต็มเสริมที่เขียนโดยระบบกำหนดค่าอัตโนมัติ เมื่อมีอยู่ xcsh จะใช้เพื่อตรวจจับการกำหนดค่าที่ล้าสมัยและอัปเกรดโดยอัตโนมัติ

`provider-id` คือคีย์ผู้ให้บริการตามแบบแผนที่ใช้ทั่วทั้งการเลือกและการค้นหาการตรวจสอบสิทธิ์

`equivalence` เป็นค่าเสริมและกำหนดค่าการจัดกลุ่มโมเดลตามแบบแผนบนโมเดลผู้ให้บริการที่เป็นรูปธรรม:

- `overrides` แมปตัวเลือกที่เป็นรูปธรรมแบบแน่นอน (`provider/modelId`) ไปยัง id ตามแบบแผนอย่างเป็นทางการ
- `exclude` ยกเว้นตัวเลือกที่เป็นรูปธรรมออกจากการจัดกลุ่มตามแบบแผน

## ฟิลด์ระดับผู้ให้บริการ

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-completions
    headers:
      X-Team: platform
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      some-model-id:
        name: Renamed model
    models:
      - id: some-model-id
        name: Some Model
        api: openai-completions
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 128000
        maxTokens: 16384
        headers:
          X-Model: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [anthropic, openai]
          extraBody:
            gateway: m1-01
            controller: mlx
```

### ค่า `api` ที่อนุญาตสำหรับผู้ให้บริการ/โมเดล

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### ค่า auth/discovery ที่อนุญาต

- `auth`: `apiKey` (ค่าเริ่มต้น) หรือ `none`
- `discovery.type`: `ollama`

## กฎการตรวจสอบความถูกต้อง (ปัจจุบัน)

### ผู้ให้บริการที่กำหนดเองอย่างสมบูรณ์ (`models` ไม่ว่างเปล่า)

จำเป็นต้องมี:

- `baseUrl`
- `apiKey` ยกเว้นเมื่อ `auth: none`
- `api` ที่ระดับผู้ให้บริการหรือในแต่ละโมเดล

### ผู้ให้บริการที่แทนที่เท่านั้น (`models` หายไปหรือว่างเปล่า)

ต้องกำหนดอย่างน้อยหนึ่งอย่างในนี้:

- `baseUrl`
- `modelOverrides`
- `discovery`

### การค้นพบ

- `discovery` ต้องการ `api` ระดับผู้ให้บริการ

### การตรวจสอบค่าโมเดล

- `id` จำเป็นต้องมี
- `contextWindow` และ `maxTokens` ต้องเป็นค่าบวกหากระบุไว้

## ลำดับการรวมและการแทนที่

ไปป์ไลน์ ModelRegistry (เมื่อรีเฟรช):

1. โหลดผู้ให้บริการ/โมเดลในตัวจาก `@f5xc-salesdemos/pi-ai`
2. โหลดการกำหนดค่าที่กำหนดเองจาก `models.yml`
3. ใช้การแทนที่ผู้ให้บริการ (`baseUrl`, `headers`) กับโมเดลในตัว
4. ใช้ `modelOverrides` (ต่อผู้ให้บริการ + model id)
5. รวม `models` ที่กำหนดเอง:
   - `provider + id` เดียวกันจะแทนที่ที่มีอยู่
   - มิฉะนั้นจะต่อท้าย
6. ใช้โมเดลที่ค้นพบขณะรันไทม์ (ปัจจุบันคือ Ollama และ LM Studio) จากนั้นใช้การแทนที่โมเดลซ้ำ

## ความเทียบเท่าของโมเดลตามแบบแผนและการรวม

รีจิสทรีเก็บโมเดลผู้ให้บริการที่เป็นรูปธรรมทุกโมเดล จากนั้นสร้างชั้นตามแบบแผนอยู่เหนือโมเดลเหล่านั้น

Canonical id คือ id อย่างเป็นทางการจาก upstream เท่านั้น ตัวอย่างเช่น:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### การกำหนดค่าความเทียบเท่าใน `models.yml`

ตัวอย่าง:

```yaml
providers:
  zenmux:
    baseUrl: https://api.zenmux.example/v1
    apiKey: ZENMUX_API_KEY
    api: openai-codex-responses
    models:
      - id: codex
        name: Zenmux Codex
        reasoning: true
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 200000
        maxTokens: 32768

equivalence:
  overrides:
    zenmux/codex: gpt-5.3-codex
    p-codex/codex: gpt-5.3-codex
  exclude:
    - demo/codex-preview
```

ลำดับการสร้างสำหรับการจัดกลุ่มตามแบบแผน:

1. การแทนที่ของผู้ใช้แบบแน่นอนจาก `equivalence.overrides`
2. การจับคู่ official-id ที่รวมอยู่จากข้อมูลเมตาโมเดลในตัว
3. การทำให้เป็นมาตรฐานด้วยฮิวริสติกเชิงอนุรักษ์สำหรับตัวแปร gateway/provider
4. ใช้ id ของโมเดลที่เป็นรูปธรรมเองเป็นค่าสำรอง

ฮิวริสติกปัจจุบันแคบโดยเจตนา:

- คำนำหน้า upstream ที่ฝังอยู่สามารถตัดออกได้เมื่อมีอยู่ เช่น `anthropic/...` หรือ `openai/...`
- ตัวแปรเวอร์ชันที่มีจุดและขีดกลางสามารถทำให้เป็นมาตรฐานได้เฉพาะเมื่อแมปกับ official id ที่มีอยู่ เช่น `4.6 -> 4-6`
- ตระกูลหรือเวอร์ชันที่คลุมเครือจะไม่ถูกรวมโดยไม่มีการจับคู่ที่รวมอยู่หรือการแทนที่อย่างชัดเจน

### พฤติกรรมการแก้ไขตามแบบแผน

เมื่อตัวแปรที่เป็นรูปธรรมหลายตัวแชร์ canonical id การแก้ไขจะใช้:

1. ความพร้อมใช้งานและการตรวจสอบสิทธิ์
2. `modelProviderOrder` ใน `config.yml`
3. ลำดับรีจิสทรี/ผู้ให้บริการที่มีอยู่หาก `modelProviderOrder` ไม่ได้ตั้งค่าไว้

ผู้ให้บริการที่ปิดใช้งานหรือไม่ได้รับการตรวจสอบสิทธิ์จะถูกข้าม

สถานะเซสชันและบันทึกการสนทนายังคงบันทึกผู้ให้บริการ/โมเดลที่เป็นรูปธรรมที่ดำเนินการเทิร์นจริง

ค่าเริ่มต้นผู้ให้บริการเทียบกับการแทนที่ต่อโมเดล:

- `headers` ของผู้ให้บริการเป็นพื้นฐาน
- `headers` ของโมเดลแทนที่คีย์ header ของผู้ให้บริการ
- `modelOverrides` สามารถแทนที่ข้อมูลเมตาของโมเดล (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)
- `compat` ถูกรวมแบบลึกสำหรับบล็อกการกำหนดเส้นทางที่ซ้อนกัน (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)

## การรวมการค้นพบขณะรันไทม์

### การค้นพบ Ollama โดยปริยาย

หากไม่ได้กำหนดค่า `ollama` อย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่ค้นพบได้โดยปริยาย:

- ผู้ให้บริการ: `ollama`
- api: `openai-completions`
- URL พื้นฐาน: `OLLAMA_BASE_URL` หรือ `http://127.0.0.1:11434`
- โหมดการตรวจสอบสิทธิ์: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบขณะรันไทม์เรียก `GET /api/tags` บน Ollama และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นในเครื่อง

### การค้นพบ llama.cpp โดยปริยาย

หากไม่ได้กำหนดค่า `llama.cpp` อย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่ค้นพบได้โดยปริยาย:
หมายเหตุ: ใช้ anthropic messages api ใหม่กว่าแทน openai-completions

- ผู้ให้บริการ: `llama.cpp`
- api: `openai-responses`
- URL พื้นฐาน: `LLAMA_CPP_BASE_URL` หรือ `http://127.0.0.1:8080`
- โหมดการตรวจสอบสิทธิ์: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบขณะรันไทม์เรียก `GET models` บน llama.cpp และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นในเครื่อง

### การค้นพบ LM Studio โดยปริยาย

หากไม่ได้กำหนดค่า `lm-studio` อย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่ค้นพบได้โดยปริยาย:

- ผู้ให้บริการ: `lm-studio`
- api: `openai-completions`
- URL พื้นฐาน: `LM_STUDIO_BASE_URL` หรือ `http://127.0.0.1:1234/v1`
- โหมดการตรวจสอบสิทธิ์: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบขณะรันไทม์ดึงโมเดล (`GET /models`) และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นในเครื่อง

### การค้นพบผู้ให้บริการอย่างชัดเจน

คุณสามารถกำหนดค่าการค้นพบด้วยตัวเอง:

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
      
  llama.cpp:
    baseUrl: http://127.0.0.1:8080
    api: openai-responses
    auth: none
    discovery:
      type: llama.cpp
```

### การลงทะเบียนผู้ให้บริการส่วนขยาย

ส่วนขยายสามารถลงทะเบียนผู้ให้บริการขณะรันไทม์ (`pi.registerProvider(...)`) ได้ รวมถึง:

- การแทนที่/ต่อท้ายโมเดลสำหรับผู้ให้บริการ
- การลงทะเบียน stream handler ที่กำหนดเองสำหรับ API ID ใหม่
- การลงทะเบียนผู้ให้บริการ OAuth ที่กำหนดเอง

## ลำดับการแก้ไข Auth และ API key

เมื่อขอคีย์สำหรับผู้ให้บริการ ลำดับที่มีผลบังคับใช้คือ:

1. การแทนที่ขณะรันไทม์ (CLI `--api-key`)
2. ข้อมูลรับรอง API key ที่เก็บไว้ใน `agent.db`
3. ข้อมูลรับรอง OAuth ที่เก็บไว้ใน `agent.db` (พร้อมการรีเฟรช)
4. การแมปตัวแปรสภาพแวดล้อม (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, เป็นต้น)
5. ตัวแก้ไขสำรอง ModelRegistry (ผู้ให้บริการ `apiKey` จาก `models.yml`, ความหมายของชื่อ env หรือค่าตัวอักษร)

พฤติกรรม `apiKey` ใน `models.yml`:

- ค่าจะถูกพิจารณาเป็นชื่อตัวแปรสภาพแวดล้อมก่อน
- หากไม่มีตัวแปร env สตริงตัวอักษรจะถูกใช้เป็น token

หาก `authHeader: true` และตั้งค่า `apiKey` ของผู้ให้บริการ โมเดลจะได้รับ:

- header `Authorization: Bearer <resolved-key>` ที่แทรกเข้าไป

ผู้ให้บริการที่ไม่ต้องใช้คีย์:

- ผู้ให้บริการที่ทำเครื่องหมาย `auth: none` ถือว่าพร้อมใช้งานโดยไม่ต้องมีข้อมูลรับรอง
- `getApiKey*` ส่งคืน `kNoAuth` สำหรับผู้ให้บริการเหล่านั้น

## ความพร้อมใช้งานของโมเดลเทียบกับโมเดลทั้งหมด

- `getAll()` ส่งคืนรีจิสทรีโมเดลที่โหลด (ในตัว + ที่กำหนดเองที่รวม + ที่ค้นพบ)
- `getAvailable()` กรองเฉพาะโมเดลที่ไม่ต้องใช้คีย์หรือมีการตรวจสอบสิทธิ์ที่แก้ไขได้

ดังนั้นโมเดลอาจมีอยู่ในรีจิสทรีแต่ไม่สามารถเลือกได้จนกว่าจะมีการตรวจสอบสิทธิ์

## การแก้ไขโมเดลขณะรันไทม์

### CLI และการแยกวิเคราะห์รูปแบบ

`model-resolver.ts` รองรับ:

- `provider/modelId` แบบแน่นอน
- canonical model id แบบแน่นอน
- model id แบบแน่นอน (ผู้ให้บริการถูกอนุมาน)
- การจับคู่แบบฟัซซี/ซับสตริง
- รูปแบบขอบเขต glob ใน `--models` (เช่น `openai/*`, `*sonnet*`)
- ส่วนต่อท้าย `:thinkingLevel` เสริม (`off|minimal|low|medium|high|xhigh`)

`--provider` เป็นรุ่นเดิม; `--model` เป็นที่แนะนำ

ลำดับความสำคัญของการแก้ไขสำหรับตัวเลือกแบบแน่นอน:

1. `provider/modelId` แบบแน่นอนจะข้ามการรวม
2. canonical id แบบแน่นอนแก้ไขผ่าน canonical index
3. bare concrete id แบบแน่นอนยังคงใช้งานได้
4. การจับคู่แบบฟัซซีและ glob ทำงานหลังจากเส้นทางแบบแน่นอน

### ลำดับความสำคัญในการเลือกโมเดลเริ่มต้น

`findInitialModel(...)` ใช้ลำดับนี้:

1. ผู้ให้บริการ+โมเดล CLI อย่างชัดเจน
2. โมเดลที่มีขอบเขตแรก (หากไม่ได้กำลังกลับมาทำต่อ)
3. ผู้ให้บริการ/โมเดลเริ่มต้นที่บันทึกไว้
4. ค่าเริ่มต้นผู้ให้บริการที่รู้จัก (เช่น OpenAI/Anthropic/เป็นต้น) ในโมเดลที่พร้อมใช้งาน
5. โมเดลแรกที่พร้อมใช้งาน

### นามแฝงบทบาทและการตั้งค่า

บทบาทโมเดลที่รองรับ:

- `default`, `smol`, `slow`, `plan`, `commit`

นามแฝงบทบาทเช่น `pi/smol` ขยายผ่าน `settings.modelRoles` ค่าบทบาทแต่ละอย่างยังสามารถเพิ่มตัวเลือก thinking เช่น `:minimal`, `:low`, `:medium`, หรือ `:high`

หากบทบาทชี้ไปยังบทบาทอื่น โมเดลเป้าหมายยังคงรับค่าตามปกติและส่วนต่อท้ายอย่างชัดเจนใดๆ บนบทบาทที่อ้างอิงจะชนะสำหรับการใช้งานเฉพาะบทบาทนั้น

การตั้งค่าที่เกี่ยวข้อง:

- `modelRoles` (record)
- `enabledModels` (รายการรูปแบบที่มีขอบเขต)
- `modelProviderOrder` (ลำดับความสำคัญ canonical-provider ทั่วโลก)
- `providers.kimiApiFormat` (รูปแบบคำขอ `openai` หรือ `anthropic`)
- `providers.openaiWebsockets` (ค่ากำหนด websocket `auto|off|on` สำหรับ OpenAI Codex transport)

`modelRoles` อาจเก็บ:

- `provider/modelId` เพื่อปักหมุดตัวแปรผู้ให้บริการที่เป็นรูปธรรม
- canonical id เช่น `gpt-5.3-codex` เพื่ออนุญาตการรวมผู้ให้บริการ

สำหรับ `enabledModels` และ CLI `--models`:

- canonical id แบบแน่นอนขยายไปยังตัวแปรที่เป็นรูปธรรมทั้งหมดในกลุ่ม canonical นั้น
- รายการ `provider/modelId` อย่างชัดเจนยังคงแน่นอน
- glob และการจับคู่แบบฟัซซียังคงทำงานบนโมเดลที่เป็นรูปธรรม

## `/model` และ `--list-models`

ทั้งสองพื้นผิวยังคงให้โมเดลที่มีคำนำหน้าผู้ให้บริการมองเห็นและเลือกได้

ปัจจุบันยังแสดงโมเดลตามแบบแผน/ที่รวมแล้ว:

- `/model` รวมมุมมองตามแบบแผนพร้อมกับแท็บผู้ให้บริการ
- `--list-models` พิมพ์ส่วนตามแบบแผนพร้อมกับแถวผู้ให้บริการที่เป็นรูปธรรม

การเลือกรายการตามแบบแผนจะเก็บตัวเลือกตามแบบแผน การเลือกแถวผู้ให้บริการจะเก็บ `provider/modelId` อย่างชัดเจน

## การโปรโมตบริบท (ห่วงโซ่สำรองระดับโมเดล)

การโปรโมตบริบทเป็นกลไกการกู้คืนจากการล้นสำหรับตัวแปรบริบทขนาดเล็ก (เช่น `*-spark`) ที่โปรโมตไปยังพี่น้องที่มีบริบทขนาดใหญ่กว่าโดยอัตโนมัติเมื่อ API ปฏิเสธคำขอด้วยข้อผิดพลาดความยาวบริบท

### ทริกเกอร์และลำดับ

เมื่อเทิร์นล้มเหลวด้วยข้อผิดพลาด context overflow (เช่น `context_length_exceeded`), `AgentSession` จะพยายามโปรโมต **ก่อน** ที่จะสำรองไปยังการบีบอัด:

1. หาก `contextPromotion.enabled` เป็น true ให้แก้ไขเป้าหมายการโปรโมต (ดูด้านล่าง)
2. หากพบเป้าหมาย ให้เปลี่ยนไปใช้และลองคำขออีกครั้ง — ไม่จำเป็นต้องบีบอัด
3. หากไม่มีเป้าหมาย ให้ผ่านไปยังการบีบอัดอัตโนมัติบนโมเดลปัจจุบัน

### การเลือกเป้าหมาย

การเลือกขับเคลื่อนด้วยโมเดล ไม่ใช่บทบาท:

1. `currentModel.contextPromotionTarget` (หากกำหนดค่าไว้)
2. โมเดลที่มีบริบทขนาดใหญ่กว่าที่เล็กที่สุดบนผู้ให้บริการ + API เดียวกัน

ผู้สมัครจะถูกละเว้นเว้นแต่ข้อมูลรับรองจะแก้ไขได้ (`ModelRegistry.getApiKey(...)`)

### การส่งต่อ websocket OpenAI Codex

หากเปลี่ยนจาก/ไปยัง `openai-codex-responses` คีย์สถานะผู้ให้บริการเซสชัน `openai-codex-responses` จะถูกปิดก่อนเปลี่ยนโมเดล ซึ่งจะทิ้งสถานะ websocket transport เพื่อให้เทิร์นถัดไปเริ่มต้นใหม่บนโมเดลที่ได้รับการโปรโมต

### พฤติกรรมการคงอยู่

การโปรโมตใช้การสลับชั่วคราว (`setModelTemporary`):

- บันทึกเป็น `model_change` ชั่วคราวในประวัติเซสชัน
- ไม่เขียนทับการแมปบทบาทที่บันทึกไว้

### การกำหนดค่าห่วงโซ่สำรองอย่างชัดเจน

กำหนดค่าสำรองโดยตรงในข้อมูลเมตาโมเดลผ่าน `contextPromotionTarget`

`contextPromotionTarget` รับ:

- `provider/model-id` (อย่างชัดเจน)
- `model-id` (แก้ไขภายในผู้ให้บริการปัจจุบัน)

ตัวอย่าง (`models.yml`) สำหรับ Spark -> non-Spark บนผู้ให้บริการเดียวกัน:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

ตัวสร้างโมเดลในตัวยังกำหนดสิ่งนี้โดยอัตโนมัติสำหรับโมเดล `*-spark` เมื่อมีโมเดลพื้นฐานบนผู้ให้บริการเดียวกัน

## ฟิลด์ความเข้ากันได้และการกำหนดเส้นทาง

`models.yml` รองรับ `compat` ชุดนี้:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` หรือ `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

ฟิลด์เหล่านี้ถูกใช้โดยตรรกะ transport ของ OpenAI-completions และรวมกับการตรวจจับอัตโนมัติตาม URL

## ตัวอย่างเชิงปฏิบัติ

### endpoint ที่เข้ากันได้กับ OpenAI ในเครื่อง (ไม่ต้องตรวจสอบสิทธิ์)

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (local)
```

### Proxy ที่โฮสต์ด้วยคีย์ที่อิงกับ env

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_API_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### แทนที่เส้นทางผู้ให้บริการในตัว + ข้อมูลเมตาโมเดล

```yaml
providers:
  openrouter:
    baseUrl: https://my-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp)
        compat:
          openRouterRouting:
            only: [anthropic]
```

## การกำหนดค่าอัตโนมัติของ LiteLLM proxy

เมื่อตั้งค่าตัวแปรสภาพแวดล้อมทั้ง `LITELLM_BASE_URL` และ `LITELLM_API_KEY` xcsh จะจัดการการกำหนดค่า `models.yml` สำหรับ LiteLLM proxy โดยอัตโนมัติ

### การสร้างอัตโนมัติครั้งแรก

หาก `models.yml` ไม่มีอยู่และตรวจพบตัวแปร env ของ LiteLLM xcsh จะสร้างโดยอัตโนมัติ:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

`config.yml` เริ่มต้นยังถูกสร้างขึ้นพร้อมการตั้งค่าผู้ให้บริการรูปภาพที่เหมาะสม

### การซ่อมแซมตัวเองเมื่อเริ่มต้น

เมื่อเริ่มต้นทุกครั้ง `startupHealthCheck()` ในรีจิสทรีโมเดลจะทำการตรวจสอบต่อไปนี้:

| เงื่อนไข | การดำเนินการ |
|-----------|--------|
| `models.yml` ไม่มีอยู่ | สร้างอัตโนมัติจากตัวแปร env |
| `models.yml` เสียหายหรืออ่านไม่ได้ | สำรองเป็น `.bak`, สร้างใหม่ |
| `baseUrl` ไม่ตรงกับ `LITELLM_BASE_URL` | สำรองเป็น `.bak`, สร้างใหม่ด้วย URL ใหม่ |
| `configVersion` หายไปหรือล้าสมัย | สำรองเป็น `.bak`, สร้างใหม่ด้วยเวอร์ชันปัจจุบัน |
| Config ปกติดี | ไม่มีการดำเนินการ |

การซ่อมแซมทั้งหมดสร้างไฟล์สำรอง `.bak` ก่อนเขียนทับ การดำเนินการทั้งหมด idempotent

### คำสั่ง CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### ตัวแปรสภาพแวดล้อมที่จำเป็น

| ตัวแปร | วัตถุประสงค์ |
|----------|---------|
| `LITELLM_BASE_URL` | URL ของ LiteLLM proxy (เช่น `https://your-proxy.example.com`) ต้องเริ่มต้นด้วย `http://` หรือ `https://` |
| `LITELLM_API_KEY` | API key สำหรับ proxy อ้างอิงด้วยชื่อในการกำหนดค่าที่สร้าง แก้ไขขณะรันไทม์ |

หากตัวแปรใดตัวแปรหนึ่งไม่ได้ตั้งค่า การกำหนดค่าอัตโนมัติจะถูกข้ามโดยไม่มีเสียง

### การกำหนดเวอร์ชัน Config

การกำหนดค่าที่สร้างจะรวมฟิลด์ `configVersion` เมื่อรูปแบบที่สร้างเปลี่ยนแปลงในรุ่นอนาคต xcsh จะตรวจจับการกำหนดค่าที่ล้าสมัยและอัปเกรดโดยอัตโนมัติ (พร้อมการสำรอง)

## ข้อควรระวังสำหรับผู้บริโภครุ่นเดิม

การกำหนดค่าโมเดลส่วนใหญ่ปัจจุบันไหลผ่าน `models.yml` ผ่าน `ModelRegistry`

เส้นทางเดิมที่น่าสังเกตยังคงอยู่: การแก้ไขการตรวจสอบสิทธิ์ Anthropic สำหรับ web-search ยังคงอ่าน `~/.xcsh/agent/models.json` โดยตรงใน `src/web/search/auth.ts`

หากคุณพึ่งพาเส้นทางเฉพาะนั้น โปรดคำนึงถึงความเข้ากันได้ของ JSON จนกว่าโมดูลนั้นจะได้รับการย้าย

## โหมดความล้มเหลว

หาก `models.yml` ล้มเหลวการตรวจสอบ schema หรือความถูกต้อง:

- หากตั้งค่า `LITELLM_BASE_URL` และ `LITELLM_API_KEY` การตรวจสอบความสมบูรณ์เมื่อเริ่มต้นจะพยายามซ่อมแซมอัตโนมัติ (สำรองไฟล์ที่เสียหาย, สร้างใหม่จากตัวแปร env) หากการซ่อมแซมสำเร็จ รีจิสทรีจะโหลดการกำหนดค่าที่แก้ไขใหม่
- หากการซ่อมแซมอัตโนมัติไม่สามารถทำได้ (ตัวแปร env ไม่ได้ตั้งค่า, ความล้มเหลวในการเขียน) รีจิสทรีจะดำเนินการต่อด้วยโมเดลในตัว
- ข้อผิดพลาดถูกเปิดเผยผ่าน `ModelRegistry.getError()` และแสดงใน UI/การแจ้งเตือน
