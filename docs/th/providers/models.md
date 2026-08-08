---
title: การกำหนดค่าโมเดลและผู้ให้บริการ
description: รีจิสทรีโมเดลและการกำหนดค่าผู้ให้บริการผ่าน models.yml พร้อมการกำหนดเส้นทาง การสำรอง และการกำหนดราคา
sidebar:
  order: 1
  label: โมเดลและผู้ให้บริการ
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# Model and Provider Configuration (`models.yml`)

เอกสารนี้อธิบายวิธีที่ coding-agent ในปัจจุบันโหลดโมเดล นำการแทนที่ (overrides) ไปใช้ ตรวจสอบข้อมูลประจำตัว และเลือกโมเดลขณะทำงาน (runtime)

## What controls model behavior

ไฟล์การนำไปใช้งาน (implementation files) หลัก:

- `src/config/model-registry.ts` — โหลดโมเดลที่มีมาให้ (built-in) + แบบกำหนดเอง (custom), การแทนที่ของผู้ให้บริการ, การค้นพบขณะทำงาน (runtime discovery), และการทำงานร่วมกับการตรวจสอบสิทธิ์ (auth integration)
- `src/config/model-resolver.ts` — วิเคราะห์รูปแบบโมเดลและเลือกโมเดล initial/smol/slow
- `src/config/settings-schema.ts` — การตั้งค่าที่เกี่ยวข้องกับโมเดล (`modelRoles`, ค่ากำหนดในการส่งผ่านของผู้ให้บริการ)
- `src/session/auth-storage.ts` — ลำดับการตรวจสอบ API key + OAuth
- `packages/ai/src/models.ts` และ `packages/ai/src/types.ts` — ผู้ให้บริการ/โมเดลที่มีมาให้ และประเภท `Model`/`compat`

## Config file location and legacy behavior

เส้นทางไฟล์กำหนดค่า (config path) เริ่มต้น:

- `~/.xcsh/agent/models.yml`

พฤติกรรมแบบดั้งเดิมที่ยังมีอยู่:

- หากไม่มี `models.yml` และมี `models.json` อยู่ในตำแหน่งเดียวกัน ไฟล์นั้นจะถูกโอนย้าย (migrated) ไปเป็น `models.yml`
- เส้นทางไฟล์กำหนดค่า `.json` / `.jsonc` แบบชัดเจนยังคงได้รับการรองรับเมื่อถูกส่งผ่านทางโปรแกรมไปยัง `ModelRegistry`

## `models.yml` shape

```yaml
configVersion: 1  # ทางเลือกเสริม — เขียนโดย auto-config, ใช้เพื่อการตรวจสอบการอัปเกรด
providers:
  <provider-id>:
    # การตั้งค่าระดับผู้ให้บริการ
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` เป็นจำนวนเต็มเสริม (optional) ที่เขียนโดยระบบ auto-config เมื่อมีค่านี้ `xcsh` จะใช้เพื่อตรวจหาไฟล์กำหนดค่าที่ล้าสมัยและอัปเกรดอัตโนมัติ

`provider-id` คือคีย์ประจำตัว (canonical key) ของผู้ให้บริการที่ใช้ตลอดการเลือกและการค้นหาการตรวจสอบสิทธิ์

`equivalence` เป็นตัวเลือกเสริมและใช้กำหนดกลุ่มของโมเดลตามรูปแบบมาตรฐาน (canonical model) ที่อยู่เหนือโมเดลของผู้ให้บริการจริง (concrete provider models):

- `overrides` จะจับคู่ตัวเลือกที่เป็นรูปธรรมแบบตรงตัว (`provider/modelId`) ไปยัง ID มาตรฐานที่ใช้อย่างเป็นทางการต้นน้ำ (official upstream canonical id)
- `exclude` เลือกระบุว่าตัวเลือกที่เป็นรูปธรรมใดที่จะไม่รวมอยู่ในกลุ่มมาตรฐาน (canonical grouping)

## Provider-level fields

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

### Allowed provider/model `api` values

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Allowed auth/discovery values

- `auth`: `apiKey` (ค่าเริ่มต้น) หรือ `none`
- `discovery.type`: `ollama`

## Validation rules (current)

### Full custom provider (`models` is non-empty)

สิ่งที่ต้องมี:

- `baseUrl`
- `apiKey` ยกเว้นตั้งค่า `auth: none`
- `api` ที่ระดับผู้ให้บริการหรือในแต่ละโมเดล

### Override-only provider (`models` missing or empty)

ต้องกำหนดอย่างน้อยหนึ่งค่าดังนี้:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` จำเป็นต้องมี `api` ระดับผู้ให้บริการ

### Model value checks

- ต้องมี `id`
- `contextWindow` และ `maxTokens` ต้องเป็นค่าบวกหากมีการกำหนดไว้

## Merge and override order

ขั้นตอนการทำงานของ ModelRegistry (เมื่อรีเฟรช):

1. โหลดผู้ให้บริการ/โมเดลที่มีมาให้จาก `@f5-sales-demo/pi-ai`
2. โหลดไฟล์กำหนดค่าแบบกำหนดเอง `models.yml`
3. นำการแทนที่ของผู้ให้บริการ (`baseUrl`, `headers`) ไปใช้กับโมเดลที่มีมาให้
4. นำ `modelOverrides` ไปใช้ (แยกตามผู้ให้บริการ + รหัสโมเดล)
5. รวม `models` แบบกำหนดเอง:
   - `provider + id` เดียวกันจะแทนที่ของเดิมที่มีอยู่
   - มิฉะนั้นจะเพิ่มต่อท้าย
6. นำโมเดลที่ค้นพบขณะทำงานไปใช้ (ปัจจุบันคือ Ollama และ LM Studio) จากนั้นนำการแทนที่ของโมเดลไปใช้อีกครั้ง

## Canonical model equivalence and coalescing

รีจิสทรีจะเก็บโมเดลของผู้ให้บริการจริง (concrete provider model) ทุกตัวไว้ จากนั้นจึงสร้างเลเยอร์มาตรฐาน (canonical layer) ครอบไว้ด้านบน

ID มาตรฐาน (Canonical ids) เป็น ID ที่เป็นทางการของต้นน้ำเท่านั้น ตัวอย่างเช่น:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### `models.yml` equivalence config

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

ลำดับการสร้างการจัดกลุ่มมาตรฐาน:

1. การแทนที่โดยผู้ใช้แบบตรงตัวจาก `equivalence.overrides`
2. การจับคู่ official-id แบบแนบมากับข้อมูลโมเดล (built-in model metadata)
3. การทำ normalization ด้วยฮิวริสติกแบบระมัดระวัง (conservative heuristic) สำหรับสายพันธุ์รูปแบบเกตเวย์/ผู้ให้บริการ (gateway/provider variants)
4. กรณีสำรอง (fallback) ไปใช้ ID ของโมเดลจริง (concrete model)

ฮิวริสติกปัจจุบันได้รับการตั้งใจให้มีความแคบ:

- คำนำหน้าจากต้นน้ำ (upstream prefixes) ที่ฝังอยู่สามารถถูกตัดออกได้เมื่อมีอยู่ เช่น `anthropic/...` หรือ `openai/...`
- รูปแบบเวอร์ชันที่มีจุดและขีด (dotted and dashed) สามารถถูกทำ normalize ได้ก็ต่อเมื่อจับคู่กับ official id ที่มีอยู่เท่านั้น เช่น `4.6 -> 4-6`
- กลุ่ม (families) หรือเวอร์ชันที่กำกวมจะไม่ถูกนำมารวมหากไม่มีการจับคู่ที่มีมาให้ (bundled match) หรือการแทนที่อย่างชัดเจน

### Canonical resolution behavior

เมื่อหลายโมเดลจริงใช้ canonical id ร่วมกัน การแก้ปัญหาจะใช้:

1. ความพร้อมใช้งาน (availability) และการตรวจสอบสิทธิ์ (auth)
2. `modelProviderOrder` ใน `config.yml`
3. ลำดับของรีจิสทรี/ผู้ให้บริการที่มีอยู่เดิมหากไม่มีการตั้งค่า `modelProviderOrder`

ผู้ให้บริการที่ถูกปิดการใช้งานหรือไม่ผ่านการตรวจสอบสิทธิ์จะถูกข้าม

สถานะเซสชันและบันทึกประวัติ (transcripts) จะยังคงบันทึกข้อมูลของผู้ให้บริการ/โมเดลจริงที่รันงานในรอบนั้นๆ

ค่าเริ่มต้นของผู้ให้บริการ (Provider defaults) เทียบกับการแทนที่แต่ละโมเดล (per-model overrides):

- `headers` ของผู้ให้บริการถือเป็นค่าพื้นฐาน (baseline)
- `headers` ของโมเดลจะแทนที่คีย์ header ของผู้ให้บริการ
- `modelOverrides` สามารถแทนที่ข้อมูล metadata ของโมเดลได้ (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`)
- `compat` จะถูกควบรวมลึก (deep-merged) สำหรับบล็อกที่ทำหน้าที่กำหนดเส้นทางแบบซ้อน (nested routing blocks) เช่น (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`)

## Runtime discovery integration

### Implicit Ollama discovery

หากไม่มีการตั้งค่า `ollama` ไว้โดยตรง รีจิสทรีจะเพิ่มผู้ให้บริการที่สามารถค้นพบได้แบบโดยนัย (implicit discoverable provider) เข้าไป:

- ผู้ให้บริการ: `ollama`
- api: `openai-completions`
- URL ฐาน: `OLLAMA_BASE_URL` หรือ `http://127.0.0.1:11434`
- โหมดการตรวจสอบสิทธิ์: ไม่ใช้คีย์ (พฤติกรรมแบบ `auth: none`)

การค้นพบขณะทำงานจะเรียก API `GET /api/tags` บน Ollama และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นระดับโลคัล

### Implicit llama.cpp discovery

หากไม่มีการตั้งค่า `llama.cpp` ไว้โดยตรง รีจิสทรีจะเพิ่มผู้ให้บริการที่สามารถค้นพบได้แบบโดยนัยเข้าไป:
หมายเหตุ: ส่วนนี้ใช้ API ใหม่ anthropic messages แทนที่จะเป็น openai-completions

- ผู้ให้บริการ: `llama.cpp`
- api: `openai-responses`
- URL ฐาน: `LLAMA_CPP_BASE_URL` หรือ `http://127.0.0.1:8080`
- โหมดการตรวจสอบสิทธิ์: ไม่ใช้คีย์ (พฤติกรรมแบบ `auth: none`)

การค้นพบขณะทำงานจะเรียก `GET models` บน llama.cpp และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นระดับโลคัล

### Implicit LM Studio discovery

หากไม่มีการตั้งค่า `lm-studio` ไว้โดยตรง รีจิสทรีจะเพิ่มผู้ให้บริการที่สามารถค้นพบได้แบบโดยนัยเข้าไป:

- ผู้ให้บริการ: `lm-studio`
- api: `openai-completions`
- URL ฐาน: `LM_STUDIO_BASE_URL` หรือ `http://127.0.0.1:1234/v1`
- โหมดการตรวจสอบสิทธิ์: ไม่ใช้คีย์ (พฤติกรรมแบบ `auth: none`)

การค้นพบขณะทำงานจะดึงรายชื่อโมเดล (`GET /models`) และสังเคราะห์รายการโมเดลด้วยค่าเริ่มต้นระดับโลคัล

### Explicit provider discovery

คุณสามารถกำหนดค่าการค้นพบได้เอง:

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

### Extension provider registration

ส่วนขยายสามารถลงทะเบียนผู้ให้บริการขณะทำงาน (runtime) ได้ (`pi.registerProvider(...)`) ซึ่งรวมถึง:

- การแทนที่/การเพิ่มโมเดลสำหรับผู้ให้บริการ
- การลงทะเบียนตัวจัดการสตรีมแบบกำหนดเอง (custom stream handler) สำหรับ API ID ใหม่ๆ
- การลงทะเบียนผู้ให้บริการ OAuth แบบกำหนดเอง

## Auth and API key resolution order

เมื่อมีการขอคีย์สำหรับผู้ให้บริการ ลำดับการทำงานที่มีผลใช้งานคือ:

1. การแทนที่ขณะทำงาน (Runtime override) (ใช้งานผ่าน CLI `--api-key`)
2. ข้อมูลประจำตัว API key ที่จัดเก็บไว้ใน `agent.db`
3. ข้อมูลประจำตัว OAuth ที่จัดเก็บไว้ใน `agent.db` (พร้อมกับการรีเฟรช)
4. การจับคู่ตัวแปรสภาพแวดล้อม (Environment variable mapping) (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, เป็นต้น)
5. ตัวจัดการการสำรอง (fallback resolver) ของ ModelRegistry (`apiKey` ของผู้ให้บริการจาก `models.yml`, รองรับเชิงความหมายแบบ env-name-or-literal)

พฤติกรรมของ `apiKey` ใน `models.yml`:

- ค่าจะถูกประเมินเป็นชื่อของตัวแปรสภาพแวดล้อมเป็นอันดับแรก
- หากไม่มีตัวแปรสภาพแวดล้อมอยู่ ระบบจะใช้สตริงที่มีค่าตรงตัว (literal string) นั้นเป็นโทเค็น

หากตั้งค่า `authHeader: true` และมีการกำหนด `apiKey` ของผู้ให้บริการ โมเดลจะได้รับ:

- การแทรก header `Authorization: Bearer <resolved-key>`

ผู้ให้บริการที่ไม่ต้องใช้คีย์ (Keyless providers):

- ผู้ให้บริการที่มีการระบุ `auth: none` จะถือว่าพร้อมใช้งานโดยไม่ต้องมีข้อมูลประจำตัว (credentials)
- การเรียก `getApiKey*` จะส่งคืน `kNoAuth` สำหรับกลุ่มเหล่านี้

## Model availability vs all models

- `getAll()` ส่งคืนรีจิสทรีของโมเดลที่โหลดไว้ทั้งหมด (โมเดลที่มีมาให้ + ที่กำหนดเองและรวมแล้ว + ที่ค้นพบ)
- `getAvailable()` กรองเฉพาะโมเดลที่ไม่ต้องใช้คีย์ (keyless) หรือมีการตรวจสอบสิทธิ์ที่สามารถหาค่าคีย์ได้ (resolvable auth)

ดังนั้น โมเดลสามารถอยู่ในรีจิสทรีได้ แต่จะไม่สามารถเลือกใช้ได้จนกว่าการตรวจสอบสิทธิ์จะพร้อมใช้งาน

## Runtime model resolution

### CLI and pattern parsing

`model-resolver.ts` รองรับ:

- รูปแบบ `provider/modelId` แบบแม่นยำ (exact)
- รูปแบบ canonical model id แบบแม่นยำ
- รูปแบบ model id แบบแม่นยำ (โดยที่ผู้ให้บริการจะถูกอนุมาน)
- การจับคู่แบบคลุมเครือ/บางส่วน (fuzzy/substring matching)
- รูปแบบ glob scope ใน `--models` (เช่น `openai/*`, `*sonnet*`)
- คำต่อท้าย (suffix) ทางเลือก `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` เป็นแบบดั้งเดิม ควรใช้ `--model` มากกว่า

ลำดับความสำคัญ (precedence) การวิเคราะห์สำหรับตัวเลือกแบบแม่นยำ:

1. รูปแบบ `provider/modelId` แบบแม่นยำจะข้ามกระบวนการรวมเข้าด้วยกัน (coalescing)
2. รูปแบบ canonical id แบบแม่นยำจะวิเคราะห์ผ่าน canonical index
3. รูปแบบ ID ตรงตัวที่ไม่ระบุผู้ให้บริการ (bare concrete id) ยังคงใช้งานได้
4. การจับคู่แบบ fuzzy และ glob จะทำงานหลังจากเส้นทางแบบแม่นยำ

### Initial model selection priority

`findInitialModel(...)` ใช้ลำดับต่อไปนี้:

1. การระบุ provider+model แบบชัดเจนผ่าน CLI
2. โมเดลแรกในขอบเขต (หากไม่ใช่การทำงานต่อ)
3. โมเดล/ผู้ให้บริการเริ่มต้นที่บันทึกไว้
4. ค่าเริ่มต้นของผู้ให้บริการที่เป็นที่รู้จัก (เช่น OpenAI/Anthropic/เป็นต้น) จากกลุ่มโมเดลที่พร้อมใช้งาน
5. โมเดลตัวแรกที่พร้อมใช้งาน

### Role aliases and settings

บทบาทของโมเดลที่รองรับ:

- `default`, `smol`, `slow`, `plan`, `commit`

นามแฝงของบทบาท (Role aliases) เช่น `pi/smol` จะถูกขยายผ่าน `settings.modelRoles` ค่าของบทบาทแต่ละตัวยังสามารถต่อท้ายด้วยตัวเลือกระดับความคิด (thinking selector) ได้ เช่น `:minimal`, `:low`, `:medium`, หรือ `:high`

หากบทบาทชี้ไปยังอีกบทบาทหนึ่ง โมเดลปลายทางยังคงสืบทอด (inherits) ตามปกติ และการใส่คำต่อท้ายที่ระบุชัดเจนบนบทบาทที่อ้างถึง จะมีความสำคัญเหนือกว่าสำหรับการใช้งานเฉพาะบทบาทนั้น

การตั้งค่าที่เกี่ยวข้อง:

- `modelRoles` (บันทึกข้อมูล)
- `enabledModels` (รายการของรูปแบบขอบเขต)
- `modelProviderOrder` (ลำดับความสำคัญของ canonical-provider ระดับโกลบอล)
- `providers.kimiApiFormat` (รูปแบบคำขอ `openai` หรือ `anthropic`)
- `providers.openaiWebsockets` (การตั้งค่า `auto|off|on` สำหรับ websocket ของ OpenAI Codex transport)

`modelRoles` อาจเก็บค่าเป็นอย่างใดอย่างหนึ่งระหว่าง:

- `provider/modelId` เพื่อปักหมุดที่สายพันธุ์โมเดลแบบเจาะจง
- canonical id เช่น `gpt-5.3-codex` เพื่ออนุญาตให้เกิดการรวมแบบผู้ให้บริการหลายราย

สำหรับ `enabledModels` และ CLI `--models`:

- canonical id แบบแม่นยำจะขยายไปยังสายพันธุ์โมเดลเจาะจง (concrete variants) ทั้งหมดในกลุ่ม canonical นั้น
- รายการ `provider/modelId` แบบชัดเจนจะยังคงความแม่นยำไว้
- การจับคู่แบบ globs และ fuzzy ยังคงทำงานบนโมเดลที่เจาะจง

## `/model` and `--list-models`

ทั้งสองช่องทาง (surfaces) จะแสดงโมเดลที่มีคำนำหน้าเป็นชื่อผู้ให้บริการ (provider-prefixed) และสามารถเลือกได้

ทั้งสองช่องทางตอนนี้จะแสดงข้อมูลโมเดลแบบ canonical/coalesced ด้วย:

- `/model` มีมุมมองรูปแบบ canonical ควบคู่ไปกับแท็บผู้ให้บริการ (provider tabs)
- `--list-models` แสดงส่วนที่เป็น canonical ตามด้วยแถวแสดงผู้ให้บริการที่เจาะจง

การเลือกรายการแบบ canonical จะเป็นการบันทึก canonical selector แต่ถ้าเลือกที่แถวแบบผู้ให้บริการ จะเป็นการบันทึก `provider/modelId` แบบชัดเจน

## Context promotion (model-level fallback chains)

การเลื่อนระดับบริบทคือกลไกการกู้คืนเมื่อข้อมูลล้น (overflow recovery mechanism) สำหรับโมเดลสายพันธุ์ที่ใช้บริบทน้อย (ตัวอย่างเช่น `*-spark`) ซึ่งจะเลื่อนระดับโดยอัตโนมัติไปยังพี่น้อง (sibling) ที่รองรับบริบทได้ใหญ่กว่า เมื่อ API ปฏิเสธคำขอจากข้อผิดพลาดความยาวบริบทที่เกิน (context length error)

### Trigger and order

เมื่อการทำงานล้มเหลวเนื่องจากข้อผิดพลาดบริบทล้น (เช่น `context_length_exceeded`) ตัว `AgentSession` จะพยายามทำการเลื่อนระดับ **ก่อน** ที่จะสลับไปใช้งานการบีบอัด (compaction):

1. หาก `contextPromotion.enabled` เป็นจริง (true) ระบบจะค้นหาเป้าหมายการเลื่อนระดับ (ดูด้านล่าง)
2. หากพบเป้าหมาย จะสลับไปใช้เป้าหมายนั้นแล้วลองส่งคำขออีกครั้ง — ไม่ต้องมีการบีบอัด
3. หากไม่มีเป้าหมายที่พร้อมใช้งาน ให้ข้ามไปยังการบีบอัดอัตโนมัติ (auto-compaction) ในโมเดลปัจจุบัน

### Target selection

การเลือกนี้ขับเคลื่อนโดยโมเดล (model-driven) ไม่ใช่โดยบทบาท (role-driven):

1. `currentModel.contextPromotionTarget` (หากได้ตั้งค่าไว้)
2. โมเดลที่มีบริบทใหญ่กว่า แต่มีขนาดเล็กที่สุดของผู้ให้บริการและ API รายเดียวกัน

ตัวเลือกที่เป็นไปได้จะถูกข้าม (ignored) ไป เว้นแต่ว่าจะสามารถตรวจสอบข้อมูลประจำตัวได้ (`ModelRegistry.getApiKey(...)`)

### OpenAI Codex websocket handoff

หากสลับไปมาจาก `openai-codex-responses` สถานะคีย์ (state key) ผู้ให้บริการของเซสชันสำหรับ `openai-codex-responses` จะถูกปิดก่อนสลับโมเดล ซึ่งจะยกเลิกสถานะการส่งผ่าน websocket (websocket transport state) ดังนั้นรอบถัดไปจะเริ่มทำงานอย่างสะอาดหมดจดบนโมเดลใหม่ที่ได้รับการเลื่อนระดับ

### Persistence behavior

การเลื่อนระดับใช้การสลับชั่วคราว (`setModelTemporary`):

- ถูกบันทึกไว้ในฐานะของ `model_change` แบบชั่วคราวในประวัติเซสชัน
- ไม่เขียนทับการแมปบทบาทที่บันทึกไว้

### Configuring explicit fallback chains

กำหนดค่าการสำรองโดยตรงที่ข้อมูล metadata ของโมเดลผ่าน `contextPromotionTarget`

`contextPromotionTarget` รองรับรูปแบบใดรูปแบบหนึ่งดังนี้:

- `provider/model-id` (แบบชัดเจน)
- `model-id` (จะถูกตรวจสอบหา (resolved) ภายในผู้ให้บริการปัจจุบัน)

ตัวอย่าง (`models.yml`) สำหรับ Spark -> ไม่ใช่-Spark (non-Spark) กับผู้ให้บริการเดียวกัน:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

ระบบจำลองรูปแบบ (model generator) ที่มากับระบบจะกำหนดค่านี้ให้โดยอัตโนมัติสำหรับโมเดลจำพวก `*-spark` เมื่อมีโมเดลหลัก (base model) จากผู้ให้บริการเดียวกันอยู่

## Compatibility and routing fields

`models.yml` รองรับเซ็ตย่อย `compat` (compatibility) เหล่านี้:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` หรือ `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

สิ่งเหล่านี้จะถูกนำไปใช้โดยตรรกะการส่งผ่าน (transport logic) แบบ OpenAI-completions และรวมเข้ากับการตรวจหาอัตโนมัติโดยอิงจาก URL (URL-based auto-detection)

## Practical examples

### Local OpenAI-compatible endpoint (no auth)

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

### Hosted proxy with env-based key

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

### Override built-in provider route + model metadata

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

## LiteLLM proxy auto-configuration

เมื่อตัวแปรสภาพแวดล้อมทั้ง `LITELLM_BASE_URL` และ `LITELLM_API_KEY` มีการถูกตั้งค่า ตัว `xcsh` จะจัดการคอนฟิกของ `models.yml` สำหรับพร็อกซี LiteLLM แบบอัตโนมัติ

### First-run auto-generation

หากไม่มี `models.yml` และตรวจพบตัวแปรสภาพแวดล้อมสำหรับ LiteLLM ตัว `xcsh` จะสร้างมันให้โดยอัตโนมัติ:

```yaml
# สร้างโดยอัตโนมัติโดย xcsh สำหรับพร็อกซี LiteLLM
# แก้ไข API key จากตัวแปรสภาพแวดล้อม LITELLM_API_KEY ในขณะทำงาน (runtime)
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

ไฟล์ `config.yml` ค่าเริ่มต้นก็จะถูกสร้างขึ้นมาเช่นกันพร้อมกับการตั้งค่าที่เหมาะสมสำหรับผู้ให้บริการรูปภาพ (image provider)

### Startup self-healing

ในการเริ่มต้นระบบทุกครั้ง ฟังก์ชัน `startupHealthCheck()` ในระบบลงทะเบียนโมเดลจะรันการตรวจสอบดังต่อไปนี้:

| Condition | Action |
|-----------|--------|
| `models.yml` missing | สร้างโดยอัตโนมัติ (Auto-generate) จากตัวแปรสภาพแวดล้อม (env vars) |
| `models.yml` corrupt or unparseable | สำรองไฟล์ (Backup) เป็น `.bak`, จากนั้นสร้างขึ้นใหม่ |
| `baseUrl` doesn't match `LITELLM_BASE_URL` | สำรองไฟล์เป็น `.bak`, สร้างขึ้นใหม่ด้วย URL ใหม่ |
| `configVersion` missing or outdated | สำรองไฟล์เป็น `.bak`, สร้างขึ้นใหม่ด้วยเวอร์ชันล่าสุด |
| Config is healthy | ไม่ดำเนินการใดๆ |

การซ่อมแซมทั้งหมดจะทำการสำรองเป็นไฟล์ `.bak` ก่อนทำการเขียนทับ การดำเนินการทั้งหมดเป็นแบบ idempotent (การทำซ้ำให้ผลเหมือนเดิม)

### CLI command

```bash
xcsh setup litellm              # สร้างหรือแก้ไขการตั้งค่า LiteLLM
xcsh setup litellm --check      # ตรวจสอบความถูกต้องโดยไม่มีการเขียน
xcsh setup litellm --check --json  # ผลลัพธ์การตรวจสอบแบบเครื่องอ่านได้ (Machine-readable)
```

### Required environment variables

| Variable | Purpose |
|----------|---------|
| `LITELLM_BASE_URL` | URL ของพร็อกซี LiteLLM (เช่น `https://your-proxy.example.com`) ต้องขึ้นต้นด้วย `http://` หรือ `https://` |
| `LITELLM_API_KEY` | API key สำหรับพร็อกซี จะถูกอ้างอิงตามชื่อที่ปรากฏในการกำหนดค่าที่สร้างขึ้น ซึ่งจะถูกค้นหาที่ runtime |

หากไม่พบตัวแปรตัวใดตัวหนึ่ง ระบบการกำหนดค่าอัตโนมัติจะถูกข้ามไปอย่างเงียบๆ

### Config versioning

การกำหนดค่าที่สร้างขึ้นมาจะรวมฟิลด์ `configVersion` ไว้ด้วย เมื่อรูปแบบที่ใช้เปลี่ยนไปในอนาคต `xcsh` จะตรวจหาไฟล์กำหนดค่าที่ล้าสมัยและอัปเกรดมันโดยอัตโนมัติ (พร้อมการสำรองข้อมูล)

## Legacy consumer caveat

ขณะนี้การกำหนดค่าโมเดลส่วนใหญ่ถูกควบคุมและจัดการผ่าน `models.yml` ด้วย `ModelRegistry`

มีกระบวนการเก่าอยู่ 1 ส่วนที่ยังคงไว้: การตรวจสอบสิทธิ์ Anthropic ของระบบค้นหาเว็บ (web-search) ที่ยังคงอ่าน `~/.xcsh/agent/models.json` โดยตรงใน `src/web/search/auth.ts`

หากคุณยังพึ่งพากระบวนการส่วนนั้นอยู่ โปรดระวังความเข้ากันได้แบบ JSON ไว้จนกว่าจะมีการปรับปรุงระบบสำหรับมอดูล (module) นั้น

## Failure mode

หาก `models.yml` ไม่ผ่านกระบวนการโครงสร้าง (schema) หรือกระบวนการตรวจสอบความถูกต้อง (validation checks):

- หากมีตัวแปร `LITELLM_BASE_URL` และ `LITELLM_API_KEY` ถูกตั้งค่า การตรวจสอบระบบ (startup health check) จะพยายามซ่อมแซมให้โดยอัตโนมัติ (สำรองไฟล์เสีย สร้างไฟล์ขึ้นใหม่ด้วยค่าจากตัวแปร) ถ้าระบบซ่อมได้สำเร็จ ตัวรีจิสทรีก็จะรีโหลดคอนฟิกใหม่นั้น
- แต่หากซ่อมไม่ได้ (เพราะตัวแปรสภาพแวดล้อมไม่ได้ถูกเซ็ต หรือเกิดปัญหาระหว่างเขียนข้อมูล) ตัวรีจิสทรีก็จะคงการดำเนินการไว้โดยใช้โมเดลแบบ built-in
- ข้อผิดพลาดจะถูกแสดงออกมาผ่าน `ModelRegistry.getError()` และจะแจ้งไปที่หน้าจอการแสดงผลแบบ UI หรือในการแจ้งเตือน (notifications)
