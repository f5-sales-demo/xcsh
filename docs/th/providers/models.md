---
title: Model and Provider Configuration
description: >-
  Model registry and provider configuration via models.yml with routing,
  fallback, and pricing.
sidebar:
  order: 1
  label: Models & providers
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# การกำหนดค่าโมเดลและผู้ให้บริการ (`models.yml`)

เอกสารนี้อธิบายวิธีที่ coding-agent โหลดโมเดล ใช้การแทนที่ ค้นหาข้อมูลรับรอง และเลือกโมเดลในระหว่างรันไทม์

## สิ่งที่ควบคุมพฤติกรรมของโมเดล

ไฟล์การทำงานหลัก:

- `src/config/model-registry.ts` — โหลดโมเดลในตัว + โมเดลกำหนดเอง, การแทนที่ผู้ให้บริการ, การค้นหารันไทม์, การรวมระบบยืนยันตัวตน
- `src/config/model-resolver.ts` — แยกวิเคราะห์รูปแบบโมเดลและเลือกโมเดล initial/smol/slow
- `src/config/settings-schema.ts` — การตั้งค่าที่เกี่ยวกับโมเดล (`modelRoles`, ค่ากำหนด transport ของผู้ให้บริการ)
- `src/session/auth-storage.ts` — ลำดับการค้นหา API key + OAuth
- `packages/ai/src/models.ts` และ `packages/ai/src/types.ts` — ผู้ให้บริการ/โมเดลในตัว และชนิดข้อมูล `Model`/`compat`

## ตำแหน่งไฟล์กำหนดค่าและพฤติกรรมแบบเก่า

เส้นทางกำหนดค่าเริ่มต้น:

- `~/.xcsh/agent/models.yml`

พฤติกรรมแบบเก่าที่ยังคงมีอยู่:

- หาก `models.yml` ไม่มีอยู่และ `models.json` มีอยู่ในตำแหน่งเดียวกัน จะถูกย้ายไปเป็น `models.yml`
- เส้นทางกำหนดค่าแบบ `.json` / `.jsonc` ที่ระบุอย่างชัดเจนยังคงรองรับเมื่อส่งผ่านโปรแกรมไปยัง `ModelRegistry`

## รูปแบบของ `models.yml`

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

`configVersion` เป็นจำนวนเต็มแบบตัวเลือกที่เขียนโดยระบบกำหนดค่าอัตโนมัติ เมื่อมีอยู่ xcsh ใช้ค่านี้เพื่อตรวจจับกำหนดค่าที่ล้าสมัยและอัปเกรดอัตโนมัติ

`provider-id` เป็นคีย์ผู้ให้บริการมาตรฐานที่ใช้ทั่วทั้งการเลือกและการค้นหายืนยันตัวตน

`equivalence` เป็นตัวเลือกและกำหนดค่าการจัดกลุ่มโมเดลมาตรฐานเหนือโมเดลผู้ให้บริการที่เป็นรูปธรรม:

- `overrides` จับคู่ตัวเลือกรูปธรรมที่แน่นอน (`provider/modelId`) กับ id มาตรฐานต้นทางอย่างเป็นทางการ
- `exclude` ยกเว้นตัวเลือกรูปธรรมออกจากการจัดกลุ่มมาตรฐาน

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

## กฎการตรวจสอบ (ปัจจุบัน)

### ผู้ให้บริการกำหนดเองแบบเต็ม (`models` ไม่ว่าง)

จำเป็น:

- `baseUrl`
- `apiKey` ยกเว้นกรณี `auth: none`
- `api` ที่ระดับผู้ให้บริการหรือแต่ละโมเดล

### ผู้ให้บริการแบบแทนที่เท่านั้น (`models` ไม่มีหรือว่าง)

ต้องกำหนดอย่างน้อยหนึ่งรายการจาก:

- `baseUrl`
- `modelOverrides`
- `discovery`

### การค้นหา

- `discovery` ต้องการ `api` ระดับผู้ให้บริการ

### การตรวจสอบค่าโมเดล

- `id` จำเป็น
- `contextWindow` และ `maxTokens` ต้องเป็นค่าบวกหากระบุ

## ลำดับการรวมและแทนที่

ไปป์ไลน์ ModelRegistry (เมื่อรีเฟรช):

1. โหลดผู้ให้บริการ/โมเดลในตัวจาก `@f5xc-salesdemos/pi-ai`
2. โหลดกำหนดค่าที่กำหนดเองจาก `models.yml`
3. ใช้การแทนที่ผู้ให้บริการ (`baseUrl`, `headers`) กับโมเดลในตัว
4. ใช้ `modelOverrides` (ตามผู้ให้บริการ + model id)
5. รวมโมเดล `models` ที่กำหนดเอง:
   - `provider + id` เดียวกันจะแทนที่ที่มีอยู่
   - มิฉะนั้นจะเพิ่มเข้าไป
6. ใช้โมเดลที่ค้นพบรันไทม์ (ปัจจุบันคือ Ollama และ LM Studio) จากนั้นใช้ model overrides อีกครั้ง

## ความเทียบเท่าโมเดลมาตรฐานและการรวมกลุ่ม

รีจิสทรีเก็บทุกโมเดลผู้ให้บริการที่เป็นรูปธรรมแล้วสร้างชั้นมาตรฐานเหนือโมเดลเหล่านั้น

id มาตรฐานเป็น id ต้นทางอย่างเป็นทางการเท่านั้น ตัวอย่างเช่น:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### การกำหนดค่า equivalence ใน `models.yml`

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

ลำดับการสร้างสำหรับการจัดกลุ่มมาตรฐาน:

1. การแทนที่ที่แน่นอนของผู้ใช้จาก `equivalence.overrides`
2. การจับคู่ official-id ที่รวมมาจากเมตาดาต้าโมเดลในตัว
3. การทำให้เป็นมาตรฐานแบบฮิวริสติกแบบอนุรักษ์นิยมสำหรับตัวแปร gateway/ผู้ให้บริการ
4. ย้อนกลับไปยัง id ของโมเดลรูปธรรมเอง

ฮิวริสติกปัจจุบันถูกจำกัดอย่างตั้งใจ:

- คำนำหน้าต้นทางที่ฝังอยู่สามารถถูกตัดออกเมื่อมีอยู่ ตัวอย่างเช่น `anthropic/...` หรือ `openai/...`
- ตัวแปรเวอร์ชันแบบจุดและขีดสามารถทำให้เป็นมาตรฐานได้เฉพาะเมื่อจับคู่กับ official id ที่มีอยู่ ตัวอย่างเช่น `4.6 -> 4-6`
- ตระกูลหรือเวอร์ชันที่คลุมเครือจะไม่ถูกรวมโดยไม่มีการจับคู่ที่รวมมาหรือการแทนที่อย่างชัดเจน

### พฤติกรรมการค้นหามาตรฐาน

เมื่อตัวแปรรูปธรรมหลายตัวใช้ id มาตรฐานเดียวกัน การค้นหาใช้:

1. ความพร้อมใช้งานและการยืนยันตัวตน
2. `modelProviderOrder` ใน `config.yml`
3. ลำดับรีจิสทรี/ผู้ให้บริการที่มีอยู่หาก `modelProviderOrder` ไม่ได้ตั้งค่า

ผู้ให้บริการที่ปิดใช้งานหรือไม่ได้ยืนยันตัวตนจะถูกข้าม

สถานะเซสชันและบันทึกการสนทนายังคงบันทึกผู้ให้บริการ/โมเดลรูปธรรมที่ทำงานจริงในแต่ละเทิร์น

ค่าเริ่มต้นผู้ให้บริการเทียบกับการแทนที่ต่อโมเดล:

- `headers` ของผู้ให้บริการเป็นค่าพื้นฐาน
- `headers` ของโมเดลแทนที่คีย์ header ของผู้ให้บริการ
- `modelOverrides` สามารถแทนที่เมตาดาต้าโมเดล (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)
- `compat` ถูก deep-merged สำหรับบล็อกการกำหนดเส้นทางแบบซ้อน (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)

## การรวมระบบค้นหารันไทม์

### การค้นหา Ollama โดยนัย

หาก `ollama` ไม่ได้กำหนดค่าอย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่ค้นหาได้โดยนัย:

- provider: `ollama`
- api: `openai-completions`
- base URL: `OLLAMA_BASE_URL` หรือ `http://127.0.0.1:11434`
- โหมดยืนยันตัวตน: ไม่ใช้คีย์ (พฤติกรรม `auth: none`)

การค้นหารันไทม์เรียก `GET /api/tags` บน Ollama และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นท้องถิ่น

### การค้นหา llama.cpp โดยนัย

หาก `llama.cpp` ไม่ได้กำหนดค่าอย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่ค้นหาได้โดยนัย:
หมายเหตุ: ใช้ antropic messages api ที่ใหม่กว่าแทน openai-completions

- provider: `llama.cpp`
- api: `openai-responses`
- base URL: `LLAMA_CPP_BASE_URL` หรือ `http://127.0.0.1:8080`
- โหมดยืนยันตัวตน: ไม่ใช้คีย์ (พฤติกรรม `auth: none`)

การค้นหารันไทม์เรียก `GET models` บน llama.cpp และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นท้องถิ่น

### การค้นหา LM Studio โดยนัย

หาก `lm-studio` ไม่ได้กำหนดค่าอย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่ค้นหาได้โดยนัย:

- provider: `lm-studio`
- api: `openai-completions`
- base URL: `LM_STUDIO_BASE_URL` หรือ `http://127.0.0.1:1234/v1`
- โหมดยืนยันตัวตน: ไม่ใช้คีย์ (พฤติกรรม `auth: none`)

การค้นหารันไทม์ดึงโมเดล (`GET /models`) และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นท้องถิ่น

### การค้นหาผู้ให้บริการอย่างชัดเจน

คุณสามารถกำหนดค่าการค้นหาด้วยตัวเอง:

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

### การลงทะเบียนผู้ให้บริการผ่านส่วนขยาย

ส่วนขยายสามารถลงทะเบียนผู้ให้บริการในรันไทม์ (`pi.registerProvider(...)`) รวมถึง:

- การแทนที่/เพิ่มโมเดลสำหรับผู้ให้บริการ
- การลงทะเบียน stream handler แบบกำหนดเองสำหรับ API ID ใหม่
- การลงทะเบียนผู้ให้บริการ OAuth แบบกำหนดเอง

## ลำดับการค้นหา Auth และ API key

เมื่อร้องขอคีย์สำหรับผู้ให้บริการ ลำดับที่มีผลคือ:

1. การแทนที่รันไทม์ (CLI `--api-key`)
2. ข้อมูลรับรอง API key ที่เก็บไว้ใน `agent.db`
3. ข้อมูลรับรอง OAuth ที่เก็บไว้ใน `agent.db` (พร้อมการรีเฟรช)
4. การจับคู่ตัวแปรสภาพแวดล้อม (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` เป็นต้น)
5. ตัวค้นหาสำรองของ ModelRegistry (`apiKey` ของผู้ให้บริการจาก `models.yml`, ความหมายแบบชื่อ-env-หรือ-ค่าตรงตัว)

พฤติกรรม `apiKey` ใน `models.yml`:

- ค่าจะถูกปฏิบัติเป็นชื่อตัวแปรสภาพแวดล้อมก่อน
- หากไม่มีตัวแปร env ค่าข้อความตรงตัวจะถูกใช้เป็นโทเค็น

หาก `authHeader: true` และ `apiKey` ของผู้ให้บริการถูกตั้งค่า โมเดลจะได้รับ:

- header `Authorization: Bearer <resolved-key>` ถูกฉีดเข้าไป

ผู้ให้บริการแบบไม่ใช้คีย์:

- ผู้ให้บริการที่ทำเครื่องหมาย `auth: none` จะถือว่าพร้อมใช้งานโดยไม่ต้องมีข้อมูลรับรอง
- `getApiKey*` ส่งคืน `kNoAuth` สำหรับผู้ให้บริการเหล่านี้

## ความพร้อมใช้งานของโมเดลเทียบกับโมเดลทั้งหมด

- `getAll()` ส่งคืนรีจิสทรีโมเดลที่โหลดแล้ว (ในตัว + กำหนดเองที่รวมแล้ว + ที่ค้นพบ)
- `getAvailable()` กรองเฉพาะโมเดลที่ไม่ใช้คีย์หรือมีการยืนยันตัวตนที่ค้นหาได้

ดังนั้นโมเดลสามารถมีอยู่ในรีจิสทรีแต่ไม่สามารถเลือกได้จนกว่าจะมีการยืนยันตัวตนพร้อมใช้งาน

## การค้นหาโมเดลรันไทม์

### CLI และการแยกวิเคราะห์รูปแบบ

`model-resolver.ts` รองรับ:

- `provider/modelId` ที่แน่นอน
- id โมเดลมาตรฐานที่แน่นอน
- id โมเดลที่แน่นอน (ผู้ให้บริการอนุมาน)
- การจับคู่แบบคลุมเครือ/สตริงย่อย
- รูปแบบขอบเขต glob ใน `--models` (เช่น `openai/*`, `*sonnet*`)
- ส่วนต่อท้าย `:thinkingLevel` ที่เป็นตัวเลือก (`off|minimal|low|medium|high|xhigh`)

`--provider` เป็นแบบเก่า; `--model` เป็นที่นิยม

ลำดับความสำคัญการค้นหาสำหรับตัวเลือกที่แน่นอน:

1. `provider/modelId` ที่แน่นอนข้ามการรวมกลุ่ม
2. id มาตรฐานที่แน่นอนค้นหาผ่านดัชนีมาตรฐาน
3. id รูปธรรมแบบเปล่าที่แน่นอนยังคงทำงานได้
4. การจับคู่แบบคลุมเครือและ glob ทำงานหลังเส้นทางที่แน่นอน

### ลำดับความสำคัญการเลือกโมเดลเริ่มต้น

`findInitialModel(...)` ใช้ลำดับนี้:

1. ผู้ให้บริการ+โมเดลจาก CLI ที่ระบุอย่างชัดเจน
2. โมเดลที่มีขอบเขตแรก (หากไม่ได้ดำเนินต่อ)
3. ผู้ให้บริการ/โมเดลเริ่มต้นที่บันทึกไว้
4. ค่าเริ่มต้นผู้ให้บริการที่รู้จัก (เช่น OpenAI/Anthropic/เป็นต้น) จากโมเดลที่พร้อมใช้งาน
5. โมเดลที่พร้อมใช้งานแรก

### นามแฝงบทบาทและการตั้งค่า

บทบาทโมเดลที่รองรับ:

- `default`, `smol`, `slow`, `plan`, `commit`

นามแฝงบทบาทเช่น `pi/smol` ขยายผ่าน `settings.modelRoles` ค่าบทบาทแต่ละค่าสามารถเพิ่มตัวเลือกการคิดเช่น `:minimal`, `:low`, `:medium`, หรือ `:high`

หากบทบาทชี้ไปยังบทบาทอื่น โมเดลเป้าหมายยังคงสืบทอดตามปกติและส่วนต่อท้ายที่ชัดเจนบนบทบาทที่อ้างอิงจะมีผลสำหรับการใช้งานเฉพาะบทบาทนั้น

การตั้งค่าที่เกี่ยวข้อง:

- `modelRoles` (record)
- `enabledModels` (รายการรูปแบบที่มีขอบเขต)
- `modelProviderOrder` (ลำดับความสำคัญผู้ให้บริการมาตรฐานระดับโลก)
- `providers.kimiApiFormat` (รูปแบบคำขอ `openai` หรือ `anthropic`)
- `providers.openaiWebsockets` (ค่ากำหนด websocket `auto|off|on` สำหรับ transport ของ OpenAI Codex)

`modelRoles` อาจเก็บได้ทั้ง:

- `provider/modelId` เพื่อระบุตัวแปรผู้ให้บริการรูปธรรม
- id มาตรฐานเช่น `gpt-5.3-codex` เพื่ออนุญาตการรวมกลุ่มผู้ให้บริการ

สำหรับ `enabledModels` และ CLI `--models`:

- id มาตรฐานที่แน่นอนขยายไปยังตัวแปรรูปธรรมทั้งหมดในกลุ่มมาตรฐานนั้น
- รายการ `provider/modelId` ที่ชัดเจนยังคงเป็นค่าที่แน่นอน
- glob และการจับคู่แบบคลุมเครือยังคงทำงานบนโมเดลรูปธรรม

## `/model` และ `--list-models`

ทั้งสองส่วนแสดงยังคงแสดงโมเดลที่มีคำนำหน้าผู้ให้บริการให้มองเห็นและเลือกได้

ตอนนี้ยังแสดงโมเดลมาตรฐาน/ที่รวมกลุ่มด้วย:

- `/model` รวมมุมมองมาตรฐานควบคู่กับแท็บผู้ให้บริการ
- `--list-models` พิมพ์ส่วนมาตรฐานบวกกับแถวผู้ให้บริการรูปธรรม

การเลือกรายการมาตรฐานจะเก็บตัวเลือกมาตรฐาน การเลือกแถวผู้ให้บริการจะเก็บ `provider/modelId` ที่ชัดเจน

## การเลื่อนระดับบริบท (ห่วงโซ่สำรองระดับโมเดล)

การเลื่อนระดับบริบทเป็นกลไกการกู้คืนจากการล้นสำหรับตัวแปรบริบทขนาดเล็ก (ตัวอย่างเช่น `*-spark`) ที่เลื่อนระดับอัตโนมัติไปยังตัวแปรพี่น้องที่มีบริบทขนาดใหญ่กว่าเมื่อ API ปฏิเสธคำขอด้วยข้อผิดพลาดความยาวบริบท

### ทริกเกอร์และลำดับ

เมื่อเทิร์นล้มเหลวด้วยข้อผิดพลาดการล้นบริบท (เช่น `context_length_exceeded`) `AgentSession` พยายามเลื่อนระดับ **ก่อน** ย้อนกลับไปยังการบีบอัด:

1. หาก `contextPromotion.enabled` เป็น true ให้ค้นหาเป้าหมายการเลื่อนระดับ (ดูด้านล่าง)
2. หากพบเป้าหมาย ให้เปลี่ยนไปใช้และลองคำขอใหม่ — ไม่ต้องบีบอัด
3. หากไม่มีเป้าหมาย ให้ผ่านไปยังการบีบอัดอัตโนมัติบนโมเดลปัจจุบัน

### การเลือกเป้าหมาย

การเลือกขับเคลื่อนด้วยโมเดล ไม่ใช่ด้วยบทบาท:

1. `currentModel.contextPromotionTarget` (หากกำหนดค่าไว้)
2. โมเดลที่มีบริบทใหญ่กว่าที่เล็กที่สุดบนผู้ให้บริการ + API เดียวกัน

ตัวเลือกจะถูกข้ามเว้นแต่ข้อมูลรับรองจะค้นหาได้ (`ModelRegistry.getApiKey(...)`)

### การส่งมอบ websocket ของ OpenAI Codex

หากเปลี่ยนจาก/ไปยัง `openai-codex-responses` คีย์สถานะผู้ให้บริการเซสชัน `openai-codex-responses` จะถูกปิดก่อนการเปลี่ยนโมเดล ซึ่งจะทิ้งสถานะ websocket transport เพื่อให้เทิร์นถัดไปเริ่มต้นใหม่บนโมเดลที่เลื่อนระดับ

### พฤติกรรมการคงอยู่

การเลื่อนระดับใช้การเปลี่ยนชั่วคราว (`setModelTemporary`):

- บันทึกเป็น `model_change` ชั่วคราวในประวัติเซสชัน
- ไม่เขียนทับการจับคู่บทบาทที่บันทึกไว้

### การกำหนดค่าห่วงโซ่สำรองอย่างชัดเจน

กำหนดค่าสำรองโดยตรงในเมตาดาต้าโมเดลผ่าน `contextPromotionTarget`

`contextPromotionTarget` ยอมรับได้ทั้ง:

- `provider/model-id` (ชัดเจน)
- `model-id` (ค้นหาภายในผู้ให้บริการปัจจุบัน)

ตัวอย่าง (`models.yml`) สำหรับ Spark -> ไม่ใช่ Spark บนผู้ให้บริการเดียวกัน:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

ตัวสร้างโมเดลในตัวยังกำหนดค่านี้โดยอัตโนมัติสำหรับโมเดล `*-spark` เมื่อมีโมเดลฐานของผู้ให้บริการเดียวกัน

## ฟิลด์ความเข้ากันได้และการกำหนดเส้นทาง

`models.yml` รองรับชุดย่อย `compat` นี้:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` หรือ `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

สิ่งเหล่านี้ถูกใช้โดยตรรกะ transport ของ OpenAI-completions และรวมกับการตรวจจับอัตโนมัติตาม URL

## ตัวอย่างการใช้งานจริง

### endpoint ที่เข้ากันได้กับ OpenAI ในเครื่อง (ไม่มี auth)

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

### พร็อกซีที่โฮสต์พร้อมคีย์จากตัวแปรสภาพแวดล้อม

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

### แทนที่เส้นทางผู้ให้บริการในตัว + เมตาดาต้าโมเดล

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

## การกำหนดค่าอัตโนมัติของพร็อกซี LiteLLM

เมื่อตั้งค่าตัวแปรสภาพแวดล้อม `LITELLM_BASE_URL` และ `LITELLM_API_KEY` ทั้งคู่แล้ว xcsh จะจัดการกำหนดค่า `models.yml` สำหรับพร็อกซี LiteLLM โดยอัตโนมัติ

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

`config.yml` เริ่มต้นจะถูกสร้างด้วยเช่นกันพร้อมการตั้งค่าผู้ให้บริการรูปภาพที่เหมาะสม

### การซ่อมแซมตัวเองเมื่อเริ่มต้น

ทุกครั้งที่เริ่มต้น `startupHealthCheck()` ในรีจิสทรีโมเดลจะรันการตรวจสอบต่อไปนี้:

| เงื่อนไข | การดำเนินการ |
|-----------|--------|
| `models.yml` ไม่มี | สร้างอัตโนมัติจากตัวแปร env |
| `models.yml` เสียหายหรือแยกวิเคราะห์ไม่ได้ | สำรองเป็น `.bak` สร้างใหม่ |
| `baseUrl` ไม่ตรงกับ `LITELLM_BASE_URL` | สำรองเป็น `.bak` สร้างใหม่ด้วย URL ใหม่ |
| `configVersion` ไม่มีหรือล้าสมัย | สำรองเป็น `.bak` สร้างใหม่ด้วยเวอร์ชันปัจจุบัน |
| กำหนดค่าปกติ | ไม่มีการดำเนินการ |

การซ่อมแซมทั้งหมดสร้างสำรอง `.bak` ก่อนเขียนทับ การดำเนินการทั้งหมดเป็น idempotent

### คำสั่ง CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### ตัวแปรสภาพแวดล้อมที่จำเป็น

| ตัวแปร | วัตถุประสงค์ |
|----------|---------|
| `LITELLM_BASE_URL` | URL ของพร็อกซี LiteLLM (เช่น `https://your-proxy.example.com`) ต้องเริ่มต้นด้วย `http://` หรือ `https://` |
| `LITELLM_API_KEY` | API key สำหรับพร็อกซี อ้างอิงตามชื่อในกำหนดค่าที่สร้าง ค้นหาในรันไทม์ |

หากตัวแปรใดตัวหนึ่งไม่ได้ตั้งค่า การกำหนดค่าอัตโนมัติจะถูกข้ามอย่างเงียบ ๆ

### การจัดการเวอร์ชันกำหนดค่า

กำหนดค่าที่สร้างจะมีฟิลด์ `configVersion` เมื่อรูปแบบที่สร้างเปลี่ยนแปลงในรุ่นอนาคต xcsh จะตรวจจับกำหนดค่าที่ล้าสมัยและอัปเกรดอัตโนมัติ (พร้อมสำรอง)

## ข้อควรระวังสำหรับผู้ใช้ระบบเก่า

การกำหนดค่าโมเดลส่วนใหญ่ตอนนี้ไหลผ่าน `models.yml` ผ่าน `ModelRegistry`

มีเส้นทางแบบเก่าที่ยังคงเหลืออยู่หนึ่งเส้นทาง: การค้นหา auth ของ Anthropic สำหรับการค้นหาเว็บยังคงอ่าน `~/.xcsh/agent/models.json` โดยตรงใน `src/web/search/auth.ts`

หากคุณพึ่งพาเส้นทางเฉพาะนั้น โปรดคำนึงถึงความเข้ากันได้ของ JSON จนกว่าโมดูลนั้นจะถูกย้าย

## โหมดความล้มเหลว

หาก `models.yml` ล้มเหลวในการตรวจสอบ schema หรือ validation:

- หากตั้งค่า `LITELLM_BASE_URL` และ `LITELLM_API_KEY` การตรวจสอบสุขภาพเมื่อเริ่มต้นจะพยายามซ่อมแซมอัตโนมัติ (สำรองไฟล์เสียหาย สร้างใหม่จากตัวแปร env) หากการซ่อมแซมสำเร็จ รีจิสทรีจะโหลดกำหนดค่าที่แก้ไขแล้วใหม่
- หากการซ่อมแซมอัตโนมัติไม่สามารถทำได้ (ตัวแปร env ไม่ได้ตั้งค่า การเขียนล้มเหลว) รีจิสทรีจะยังคงทำงานด้วยโมเดลในตัว
- ข้อผิดพลาดจะถูกเปิดเผยผ่าน `ModelRegistry.getError()` และแสดงใน UI/การแจ้งเตือน
