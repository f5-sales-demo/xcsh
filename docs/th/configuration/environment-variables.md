---
title: ตัวแปรสภาพแวดล้อม
description: >-
  เอกสารอ้างอิงตัวแปรสภาพแวดล้อมรันไทม์สำหรับการกำหนดค่าและควบคุมพฤติกรรมของ
  xcsh
sidebar:
  order: 2
  label: ตัวแปรสภาพแวดล้อม
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# ตัวแปรสภาพแวดล้อม (เอกสารอ้างอิงรันไทม์ปัจจุบัน)

เอกสารอ้างอิงนี้ถูกดึงมาจากเส้นทางโค้ดปัจจุบันใน:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (การแก้ไข provider/auth ที่ใช้โดย coding-agent)
- `packages/utils/src/**` และ `packages/tui/src/**` ที่ตัวแปรเหล่านั้นมีผลกระทบโดยตรงต่อรันไทม์ของ coding-agent

เอกสารนี้บันทึกเฉพาะพฤติกรรมที่ใช้งานอยู่เท่านั้น

## โมเดลการแก้ไขและลำดับความสำคัญ

การค้นหาในรันไทม์ส่วนใหญ่ใช้ `$env` จาก `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`)

ลำดับการโหลดของ `$env`:

1. สภาพแวดล้อมกระบวนการที่มีอยู่ (`Bun.env`)
2. `.env` ของโปรเจกต์ (`$PWD/.env`) สำหรับคีย์ที่ยังไม่ได้ตั้งค่า
3. `.env` ของ home (`~/.env`) สำหรับคีย์ที่ยังไม่ได้ตั้งค่า

กฎเพิ่มเติมในไฟล์ `.env`: คีย์ `XCSH_*` จะถูกมิเรอร์เป็นคีย์ `PI_*` ระหว่างการแยกวิเคราะห์

---

## 1) การยืนยันตัวตนของโมเดล/ผู้ให้บริการ

ค่าเหล่านี้ถูกใช้ผ่าน `getEnvApiKey()` (`packages/ai/src/stream.ts`) เว้นแต่จะระบุไว้เป็นอย่างอื่น

### ข้อมูลประจำตัวของผู้ให้บริการหลัก

| ตัวแปร                        | ใช้สำหรับ | จำเป็นเมื่อ                                                 | หมายเหตุ / ลำดับความสำคัญ                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | การยืนยันตัวตน Anthropic API | ใช้ Anthropic กับการยืนยันตัวตนด้วย OAuth token                         | มีความสำคัญเหนือกว่า `ANTHROPIC_API_KEY` สำหรับการแก้ไขการยืนยันตัวตนของผู้ให้บริการ                              |
| `ANTHROPIC_API_KEY`             | การยืนยันตัวตน Anthropic API | ใช้ Anthropic โดยไม่มี OAuth token                           | ทางเลือกสำรองหลังจาก `ANTHROPIC_OAUTH_TOKEN`                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic ผ่าน Azure Foundry / enterprise gateway | เปิดใช้งาน `CLAUDE_CODE_USE_FOUNDRY`                             | มีความสำคัญเหนือกว่า `ANTHROPIC_OAUTH_TOKEN` และ `ANTHROPIC_API_KEY` เมื่อเปิดใช้งานโหมด Foundry  |
| `OPENAI_API_KEY`                | การยืนยันตัวตน OpenAI | ใช้ผู้ให้บริการตระกูล OpenAI โดยไม่มีอาร์กิวเมนต์ apiKey ที่ชัดเจน | ใช้โดยผู้ให้บริการ OpenAI Completions/Responses                                                      |
| `GEMINI_API_KEY`                | การยืนยันตัวตน Google Gemini | ใช้โมเดลผู้ให้บริการ `google`                                | คีย์หลักสำหรับการแมปผู้ให้บริการ Gemini                                                             |
| `GOOGLE_API_KEY`                | ทางเลือกสำรองการยืนยันตัวตนเครื่องมือภาพ Gemini | ใช้เครื่องมือ `gemini_image` โดยไม่มี `GEMINI_API_KEY`            | ใช้โดยเส้นทางสำรองเครื่องมือภาพของ coding-agent                                                       |
| `GROQ_API_KEY`                  | การยืนยันตัวตน Groq | ใช้โมเดล Groq                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | การยืนยันตัวตน Cerebras | ใช้โมเดล Cerebras                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | การยืนยันตัวตน Together | ใช้ผู้ให้บริการ `together`                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | การยืนยันตัวตน Hugging Face | ใช้ผู้ให้บริการ `huggingface`                                  | ตัวแปรสภาพแวดล้อมโทเค็น Hugging Face หลัก                                                                  |
| `HF_TOKEN`                      | การยืนยันตัวตน Hugging Face | ใช้ผู้ให้บริการ `huggingface`                                  | ทางเลือกสำรองเมื่อ `HUGGINGFACE_HUB_TOKEN` ไม่ได้ตั้งค่า                                                      |
| `SYNTHETIC_API_KEY`             | การยืนยันตัวตน Synthetic | ใช้โมเดล Synthetic                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | การยืนยันตัวตน NVIDIA | ใช้ผู้ให้บริการ `nvidia`                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | การยืนยันตัวตน NanoGPT | ใช้ผู้ให้บริการ `nanogpt`                                      |                                                                                                     |
| `VENICE_API_KEY`                | การยืนยันตัวตน Venice | ใช้ผู้ให้บริการ `venice`                                       |                                                                                                     |
| `LITELLM_API_KEY`               | การยืนยันตัวตน LiteLLM | ใช้ผู้ให้บริการ `litellm`                                      | คีย์พร็อกซี LiteLLM ที่เข้ากันได้กับ OpenAI เมื่อตั้งค่าร่วมกับ `LITELLM_BASE_URL` จะเปิดใช้งานการกำหนดค่าอัตโนมัติของ `models.yml` |
| `LM_STUDIO_API_KEY`             | การยืนยันตัวตน LM Studio (ตัวเลือก) | ใช้ผู้ให้บริการ `lm-studio` กับโฮสต์ที่ต้องยืนยันตัวตน           | โดยปกติ LM Studio ในเครื่องทำงานโดยไม่ต้องยืนยันตัวตน; โทเค็นที่ไม่ว่างใด ๆ ก็ใช้ได้เมื่อต้องการคีย์         |
| `OLLAMA_API_KEY`                | การยืนยันตัวตน Ollama (ตัวเลือก) | ใช้ผู้ให้บริการ `ollama` กับโฮสต์ที่ต้องยืนยันตัวตน              | โดยปกติ Ollama ในเครื่องทำงานโดยไม่ต้องยืนยันตัวตน; โทเค็นที่ไม่ว่างใด ๆ ก็ใช้ได้เมื่อต้องการคีย์            |
| `LLAMA_CPP_API_KEY`             | การยืนยันตัวตน Ollama (ตัวเลือก) | ใช้ `llama-server` กับพารามิเตอร์ `--api-key`              | โดยปกติ llama.cpp ในเครื่องทำงานโดยไม่ต้องยืนยันตัวตน; โทเค็นที่ไม่ว่างใด ๆ ก็ใช้ได้เมื่อกำหนดค่าคีย์       |
| `XIAOMI_API_KEY`                | การยืนยันตัวตน Xiaomi MiMo | ใช้ผู้ให้บริการ `xiaomi`                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | การยืนยันตัวตน Moonshot | ใช้ผู้ให้บริการ `moonshot`                                     |                                                                                                     |
| `XAI_API_KEY`                   | การยืนยันตัวตน xAI | ใช้โมเดล xAI                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | การยืนยันตัวตน OpenRouter | ใช้โมเดล OpenRouter                                       | ยังใช้โดยเครื่องมือภาพเมื่อผู้ให้บริการที่ต้องการ/อัตโนมัติเป็น OpenRouter                                  |
| `MISTRAL_API_KEY`               | การยืนยันตัวตน Mistral | ใช้โมเดล Mistral                                          |                                                                                                     |
| `ZAI_API_KEY`                   | การยืนยันตัวตน z.ai | ใช้โมเดล z.ai                                             | ยังใช้โดยผู้ให้บริการค้นหาเว็บ z.ai                                                               |
| `MINIMAX_API_KEY`               | การยืนยันตัวตน MiniMax | ใช้ผู้ให้บริการ `minimax`                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | การยืนยันตัวตน MiniMax Code | ใช้ผู้ให้บริการ `minimax-code`                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | การยืนยันตัวตน MiniMax Code CN | ใช้ผู้ให้บริการ `minimax-code-cn`                              |                                                                                                     |
| `OPENCODE_API_KEY`              | การยืนยันตัวตน OpenCode | ใช้โมเดล OpenCode                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | การยืนยันตัวตน Qianfan | ใช้ผู้ให้บริการ `qianfan`                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | การยืนยันตัวตน Qwen Portal | ใช้ `qwen-portal` กับ OAuth token                          | มีความสำคัญเหนือกว่า `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | การยืนยันตัวตน Qwen Portal | ใช้ `qwen-portal` กับ API key                              | ทางเลือกสำรองหลังจาก `QWEN_OAUTH_TOKEN`                                                                   |
| `ZENMUX_API_KEY`                | การยืนยันตัวตน ZenMux | ใช้ผู้ให้บริการ `zenmux`                                       | ใช้สำหรับเส้นทางที่เข้ากันได้กับ ZenMux OpenAI และ Anthropic                                              |
| `VLLM_API_KEY`                  | การยืนยันตัวตน/การค้นพบ vLLM | ใช้ผู้ให้บริการ `vllm` (เซิร์ฟเวอร์ในเครื่องที่เข้ากันได้กับ OpenAI)       | ค่าที่ไม่ว่างใด ๆ ก็ใช้ได้สำหรับเซิร์ฟเวอร์ในเครื่องที่ไม่ต้องยืนยันตัวตน                                                 |
| `CURSOR_ACCESS_TOKEN`           | การยืนยันตัวตนผู้ให้บริการ Cursor | ใช้ผู้ให้บริการ Cursor                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | การยืนยันตัวตน Vercel AI Gateway | ใช้ผู้ให้บริการ `vercel-ai-gateway`                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | การยืนยันตัวตน Cloudflare AI Gateway | ใช้ผู้ให้บริการ `cloudflare-ai-gateway`                        | Base URL ต้องกำหนดค่าเป็น `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### ลูกโซ่โทเค็น GitHub/Copilot

| ตัวแปร | ใช้สำหรับ | ลูกโซ่ |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | การยืนยันตัวตนผู้ให้บริการ GitHub Copilot | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | ทางเลือกสำรอง Copilot; การยืนยันตัวตน GitHub API ใน web scraper | ใน web scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | ทางเลือกสำรอง Copilot; การยืนยันตัวตน GitHub API ใน web scraper | ใน web scraper: ตรวจสอบก่อน `GH_TOKEN` |

---

## 2) การกำหนดค่ารันไทม์เฉพาะผู้ให้บริการ

### Anthropic Foundry Gateway (Azure / enterprise proxy)

เมื่อเปิดใช้งาน `CLAUDE_CODE_USE_FOUNDRY` คำขอ Anthropic จะเปลี่ยนเป็นโหมด Foundry:

- Base URL แก้ไขจาก `FOUNDRY_BASE_URL` (ทางเลือกสำรองยังคงเป็น base URL ของโมเดล/ค่าเริ่มต้นหากไม่ได้ตั้งค่า)
- การแก้ไข API key สำหรับผู้ให้บริการ `anthropic` กลายเป็น:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`
- `ANTHROPIC_CUSTOM_HEADERS` ถูกแยกวิเคราะห์เป็นคู่ `key: value` ที่คั่นด้วยเครื่องหมายจุลภาค/ขึ้นบรรทัดใหม่ และรวมเข้ากับส่วนหัวของคำขอ
- สามารถฉีดข้อมูล TLS ไคลเอนต์/เซิร์ฟเวอร์จากค่าสภาพแวดล้อม:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`
  แต่ละตัวรับ:
  - เส้นทางระบบไฟล์ไปยังเนื้อหา PEM หรือ
  - PEM แบบอินไลน์ (รวมถึงลำดับ `\n` ที่ escaped)

| ตัวแปร | ประเภทค่า | พฤติกรรม |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | สตริงคล้ายบูลีน (`1`, `true`, `yes`, `on`) | เปิดใช้งานโหมด Foundry สำหรับผู้ให้บริการ Anthropic |
| `FOUNDRY_BASE_URL` | สตริง URL | Base URL ปลายทาง Anthropic ในโหมด Foundry |
| `ANTHROPIC_FOUNDRY_API_KEY` | สตริงโทเค็น | ใช้สำหรับ `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | สตริงรายการส่วนหัว | ส่วนหัวเพิ่มเติม; รูปแบบ `header-a: value, header-b: value` หรือคั่นด้วยขึ้นบรรทัดใหม่ |
| `NODE_EXTRA_CA_CERTS` | เส้นทาง PEM หรือ PEM แบบอินไลน์ | ลูกโซ่ CA เพิ่มเติมสำหรับการตรวจสอบใบรับรองเซิร์ฟเวอร์ |
| `CLAUDE_CODE_CLIENT_CERT` | เส้นทาง PEM หรือ PEM แบบอินไลน์ | ใบรับรองไคลเอนต์ mTLS |
| `CLAUDE_CODE_CLIENT_KEY` | เส้นทาง PEM หรือ PEM แบบอินไลน์ | คีย์ส่วนตัวไคลเอนต์ mTLS (ต้องจับคู่กับใบรับรอง) |

### Amazon Bedrock

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `AWS_REGION` | แหล่งข้อมูลภูมิภาคหลัก |
| `AWS_DEFAULT_REGION` | ทางเลือกสำรองหาก `AWS_REGION` ไม่ได้ตั้งค่า |
| `AWS_PROFILE` | เปิดใช้งานเส้นทางการยืนยันตัวตนแบบ named profile |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | เปิดใช้งานเส้นทางการยืนยันตัวตนด้วย IAM key |
| `AWS_BEARER_TOKEN_BEDROCK` | เปิดใช้งานเส้นทางการยืนยันตัวตนด้วย bearer token |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | เปิดใช้งานเส้นทางข้อมูลประจำตัว ECS task |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | เปิดใช้งานเส้นทางการยืนยันตัวตนด้วย web identity |
| `AWS_BEDROCK_SKIP_AUTH` | หากเป็น `1` จะฉีดข้อมูลประจำตัวจำลอง (สถานการณ์พร็อกซี/ไม่ต้องยืนยันตัวตน) |
| `AWS_BEDROCK_FORCE_HTTP1` | หากเป็น `1` บังคับใช้ตัวจัดการคำขอ Node HTTP/1 |

ลำดับทางเลือกสำรองภูมิภาคในโค้ดผู้ให้บริการ: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`

### Azure OpenAI Responses

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `AZURE_OPENAI_API_KEY` | จำเป็นเว้นแต่จะส่ง API key เป็นตัวเลือก |
| `AZURE_OPENAI_API_VERSION` | ค่าเริ่มต้น `v1` |
| `AZURE_OPENAI_BASE_URL` | การแทนที่ base URL โดยตรง |
| `AZURE_OPENAI_RESOURCE_NAME` | ใช้เพื่อสร้าง base URL: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | สตริงการแมปตัวเลือก: `modelId=deploymentName,model2=deployment2` |

การแก้ไข Base URL: ตัวเลือก `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → ตัวเลือก/env ชื่อทรัพยากร → `model.baseUrl`

### Google Vertex AI

| ตัวแปร | จำเป็น? | หมายเหตุ |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | ใช่ (เว้นแต่จะส่งในตัวเลือก) | ทางเลือกสำรอง: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | ทางเลือกสำรอง | ใช้เป็นแหล่ง project ID ทางเลือก |
| `GOOGLE_CLOUD_LOCATION` | ใช่ (เว้นแต่จะส่งในตัวเลือก) | ไม่มีค่าเริ่มต้นในผู้ให้บริการ |
| `GOOGLE_APPLICATION_CREDENTIALS` | เงื่อนไข | หากตั้งค่า ไฟล์ต้องมีอยู่; มิฉะนั้นจะตรวจสอบเส้นทางสำรอง ADC (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | การแทนที่โฮสต์ OAuth หลัก |
| `KIMI_OAUTH_HOST` | การแทนที่โฮสต์ OAuth สำรอง |
| `KIMI_CODE_BASE_URL` | แทนที่ base URL ปลายทางการใช้งาน Kimi (`usage/kimi.ts`) |

ลูกโซ่โฮสต์ OAuth: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`

### ความเข้ากันได้ของ Antigravity/Gemini image

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | แทนที่แท็กเวอร์ชัน user-agent ของ Antigravity ในผู้ให้บริการ Gemini CLI |

### OpenAI Codex responses (การควบคุมฟีเจอร์/การดีบัก)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` เปิดใช้งานการบันทึกดีบักของผู้ให้บริการ Codex |
| `PI_CODEX_WEBSOCKET` | `1`/`true` เปิดใช้งานการเลือกใช้การขนส่งแบบ websocket |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` เปิดใช้งานเส้นทาง websocket v2 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | การแทนที่จำนวนเต็มบวก (ค่าเริ่มต้น 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | การแทนที่จำนวนเต็มไม่ติดลบ (ค่าเริ่มต้น 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | การแทนที่ base backoff จำนวนเต็มบวก (ค่าเริ่มต้น 500) |

### การดีบักผู้ให้บริการ Cursor

| ตัวแปร | พฤติกรรม |
|---|---|
| `DEBUG_CURSOR` | เปิดใช้งานบันทึกดีบักของผู้ให้บริการ; `2`/`verbose` สำหรับตัวอย่าง payload โดยละเอียด |
| `DEBUG_CURSOR_LOG` | เส้นทางไฟล์ตัวเลือกสำหรับเอาต์พุตบันทึกดีบัก JSONL |

### สวิตช์ความเข้ากันได้ของ prompt cache

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_CACHE_RETENTION` | หากเป็น `long` จะเปิดใช้งานการเก็บรักษาระยะยาวที่รองรับ (`anthropic`, `openai-responses`, การแก้ไขการเก็บรักษา Bedrock) |

---

## 3) ระบบย่อยค้นหาเว็บ

### ข้อมูลประจำตัวผู้ให้บริการค้นหา

| ตัวแปร | ใช้โดย |
|---|---|
| `EXA_API_KEY` | ผู้ให้บริการค้นหา Exa และเครื่องมือ Exa MCP |
| `BRAVE_API_KEY` | ผู้ให้บริการค้นหา Brave |
| `PERPLEXITY_API_KEY` | โหมด API-key ของผู้ให้บริการค้นหา Perplexity |
| `TAVILY_API_KEY` | ผู้ให้บริการค้นหา Tavily |
| `ZAI_API_KEY` | ผู้ให้บริการค้นหา z.ai (ตรวจสอบ OAuth ที่จัดเก็บใน `agent.db` ด้วย) |
| `OPENAI_API_KEY` / Codex OAuth ใน DB | ความพร้อมใช้งาน/การยืนยันตัวตนของผู้ให้บริการค้นหา Codex |

### ลูกโซ่การยืนยันตัวตนค้นหาเว็บ Anthropic

`packages/coding-agent/src/web/search/auth.ts` แก้ไขข้อมูลประจำตัวค้นหาเว็บ Anthropic ในลำดับนี้:

1. `ANTHROPIC_SEARCH_API_KEY` (+ ตัวเลือก `ANTHROPIC_SEARCH_BASE_URL`)
2. รายการผู้ให้บริการ `models.json` ที่มี `api: "anthropic-messages"`
3. ข้อมูลประจำตัว OAuth ของ Anthropic จาก `agent.db` (ต้องไม่หมดอายุภายในบัฟเฟอร์ 5 นาที)
4. ทางเลือกสำรองสภาพแวดล้อม Anthropic ทั่วไป: คีย์ผู้ให้บริการ (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + ตัวเลือก `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` เมื่อเปิดใช้งานโหมด Foundry)

ตัวแปรที่เกี่ยวข้อง:

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | คีย์ค้นหาที่ชัดเจนที่มีลำดับความสำคัญสูงสุด |
| `ANTHROPIC_SEARCH_BASE_URL` | ค่าเริ่มต้นเป็น `https://api.anthropic.com` เมื่อไม่ระบุ |
| `ANTHROPIC_SEARCH_MODEL` | ค่าเริ่มต้นเป็น `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | Base URL สำรองทั่วไปสำหรับเส้นทางการยืนยันตัวตนระดับ 4 |

### แฟล็กพฤติกรรม OAuth flow ของ Perplexity

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_AUTH_NO_BORROW` | หากตั้งค่า จะปิดใช้งานเส้นทางการยืมโทเค็นแอปเนทีฟ macOS ใน flow เข้าสู่ระบบ Perplexity |

---

## 4) เครื่องมือ Python และรันไทม์เคอร์เนล

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_PY` | การแทนที่โหมดเครื่องมือ Python: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; ค่าที่ไม่ถูกต้องจะถูกเพิกเฉย |
| `PI_PYTHON_SKIP_CHECK` | หากเป็น `1` จะข้ามการตรวจสอบความพร้อมใช้งาน/การอุ่นเครื่องเคอร์เนล Python |
| `PI_PYTHON_GATEWAY_URL` | หากตั้งค่า จะใช้เกตเวย์เคอร์เนลภายนอกแทนเกตเวย์ที่ใช้ร่วมกันในเครื่อง |
| `PI_PYTHON_GATEWAY_TOKEN` | โทเค็นการยืนยันตัวตนตัวเลือกสำหรับเกตเวย์ภายนอก (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | หากเป็น `1` จะเปิดใช้งานเส้นทาง IPC trace ระดับต่ำในโมดูลเคอร์เนล |
| `VIRTUAL_ENV` | เส้นทาง venv ที่มีลำดับความสำคัญสูงสุดสำหรับการแก้ไขรันไทม์ Python |

พฤติกรรมเงื่อนไขเพิ่มเติม:

- หาก `BUN_ENV=test` หรือ `NODE_ENV=test` การตรวจสอบความพร้อมใช้งาน Python จะถือว่าผ่าน และการอุ่นเครื่องจะถูกข้าม
- การกรองสภาพแวดล้อม Python จะปฏิเสธ API key ทั่วไปและอนุญาตตัวแปรฐานที่ปลอดภัย + คำนำหน้า `LC_`, `XDG_`, `PI_`

---

## 5) สวิตช์พฤติกรรม Agent/รันไทม์

| ตัวแปร                   | ค่าเริ่มต้น / พฤติกรรม                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | การแทนที่ model-role ชั่วคราวสำหรับ `smol` (CLI `--smol` มีความสำคัญเหนือกว่า)                     |
| `PI_SLOW_MODEL`            | การแทนที่ model-role ชั่วคราวสำหรับ `slow` (CLI `--slow` มีความสำคัญเหนือกว่า)                     |
| `PI_PLAN_MODEL`            | การแทนที่ model-role ชั่วคราวสำหรับ `plan` (CLI `--plan` มีความสำคัญเหนือกว่า)                     |
| `PI_NO_TITLE`              | หากตั้งค่า (ค่าที่ไม่ว่างใด ๆ) จะปิดใช้งานการสร้างชื่อเซสชันอัตโนมัติเมื่อข้อความผู้ใช้แรก   |
| `NULL_PROMPT`              | หากเป็น `true` ตัวสร้าง system prompt จะคืนค่าสตริงว่าง                                        |
| `PI_BLOCKED_AGENT`         | บล็อกประเภท subagent เฉพาะในเครื่องมือ task                                                 |
| `PI_SUBPROCESS_CMD`        | แทนที่คำสั่ง spawn ของ subagent (ข้ามการแก้ไข `xcsh` / `xcsh.cmd`)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | จำนวนไบต์เอาต์พุตสูงสุดที่จับได้ต่อ subagent (ค่าเริ่มต้น `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | จำนวนบรรทัดเอาต์พุตสูงสุดที่จับได้ต่อ subagent (ค่าเริ่มต้น `5000`)                                      |
| `PI_TIMING`                | หากเป็น `1` จะเปิดใช้งานบันทึกการวัดเวลา startup/tool                                     |
| `PI_DEBUG_STARTUP`         | เปิดใช้งานการพิมพ์ดีบักขั้นตอน startup ไปยัง stderr ในเส้นทาง startup หลายเส้นทาง                       |
| `PI_PACKAGE_DIR`           | แทนที่การแก้ไขไดเรกทอรีฐานสินทรัพย์แพ็กเกจ (การค้นหาเส้นทาง docs/examples/changelog)            |
| `PI_DISABLE_LSPMUX`        | หากเป็น `1` จะปิดใช้งานการตรวจจับ/การรวม lspmux และบังคับการเรียกใช้เซิร์ฟเวอร์ LSP โดยตรง          |
| `LITELLM_BASE_URL`         | Base URL พร็อกซี LiteLLM เมื่อตั้งค่าร่วมกับ `LITELLM_API_KEY` จะทริกเกอร์การสร้างอัตโนมัติของ `models.yml` ในการรันครั้งแรกและการซ่อมแซมอัตโนมัติในทุกการเริ่มต้น |
| `LM_STUDIO_BASE_URL`       | การแทนที่ base URL การค้นพบ LM Studio โดยนัยเริ่มต้น (`http://127.0.0.1:1234/v1` หากไม่ได้ตั้งค่า) |
| `OLLAMA_BASE_URL`          | การแทนที่ base URL การค้นพบ Ollama โดยนัยเริ่มต้น (`http://127.0.0.1:11434` หากไม่ได้ตั้งค่า)      |
| `LLAMA_CPP_BASE_URL`       | การแทนที่ base URL การค้นพบ Llama.cpp โดยนัยเริ่มต้น (`http://127.0.0.1:8080` หากไม่ได้ตั้งค่า)    |
| `PI_EDIT_VARIANT`          | หากเป็น `hashline` จะบังคับโหมดแสดงผล hashline read/grep เมื่อเครื่องมือแก้ไขพร้อมใช้งาน               |
| `PI_NO_PTY`                | หากเป็น `1` จะปิดใช้งานเส้นทาง PTY แบบโต้ตอบสำหรับเครื่องมือ bash                                          |

`PI_NO_PTY` ยังถูกตั้งค่าภายในเมื่อใช้ CLI `--no-pty`

---

## 6) เส้นทางรากของพื้นที่จัดเก็บและการกำหนดค่า

ค่าเหล่านี้ถูกใช้ผ่าน `@f5xc-salesdemos/pi-utils/dirs` และมีผลต่อตำแหน่งที่ coding-agent จัดเก็บข้อมูล

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_CONFIG_DIR` | ชื่อไดเรกทอรีรากการกำหนดค่าภายใต้ home (ค่าเริ่มต้น `.xcsh`) |
| `PI_CODING_AGENT_DIR` | การแทนที่เต็มสำหรับไดเรกทอรี agent (ค่าเริ่มต้น `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | ใช้เมื่อจับคู่ไดเรกทอรีทำงานปัจจุบันแบบ canonical ในตัวช่วยเส้นทาง |

---

## 7) สภาพแวดล้อมการทำงานของเชลล์/เครื่องมือ

(จาก `packages/utils/src/procmgr.ts` และการรวมเครื่องมือ bash ของ coding-agent)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_BASH_NO_CI` | ระงับการฉีด `CI=true` อัตโนมัติในสภาพแวดล้อมเชลล์ที่ spawn |
| `CLAUDE_BASH_NO_CI` | นามแฝงแบบเดิมสำรองสำหรับ `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | มีวัตถุประสงค์เพื่อปิดใช้งานโหมดเชลล์ login |
| `CLAUDE_BASH_NO_LOGIN` | นามแฝงแบบเดิมสำรองสำหรับ `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | ตัวห่อคำสั่งนำหน้าตัวเลือก |
| `CLAUDE_CODE_SHELL_PREFIX` | นามแฝงแบบเดิมสำรองสำหรับ `PI_SHELL_PREFIX` |
| `VISUAL` | คำสั่งตัวแก้ไขภายนอกที่ต้องการ |
| `EDITOR` | คำสั่งตัวแก้ไขภายนอกสำรอง |

หมายเหตุการใช้งานปัจจุบัน: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` ถูกอ่าน แต่ `getShellArgs()` ปัจจุบันคืนค่า `['-l','-c']` ในทั้งสองสาขา (ไม่มีผลในปัจจุบัน)

---

## 8) การตรวจจับ UI/ธีม/เซสชัน (สภาพแวดล้อมที่ตรวจจับอัตโนมัติ)

ค่าเหล่านี้ถูกอ่านเป็นสัญญาณรันไทม์; โดยปกติจะถูกตั้งค่าโดยเทอร์มินัล/ระบบปฏิบัติการแทนที่จะกำหนดค่าด้วยตนเอง

| ตัวแปร | ใช้สำหรับ |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | การตรวจจับความสามารถสี (โหมดสีธีม) |
| `COLORFGBG` | การตรวจจับอัตโนมัติพื้นหลังเทอร์มินัลสว่าง/มืด |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | เอกลักษณ์เทอร์มินัลใน system prompt/บริบท |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | การตรวจจับเดสก์ท็อป/ตัวจัดการหน้าต่างใน system prompt/บริบท |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | ID breadcrumb เซสชันต่อเทอร์มินัลที่เสถียร |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | การวินิจฉัยข้อมูลระบบ |
| `APPDATA`, `XDG_CONFIG_HOME` | การแก้ไขเส้นทางการกำหนดค่า lspmux |
| `HOME` | การย่อเส้นทางใน UI คำสั่ง MCP |

---

## 9) แฟล็กดีบัก/ตัวโหลดเนทีฟ

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_DEV` | เปิดใช้งานการวินิจฉัยการโหลด native addon แบบละเอียดใน `packages/natives` |

## 10) แฟล็กรันไทม์ TUI (แพ็กเกจที่ใช้ร่วมกัน มีผลต่อ UX ของ coding-agent)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` ระงับการแจ้งเตือนเดสก์ท็อป |
| `PI_TUI_WRITE_LOG` | หากตั้งค่า จะบันทึกการเขียน TUI ลงไฟล์ |
| `PI_HARDWARE_CURSOR` | หากเป็น `1` จะเปิดใช้งานโหมดเคอร์เซอร์ฮาร์ดแวร์ |
| `PI_CLEAR_ON_SHRINK` | หากเป็น `1` จะล้างแถวว่างเมื่อเนื้อหาหดตัว |
| `PI_DEBUG_REDRAW` | หากเป็น `1` จะเปิดใช้งานการบันทึกดีบักการวาดใหม่ |
| `PI_TUI_DEBUG` | หากเป็น `1` จะเปิดใช้งานเส้นทาง debug dump เชิงลึกของ TUI |

---

## 11) การควบคุมการสร้างคอมมิต

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | หากเป็น `true` (ไม่คำนึงตัวพิมพ์เล็กใหญ่) จะบังคับเส้นทางการสร้างคอมมิตสำรอง |
| `PI_COMMIT_NO_FALLBACK` | หากเป็น `true` จะปิดใช้งานทางเลือกสำรองเมื่อ agent ไม่คืนข้อเสนอ |
| `PI_COMMIT_MAP_REDUCE` | หากเป็น `false` จะปิดใช้งานเส้นทางการวิเคราะห์คอมมิตแบบ map-reduce |
| `DEBUG` | หากตั้งค่า จะพิมพ์ stack trace ข้อผิดพลาดของ commit agent |

---

## ตัวแปรที่เกี่ยวกับความปลอดภัย

ถือว่าค่าเหล่านี้เป็นข้อมูลลับ; อย่าบันทึกหรือคอมมิต:

- คีย์ผู้ให้บริการ/API และข้อมูลประจำตัว OAuth/bearer (ทั้งหมดที่เป็น `*_API_KEY`, `*_TOKEN`, โทเค็น access/refresh ของ OAuth)
- ข้อมูลประจำตัวคลาวด์ (`AWS_*`, เส้นทาง `GOOGLE_APPLICATION_CREDENTIALS` อาจเปิดเผยข้อมูล service-account)
- ตัวแปรการยืนยันตัวตนค้นหา/ผู้ให้บริการ (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, คีย์ค้นหา Anthropic)
- ข้อมูล mTLS ของ Foundry (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` เมื่อชี้ไปยังบันเดิล CA ส่วนตัว)

รันไทม์ Python ยังลบตัวแปรคีย์ทั่วไปหลายตัวอย่างชัดเจนก่อนที่จะ spawn กระบวนการย่อยเคอร์เนล (`packages/coding-agent/src/ipy/runtime.ts`)
