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

เอกสารนี้อธิบายวิธีที่ coding-agent โหลดโมเดล ใช้การแทนที่ค่า แก้ไขข้อมูลรับรอง และเลือกโมเดลในขณะรันไทม์

## สิ่งที่ควบคุมพฤติกรรมของโมเดล

ไฟล์การทำงานหลัก:

- `src/config/model-registry.ts` — โหลดโมเดลในตัว + โมเดลที่กำหนดเอง, การแทนที่ค่าผู้ให้บริการ, การค้นพบรันไทม์, การผสานรวมการยืนยันตัวตน
- `src/config/model-resolver.ts` — แยกวิเคราะห์รูปแบบโมเดลและเลือกโมเดล initial/smol/slow
- `src/config/settings-schema.ts` — การตั้งค่าที่เกี่ยวข้องกับโมเดล (`modelRoles`, การตั้งค่า transport ของผู้ให้บริการ)
- `src/session/auth-storage.ts` — ลำดับการแก้ไข API key + OAuth
- `packages/ai/src/models.ts` และ `packages/ai/src/types.ts` — ผู้ให้บริการ/โมเดลในตัว และประเภท `Model`/`compat`

## ตำแหน่งไฟล์ config และพฤติกรรมแบบเดิม

เส้นทาง config เริ่มต้น:

- `~/.xcsh/agent/models.yml`

พฤติกรรมแบบเดิมที่ยังคงมีอยู่:

- หาก `models.yml` หายไปและ `models.json` มีอยู่ในตำแหน่งเดียวกัน จะถูกย้ายไปเป็น `models.yml`
- เส้นทาง config แบบ `.json` / `.jsonc` ที่ระบุอย่างชัดเจนยังคงรองรับเมื่อส่งผ่านทางโปรแกรมไปยัง `ModelRegistry`

## โครงสร้างของ `models.yml`

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

`configVersion` เป็นจำนวนเต็มที่ไม่บังคับ เขียนโดยระบบ auto-config เมื่อมีอยู่ xcsh จะใช้เพื่อตรวจจับ config ที่ล้าสมัยและอัปเกรดโดยอัตโนมัติ

`provider-id` เป็นคีย์ผู้ให้บริการหลักที่ใช้ทั่วทั้งการเลือกและการค้นหาการยืนยันตัวตน

`equivalence` เป็นตัวเลือกเสริมและกำหนดค่าการจัดกลุ่มโมเดลหลักบนโมเดลผู้ให้บริการที่เป็นรูปธรรม:

- `overrides` แมปตัวเลือกรูปธรรมที่แน่นอน (`provider/modelId`) ไปยัง canonical id อย่างเป็นทางการจากต้นทาง
- `exclude` ยกเว้นตัวเลือกรูปธรรมออกจากการจัดกลุ่มหลัก

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

### ค่า `api` ของผู้ให้บริการ/โมเดลที่อนุญาต

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

### ผู้ให้บริการแบบกำหนดเองเต็มรูปแบบ (`models` ไม่ว่าง)

จำเป็นต้องมี:

- `baseUrl`
- `apiKey` เว้นแต่ `auth: none`
- `api` ที่ระดับผู้ให้บริการหรือแต่ละโมเดล

### ผู้ให้บริการแบบแทนที่ค่าเท่านั้น (`models` หายไปหรือว่าง)

ต้องกำหนดอย่างน้อยหนึ่งอย่างจาก:

- `baseUrl`
- `modelOverrides`
- `discovery`

### การค้นพบ

- `discovery` ต้องการ `api` ระดับผู้ให้บริการ

### การตรวจสอบค่าโมเดล

- `id` จำเป็นต้องมี
- `contextWindow` และ `maxTokens` ต้องเป็นค่าบวกถ้ามีการระบุ

## ลำดับการรวมและแทนที่ค่า

กระบวนการของ ModelRegistry (เมื่อรีเฟรช):

1. โหลดผู้ให้บริการ/โมเดลในตัวจาก `@f5xc-salesdemos/pi-ai`
2. โหลด config แบบกำหนดเองจาก `models.yml`
3. ใช้การแทนที่ค่าผู้ให้บริการ (`baseUrl`, `headers`) กับโมเดลในตัว
4. ใช้ `modelOverrides` (ต่อผู้ให้บริการ + model id)
5. รวมโมเดลที่กำหนดเอง `models`:
   - `provider + id` เดียวกันจะแทนที่ที่มีอยู่
   - มิฉะนั้นเพิ่มต่อท้าย
6. ใช้โมเดลที่ค้นพบขณะรันไทม์ (ปัจจุบันคือ Ollama และ LM Studio) จากนั้นใช้ model overrides ซ้ำอีกครั้ง

## ความเทียบเท่าของโมเดลหลักและการรวมกลุ่ม

Registry เก็บโมเดลผู้ให้บริการที่เป็นรูปธรรมทุกตัว จากนั้นสร้างเลเยอร์หลักไว้ด้านบน

Canonical id เป็น id อย่างเป็นทางการจากต้นทางเท่านั้น ตัวอย่างเช่น:

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

ลำดับการสร้างสำหรับการจัดกลุ่มหลัก:

1. การแทนที่ค่าจากผู้ใช้ที่แน่นอนจาก `equivalence.overrides`
2. การจับคู่ official-id ที่รวมมาจากเมตาดาต้าโมเดลในตัว
3. การทำให้เป็นมาตรฐานแบบอนุรักษ์สำหรับตัวแปร gateway/ผู้ให้บริการ
4. กลับไปใช้ id ของตัวโมเดลที่เป็นรูปธรรมเอง

ฮิวริสติกส์ปัจจุบันถูกจำกัดโดยเจตนา:

- คำนำหน้าต้นทางที่ฝังอยู่สามารถตัดออกได้เมื่อมี เช่น `anthropic/...` หรือ `openai/...`
- ตัวแปรเวอร์ชันแบบจุดและขีดสามารถทำให้เป็นมาตรฐานได้เฉพาะเมื่อแมปไปยัง official id ที่มีอยู่ เช่น `4.6 -> 4-6`
- ตระกูลหรือเวอร์ชันที่คลุมเครือจะไม่ถูกรวมโดยไม่มีการจับคู่ที่รวมมาหรือการแทนที่ค่าอย่างชัดเจน

### พฤติกรรมการแก้ไข canonical

เมื่อตัวแปรรูปธรรมหลายตัวใช้ canonical id เดียวกัน การแก้ไขจะใช้:

1. ความพร้อมใช้งานและการยืนยันตัวตน
2. `modelProviderOrder` ใน `config.yml`
3. ลำดับ registry/ผู้ให้บริการที่มีอยู่ถ้าไม่ได้ตั้ง `modelProviderOrder`

ผู้ให้บริการที่ถูกปิดใช้งานหรือไม่ได้ยืนยันตัวตนจะถูกข้ามไป

สถานะเซสชันและบันทึกยังคงบันทึกผู้ให้บริการ/โมเดลที่เป็นรูปธรรมที่ดำเนินการจริงในแต่ละเทิร์น

ค่าเริ่มต้นของผู้ให้บริการ vs การแทนที่ค่าต่อโมเดล:

- `headers` ของผู้ให้บริการเป็นค่าพื้นฐาน
- `headers` ของโมเดลแทนที่คีย์ header ของผู้ให้บริการ
- `modelOverrides` สามารถแทนที่เมตาดาต้าของโมเดล (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)
- `compat` ถูก deep-merge สำหรับบล็อก routing ที่ซ้อนกัน (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)

## การผสานรวมการค้นพบรันไทม์

### การค้นพบ Ollama โดยอัตโนมัติ

หากไม่ได้กำหนดค่า `ollama` อย่างชัดเจน registry จะเพิ่มผู้ให้บริการที่สามารถค้นพบได้โดยอัตโนมัติ:

- provider: `ollama`
- api: `openai-completions`
- base URL: `OLLAMA_BASE_URL` หรือ `http://127.0.0.1:11434`
- โหมดยืนยันตัวตน: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบรันไทม์เรียก `GET /api/tags` บน Ollama และสร้างรายการโมเดลด้วยค่าเริ่มต้นในเครื่อง

### การค้นพบ llama.cpp โดยอัตโนมัติ

หากไม่ได้กำหนดค่า `llama.cpp` อย่างชัดเจน registry จะเพิ่มผู้ให้บริการที่สามารถค้นพบได้โดยอัตโนมัติ:
หมายเหตุ: ใช้ anthropic messages api ที่ใหม่กว่าแทน openai-completions

- provider: `llama.cpp`
- api: `openai-responses`
- base URL: `LLAMA_CPP_BASE_URL` หรือ `http://127.0.0.1:8080`
- โหมดยืนยันตัวตน: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบรันไทม์เรียก `GET models` บน llama.cpp และสร้างรายการโมเดลด้วยค่าเริ่มต้นในเครื่อง

### การค้นพบ LM Studio โดยอัตโนมัติ

หากไม่ได้กำหนดค่า `lm-studio` อย่างชัดเจน registry จะเพิ่มผู้ให้บริการที่สามารถค้นพบได้โดยอัตโนมัติ:

- provider: `lm-studio`
- api: `openai-completions`
- base URL: `LM_STUDIO_BASE_URL` หรือ `http://127.0.0.1:1234/v1`
- โหมดยืนยันตัวตน: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบรันไทม์ดึงโมเดล (`GET /models`) และสร้างรายการโมเดลด้วยค่าเริ่มต้นในเครื่อง

### การค้นพบผู้ให้บริการอย่างชัดเจน

คุณสามารถกำหนดค่าการค้นพบด้วยตนเอง:

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

ส่วนขยายสามารถลงทะเบียนผู้ให้บริการในขณะรันไทม์ (`pi.registerProvider(...)`) รวมถึง:

- การแทนที่/เพิ่มโมเดลสำหรับผู้ให้บริการ
- การลงทะเบียน custom stream handler สำหรับ API ID ใหม่
- การลงทะเบียนผู้ให้บริการ OAuth แบบกำหนดเอง

## ลำดับการแก้ไข Auth และ API key

เมื่อร้องขอคีย์สำหรับผู้ให้บริการ ลำดับที่มีผลคือ:

1. การแทนที่ค่ารันไทม์ (CLI `--api-key`)
2. ข้อมูลรับรอง API key ที่เก็บไว้ใน `agent.db`
3. ข้อมูลรับรอง OAuth ที่เก็บไว้ใน `agent.db` (พร้อมการรีเฟรช)
4. การแมปตัวแปรสภาพแวดล้อม (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ฯลฯ)
5. ตัวแก้ไขสำรองของ ModelRegistry (`apiKey` ของผู้ให้บริการจาก `models.yml`, ความหมายแบบชื่อ env หรือค่าตรง)

พฤติกรรม `apiKey` ของ `models.yml`:

- ค่าจะถูกตีความเป็นชื่อตัวแปรสภาพแวดล้อมก่อน
- หากไม่มี env var ที่ตรงกัน สตริงที่ระบุจะถูกใช้เป็นโทเค็นโดยตรง

หาก `authHeader: true` และ `apiKey` ของผู้ให้บริการถูกตั้งค่า โมเดลจะได้รับ:

- header `Authorization: Bearer <resolved-key>` ที่ถูกแทรกเข้าไป

ผู้ให้บริการที่ไม่ต้องใช้คีย์:

- ผู้ให้บริการที่ทำเครื่องหมาย `auth: none` จะถือว่าพร้อมใช้งานโดยไม่ต้องมีข้อมูลรับรอง
- `getApiKey*` จะคืนค่า `kNoAuth` สำหรับพวกเขา

## ความพร้อมใช้งานของโมเดล vs โมเดลทั้งหมด

- `getAll()` คืนค่า model registry ที่โหลดแล้ว (ในตัว + รวมแบบกำหนดเอง + ที่ค้นพบ)
- `getAvailable()` กรองเฉพาะโมเดลที่ไม่ต้องใช้คีย์หรือมีการยืนยันตัวตนที่แก้ไขได้

ดังนั้นโมเดลสามารถมีอยู่ใน registry แต่ไม่สามารถเลือกได้จนกว่าจะมีการยืนยันตัวตนพร้อมใช้งาน

## การแก้ไขโมเดลขณะรันไทม์

### CLI และการแยกวิเคราะห์รูปแบบ

`model-resolver.ts` รองรับ:

- `provider/modelId` ที่แน่นอน
- canonical model id ที่แน่นอน
- model id ที่แน่นอน (อนุมานผู้ให้บริการ)
- การจับคู่แบบ fuzzy/substring
- รูปแบบ glob scope ใน `--models` (เช่น `openai/*`, `*sonnet*`)
- ส่วนต่อท้าย `:thinkingLevel` ที่เป็นตัวเลือก (`off|minimal|low|medium|high|xhigh`)

`--provider` เป็นแบบเดิม; ควรใช้ `--model`

ลำดับความสำคัญในการแก้ไขสำหรับตัวเลือกที่แน่นอน:

1. `provider/modelId` ที่แน่นอนข้ามการรวมกลุ่ม
2. canonical id ที่แน่นอนแก้ไขผ่านดัชนี canonical
3. bare concrete id ที่แน่นอนยังคงทำงาน
4. การจับคู่ fuzzy และ glob ทำงานหลังจากเส้นทางที่แน่นอน

### ลำดับความสำคัญในการเลือกโมเดลเริ่มต้น

`findInitialModel(...)` ใช้ลำดับนี้:

1. ผู้ให้บริการ+โมเดลที่ระบุจาก CLI อย่างชัดเจน
2. โมเดลที่กำหนดขอบเขตตัวแรก (ถ้าไม่ได้ resume)
3. ผู้ให้บริการ/โมเดลเริ่มต้นที่บันทึกไว้
4. ค่าเริ่มต้นของผู้ให้บริการที่รู้จัก (เช่น OpenAI/Anthropic/ฯลฯ) ในบรรดาโมเดลที่พร้อมใช้งาน
5. โมเดลแรกที่พร้อมใช้งาน

### นามแฝงบทบาทและการตั้งค่า

บทบาทโมเดลที่รองรับ:

- `default`, `smol`, `slow`, `plan`, `commit`

นามแฝงบทบาทเช่น `pi/smol` ขยายผ่าน `settings.modelRoles` ค่าของแต่ละบทบาทยังสามารถต่อท้ายตัวเลือก thinking เช่น `:minimal`, `:low`, `:medium`, หรือ `:high`

หากบทบาทชี้ไปที่บทบาทอื่น โมเดลเป้าหมายยังคงสืบทอดตามปกติ และส่วนต่อท้ายที่ระบุอย่างชัดเจนบนบทบาทที่อ้างอิงจะมีผลสำหรับการใช้งานเฉพาะบทบาทนั้น

การตั้งค่าที่เกี่ยวข้อง:

- `modelRoles` (record)
- `enabledModels` (รายการรูปแบบที่กำหนดขอบเขต)
- `modelProviderOrder` (ลำดับความสำคัญ canonical-provider ทั่วไป)
- `providers.kimiApiFormat` (รูปแบบคำขอ `openai` หรือ `anthropic`)
- `providers.openaiWebsockets` (ค่ากำหนด websocket `auto|off|on` สำหรับ transport ของ OpenAI Codex)

`modelRoles` อาจเก็บ:

- `provider/modelId` เพื่อตรึงตัวแปรผู้ให้บริการที่เป็นรูปธรรม
- canonical id เช่น `gpt-5.3-codex` เพื่ออนุญาตการรวมกลุ่มผู้ให้บริการ

สำหรับ `enabledModels` และ CLI `--models`:

- canonical id ที่แน่นอนขยายไปยังตัวแปรรูปธรรมทั้งหมดในกลุ่ม canonical นั้น
- รายการ `provider/modelId` ที่ระบุอย่างชัดเจนยังคงแน่นอน
- globs และการจับคู่ fuzzy ยังคงทำงานบนโมเดลที่เป็นรูปธรรม

## `/model` และ `--list-models`

ทั้งสองส่วนยังคงแสดงและให้เลือกโมเดลที่มีคำนำหน้าผู้ให้บริการได้

ตอนนี้ยังแสดงโมเดล canonical/ที่รวมกลุ่มแล้ว:

- `/model` รวมมุมมอง canonical ควบคู่กับแท็บผู้ให้บริการ
- `--list-models` พิมพ์ส่วน canonical พร้อมแถวผู้ให้บริการที่เป็นรูปธรรม

การเลือกรายการ canonical จะเก็บตัวเลือก canonical การเลือกแถวผู้ให้บริการจะเก็บ `provider/modelId` ที่ชัดเจน

## Context promotion (ห่วงโซ่สำรองระดับโมเดล)

Context promotion เป็นกลไกการกู้คืนจากการล้นสำหรับตัวแปรที่มี context ขนาดเล็ก (เช่น `*-spark`) ที่เลื่อนขั้นโดยอัตโนมัติไปยังโมเดลพี่น้องที่มี context ขนาดใหญ่กว่าเมื่อ API ปฏิเสธคำขอด้วยข้อผิดพลาดความยาว context

### ทริกเกอร์และลำดับ

เมื่อเทิร์นล้มเหลวด้วยข้อผิดพลาด context overflow (เช่น `context_length_exceeded`) `AgentSession` จะพยายาม promotion **ก่อน** ที่จะกลับไปใช้การบีบอัด:

1. หาก `contextPromotion.enabled` เป็น true ให้แก้ไขเป้าหมาย promotion (ดูด้านล่าง)
2. หากพบเป้าหมาย ให้สลับไปใช้และลองคำขออีกครั้ง — ไม่ต้องบีบอัด
3. หากไม่มีเป้าหมายที่พร้อมใช้งาน ให้ตกลงไปยังการบีบอัดอัตโนมัติบนโมเดลปัจจุบัน

### การเลือกเป้าหมาย

การเลือกขึ้นอยู่กับโมเดล ไม่ใช่บทบาท:

1. `currentModel.contextPromotionTarget` (ถ้ากำหนดค่าไว้)
2. โมเดลที่มี context ขนาดใหญ่กว่าที่เล็กที่สุดบนผู้ให้บริการ + API เดียวกัน

ตัวเลือกจะถูกข้ามเว้นแต่ข้อมูลรับรองจะแก้ไขได้ (`ModelRegistry.getApiKey(...)`)

### การส่งต่อ websocket ของ OpenAI Codex

หากสลับจาก/ไปยัง `openai-codex-responses` สถานะคีย์ผู้ให้บริการเซสชัน `openai-codex-responses` จะถูกปิดก่อนการสลับโมเดล ซึ่งจะทิ้งสถานะ websocket transport เพื่อให้เทิร์นถัดไปเริ่มต้นใหม่บนโมเดลที่เลื่อนขั้น

### พฤติกรรมการคงอยู่

Promotion ใช้การสลับชั่วคราว (`setModelTemporary`):

- บันทึกเป็น `model_change` ชั่วคราวในประวัติเซสชัน
- ไม่เขียนทับการแมปบทบาทที่บันทึกไว้

### การกำหนดค่าห่วงโซ่สำรองอย่างชัดเจน

กำหนดค่าสำรองโดยตรงในเมตาดาต้าโมเดลผ่าน `contextPromotionTarget`

`contextPromotionTarget` รับค่า:

- `provider/model-id` (ชัดเจน)
- `model-id` (แก้ไขภายในผู้ให้บริการปัจจุบัน)

ตัวอย่าง (`models.yml`) สำหรับ Spark -> non-Spark บนผู้ให้บริการเดียวกัน:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

ตัวสร้างโมเดลในตัวยังกำหนดค่านี้โดยอัตโนมัติสำหรับโมเดล `*-spark` เมื่อมีโมเดลฐานบนผู้ให้บริการเดียวกัน

## ฟิลด์ความเข้ากันได้และการกำหนดเส้นทาง

`models.yml` รองรับชุดย่อย `compat` ดังนี้:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` หรือ `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

สิ่งเหล่านี้ถูกใช้โดยลอจิก transport ของ OpenAI-completions และรวมกับการตรวจจับอัตโนมัติตาม URL

## ตัวอย่างที่ใช้งานได้จริง

### Local OpenAI-compatible endpoint (ไม่มี auth)

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

### Hosted proxy ด้วยคีย์จาก env

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

### แทนที่ค่าเส้นทางผู้ให้บริการในตัว + เมตาดาต้าโมเดล

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

เมื่อตั้งค่าตัวแปรสภาพแวดล้อมทั้ง `LITELLM_BASE_URL` และ `LITELLM_API_KEY` แล้ว xcsh จะจัดการการกำหนดค่า `models.yml` สำหรับ LiteLLM proxy โดยอัตโนมัติ

### การสร้างอัตโนมัติครั้งแรก

หาก `models.yml` ไม่มีอยู่และตรวจพบ env vars ของ LiteLLM, xcsh จะสร้างโดยอัตโนมัติ:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

`config.yml` เริ่มต้นก็จะถูกสร้างพร้อมกับการตั้งค่าผู้ให้บริการรูปภาพที่เหมาะสม

### การซ่อมแซมตัวเองเมื่อเริ่มต้น

ทุกครั้งที่เริ่มต้น `startupHealthCheck()` ใน model registry จะรันการตรวจสอบต่อไปนี้:

| เงื่อนไข | การดำเนินการ |
|-----------|--------|
| `models.yml` หายไป | สร้างอัตโนมัติจาก env vars |
| `models.yml` เสียหายหรือแยกวิเคราะห์ไม่ได้ | สำรองเป็น `.bak`, สร้างใหม่ |
| `baseUrl` ไม่ตรงกับ `LITELLM_BASE_URL` | สำรองเป็น `.bak`, สร้างใหม่ด้วย URL ใหม่ |
| `configVersion` หายไปหรือล้าสมัย | สำรองเป็น `.bak`, สร้างใหม่ด้วยเวอร์ชันปัจจุบัน |
| Config สมบูรณ์ดี | ไม่มีการดำเนินการ |

การซ่อมแซมทั้งหมดจะสร้างสำเนาสำรอง `.bak` ก่อนเขียนทับ การดำเนินการทั้งหมดเป็น idempotent

### คำสั่ง CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### ตัวแปรสภาพแวดล้อมที่จำเป็น

| ตัวแปร | วัตถุประสงค์ |
|----------|---------|
| `LITELLM_BASE_URL` | URL ของ LiteLLM proxy (เช่น `https://your-proxy.example.com`) ต้องขึ้นต้นด้วย `http://` หรือ `https://` |
| `LITELLM_API_KEY` | API key สำหรับ proxy อ้างอิงตามชื่อใน config ที่สร้าง แก้ไขขณะรันไทม์ |

หากตัวแปรใดตัวแปรหนึ่งไม่ได้ตั้งค่า การกำหนดค่าอัตโนมัติจะถูกข้ามอย่างเงียบๆ

### การกำหนดเวอร์ชัน Config

Config ที่สร้างจะรวมฟิลด์ `configVersion` เมื่อรูปแบบที่สร้างเปลี่ยนแปลงในรุ่นอนาคต xcsh จะตรวจจับ config ที่ล้าสมัยและอัปเกรดโดยอัตโนมัติ (พร้อมสำเนาสำรอง)

## ข้อควรระวังสำหรับ consumer แบบเดิม

การกำหนดค่าโมเดลส่วนใหญ่ตอนนี้ไหลผ่าน `models.yml` ผ่าน `ModelRegistry`

มีเส้นทางแบบเดิมที่สำคัญอยู่หนึ่งเส้นทาง: การแก้ไข auth ของ Anthropic สำหรับการค้นหาเว็บยังคงอ่าน `~/.xcsh/agent/models.json` โดยตรงใน `src/web/search/auth.ts`

หากคุณพึ่งพาเส้นทางเฉพาะนี้ ให้คำนึงถึงความเข้ากันได้ของ JSON จนกว่าโมดูลนั้นจะถูกย้าย

## โหมดความล้มเหลว

หาก `models.yml` ไม่ผ่านการตรวจสอบ schema หรือ validation:

- หากตั้งค่า `LITELLM_BASE_URL` และ `LITELLM_API_KEY` ไว้ การตรวจสอบสุขภาพเมื่อเริ่มต้นจะพยายามซ่อมแซมอัตโนมัติ (สำรองไฟล์ที่เสียหาย สร้างใหม่จาก env vars) หากการซ่อมแซมสำเร็จ registry จะโหลด config ที่แก้ไขแล้วใหม่
- หากไม่สามารถซ่อมแซมอัตโนมัติได้ (env vars ไม่ได้ตั้งค่า เขียนไม่สำเร็จ) registry จะยังคงทำงานด้วยโมเดลในตัว
- ข้อผิดพลาดจะถูกเปิดเผยผ่าน `ModelRegistry.getError()` และแสดงใน UI/การแจ้งเตือน
