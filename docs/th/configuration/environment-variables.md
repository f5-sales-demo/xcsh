---
title: Environment Variables
description: >-
  Runtime environment variable reference for xcsh configuration and behavior
  control.
sidebar:
  order: 2
  label: Environment variables
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# ตัวแปรสภาพแวดล้อม (เอกสารอ้างอิงรันไทม์ปัจจุบัน)

เอกสารอ้างอิงนี้ได้มาจากเส้นทางโค้ดปัจจุบันใน:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (การแก้ไข provider/auth ที่ใช้โดย coding-agent)
- `packages/utils/src/**` และ `packages/tui/src/**` ที่ตัวแปรเหล่านั้นส่งผลต่อรันไทม์ของ coding-agent โดยตรง

เอกสารนี้บันทึกเฉพาะพฤติกรรมที่ใช้งานอยู่เท่านั้น

## โมเดลการแก้ไขและลำดับความสำคัญ

การค้นหาในรันไทม์ส่วนใหญ่ใช้ `$env` จาก `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`)

ลำดับการโหลดของ `$env`:

1. สภาพแวดล้อมของโปรเซสที่มีอยู่ (`Bun.env`)
2. `.env` ของโปรเจกต์ (`$PWD/.env`) สำหรับคีย์ที่ยังไม่ได้ตั้งค่า
3. `.env` ของโฮม (`~/.env`) สำหรับคีย์ที่ยังไม่ได้ตั้งค่า

กฎเพิ่มเติมในไฟล์ `.env`: คีย์ `XCSH_*` จะถูกมิเรอร์ไปเป็นคีย์ `PI_*` ระหว่างการแยกวิเคราะห์

---

## 1) การยืนยันตัวตนของโมเดล/ผู้ให้บริการ

ตัวแปรเหล่านี้ถูกใช้ผ่าน `getEnvApiKey()` (`packages/ai/src/stream.ts`) เว้นแต่จะระบุไว้เป็นอย่างอื่น

### ข้อมูลรับรองผู้ให้บริการหลัก

| ตัวแปร                        | ใช้สำหรับ | จำเป็นเมื่อ                                                 | หมายเหตุ / ลำดับความสำคัญ                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | การยืนยันตัวตน Anthropic API | ใช้ Anthropic ด้วยการยืนยันตัวตนแบบ OAuth token                         | มีความสำคัญเหนือกว่า `ANTHROPIC_API_KEY` ในการแก้ไขการยืนยันตัวตนของ provider              |
| `ANTHROPIC_API_KEY`             | การยืนยันตัวตน Anthropic API | ใช้ Anthropic โดยไม่มี OAuth token                           | ใช้เป็นตัวสำรองหลังจาก `ANTHROPIC_OAUTH_TOKEN`                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic ผ่าน Azure Foundry / enterprise gateway | เปิดใช้งาน `CLAUDE_CODE_USE_FOUNDRY`                             | มีความสำคัญเหนือกว่า `ANTHROPIC_OAUTH_TOKEN` และ `ANTHROPIC_API_KEY` เมื่อเปิดใช้โหมด Foundry  |
| `OPENAI_API_KEY`                | การยืนยันตัวตน OpenAI | ใช้ provider ตระกูล OpenAI โดยไม่มี apiKey argument ที่ระบุชัดเจน | ใช้โดย OpenAI Completions/Responses providers                                                      |
| `GEMINI_API_KEY`                | การยืนยันตัวตน Google Gemini | ใช้โมเดล provider `google`                                | คีย์หลักสำหรับการแมป Gemini provider                                                             |
| `GOOGLE_API_KEY`                | การยืนยันตัวตนสำรองของเครื่องมือภาพ Gemini | ใช้เครื่องมือ `gemini_image` โดยไม่มี `GEMINI_API_KEY`            | ใช้โดยเส้นทางสำรองของเครื่องมือภาพ coding-agent                                                       |
| `GROQ_API_KEY`                  | การยืนยันตัวตน Groq | ใช้โมเดล Groq                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | การยืนยันตัวตน Cerebras | ใช้โมเดล Cerebras                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | การยืนยันตัวตน Together | ใช้ provider `together`                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | การยืนยันตัวตน Hugging Face | ใช้ provider `huggingface`                                  | ตัวแปรสภาพแวดล้อม token หลักของ Hugging Face                                                                  |
| `HF_TOKEN`                      | การยืนยันตัวตน Hugging Face | ใช้ provider `huggingface`                                  | ใช้เป็นตัวสำรองเมื่อไม่ได้ตั้งค่า `HUGGINGFACE_HUB_TOKEN`                                                      |
| `SYNTHETIC_API_KEY`             | การยืนยันตัวตน Synthetic | ใช้โมเดล Synthetic                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | การยืนยันตัวตน NVIDIA | ใช้ provider `nvidia`                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | การยืนยันตัวตน NanoGPT | ใช้ provider `nanogpt`                                      |                                                                                                     |
| `VENICE_API_KEY`                | การยืนยันตัวตน Venice | ใช้ provider `venice`                                       |                                                                                                     |
| `LITELLM_API_KEY`               | การยืนยันตัวตน LiteLLM | ใช้ provider `litellm`                                      | คีย์พร็อกซี LiteLLM ที่เข้ากันได้กับ OpenAI เมื่อตั้งค่าร่วมกับ `LITELLM_BASE_URL` จะเปิดใช้งานการกำหนดค่า `models.yml` อัตโนมัติ |
| `LM_STUDIO_API_KEY`             | การยืนยันตัวตน LM Studio (ไม่บังคับ) | ใช้ provider `lm-studio` กับโฮสต์ที่ต้องการยืนยันตัวตน           | โดยปกติ LM Studio ในเครื่องทำงานโดยไม่ต้องยืนยันตัวตน; token ที่ไม่ว่างใดๆ ก็ใช้ได้เมื่อต้องการคีย์         |
| `OLLAMA_API_KEY`                | การยืนยันตัวตน Ollama (ไม่บังคับ) | ใช้ provider `ollama` กับโฮสต์ที่ต้องการยืนยันตัวตน              | โดยปกติ Ollama ในเครื่องทำงานโดยไม่ต้องยืนยันตัวตน; token ที่ไม่ว่างใดๆ ก็ใช้ได้เมื่อต้องการคีย์            |
| `LLAMA_CPP_API_KEY`             | การยืนยันตัวตน Ollama (ไม่บังคับ) | ใช้ `llama-server` กับพารามิเตอร์ `--api-key`              | โดยปกติ llama.cpp ในเครื่องทำงานโดยไม่ต้องยืนยันตัวตน; token ที่ไม่ว่างใดๆ ก็ใช้ได้เมื่อมีการกำหนดค่าคีย์       |
| `XIAOMI_API_KEY`                | การยืนยันตัวตน Xiaomi MiMo | ใช้ provider `xiaomi`                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | การยืนยันตัวตน Moonshot | ใช้ provider `moonshot`                                     |                                                                                                     |
| `XAI_API_KEY`                   | การยืนยันตัวตน xAI | ใช้โมเดล xAI                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | การยืนยันตัวตน OpenRouter | ใช้โมเดล OpenRouter                                       | ยังใช้โดยเครื่องมือภาพเมื่อ provider ที่ต้องการ/อัตโนมัติคือ OpenRouter                                  |
| `MISTRAL_API_KEY`               | การยืนยันตัวตน Mistral | ใช้โมเดล Mistral                                          |                                                                                                     |
| `ZAI_API_KEY`                   | การยืนยันตัวตน z.ai | ใช้โมเดล z.ai                                             | ยังใช้โดย z.ai web search provider                                                               |
| `MINIMAX_API_KEY`               | การยืนยันตัวตน MiniMax | ใช้ provider `minimax`                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | การยืนยันตัวตน MiniMax Code | ใช้ provider `minimax-code`                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | การยืนยันตัวตน MiniMax Code CN | ใช้ provider `minimax-code-cn`                              |                                                                                                     |
| `OPENCODE_API_KEY`              | การยืนยันตัวตน OpenCode | ใช้โมเดล OpenCode                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | การยืนยันตัวตน Qianfan | ใช้ provider `qianfan`                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | การยืนยันตัวตน Qwen Portal | ใช้ `qwen-portal` ด้วย OAuth token                          | มีความสำคัญเหนือกว่า `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | การยืนยันตัวตน Qwen Portal | ใช้ `qwen-portal` ด้วย API key                              | ใช้เป็นตัวสำรองหลังจาก `QWEN_OAUTH_TOKEN`                                                                   |
| `ZENMUX_API_KEY`                | การยืนยันตัวตน ZenMux | ใช้ provider `zenmux`                                       | ใช้สำหรับเส้นทาง ZenMux ที่เข้ากันได้กับ OpenAI และ Anthropic                                              |
| `VLLM_API_KEY`                  | การยืนยันตัวตน/การค้นพบ vLLM แบบ opt-in | ใช้ provider `vllm` (เซิร์ฟเวอร์ในเครื่องที่เข้ากันได้กับ OpenAI)       | ค่าที่ไม่ว่างใดๆ ก็ใช้ได้สำหรับเซิร์ฟเวอร์ในเครื่องที่ไม่ต้องยืนยันตัวตน                                                 |
| `CURSOR_ACCESS_TOKEN`           | การยืนยันตัวตน Cursor provider | ใช้ Cursor provider                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | การยืนยันตัวตน Vercel AI Gateway | ใช้ provider `vercel-ai-gateway`                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | การยืนยันตัวตน Cloudflare AI Gateway | ใช้ provider `cloudflare-ai-gateway`                        | ต้องกำหนดค่า Base URL เป็น `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### ลำดับ token ของ GitHub/Copilot

| ตัวแปร | ใช้สำหรับ | ลำดับ |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | การยืนยันตัวตน GitHub Copilot provider | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | ตัวสำรอง Copilot; การยืนยันตัวตน GitHub API ใน web scraper | ใน web scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | ตัวสำรอง Copilot; การยืนยันตัวตน GitHub API ใน web scraper | ใน web scraper: ตรวจสอบก่อน `GH_TOKEN` |

---

## 2) การกำหนดค่ารันไทม์เฉพาะผู้ให้บริการ

### Anthropic Foundry Gateway (Azure / enterprise proxy)

เมื่อเปิดใช้งาน `CLAUDE_CODE_USE_FOUNDRY` คำขอ Anthropic จะสลับไปเป็นโหมด Foundry:

- Base URL จะแก้ไขจาก `FOUNDRY_BASE_URL` (ถ้าไม่ได้ตั้งค่า จะใช้ base URL เริ่มต้นของโมเดลแทน)
- การแก้ไข API key สำหรับ provider `anthropic` จะกลายเป็น:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`
- `ANTHROPIC_CUSTOM_HEADERS` จะถูกแยกวิเคราะห์เป็นคู่ `key: value` ที่คั่นด้วยเครื่องหมายจุลภาคหรือบรรทัดใหม่ แล้วรวมเข้ากับ request headers
- สามารถฉีดวัสดุ TLS client/server จากค่าสภาพแวดล้อม:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`
  แต่ละตัวรับได้ทั้ง:
  - เส้นทางระบบไฟล์ไปยังเนื้อหา PEM หรือ
  - PEM แบบอินไลน์ (รวมถึงลำดับ `\n` ที่ถูก escape)

| ตัวแปร | ประเภทค่า | พฤติกรรม |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | สตริงคล้ายบูลีน (`1`, `true`, `yes`, `on`) | เปิดใช้โหมด Foundry สำหรับ Anthropic provider |
| `FOUNDRY_BASE_URL` | สตริง URL | Base URL ของ Anthropic endpoint ในโหมด Foundry |
| `ANTHROPIC_FOUNDRY_API_KEY` | สตริง token | ใช้สำหรับ `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | สตริงรายการ header | headers เพิ่มเติม; รูปแบบ `header-a: value, header-b: value` หรือคั่นด้วยบรรทัดใหม่ |
| `NODE_EXTRA_CA_CERTS` | เส้นทาง PEM หรือ PEM แบบอินไลน์ | CA chain เพิ่มเติมสำหรับการตรวจสอบใบรับรองเซิร์ฟเวอร์ |
| `CLAUDE_CODE_CLIENT_CERT` | เส้นทาง PEM หรือ PEM แบบอินไลน์ | ใบรับรอง client สำหรับ mTLS |
| `CLAUDE_CODE_CLIENT_KEY` | เส้นทาง PEM หรือ PEM แบบอินไลน์ | คีย์ส่วนตัว client สำหรับ mTLS (ต้องจับคู่กับใบรับรอง) |

### Amazon Bedrock

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `AWS_REGION` | แหล่งข้อมูลภูมิภาคหลัก |
| `AWS_DEFAULT_REGION` | ตัวสำรองถ้าไม่ได้ตั้งค่า `AWS_REGION` |
| `AWS_PROFILE` | เปิดใช้เส้นทางการยืนยันตัวตนด้วยโปรไฟล์ที่มีชื่อ |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | เปิดใช้เส้นทางการยืนยันตัวตนด้วย IAM key |
| `AWS_BEARER_TOKEN_BEDROCK` | เปิดใช้เส้นทางการยืนยันตัวตนด้วย bearer token |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | เปิดใช้เส้นทางข้อมูลรับรองงาน ECS |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | เปิดใช้เส้นทางการยืนยันตัวตนด้วย web identity |
| `AWS_BEDROCK_SKIP_AUTH` | ถ้า `1` จะฉีดข้อมูลรับรองจำลอง (สถานการณ์ proxy/ไม่ต้องยืนยันตัวตน) |
| `AWS_BEDROCK_FORCE_HTTP1` | ถ้า `1` จะบังคับใช้ Node HTTP/1 request handler |

ลำดับสำรองภูมิภาคในโค้ด provider: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`

### Azure OpenAI Responses

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `AZURE_OPENAI_API_KEY` | จำเป็นเว้นแต่จะส่ง API key เป็น option |
| `AZURE_OPENAI_API_VERSION` | ค่าเริ่มต้น `v1` |
| `AZURE_OPENAI_BASE_URL` | การ override base URL โดยตรง |
| `AZURE_OPENAI_RESOURCE_NAME` | ใช้สร้าง base URL: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | สตริงการแมปที่ไม่บังคับ: `modelId=deploymentName,model2=deployment2` |

การแก้ไข Base URL: option `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → option/env resource name → `model.baseUrl`

### Google Vertex AI

| ตัวแปร | จำเป็น? | หมายเหตุ |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | ใช่ (เว้นแต่ส่งผ่าน options) | ตัวสำรอง: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | ตัวสำรอง | ใช้เป็นแหล่งข้อมูล project ID สำรอง |
| `GOOGLE_CLOUD_LOCATION` | ใช่ (เว้นแต่ส่งผ่าน options) | ไม่มีค่าเริ่มต้นใน provider |
| `GOOGLE_APPLICATION_CREDENTIALS` | มีเงื่อนไข | ถ้าตั้งค่าไว้ ไฟล์ต้องมีอยู่; มิฉะนั้นจะตรวจสอบเส้นทาง ADC สำรอง (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | การ override โฮสต์ OAuth หลัก |
| `KIMI_OAUTH_HOST` | การ override โฮสต์ OAuth สำรอง |
| `KIMI_CODE_BASE_URL` | override base URL ของ Kimi usage endpoint (`usage/kimi.ts`) |

ลำดับโฮสต์ OAuth: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`

### ความเข้ากันได้ของ Antigravity/Gemini image

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | override แท็กเวอร์ชัน user-agent ของ Antigravity ใน Gemini CLI provider |

### OpenAI Codex responses (ตัวควบคุมฟีเจอร์/ดีบัก)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` เปิดใช้การบันทึกดีบักของ Codex provider |
| `PI_CODEX_WEBSOCKET` | `1`/`true` เปิดใช้การเลือกใช้ websocket transport |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` เปิดใช้เส้นทาง websocket v2 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | override จำนวนเต็มบวก (ค่าเริ่มต้น 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | override จำนวนเต็มไม่ติดลบ (ค่าเริ่มต้น 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | override base backoff จำนวนเต็มบวก (ค่าเริ่มต้น 500) |

### การดีบัก Cursor provider

| ตัวแปร | พฤติกรรม |
|---|---|
| `DEBUG_CURSOR` | เปิดใช้บันทึกดีบักของ provider; `2`/`verbose` สำหรับส่วนย่อย payload โดยละเอียด |
| `DEBUG_CURSOR_LOG` | เส้นทางไฟล์ที่ไม่บังคับสำหรับเอาต์พุตบันทึกดีบัก JSONL |

### สวิตช์ความเข้ากันได้ของ prompt cache

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_CACHE_RETENTION` | ถ้า `long` จะเปิดใช้การเก็บรักษาระยะยาวในที่ที่รองรับ (`anthropic`, `openai-responses`, การแก้ไขการเก็บรักษา Bedrock) |

---

## 3) ระบบย่อยการค้นหาเว็บ

### ข้อมูลรับรองผู้ให้บริการค้นหา

| ตัวแปร | ใช้โดย |
|---|---|
| `EXA_API_KEY` | Exa search provider และเครื่องมือ Exa MCP |
| `BRAVE_API_KEY` | Brave search provider |
| `PERPLEXITY_API_KEY` | โหมด API-key ของ Perplexity search provider |
| `TAVILY_API_KEY` | Tavily search provider |
| `ZAI_API_KEY` | z.ai search provider (ยังตรวจสอบ OAuth ที่จัดเก็บใน `agent.db`) |
| `OPENAI_API_KEY` / Codex OAuth ใน DB | ความพร้อมใช้งาน/การยืนยันตัวตนของ Codex search provider |

### ลำดับการยืนยันตัวตนสำหรับ Anthropic web search

`packages/coding-agent/src/web/search/auth.ts` แก้ไขข้อมูลรับรอง Anthropic web-search ตามลำดับนี้:

1. `ANTHROPIC_SEARCH_API_KEY` (+ `ANTHROPIC_SEARCH_BASE_URL` ที่ไม่บังคับ)
2. รายการ provider ใน `models.json` ที่มี `api: "anthropic-messages"`
3. ข้อมูลรับรอง Anthropic OAuth จาก `agent.db` (ต้องไม่หมดอายุภายในบัฟเฟอร์ 5 นาที)
4. ตัวสำรอง Anthropic env ทั่วไป: คีย์ provider (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + `ANTHROPIC_BASE_URL` ที่ไม่บังคับ (`FOUNDRY_BASE_URL` เมื่อเปิดใช้โหมด Foundry)

ตัวแปรที่เกี่ยวข้อง:

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | คีย์ค้นหาที่ระบุชัดเจนที่มีความสำคัญสูงสุด |
| `ANTHROPIC_SEARCH_BASE_URL` | ค่าเริ่มต้นเป็น `https://api.anthropic.com` เมื่อไม่ได้ระบุ |
| `ANTHROPIC_SEARCH_MODEL` | ค่าเริ่มต้นเป็น `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | Base URL สำรองทั่วไปสำหรับเส้นทางการยืนยันตัวตนระดับที่ 4 |

### แฟล็กพฤติกรรม OAuth flow ของ Perplexity

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_AUTH_NO_BORROW` | ถ้าตั้งค่าไว้ จะปิดใช้เส้นทางการยืม token จากแอปเนทีฟ macOS ในขั้นตอนเข้าสู่ระบบ Perplexity |

---

## 4) เครื่องมือ Python และรันไทม์ kernel

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_PY` | override โหมดเครื่องมือ Python: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; ค่าที่ไม่ถูกต้องจะถูกข้าม |
| `PI_PYTHON_SKIP_CHECK` | ถ้า `1` จะข้ามการตรวจสอบความพร้อมใช้งาน/การอุ่นเครื่อง Python kernel |
| `PI_PYTHON_GATEWAY_URL` | ถ้าตั้งค่าไว้ จะใช้ kernel gateway ภายนอกแทน shared gateway ในเครื่อง |
| `PI_PYTHON_GATEWAY_TOKEN` | token การยืนยันตัวตนที่ไม่บังคับสำหรับ gateway ภายนอก (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | ถ้า `1` จะเปิดใช้เส้นทาง IPC trace ระดับต่ำในโมดูล kernel |
| `VIRTUAL_ENV` | เส้นทาง venv ที่มีความสำคัญสูงสุดสำหรับการแก้ไขรันไทม์ Python |

พฤติกรรมเงื่อนไขเพิ่มเติม:

- ถ้า `BUN_ENV=test` หรือ `NODE_ENV=test` การตรวจสอบความพร้อมใช้งาน Python จะถือว่า OK และจะข้ามการอุ่นเครื่อง
- การกรองสภาพแวดล้อม Python จะปฏิเสธ API key ทั่วไปและอนุญาตตัวแปรฐานที่ปลอดภัย + คำนำหน้า `LC_`, `XDG_`, `PI_`

---

## 5) ตัวสลับพฤติกรรม Agent/รันไทม์

| ตัวแปร                   | ค่าเริ่มต้น / พฤติกรรม                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | override model-role แบบชั่วคราวสำหรับ `smol` (CLI `--smol` มีความสำคัญเหนือกว่า)                     |
| `PI_SLOW_MODEL`            | override model-role แบบชั่วคราวสำหรับ `slow` (CLI `--slow` มีความสำคัญเหนือกว่า)                     |
| `PI_PLAN_MODEL`            | override model-role แบบชั่วคราวสำหรับ `plan` (CLI `--plan` มีความสำคัญเหนือกว่า)                     |
| `PI_NO_TITLE`              | ถ้าตั้งค่าไว้ (ค่าที่ไม่ว่างใดๆ) จะปิดใช้การสร้างชื่อเซสชันอัตโนมัติเมื่อผู้ใช้ส่งข้อความแรก   |
| `NULL_PROMPT`              | ถ้า `true` ตัวสร้าง system prompt จะคืนค่าสตริงว่าง                                        |
| `PI_BLOCKED_AGENT`         | บล็อกประเภท subagent เฉพาะในเครื่องมือ task                                                 |
| `PI_SUBPROCESS_CMD`        | override คำสั่งสร้าง subagent (ข้ามการแก้ไข `xcsh` / `xcsh.cmd`)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | ไบต์เอาต์พุตที่จับได้สูงสุดต่อ subagent (ค่าเริ่มต้น `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | บรรทัดเอาต์พุตที่จับได้สูงสุดต่อ subagent (ค่าเริ่มต้น `5000`)                                      |
| `PI_TIMING`                | ถ้า `1` จะเปิดใช้บันทึกการวัดเวลาเครื่องมือ/การเริ่มต้น                                     |
| `PI_DEBUG_STARTUP`         | เปิดใช้การพิมพ์ดีบักขั้นตอนเริ่มต้นไปยัง stderr ในหลายเส้นทางเริ่มต้น                       |
| `PI_PACKAGE_DIR`           | override การแก้ไขไดเรกทอรีฐานของแพ็กเกจ asset (การค้นหาเส้นทาง docs/examples/changelog)            |
| `PI_DISABLE_LSPMUX`        | ถ้า `1` จะปิดใช้การตรวจจับ/การรวม lspmux และบังคับสร้าง LSP server โดยตรง          |
| `LITELLM_BASE_URL`         | Base URL ของ LiteLLM proxy เมื่อตั้งค่าร่วมกับ `LITELLM_API_KEY` จะทริกเกอร์การสร้าง `models.yml` อัตโนมัติในการรันครั้งแรกและการซ่อมแซมอัตโนมัติในทุกครั้งที่เริ่มต้น |
| `LM_STUDIO_BASE_URL`       | override base URL ค้นพบ LM Studio โดยปริยาย (ค่าเริ่มต้น `http://127.0.0.1:1234/v1` ถ้าไม่ได้ตั้งค่า) |
| `OLLAMA_BASE_URL`          | override base URL ค้นพบ Ollama โดยปริยาย (ค่าเริ่มต้น `http://127.0.0.1:11434` ถ้าไม่ได้ตั้งค่า)      |
| `LLAMA_CPP_BASE_URL`       | override base URL ค้นพบ Llama.cpp โดยปริยาย (ค่าเริ่มต้น `http://127.0.0.1:8080` ถ้าไม่ได้ตั้งค่า)    |
| `PI_EDIT_VARIANT`          | ถ้า `hashline` จะบังคับโหมดแสดง hashline read/grep เมื่อเครื่องมือ edit พร้อมใช้งาน               |
| `PI_NO_PTY`                | ถ้า `1` จะปิดใช้เส้นทาง PTY แบบโต้ตอบสำหรับเครื่องมือ bash                                          |

`PI_NO_PTY` ยังถูกตั้งค่าภายในเมื่อใช้ CLI `--no-pty`

---

## 6) เส้นทางรูทของที่เก็บข้อมูลและการกำหนดค่า

ตัวแปรเหล่านี้ถูกใช้ผ่าน `@f5xc-salesdemos/pi-utils/dirs` และส่งผลต่อตำแหน่งที่ coding-agent จัดเก็บข้อมูล

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_CONFIG_DIR` | ชื่อไดเรกทอรีรูทของการกำหนดค่าภายใต้โฮม (ค่าเริ่มต้น `.xcsh`) |
| `PI_CODING_AGENT_DIR` | override เต็มรูปแบบสำหรับไดเรกทอรี agent (ค่าเริ่มต้น `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | ใช้เมื่อจับคู่ไดเรกทอรีทำงานปัจจุบันตามมาตรฐานในตัวช่วยเส้นทาง |

---

## 7) สภาพแวดล้อมการดำเนินการ Shell/เครื่องมือ

(จาก `packages/utils/src/procmgr.ts` และการรวมเครื่องมือ bash ของ coding-agent)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_BASH_NO_CI` | ระงับการฉีด `CI=true` อัตโนมัติเข้าสู่สภาพแวดล้อม shell ที่สร้างขึ้น |
| `CLAUDE_BASH_NO_CI` | นามแฝงสำรองแบบเดิมสำหรับ `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | มีไว้สำหรับปิดใช้โหมด login shell |
| `CLAUDE_BASH_NO_LOGIN` | นามแฝงสำรองแบบเดิมสำหรับ `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | ตัวครอบคำสั่งนำหน้าที่ไม่บังคับ |
| `CLAUDE_CODE_SHELL_PREFIX` | นามแฝงสำรองแบบเดิมสำหรับ `PI_SHELL_PREFIX` |
| `VISUAL` | คำสั่งตัวแก้ไขภายนอกที่ต้องการ |
| `EDITOR` | คำสั่งตัวแก้ไขภายนอกสำรอง |

หมายเหตุการใช้งานปัจจุบัน: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` ถูกอ่าน แต่ `getShellArgs()` ปัจจุบันคืนค่า `['-l','-c']` ในทั้งสองกรณี (ไม่มีผลในทางปฏิบัติในปัจจุบัน)

---

## 8) การตรวจจับ UI/ธีม/เซสชัน (สภาพแวดล้อมที่ตรวจจับอัตโนมัติ)

ตัวแปรเหล่านี้ถูกอ่านเป็นสัญญาณรันไทม์; โดยปกติจะถูกตั้งค่าโดยเทอร์มินัล/ระบบปฏิบัติการแทนที่จะกำหนดค่าด้วยตนเอง

| ตัวแปร | ใช้สำหรับ |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | การตรวจจับความสามารถด้านสี (โหมดสีของธีม) |
| `COLORFGBG` | การตรวจจับอัตโนมัติพื้นหลังสว่าง/มืดของเทอร์มินัล |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | การระบุตัวตนเทอร์มินัลใน system prompt/บริบท |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | การตรวจจับเดสก์ท็อป/ตัวจัดการหน้าต่างใน system prompt/บริบท |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | ID breadcrumb เซสชันต่อเทอร์มินัลที่เสถียร |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | การวินิจฉัยข้อมูลระบบ |
| `APPDATA`, `XDG_CONFIG_HOME` | การแก้ไขเส้นทางการกำหนดค่า lspmux |
| `HOME` | การย่อเส้นทางใน MCP command UI |

---

## 9) แฟล็กเนทีฟ loader/ดีบัก

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_DEV` | เปิดใช้การวินิจฉัยการโหลด native addon แบบละเอียดใน `packages/natives` |

## 10) แฟล็กรันไทม์ TUI (แพ็กเกจที่ใช้ร่วมกัน ส่งผลต่อ UX ของ coding-agent)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` ระงับการแจ้งเตือนบนเดสก์ท็อป |
| `PI_TUI_WRITE_LOG` | ถ้าตั้งค่าไว้ จะบันทึกการเขียน TUI ลงไฟล์ |
| `PI_HARDWARE_CURSOR` | ถ้า `1` จะเปิดใช้โหมด hardware cursor |
| `PI_CLEAR_ON_SHRINK` | ถ้า `1` จะล้างแถวว่างเมื่อเนื้อหาหดลง |
| `PI_DEBUG_REDRAW` | ถ้า `1` จะเปิดใช้การบันทึกดีบักการวาดใหม่ |
| `PI_TUI_DEBUG` | ถ้า `1` จะเปิดใช้เส้นทาง TUI debug dump เชิงลึก |

---

## 11) ตัวควบคุมการสร้าง commit

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | ถ้า `true` (ไม่คำนึงถึงตัวพิมพ์) จะบังคับเส้นทางการสร้าง commit สำรอง |
| `PI_COMMIT_NO_FALLBACK` | ถ้า `true` จะปิดใช้ตัวสำรองเมื่อ agent ไม่คืนค่าข้อเสนอ |
| `PI_COMMIT_MAP_REDUCE` | ถ้า `false` จะปิดใช้เส้นทางการวิเคราะห์ commit แบบ map-reduce |
| `DEBUG` | ถ้าตั้งค่าไว้ จะพิมพ์ stack trace ข้อผิดพลาดของ commit agent |

---

## ตัวแปรที่มีความอ่อนไหวด้านความปลอดภัย

ปฏิบัติต่อตัวแปรเหล่านี้เป็นความลับ; อย่าบันทึกหรือ commit:

- คีย์ provider/API และข้อมูลรับรอง OAuth/bearer (ทั้งหมดที่เป็น `*_API_KEY`, `*_TOKEN`, access/refresh token ของ OAuth)
- ข้อมูลรับรองคลาวด์ (`AWS_*`, เส้นทาง `GOOGLE_APPLICATION_CREDENTIALS` อาจเปิดเผยข้อมูลบัญชีบริการ)
- ตัวแปรการยืนยันตัวตนค้นหา/ผู้ให้บริการ (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, คีย์ค้นหา Anthropic)
- วัสดุ mTLS ของ Foundry (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` เมื่อชี้ไปยังบันเดิล CA ส่วนตัว)

Python runtime ยังลบตัวแปรคีย์ทั่วไปจำนวนมากอย่างชัดเจนก่อนสร้างโปรเซสย่อย kernel (`packages/coding-agent/src/ipy/runtime.ts`)
