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
- `packages/utils/src/**` และ `packages/tui/src/**` เฉพาะที่ตัวแปรเหล่านั้นส่งผลโดยตรงต่อรันไทม์ของ coding-agent

เอกสารนี้ครอบคลุมเฉพาะพฤติกรรมที่ใช้งานจริงเท่านั้น

## โมเดลการแก้ไขและลำดับความสำคัญ

การค้นหารันไทม์ส่วนใหญ่ใช้ `$env` จาก `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`)

ลำดับการโหลดของ `$env`:

1. สภาพแวดล้อมของโปรเซสที่มีอยู่ (`Bun.env`)
2. `.env` ของโปรเจกต์ (`$PWD/.env`) สำหรับคีย์ที่ยังไม่ได้ตั้งค่า
3. `.env` ของ home (`~/.env`) สำหรับคีย์ที่ยังไม่ได้ตั้งค่า

กฎเพิ่มเติมในไฟล์ `.env`: คีย์ `XCSH_*` จะถูกมิเรอร์เป็นคีย์ `PI_*` ระหว่างการแยกวิเคราะห์

---

## 1) การยืนยันตัวตนของ Model/Provider

สิ่งเหล่านี้ถูกใช้งานผ่าน `getEnvApiKey()` (`packages/ai/src/stream.ts`) เว้นแต่จะระบุไว้เป็นอย่างอื่น

### ข้อมูลรับรองของ Provider หลัก

| ตัวแปร                        | ใช้สำหรับ | จำเป็นเมื่อ                                                 | หมายเหตุ / ลำดับความสำคัญ                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | การยืนยันตัวตน Anthropic API | ใช้ Anthropic กับการยืนยันตัวตนแบบ OAuth token                         | มีลำดับความสำคัญเหนือ `ANTHROPIC_API_KEY` สำหรับการแก้ไขการยืนยันตัวตน provider                              |
| `ANTHROPIC_API_KEY`             | การยืนยันตัวตน Anthropic API | ใช้ Anthropic โดยไม่มี OAuth token                           | ทางเลือกสำรองหลังจาก `ANTHROPIC_OAUTH_TOKEN`                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic ผ่าน Azure Foundry / enterprise gateway | เปิดใช้งาน `CLAUDE_CODE_USE_FOUNDRY`                             | มีลำดับความสำคัญเหนือ `ANTHROPIC_OAUTH_TOKEN` และ `ANTHROPIC_API_KEY` เมื่อเปิดใช้โหมด Foundry  |
| `OPENAI_API_KEY`                | การยืนยันตัวตน OpenAI | ใช้ provider ตระกูล OpenAI โดยไม่มีอาร์กิวเมนต์ apiKey ที่ระบุชัดเจน | ใช้โดย OpenAI Completions/Responses providers                                                      |
| `GEMINI_API_KEY`                | การยืนยันตัวตน Google Gemini | ใช้โมเดล provider `google`                                | คีย์หลักสำหรับการแมป Gemini provider                                                             |
| `GOOGLE_API_KEY`                | ทางเลือกสำรองการยืนยันตัวตนเครื่องมือรูปภาพ Gemini | ใช้เครื่องมือ `gemini_image` โดยไม่มี `GEMINI_API_KEY`            | ใช้โดยเส้นทางสำรองเครื่องมือรูปภาพของ coding-agent                                                       |
| `GROQ_API_KEY`                  | การยืนยันตัวตน Groq | ใช้โมเดล Groq                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | การยืนยันตัวตน Cerebras | ใช้โมเดล Cerebras                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | การยืนยันตัวตน Together | ใช้ provider `together`                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | การยืนยันตัวตน Hugging Face | ใช้ provider `huggingface`                                  | ตัวแปร token หลักของ Hugging Face                                                                  |
| `HF_TOKEN`                      | การยืนยันตัวตน Hugging Face | ใช้ provider `huggingface`                                  | ทางเลือกสำรองเมื่อไม่ได้ตั้งค่า `HUGGINGFACE_HUB_TOKEN`                                                      |
| `SYNTHETIC_API_KEY`             | การยืนยันตัวตน Synthetic | ใช้โมเดล Synthetic                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | การยืนยันตัวตน NVIDIA | ใช้ provider `nvidia`                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | การยืนยันตัวตน NanoGPT | ใช้ provider `nanogpt`                                      |                                                                                                     |
| `VENICE_API_KEY`                | การยืนยันตัวตน Venice | ใช้ provider `venice`                                       |                                                                                                     |
| `LITELLM_API_KEY`               | การยืนยันตัวตน LiteLLM | ใช้ provider `litellm`                                      | คีย์ proxy LiteLLM ที่เข้ากันได้กับ OpenAI เมื่อตั้งค่าพร้อม `LITELLM_BASE_URL` จะเปิดใช้งานการกำหนดค่า `models.yml` อัตโนมัติ |
| `LM_STUDIO_API_KEY`             | การยืนยันตัวตน LM Studio (ไม่บังคับ) | ใช้ provider `lm-studio` กับโฮสต์ที่ต้องยืนยันตัวตน           | LM Studio ในเครื่องมักจะทำงานโดยไม่ต้องยืนยันตัวตน; token ที่ไม่ว่างเปล่าใดๆ ก็ใช้ได้เมื่อต้องการคีย์         |
| `OLLAMA_API_KEY`                | การยืนยันตัวตน Ollama (ไม่บังคับ) | ใช้ provider `ollama` กับโฮสต์ที่ต้องยืนยันตัวตน              | Ollama ในเครื่องมักจะทำงานโดยไม่ต้องยืนยันตัวตน; token ที่ไม่ว่างเปล่าใดๆ ก็ใช้ได้เมื่อต้องการคีย์            |
| `LLAMA_CPP_API_KEY`             | การยืนยันตัวตน Ollama (ไม่บังคับ) | ใช้ `llama-server` กับพารามิเตอร์ `--api-key`              | llama.cpp ในเครื่องมักจะทำงานโดยไม่ต้องยืนยันตัวตน; token ที่ไม่ว่างเปล่าใดๆ ก็ใช้ได้เมื่อกำหนดค่าคีย์       |
| `XIAOMI_API_KEY`                | การยืนยันตัวตน Xiaomi MiMo | ใช้ provider `xiaomi`                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | การยืนยันตัวตน Moonshot | ใช้ provider `moonshot`                                     |                                                                                                     |
| `XAI_API_KEY`                   | การยืนยันตัวตน xAI | ใช้โมเดล xAI                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | การยืนยันตัวตน OpenRouter | ใช้โมเดล OpenRouter                                       | ยังใช้โดยเครื่องมือรูปภาพเมื่อ provider ที่ต้องการ/อัตโนมัติคือ OpenRouter                                  |
| `MISTRAL_API_KEY`               | การยืนยันตัวตน Mistral | ใช้โมเดล Mistral                                          |                                                                                                     |
| `ZAI_API_KEY`                   | การยืนยันตัวตน z.ai | ใช้โมเดล z.ai                                             | ยังใช้โดย z.ai web search provider                                                               |
| `MINIMAX_API_KEY`               | การยืนยันตัวตน MiniMax | ใช้ provider `minimax`                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | การยืนยันตัวตน MiniMax Code | ใช้ provider `minimax-code`                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | การยืนยันตัวตน MiniMax Code CN | ใช้ provider `minimax-code-cn`                              |                                                                                                     |
| `OPENCODE_API_KEY`              | การยืนยันตัวตน OpenCode | ใช้โมเดล OpenCode                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | การยืนยันตัวตน Qianfan | ใช้ provider `qianfan`                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | การยืนยันตัวตน Qwen Portal | ใช้ `qwen-portal` กับ OAuth token                          | มีลำดับความสำคัญเหนือ `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | การยืนยันตัวตน Qwen Portal | ใช้ `qwen-portal` กับ API key                              | ทางเลือกสำรองหลังจาก `QWEN_OAUTH_TOKEN`                                                                   |
| `ZENMUX_API_KEY`                | การยืนยันตัวตน ZenMux | ใช้ provider `zenmux`                                       | ใช้สำหรับเส้นทางที่เข้ากันได้กับ ZenMux OpenAI และ Anthropic                                              |
| `VLLM_API_KEY`                  | การยืนยันตัวตน/การค้นหา vLLM | ใช้ provider `vllm` (เซิร์ฟเวอร์ที่เข้ากันได้กับ OpenAI ในเครื่อง)       | ค่าที่ไม่ว่างเปล่าใดๆ ก็ใช้ได้สำหรับเซิร์ฟเวอร์ในเครื่องที่ไม่ต้องยืนยันตัวตน                                                 |
| `CURSOR_ACCESS_TOKEN`           | การยืนยันตัวตน Cursor provider | ใช้ Cursor provider                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | การยืนยันตัวตน Vercel AI Gateway | ใช้ provider `vercel-ai-gateway`                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | การยืนยันตัวตน Cloudflare AI Gateway | ใช้ provider `cloudflare-ai-gateway`                        | ต้องกำหนดค่า Base URL เป็น `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### ลำดับ token ของ GitHub/Copilot

| ตัวแปร | ใช้สำหรับ | ลำดับ |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | การยืนยันตัวตน GitHub Copilot provider | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | ทางเลือกสำรอง Copilot; การยืนยันตัวตน GitHub API ใน web scraper | ใน web scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | ทางเลือกสำรอง Copilot; การยืนยันตัวตน GitHub API ใน web scraper | ใน web scraper: ตรวจสอบก่อน `GH_TOKEN` |

---

## 2) การกำหนดค่ารันไทม์เฉพาะ Provider

### Anthropic Foundry Gateway (Azure / enterprise proxy)

เมื่อเปิดใช้งาน `CLAUDE_CODE_USE_FOUNDRY` คำขอ Anthropic จะเปลี่ยนเป็นโหมด Foundry:

- Base URL แก้ไขจาก `FOUNDRY_BASE_URL` (ทางเลือกสำรองยังคงเป็น base URL ของ model/default หากไม่ได้ตั้งค่า)
- การแก้ไข API key สำหรับ provider `anthropic` จะเป็น:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`
- `ANTHROPIC_CUSTOM_HEADERS` จะถูกแยกวิเคราะห์เป็นคู่ `key: value` ที่คั่นด้วยเครื่องหมายจุลภาคหรือบรรทัดใหม่ และรวมเข้ากับ request headers
- วัสดุ TLS client/server สามารถฉีดจากค่า env:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`
  แต่ละตัวรับได้ทั้ง:
  - พาธของระบบไฟล์ไปยังเนื้อหา PEM หรือ
  - PEM แบบอินไลน์ (รวมถึงลำดับ `\n` ที่ถูก escape)

| ตัวแปร | ประเภทค่า | พฤติกรรม |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | สตริงคล้ายบูลีน (`1`, `true`, `yes`, `on`) | เปิดใช้งานโหมด Foundry สำหรับ Anthropic provider |
| `FOUNDRY_BASE_URL` | สตริง URL | Base URL ของ endpoint Anthropic ในโหมด Foundry |
| `ANTHROPIC_FOUNDRY_API_KEY` | สตริง token | ใช้สำหรับ `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | สตริงรายการ header | Headers เพิ่มเติม; รูปแบบ `header-a: value, header-b: value` หรือคั่นด้วยบรรทัดใหม่ |
| `NODE_EXTRA_CA_CERTS` | พาธ PEM หรือ PEM แบบอินไลน์ | CA chain เพิ่มเติมสำหรับการตรวจสอบใบรับรองเซิร์ฟเวอร์ |
| `CLAUDE_CODE_CLIENT_CERT` | พาธ PEM หรือ PEM แบบอินไลน์ | ใบรับรอง mTLS client |
| `CLAUDE_CODE_CLIENT_KEY` | พาธ PEM หรือ PEM แบบอินไลน์ | คีย์ส่วนตัว mTLS client (ต้องจับคู่กับ cert) |

### Amazon Bedrock

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `AWS_REGION` | แหล่ง region หลัก |
| `AWS_DEFAULT_REGION` | ทางเลือกสำรองหากไม่ได้ตั้งค่า `AWS_REGION` |
| `AWS_PROFILE` | เปิดใช้งานเส้นทางการยืนยันตัวตนแบบ named profile |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | เปิดใช้งานเส้นทางการยืนยันตัวตนแบบ IAM key |
| `AWS_BEARER_TOKEN_BEDROCK` | เปิดใช้งานเส้นทางการยืนยันตัวตนแบบ bearer token |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | เปิดใช้งานเส้นทาง credential ของ ECS task |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | เปิดใช้งานเส้นทางการยืนยันตัวตนแบบ web identity |
| `AWS_BEDROCK_SKIP_AUTH` | หากเป็น `1` จะฉีด credentials จำลอง (สถานการณ์ proxy/ไม่ต้องยืนยันตัวตน) |
| `AWS_BEDROCK_FORCE_HTTP1` | หากเป็น `1` จะบังคับใช้ Node HTTP/1 request handler |

ทางเลือกสำรอง region ในโค้ด provider: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`

### Azure OpenAI Responses

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `AZURE_OPENAI_API_KEY` | จำเป็น เว้นแต่จะส่ง API key เป็น option |
| `AZURE_OPENAI_API_VERSION` | ค่าเริ่มต้น `v1` |
| `AZURE_OPENAI_BASE_URL` | การ override base URL โดยตรง |
| `AZURE_OPENAI_RESOURCE_NAME` | ใช้สร้าง base URL: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | สตริงแมปปิ้งที่ไม่บังคับ: `modelId=deploymentName,model2=deployment2` |

การแก้ไข Base URL: option `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → option/env resource name → `model.baseUrl`

### Google Vertex AI

| ตัวแปร | จำเป็น? | หมายเหตุ |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | ใช่ (เว้นแต่จะส่งใน options) | ทางเลือกสำรอง: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | ทางเลือกสำรอง | ใช้เป็นแหล่ง project ID ทางเลือก |
| `GOOGLE_CLOUD_LOCATION` | ใช่ (เว้นแต่จะส่งใน options) | ไม่มีค่าเริ่มต้นใน provider |
| `GOOGLE_APPLICATION_CREDENTIALS` | มีเงื่อนไข | หากตั้งค่า ไฟล์ต้องมีอยู่; มิฉะนั้นจะตรวจสอบเส้นทาง ADC สำรอง (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | การ override โฮสต์ OAuth หลัก |
| `KIMI_OAUTH_HOST` | การ override โฮสต์ OAuth สำรอง |
| `KIMI_CODE_BASE_URL` | Override base URL ของ endpoint การใช้งาน Kimi (`usage/kimi.ts`) |

ลำดับโฮสต์ OAuth: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`

### ความเข้ากันได้ของ Antigravity/Gemini image

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Override แท็กเวอร์ชัน user-agent ของ Antigravity ใน Gemini CLI provider |

### OpenAI Codex responses (การควบคุมฟีเจอร์/ดีบัก)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` เปิดใช้งานการบันทึกดีบักของ Codex provider |
| `PI_CODEX_WEBSOCKET` | `1`/`true` เปิดใช้งานการเลือก websocket transport |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` เปิดใช้งานเส้นทาง websocket v2 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Override จำนวนเต็มบวก (ค่าเริ่มต้น 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Override จำนวนเต็มไม่ติดลบ (ค่าเริ่มต้น 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Override base backoff จำนวนเต็มบวก (ค่าเริ่มต้น 500) |

### ดีบักของ Cursor provider

| ตัวแปร | พฤติกรรม |
|---|---|
| `DEBUG_CURSOR` | เปิดใช้งานบันทึกดีบักของ provider; `2`/`verbose` สำหรับส่วนย่อย payload โดยละเอียด |
| `DEBUG_CURSOR_LOG` | พาธไฟล์ที่ไม่บังคับสำหรับเอาต์พุตบันทึกดีบัก JSONL |

### สวิตช์ความเข้ากันได้ของ Prompt cache

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_CACHE_RETENTION` | หากเป็น `long` จะเปิดใช้งาน long retention ในที่ที่รองรับ (`anthropic`, `openai-responses`, การแก้ไข retention ของ Bedrock) |

---

## 3) ระบบย่อยการค้นหาเว็บ

### ข้อมูลรับรองของ Search provider

| ตัวแปร | ใช้โดย |
|---|---|
| `EXA_API_KEY` | Exa search provider และเครื่องมือ Exa MCP |
| `BRAVE_API_KEY` | Brave search provider |
| `PERPLEXITY_API_KEY` | Perplexity search provider โหมด API-key |
| `TAVILY_API_KEY` | Tavily search provider |
| `ZAI_API_KEY` | z.ai search provider (ยังตรวจสอบ OAuth ที่จัดเก็บใน `agent.db`) |
| `OPENAI_API_KEY` / Codex OAuth ใน DB | ความพร้อม/การยืนยันตัวตนของ Codex search provider |

### ลำดับการยืนยันตัวตนการค้นหาเว็บ Anthropic

`packages/coding-agent/src/web/search/auth.ts` แก้ไขข้อมูลรับรองการค้นหาเว็บ Anthropic ตามลำดับนี้:

1. `ANTHROPIC_SEARCH_API_KEY` (+ `ANTHROPIC_SEARCH_BASE_URL` ที่ไม่บังคับ)
2. รายการ provider ใน `models.json` ที่มี `api: "anthropic-messages"`
3. ข้อมูลรับรอง Anthropic OAuth จาก `agent.db` (ต้องไม่หมดอายุภายในบัฟเฟอร์ 5 นาที)
4. ทางเลือกสำรอง env ของ Anthropic ทั่วไป: คีย์ provider (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + `ANTHROPIC_BASE_URL` ที่ไม่บังคับ (`FOUNDRY_BASE_URL` เมื่อเปิดใช้โหมด Foundry)

ตัวแปรที่เกี่ยวข้อง:

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | คีย์การค้นหาที่ระบุชัดเจนซึ่งมีลำดับความสำคัญสูงสุด |
| `ANTHROPIC_SEARCH_BASE_URL` | ค่าเริ่มต้นเป็น `https://api.anthropic.com` เมื่อไม่ระบุ |
| `ANTHROPIC_SEARCH_MODEL` | ค่าเริ่มต้นเป็น `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | Base URL สำรองทั่วไปสำหรับเส้นทางการยืนยันตัวตนระดับ 4 |

### แฟล็กพฤติกรรม OAuth flow ของ Perplexity

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_AUTH_NO_BORROW` | หากตั้งค่า จะปิดใช้งานเส้นทางการยืม token จากแอปเนทีฟ macOS ใน Perplexity login flow |

---

## 4) เครื่องมือ Python และรันไทม์เคอร์เนล

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_PY` | Override โหมดเครื่องมือ Python: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; ค่าที่ไม่ถูกต้องจะถูกละเว้น |
| `PI_PYTHON_SKIP_CHECK` | หากเป็น `1` จะข้ามการตรวจสอบความพร้อม/การวอร์มของ Python kernel |
| `PI_PYTHON_GATEWAY_URL` | หากตั้งค่า จะใช้ kernel gateway ภายนอกแทน shared gateway ในเครื่อง |
| `PI_PYTHON_GATEWAY_TOKEN` | token การยืนยันตัวตนที่ไม่บังคับสำหรับ gateway ภายนอก (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | หากเป็น `1` จะเปิดใช้งานเส้นทาง IPC trace ระดับต่ำในโมดูลเคอร์เนล |
| `VIRTUAL_ENV` | พาธ venv ที่มีลำดับความสำคัญสูงสุดสำหรับการแก้ไขรันไทม์ Python |

พฤติกรรมแบบมีเงื่อนไขเพิ่มเติม:

- หาก `BUN_ENV=test` หรือ `NODE_ENV=test` การตรวจสอบความพร้อมของ Python จะถือว่าผ่านและข้ามการวอร์ม
- การกรอง env ของ Python จะปฏิเสธ API key ทั่วไปและอนุญาตตัวแปรพื้นฐานที่ปลอดภัย + คำนำหน้า `LC_`, `XDG_`, `PI_`

---

## 5) สวิตช์เปิด/ปิดพฤติกรรม Agent/รันไทม์

| ตัวแปร                   | ค่าเริ่มต้น / พฤติกรรม                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | Override model-role ชั่วคราวสำหรับ `smol` (CLI `--smol` มีลำดับความสำคัญเหนือกว่า)                     |
| `PI_SLOW_MODEL`            | Override model-role ชั่วคราวสำหรับ `slow` (CLI `--slow` มีลำดับความสำคัญเหนือกว่า)                     |
| `PI_PLAN_MODEL`            | Override model-role ชั่วคราวสำหรับ `plan` (CLI `--plan` มีลำดับความสำคัญเหนือกว่า)                     |
| `PI_NO_TITLE`              | หากตั้งค่า (ค่าที่ไม่ว่างเปล่าใดๆ) จะปิดใช้งานการสร้างชื่อเซสชันอัตโนมัติในข้อความผู้ใช้แรก   |
| `NULL_PROMPT`              | หากเป็น `true` ตัวสร้าง system prompt จะคืนค่าสตริงว่าง                                        |
| `PI_BLOCKED_AGENT`         | บล็อกประเภท subagent เฉพาะในเครื่องมือ task                                                 |
| `PI_SUBPROCESS_CMD`        | Override คำสั่งเรียก subagent (ข้ามการแก้ไข `xcsh` / `xcsh.cmd`)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | จำนวนไบต์เอาต์พุตสูงสุดที่จับได้ต่อ subagent (ค่าเริ่มต้น `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | จำนวนบรรทัดเอาต์พุตสูงสุดที่จับได้ต่อ subagent (ค่าเริ่มต้น `5000`)                                      |
| `PI_TIMING`                | หากเป็น `1` จะเปิดใช้งานบันทึกการวัดเวลาเริ่มต้น/เครื่องมือ                                     |
| `PI_DEBUG_STARTUP`         | เปิดใช้งานการพิมพ์ดีบักขั้นตอนเริ่มต้นไปยัง stderr ในเส้นทางเริ่มต้นหลายเส้นทาง                       |
| `PI_PACKAGE_DIR`           | Override การแก้ไขไดเรกทอรีฐานของ asset แพ็คเกจ (การค้นหาพาธ docs/examples/changelog)            |
| `PI_DISABLE_LSPMUX`        | หากเป็น `1` จะปิดใช้งานการตรวจจับ/การรวม lspmux และบังคับเรียก LSP server โดยตรง          |
| `LITELLM_BASE_URL`         | Base URL ของ LiteLLM proxy เมื่อตั้งค่าพร้อม `LITELLM_API_KEY` จะทริกเกอร์การสร้าง `models.yml` อัตโนมัติในการรันครั้งแรกและการซ่อมแซมตัวเองในทุกครั้งที่เริ่มต้น |
| `LM_STUDIO_BASE_URL`       | Override base URL การค้นหา LM Studio โดยนัยเริ่มต้น (`http://127.0.0.1:1234/v1` หากไม่ได้ตั้งค่า) |
| `OLLAMA_BASE_URL`          | Override base URL การค้นหา Ollama โดยนัยเริ่มต้น (`http://127.0.0.1:11434` หากไม่ได้ตั้งค่า)      |
| `LLAMA_CPP_BASE_URL`       | Override base URL การค้นหา Llama.cpp โดยนัยเริ่มต้น (`http://127.0.0.1:8080` หากไม่ได้ตั้งค่า)    |
| `PI_EDIT_VARIANT`          | หากเป็น `hashline` จะบังคับโหมดแสดงผล hashline read/grep เมื่อเครื่องมือ edit พร้อมใช้งาน               |
| `PI_NO_PTY`                | หากเป็น `1` จะปิดใช้งานเส้นทาง PTY แบบโต้ตอบสำหรับเครื่องมือ bash                                          |

`PI_NO_PTY` ยังถูกตั้งค่าภายในเมื่อใช้ CLI `--no-pty`

---

## 6) พาธรูทของ Storage และ Config

สิ่งเหล่านี้ถูกใช้งานผ่าน `@f5xc-salesdemos/pi-utils/dirs` และมีผลต่อตำแหน่งที่ coding-agent จัดเก็บข้อมูล

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_CONFIG_DIR` | ชื่อไดเรกทอรีรูท config ภายใต้ home (ค่าเริ่มต้น `.xcsh`) |
| `PI_CODING_AGENT_DIR` | Override เต็มสำหรับไดเรกทอรี agent (ค่าเริ่มต้น `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | ใช้เมื่อจับคู่ไดเรกทอรีทำงานปัจจุบันแบบ canonical ในตัวช่วยพาธ |

---

## 7) สภาพแวดล้อมการดำเนินการ Shell/เครื่องมือ

(จาก `packages/utils/src/procmgr.ts` และการรวมเครื่องมือ bash ของ coding-agent)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_BASH_NO_CI` | ระงับการฉีด `CI=true` อัตโนมัติเข้าไปใน env ของ shell ที่ถูกเรียก |
| `CLAUDE_BASH_NO_CI` | ชื่อเล่นเดิมที่เป็นทางเลือกสำรองของ `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | มีวัตถุประสงค์เพื่อปิดใช้งานโหมด login shell |
| `CLAUDE_BASH_NO_LOGIN` | ชื่อเล่นเดิมที่เป็นทางเลือกสำรองของ `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | ตัว wrapper คำสั่งนำหน้าที่ไม่บังคับ |
| `CLAUDE_CODE_SHELL_PREFIX` | ชื่อเล่นเดิมที่เป็นทางเลือกสำรองของ `PI_SHELL_PREFIX` |
| `VISUAL` | คำสั่ง external editor ที่ต้องการ |
| `EDITOR` | คำสั่ง external editor สำรอง |

หมายเหตุเกี่ยวกับการใช้งานปัจจุบัน: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` ถูกอ่าน แต่ `getShellArgs()` ปัจจุบันคืนค่า `['-l','-c']` ในทั้งสองกรณี (ในทางปฏิบัติไม่มีผลในปัจจุบัน)

---

## 8) การตรวจจับ UI/ธีม/เซสชัน (env ที่ตรวจจับอัตโนมัติ)

สิ่งเหล่านี้ถูกอ่านเป็นสัญญาณรันไทม์; โดยปกติจะถูกตั้งค่าโดย terminal/OS มากกว่าการกำหนดค่าด้วยตนเอง

| ตัวแปร | ใช้สำหรับ |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | การตรวจจับความสามารถด้านสี (โหมดสีของธีม) |
| `COLORFGBG` | การตรวจจับอัตโนมัติพื้นหลัง terminal สว่าง/มืด |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | ข้อมูลระบุตัวตน terminal ใน system prompt/context |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | การตรวจจับ desktop/window-manager ใน system prompt/context |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | ID breadcrumb เซสชันที่คงที่ต่อ terminal |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | การวินิจฉัยข้อมูลระบบ |
| `APPDATA`, `XDG_CONFIG_HOME` | การแก้ไขพาธ config ของ lspmux |
| `HOME` | การย่อพาธใน MCP command UI |

---

## 9) แฟล็ก Native loader/ดีบัก

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_DEV` | เปิดใช้งานการวินิจฉัยการโหลด native addon แบบละเอียดใน `packages/natives` |

## 10) แฟล็กรันไทม์ TUI (shared package, ส่งผลต่อ UX ของ coding-agent)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` ระงับการแจ้งเตือนบนเดสก์ท็อป |
| `PI_TUI_WRITE_LOG` | หากตั้งค่า จะบันทึกการเขียน TUI ลงไฟล์ |
| `PI_HARDWARE_CURSOR` | หากเป็น `1` จะเปิดใช้งานโหมด hardware cursor |
| `PI_CLEAR_ON_SHRINK` | หากเป็น `1` จะล้างแถวว่างเมื่อเนื้อหาหดตัว |
| `PI_DEBUG_REDRAW` | หากเป็น `1` จะเปิดใช้งานการบันทึกดีบักการวาดซ้ำ |
| `PI_TUI_DEBUG` | หากเป็น `1` จะเปิดใช้งานเส้นทาง TUI debug dump แบบเชิงลึก |

---

## 11) การควบคุมการสร้าง Commit

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | หากเป็น `true` (ไม่สนใจตัวพิมพ์ใหญ่-เล็ก) จะบังคับเส้นทางการสร้าง commit สำรอง |
| `PI_COMMIT_NO_FALLBACK` | หากเป็น `true` จะปิดใช้งานทางเลือกสำรองเมื่อ agent ไม่ส่งคืนข้อเสนอ |
| `PI_COMMIT_MAP_REDUCE` | หากเป็น `false` จะปิดใช้งานเส้นทางการวิเคราะห์ commit แบบ map-reduce |
| `DEBUG` | หากตั้งค่า จะพิมพ์ stack trace ข้อผิดพลาดของ commit agent |

---

## ตัวแปรที่มีความอ่อนไหวด้านความปลอดภัย

ถือว่าสิ่งเหล่านี้เป็นความลับ; ห้ามบันทึกหรือ commit:

- คีย์ Provider/API และข้อมูลรับรอง OAuth/bearer (ทั้งหมดที่เป็น `*_API_KEY`, `*_TOKEN`, access/refresh tokens ของ OAuth)
- ข้อมูลรับรองคลาวด์ (`AWS_*`, พาธ `GOOGLE_APPLICATION_CREDENTIALS` อาจเปิดเผยข้อมูล service-account)
- ตัวแปรการยืนยันตัวตนของ Search/provider (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, คีย์การค้นหา Anthropic)
- วัสดุ mTLS ของ Foundry (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` เมื่อชี้ไปยัง private CA bundles)

รันไทม์ Python ยังลบตัวแปรคีย์ทั่วไปจำนวนมากออกอย่างชัดเจนก่อนเรียก kernel subprocess (`packages/coding-agent/src/ipy/runtime.ts`)
