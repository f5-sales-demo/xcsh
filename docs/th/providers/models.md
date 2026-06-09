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

เอกสารนี้อธิบายวิธีที่ coding-agent โหลดโมเดล ใช้การแทนที่ ค้นหาข้อมูลรับรอง และเลือกโมเดลในขณะรันไทม์

## สิ่งที่ควบคุมพฤติกรรมของโมเดล

ไฟล์การทำงานหลัก:

- `src/config/model-registry.ts` — โหลดโมเดลในตัว + โมเดลกำหนดเอง, การแทนที่ผู้ให้บริการ, การค้นพบขณะรันไทม์, การรวมระบบ auth
- `src/config/model-resolver.ts` — แยกวิเคราะห์รูปแบบโมเดลและเลือกโมเดล initial/smol/slow
- `src/config/settings-schema.ts` — การตั้งค่าที่เกี่ยวกับโมเดล (`modelRoles`, ค่ากำหนด transport ของผู้ให้บริการ)
- `src/session/auth-storage.ts` — ลำดับการค้นหา API key + OAuth
- `packages/ai/src/models.ts` และ `packages/ai/src/types.ts` — ผู้ให้บริการ/โมเดลในตัวและชนิด `Model`/`compat`

## ตำแหน่งไฟล์กำหนดค่าและพฤติกรรมแบบเก่า

เส้นทางกำหนดค่าเริ่มต้น:

- `~/.xcsh/agent/models.yml`

พฤติกรรมแบบเก่าที่ยังคงมีอยู่:

- หาก `models.yml` ไม่มีและ `models.json` มีอยู่ในตำแหน่งเดียวกัน จะถูกย้ายไปเป็น `models.yml`
- เส้นทางกำหนดค่าแบบ `.json` / `.jsonc` ที่ระบุชัดเจนยังคงรองรับเมื่อส่งโดยโปรแกรมไปยัง `ModelRegistry`

## รูปร่างของ `models.yml`

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

`configVersion` เป็นจำนวนเต็มเสริมที่เขียนโดยระบบ auto-config เมื่อมีอยู่ xcsh จะใช้มันเพื่อตรวจจับกำหนดค่าที่ล้าสมัยและอัปเกรดอัตโนมัติ

`provider-id` เป็นคีย์ผู้ให้บริการแบบ canonical ที่ใช้ทั่วทั้งการเลือกและการค้นหา auth

`equivalence` เป็นตัวเลือกเสริมและกำหนดค่าการจัดกลุ่มโมเดลแบบ canonical บนโมเดลผู้ให้บริการที่เป็นรูปธรรม:

- `overrides` แม็ปตัวเลือกรูปธรรมที่ตรงกันทุกประการ (`provider/modelId`) ไปยัง id canonical ต้นทางอย่างเป็นทางการ
- `exclude` เลือกตัวเลือกรูปธรรมออกจากการจัดกลุ่มแบบ canonical

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

### ผู้ให้บริการกำหนดเองแบบเต็ม (`models` ไม่ว่างเปล่า)

จำเป็น:

- `baseUrl`
- `apiKey` เว้นแต่ `auth: none`
- `api` ที่ระดับผู้ให้บริการหรือแต่ละโมเดล

### ผู้ให้บริการแบบแทนที่เท่านั้น (`models` ไม่มีหรือว่างเปล่า)

ต้องกำหนดอย่างน้อยหนึ่งอย่างจาก:

- `baseUrl`
- `modelOverrides`
- `discovery`

### การค้นพบ

- `discovery` ต้องการ `api` ระดับผู้ให้บริการ

### การตรวจสอบค่าโมเดล

- `id` จำเป็น
- `contextWindow` และ `maxTokens` ต้องเป็นค่าบวกหากระบุ

## ลำดับการรวมและการแทนที่

ไปป์ไลน์ ModelRegistry (เมื่อรีเฟรช):

1. โหลดผู้ให้บริการ/โมเดลในตัวจาก `@f5xc-salesdemos/pi-ai`
2. โหลดกำหนดค่ากำหนดเองจาก `models.yml`
3. ใช้การแทนที่ผู้ให้บริการ (`baseUrl`, `headers`) กับโมเดลในตัว
4. ใช้ `modelOverrides` (ต่อผู้ให้บริการ + model id)
5. รวม `models` กำหนดเอง:
   - `provider + id` เดียวกันจะแทนที่ที่มีอยู่
   - มิฉะนั้นจะเพิ่มต่อท้าย
6. ใช้โมเดลที่ค้นพบขณะรันไทม์ (ปัจจุบัน Ollama และ LM Studio) จากนั้นใช้การแทนที่โมเดลอีกครั้ง

## ความเทียบเท่าโมเดลแบบ canonical และการรวมกลุ่ม

รีจิสทรีเก็บโมเดลผู้ให้บริการรูปธรรมทุกตัวแล้วสร้างชั้น canonical ไว้ด้านบน

id แบบ canonical เป็น id ต้นทางอย่างเป็นทางการเท่านั้น ตัวอย่าง:

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

ลำดับการสร้างสำหรับการจัดกลุ่มแบบ canonical:

1. การแทนที่ที่ตรงกันทุกประการจากผู้ใช้จาก `equivalence.overrides`
2. การจับคู่ official-id ที่รวมมาจากเมตาดาต้าโมเดลในตัว
3. การปรับมาตรฐานแบบฮิวริสติกอนุรักษ์นิยมสำหรับตัวแปร gateway/ผู้ให้บริการ
4. สำรองไปที่ id ของโมเดลรูปธรรมเอง

ฮิวริสติกปัจจุบันถูกจำกัดโดยตั้งใจ:

- คำนำหน้าต้นทางที่ฝังอยู่สามารถถูกลบออกได้เมื่อมีอยู่ ตัวอย่างเช่น `anthropic/...` หรือ `openai/...`
- ตัวแปรเวอร์ชันแบบจุดและขีดจะปรับมาตรฐานได้เฉพาะเมื่อแม็ปไปยัง official id ที่มีอยู่ ตัวอย่างเช่น `4.6 -> 4-6`
- กลุ่มหรือเวอร์ชันที่ไม่ชัดเจนจะไม่ถูกรวมโดยไม่มีการจับคู่แบบรวมมาหรือการแทนที่ที่ชัดเจน

### พฤติกรรมการค้นหาแบบ canonical

เมื่อตัวแปรรูปธรรมหลายตัวใช้ id canonical ร่วมกัน การค้นหาจะใช้:

1. ความพร้อมใช้งานและ auth
2. `modelProviderOrder` ใน `config.yml`
3. ลำดับรีจิสทรี/ผู้ให้บริการที่มีอยู่หาก `modelProviderOrder` ไม่ได้ตั้งค่า

ผู้ให้บริการที่ถูกปิดใช้งานหรือไม่ได้รับการยืนยันตัวตนจะถูกข้าม

สถานะเซสชันและทรานสคริปต์ยังคงบันทึกผู้ให้บริการ/โมเดลรูปธรรมที่ทำงานจริงในแต่ละเทิร์น

ค่าเริ่มต้นของผู้ให้บริการ vs การแทนที่ต่อโมเดล:

- `headers` ของผู้ให้บริการเป็นพื้นฐาน
- `headers` ของโมเดลจะแทนที่คีย์เฮดเดอร์ของผู้ให้บริการ
- `modelOverrides` สามารถแทนที่เมตาดาต้าโมเดล (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)
- `compat` จะถูก deep-merged สำหรับบล็อกการกำหนดเส้นทางแบบซ้อน (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)

## การรวมระบบการค้นพบขณะรันไทม์

### การค้นพบ Ollama โดยปริยาย

หาก `ollama` ไม่ได้กำหนดค่าอย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่สามารถค้นพบได้โดยปริยาย:

- ผู้ให้บริการ: `ollama`
- api: `openai-completions`
- base URL: `OLLAMA_BASE_URL` หรือ `http://127.0.0.1:11434`
- โหมด auth: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบขณะรันไทม์เรียก `GET /api/tags` บน Ollama และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นแบบโลคอล

### การค้นพบ llama.cpp โดยปริยาย

หาก `llama.cpp` ไม่ได้กำหนดค่าอย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่สามารถค้นพบได้โดยปริยาย:
หมายเหตุ: ใช้ antropic messages api แบบใหม่กว่าแทน openai-completions

- ผู้ให้บริการ: `llama.cpp`
- api: `openai-responses`
- base URL: `LLAMA_CPP_BASE_URL` หรือ `http://127.0.0.1:8080`
- โหมด auth: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบขณะรันไทม์เรียก `GET models` บน llama.cpp และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นแบบโลคอล

### การค้นพบ LM Studio โดยปริยาย

หาก `lm-studio` ไม่ได้กำหนดค่าอย่างชัดเจน รีจิสทรีจะเพิ่มผู้ให้บริการที่สามารถค้นพบได้โดยปริยาย:

- ผู้ให้บริการ: `lm-studio`
- api: `openai-completions`
- base URL: `LM_STUDIO_BASE_URL` หรือ `http://127.0.0.1:1234/v1`
- โหมด auth: ไม่ต้องใช้คีย์ (พฤติกรรม `auth: none`)

การค้นพบขณะรันไทม์ดึงโมเดล (`GET /models`) และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นแบบโลคอล

### การค้นพบผู้ให้บริการแบบชัดเจน

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

### การลงทะเบียนผู้ให้บริการผ่านส่วนขยาย

ส่วนขยายสามารถลงทะเบียนผู้ให้บริการขณะรันไทม์ได้ (`pi.registerProvider(...)`) รวมถึง:

- การแทนที่/เพิ่มโมเดลสำหรับผู้ให้บริการ
- การลงทะเบียนตัวจัดการสตรีมกำหนดเองสำหรับ API ID ใหม่
- การลงทะเบียนผู้ให้บริการ OAuth กำหนดเอง

## ลำดับการค้นหา auth และ API key

เมื่อร้องขอคีย์สำหรับผู้ให้บริการ ลำดับที่มีผลคือ:

1. การแทนที่ขณะรันไทม์ (CLI `--api-key`)
2. ข้อมูลรับรอง API key ที่จัดเก็บใน `agent.db`
3. ข้อมูลรับรอง OAuth ที่จัดเก็บใน `agent.db` (พร้อมการรีเฟรช)
4. การแม็ปตัวแปรสภาพแวดล้อม (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ฯลฯ)
5. ตัวค้นหาสำรองของ ModelRegistry (`apiKey` ของผู้ให้บริการจาก `models.yml`, ความหมายแบบชื่อ-env-หรือ-ค่าตรง)

พฤติกรรม `apiKey` ใน `models.yml`:

- ค่าจะถูกถือว่าเป็นชื่อตัวแปรสภาพแวดล้อมก่อน
- หากไม่มีตัวแปรสภาพแวดล้อม สตริงตรงจะถูกใช้เป็นโทเค็น

หาก `authHeader: true` และ `apiKey` ของผู้ให้บริการถูกตั้งค่า โมเดลจะได้รับ:

- เฮดเดอร์ `Authorization: Bearer <resolved-key>` ที่ถูกฉีดเข้าไป

ผู้ให้บริการแบบไม่ต้องใช้คีย์:

- ผู้ให้บริการที่ทำเครื่องหมาย `auth: none` จะถือว่าพร้อมใช้งานโดยไม่ต้องมีข้อมูลรับรอง
- `getApiKey*` จะคืนค่า `kNoAuth` สำหรับพวกเขา

## ความพร้อมใช้งานของโมเดล vs โมเดลทั้งหมด

- `getAll()` คืนค่ารีจิสทรีโมเดลที่โหลดแล้ว (ในตัว + รวมกำหนดเอง + ค้นพบ)
- `getAvailable()` กรองเฉพาะโมเดลที่ไม่ต้องใช้คีย์หรือมี auth ที่ค้นหาได้

ดังนั้นโมเดลสามารถมีอยู่ในรีจิสทรีแต่ไม่สามารถเลือกได้จนกว่า auth จะพร้อมใช้งาน

## การค้นหาโมเดลขณะรันไทม์

### CLI และการแยกวิเคราะห์รูปแบบ

`model-resolver.ts` รองรับ:

- `provider/modelId` ที่ตรงกันทุกประการ
- id โมเดล canonical ที่ตรงกันทุกประการ
- id โมเดลที่ตรงกันทุกประการ (อนุมานผู้ให้บริการ)
- การจับคู่แบบ fuzzy/substring
- รูปแบบขอบเขต glob ใน `--models` (เช่น `openai/*`, `*sonnet*`)
- ส่วนต่อท้าย `:thinkingLevel` ที่เป็นทางเลือก (`off|minimal|low|medium|high|xhigh`)

`--provider` เป็นแบบเก่า; แนะนำให้ใช้ `--model`

ลำดับความสำคัญในการค้นหาสำหรับตัวเลือกที่ตรงกัน:

1. `provider/modelId` ที่ตรงกันทุกประการจะข้ามการรวมกลุ่ม
2. id canonical ที่ตรงกันทุกประการจะค้นหาผ่านดัชนี canonical
3. id รูปธรรมแบบเปล่าที่ตรงกันยังคงใช้ได้
4. การจับคู่แบบ fuzzy และ glob จะทำงานหลังเส้นทางที่ตรงกัน

### ลำดับความสำคัญในการเลือกโมเดลเริ่มต้น

`findInitialModel(...)` ใช้ลำดับนี้:

1. ผู้ให้บริการ+โมเดลที่ระบุชัดเจนจาก CLI
2. โมเดลที่มีขอบเขตแรก (หากไม่ได้ทำการ resume)
3. ผู้ให้บริการ/โมเดลเริ่มต้นที่บันทึกไว้
4. ค่าเริ่มต้นของผู้ให้บริการที่รู้จัก (เช่น OpenAI/Anthropic ฯลฯ) ในบรรดาโมเดลที่พร้อมใช้งาน
5. โมเดลแรกที่พร้อมใช้งาน

### นามแฝงบทบาทและการตั้งค่า

บทบาทโมเดลที่รองรับ:

- `default`, `smol`, `slow`, `plan`, `commit`

นามแฝงบทบาทเช่น `pi/smol` จะขยายผ่าน `settings.modelRoles` แต่ละค่าบทบาทยังสามารถเพิ่มตัวเลือก thinking เช่น `:minimal`, `:low`, `:medium` หรือ `:high`

หากบทบาทชี้ไปยังบทบาทอื่น โมเดลเป้าหมายยังคงสืบทอดตามปกติและส่วนต่อท้ายที่ชัดเจนบนบทบาทที่อ้างอิงจะชนะสำหรับการใช้งานเฉพาะบทบาทนั้น

การตั้งค่าที่เกี่ยวข้อง:

- `modelRoles` (record)
- `enabledModels` (รายการรูปแบบที่มีขอบเขต)
- `modelProviderOrder` (ลำดับความสำคัญของผู้ให้บริการ canonical แบบทั่วไป)
- `providers.kimiApiFormat` (รูปแบบคำขอ `openai` หรือ `anthropic`)
- `providers.openaiWebsockets` (ค่ากำหนด websocket `auto|off|on` สำหรับ transport ของ OpenAI Codex)

`modelRoles` อาจจัดเก็บ:

- `provider/modelId` เพื่อปักหมุดตัวแปรผู้ให้บริการรูปธรรม
- id canonical เช่น `gpt-5.3-codex` เพื่ออนุญาตการรวมกลุ่มผู้ให้บริการ

สำหรับ `enabledModels` และ CLI `--models`:

- id canonical ที่ตรงกันทุกประการจะขยายไปยังตัวแปรรูปธรรมทั้งหมดในกลุ่ม canonical นั้น
- รายการ `provider/modelId` ที่ชัดเจนจะคงเป็นแบบตรงกัน
- glob และการจับคู่แบบ fuzzy ยังคงทำงานกับโมเดลรูปธรรม

## `/model` และ `--list-models`

ทั้งสองส่วนแสดงผลยังคงทำให้โมเดลที่มีคำนำหน้าผู้ให้บริการมองเห็นได้และเลือกได้

ตอนนี้ยังเปิดเผยโมเดล canonical/ที่รวมกลุ่มแล้ว:

- `/model` รวมมุมมอง canonical ควบคู่กับแท็บผู้ให้บริการ
- `--list-models` พิมพ์ส่วน canonical พร้อมแถวผู้ให้บริการรูปธรรม

การเลือกรายการ canonical จะจัดเก็บตัวเลือก canonical การเลือกแถวผู้ให้บริการจะจัดเก็บ `provider/modelId` ที่ชัดเจน

## การเลื่อนขั้นบริบท (ห่วงโซ่สำรองระดับโมเดล)

การเลื่อนขั้นบริบทเป็นกลไกการกู้คืนจากการล้นสำหรับตัวแปรที่มีบริบทเล็ก (ตัวอย่างเช่น `*-spark`) ที่จะเลื่อนขั้นอัตโนมัติไปยังโมเดลพี่น้องที่มีบริบทใหญ่กว่าเมื่อ API ปฏิเสธคำขอด้วยข้อผิดพลาดความยาวบริบท

### ทริกเกอร์และลำดับ

เมื่อเทิร์นล้มเหลวด้วยข้อผิดพลาดการล้นบริบท (เช่น `context_length_exceeded`) `AgentSession` จะพยายามเลื่อนขั้น **ก่อน** สำรองไปยังการบีบอัด:

1. หาก `contextPromotion.enabled` เป็น true จะค้นหาเป้าหมายเลื่อนขั้น (ดูด้านล่าง)
2. หากพบเป้าหมาย จะสลับไปใช้และลองคำขอใหม่ — ไม่จำเป็นต้องบีบอัด
3. หากไม่มีเป้าหมายที่พร้อมใช้งาน จะสำรองไปยังการบีบอัดอัตโนมัติบนโมเดลปัจจุบัน

### การเลือกเป้าหมาย

การเลือกขึ้นอยู่กับโมเดล ไม่ใช่บทบาท:

1. `currentModel.contextPromotionTarget` (หากกำหนดค่าไว้)
2. โมเดลที่มีบริบทใหญ่กว่าที่เล็กที่สุดบนผู้ให้บริการ + API เดียวกัน

ผู้สมัครจะถูกเพิกเฉยเว้นแต่ข้อมูลรับรองจะค้นหาได้ (`ModelRegistry.getApiKey(...)`)

### การส่งต่อ websocket ของ OpenAI Codex

หากสลับจาก/ไปยัง `openai-codex-responses` สถานะคีย์ผู้ให้บริการเซสชัน `openai-codex-responses` จะถูกปิดก่อนสลับโมเดล สิ่งนี้จะลบสถานะ transport websocket เพื่อให้เทิร์นถัดไปเริ่มต้นสะอาดบนโมเดลที่เลื่อนขั้น

### พฤติกรรมการคงอยู่

การเลื่อนขั้นใช้การสลับชั่วคราว (`setModelTemporary`):

- บันทึกเป็น `model_change` ชั่วคราวในประวัติเซสชัน
- ไม่เขียนทับการแม็ปบทบาทที่บันทึกไว้

### การกำหนดค่าห่วงโซ่สำรองอย่างชัดเจน

กำหนดค่าการสำรองโดยตรงในเมตาดาต้าโมเดลผ่าน `contextPromotionTarget`

`contextPromotionTarget` ยอมรับ:

- `provider/model-id` (ชัดเจน)
- `model-id` (ค้นหาภายในผู้ให้บริการปัจจุบัน)

ตัวอย่าง (`models.yml`) สำหรับ Spark -> non-Spark บนผู้ให้บริการเดียวกัน:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

ตัวสร้างโมเดลในตัวยังกำหนดสิ่งนี้โดยอัตโนมัติสำหรับโมเดล `*-spark` เมื่อมีโมเดลฐานบนผู้ให้บริการเดียวกัน

## ฟิลด์ความเข้ากันได้และการกำหนดเส้นทาง

`models.yml` รองรับชุดย่อย `compat` นี้:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` หรือ `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

สิ่งเหล่านี้ถูกใช้โดยตรรกะ transport ของ OpenAI-completions และรวมกับการตรวจจับอัตโนมัติตาม URL

## ตัวอย่างเชิงปฏิบัติ

### จุดปลายทางแบบ OpenAI-compatible ในเครื่อง (ไม่มี auth)

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

## การกำหนดค่าอัตโนมัติสำหรับพร็อกซี LiteLLM

เมื่อตั้งค่าตัวแปรสภาพแวดล้อมทั้ง `LITELLM_BASE_URL` และ `LITELLM_API_KEY` xcsh จะจัดการการกำหนดค่า `models.yml` สำหรับพร็อกซี LiteLLM โดยอัตโนมัติ

### การสร้างอัตโนมัติเมื่อรันครั้งแรก

หาก `models.yml` ไม่มีอยู่และตรวจพบตัวแปรสภาพแวดล้อม LiteLLM xcsh จะสร้างขึ้นโดยอัตโนมัติ:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

`config.yml` เริ่มต้นจะถูกสร้างขึ้นพร้อมการตั้งค่าผู้ให้บริการรูปภาพที่เหมาะสมด้วย

### การซ่อมแซมตัวเองเมื่อเริ่มต้น

ทุกครั้งที่เริ่มต้น `startupHealthCheck()` ในรีจิสทรีโมเดลจะทำการตรวจสอบต่อไปนี้:

| เงื่อนไข | การดำเนินการ |
|-----------|--------|
| `models.yml` ไม่มี | สร้างอัตโนมัติจากตัวแปรสภาพแวดล้อม |
| `models.yml` เสียหายหรือแยกวิเคราะห์ไม่ได้ | สำรองเป็น `.bak`, สร้างใหม่ |
| `baseUrl` ไม่ตรงกับ `LITELLM_BASE_URL` | สำรองเป็น `.bak`, สร้างใหม่ด้วย URL ใหม่ |
| `configVersion` ไม่มีหรือล้าสมัย | สำรองเป็น `.bak`, สร้างใหม่ด้วยเวอร์ชันปัจจุบัน |
| กำหนดค่าปกติ | ไม่มีการดำเนินการ |

การซ่อมแซมทั้งหมดจะสร้างสำรอง `.bak` ก่อนเขียนทับ การดำเนินการทั้งหมดเป็นแบบ idempotent

### คำสั่ง CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### ตัวแปรสภาพแวดล้อมที่จำเป็น

| ตัวแปร | วัตถุประสงค์ |
|----------|---------|
| `LITELLM_BASE_URL` | URL พร็อกซี LiteLLM (เช่น `https://your-proxy.example.com`) ต้องเริ่มต้นด้วย `http://` หรือ `https://` |
| `LITELLM_API_KEY` | API key สำหรับพร็อกซี อ้างอิงตามชื่อในกำหนดค่าที่สร้าง ค้นหาเมื่อรันไทม์ |

หากตัวแปรใดตัวแปรหนึ่งไม่ได้ตั้งค่า การกำหนดค่าอัตโนมัติจะถูกข้ามอย่างเงียบๆ

### การกำหนดเวอร์ชันกำหนดค่า

กำหนดค่าที่สร้างจะรวมฟิลด์ `configVersion` เมื่อรูปแบบที่สร้างเปลี่ยนแปลงในรุ่นอนาคต xcsh จะตรวจจับกำหนดค่าที่ล้าสมัยและอัปเกรดโดยอัตโนมัติ (พร้อมสำรอง)

## ข้อควรระวังสำหรับผู้บริโภคแบบเก่า

การกำหนดค่าโมเดลส่วนใหญ่ตอนนี้ไหลผ่าน `models.yml` ผ่าน `ModelRegistry`

ยังคงมีเส้นทางแบบเก่าที่น่าสังเกตอยู่หนึ่งเส้นทาง: การค้นหา auth ของ Anthropic สำหรับ web-search ยังคงอ่าน `~/.xcsh/agent/models.json` โดยตรงใน `src/web/search/auth.ts`

หากคุณพึ่งพาเส้นทางเฉพาะนั้น โปรดคำนึงถึงความเข้ากันได้กับ JSON จนกว่าโมดูลนั้นจะถูกย้าย

## โหมดความล้มเหลว

หาก `models.yml` ล้มเหลวในการตรวจสอบ schema หรือ validation:

- หากตั้งค่า `LITELLM_BASE_URL` และ `LITELLM_API_KEY` การตรวจสอบสุขภาพเมื่อเริ่มต้นจะพยายามซ่อมแซมอัตโนมัติ (สำรองไฟล์เสียหาย สร้างใหม่จากตัวแปรสภาพแวดล้อม) หากการซ่อมแซมสำเร็จ รีจิสทรีจะโหลดกำหนดค่าที่แก้ไขแล้วใหม่
- หากการซ่อมแซมอัตโนมัติไม่สามารถทำได้ (ตัวแปรสภาพแวดล้อมไม่ได้ตั้งค่า การเขียนล้มเหลว) รีจิสทรีจะยังคงทำงานกับโมเดลในตัว
- ข้อผิดพลาดจะถูกเปิดเผยผ่าน `ModelRegistry.getError()` และแสดงใน UI/การแจ้งเตือน
