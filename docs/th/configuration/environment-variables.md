---
title: ตัวแปรสภาพแวดล้อม
description: >-
  เอกสารอ้างอิงตัวแปรสภาพแวดล้อมขณะรันไทม์สำหรับการกำหนดค่าและการควบคุมพฤติกรรมของ
  xcsh
sidebar:
  order: 2
  label: ตัวแปรสภาพแวดล้อม
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# ตัวแปรสภาพแวดล้อม (เอกสารอ้างอิงรันไทม์ปัจจุบัน)

เอกสารอ้างอิงนี้ได้รับการรวบรวมจากเส้นทางโค้ดปัจจุบันใน:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (การแก้ไข provider/auth ที่ใช้โดย coding-agent)
- `packages/utils/src/**` และ `packages/tui/src/**` ในกรณีที่ตัวแปรเหล่านั้นส่งผลโดยตรงต่อรันไทม์ของ coding-agent

เอกสารนี้บันทึกเฉพาะพฤติกรรมที่ใช้งานอยู่จริง

## โมเดลการแก้ไขและลำดับความสำคัญ

การค้นหาค่ารันไทม์ส่วนใหญ่ใช้ `$env` จาก `@f5-sales-demo/pi-utils` (`packages/utils/src/env.ts`)

ลำดับการโหลดของ `$env`:

1. สภาพแวดล้อมของกระบวนการที่มีอยู่ (`Bun.env`)
2. ไฟล์ `.env` ของโปรเจกต์ (`$PWD/.env`) สำหรับคีย์ที่ยังไม่ได้ตั้งค่า
3. ไฟล์ `.env` ของ Home (`~/.env`) สำหรับคีย์ที่ยังไม่ได้ตั้งค่า

กฎเพิ่มเติมในไฟล์ `.env`: คีย์ `XCSH_*` จะถูกสะท้อนไปยังคีย์ `PI_*` ระหว่างการแยกวิเคราะห์

---

## 1) การพิสูจน์ตัวตน model/provider

ตัวแปรเหล่านี้ถูกใช้งานผ่าน `getEnvApiKey()` (`packages/ai/src/stream.ts`) เว้นแต่จะระบุไว้เป็นอย่างอื่น

### ข้อมูลประจำตัวของ provider หลัก

| ตัวแปร                          | ใช้สำหรับ | จำเป็นเมื่อ                                                  | หมายเหตุ / ลำดับความสำคัญ                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | การพิสูจน์ตัวตน Anthropic API | ใช้ Anthropic ด้วยการพิสูจน์ตัวตนแบบ OAuth token            | มีลำดับความสำคัญเหนือ `ANTHROPIC_API_KEY` สำหรับการแก้ไข provider auth                              |
| `ANTHROPIC_API_KEY`             | การพิสูจน์ตัวตน Anthropic API | ใช้ Anthropic โดยไม่มี OAuth token                           | Fallback หลังจาก `ANTHROPIC_OAUTH_TOKEN`                                                             |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic ผ่าน Azure Foundry / enterprise gateway | เปิดใช้งาน `CLAUDE_CODE_USE_FOUNDRY`                         | มีลำดับความสำคัญเหนือ `ANTHROPIC_OAUTH_TOKEN` และ `ANTHROPIC_API_KEY` เมื่อเปิดใช้งาน Foundry mode  |
| `OPENAI_API_KEY`                | การพิสูจน์ตัวตน OpenAI | ใช้ provider ในตระกูล OpenAI โดยไม่มีอาร์กิวเมนต์ apiKey ที่ระบุชัดเจน | ใช้โดย OpenAI Completions/Responses providers                                                       |
| `GEMINI_API_KEY`                | การพิสูจน์ตัวตน Google Gemini | ใช้โมเดล provider `google`                                  | คีย์หลักสำหรับการแมป Gemini provider                                                                |
| `GOOGLE_API_KEY`                | Fallback สำหรับการพิสูจน์ตัวตนของ Gemini image tool | ใช้เครื่องมือ `gemini_image` โดยไม่มี `GEMINI_API_KEY`      | ใช้โดย fallback path ของ image tool ใน coding-agent                                                |
| `GROQ_API_KEY`                  | การพิสูจน์ตัวตน Groq | ใช้โมเดล Groq                                               |                                                                                                     |
| `CEREBRAS_API_KEY`              | การพิสูจน์ตัวตน Cerebras | ใช้โมเดล Cerebras                                           |                                                                                                     |
| `TOGETHER_API_KEY`              | การพิสูจน์ตัวตน Together | ใช้ provider `together`                                      |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | การพิสูจน์ตัวตน Hugging Face | ใช้ provider `huggingface`                                   | ตัวแปร env token หลักของ Hugging Face                                                               |
| `HF_TOKEN`                      | การพิสูจน์ตัวตน Hugging Face | ใช้ provider `huggingface`                                   | Fallback เมื่อ `HUGGINGFACE_HUB_TOKEN` ไม่ได้ตั้งค่า                                               |
| `SYNTHETIC_API_KEY`             | การพิสูจน์ตัวตน Synthetic | ใช้โมเดล Synthetic                                          |                                                                                                     |
| `NVIDIA_API_KEY`                | การพิสูจน์ตัวตน NVIDIA | ใช้ provider `nvidia`                                        |                                                                                                     |
| `NANO_GPT_API_KEY`              | การพิสูจน์ตัวตน NanoGPT | ใช้ provider `nanogpt`                                       |                                                                                                     |
| `VENICE_API_KEY`                | การพิสูจน์ตัวตน Venice | ใช้ provider `venice`                                        |                                                                                                     |
| `LITELLM_API_KEY`               | การพิสูจน์ตัวตน LiteLLM | ใช้ provider `litellm`                                       | คีย์ LiteLLM proxy ที่เข้ากันได้กับ OpenAI เมื่อตั้งค่าพร้อมกับ `LITELLM_BASE_URL` จะเปิดใช้งานการกำหนดค่าอัตโนมัติของ `models.yml` |
| `LM_STUDIO_API_KEY`             | การพิสูจน์ตัวตน LM Studio (ไม่บังคับ) | ใช้ provider `lm-studio` กับ host ที่ต้องการการพิสูจน์ตัวตน | LM Studio ในเครื่องส่วนใหญ่จะทำงานโดยไม่มีการพิสูจน์ตัวตน โทเค็นที่ไม่ว่างเปล่าใดๆ จะทำงานได้เมื่อต้องใช้คีย์ |
| `OLLAMA_API_KEY`                | การพิสูจน์ตัวตน Ollama (ไม่บังคับ) | ใช้ provider `ollama` กับ host ที่ต้องการการพิสูจน์ตัวตน   | Ollama ในเครื่องส่วนใหญ่จะทำงานโดยไม่มีการพิสูจน์ตัวตน โทเค็นที่ไม่ว่างเปล่าใดๆ จะทำงานได้เมื่อต้องใช้คีย์ |
| `LLAMA_CPP_API_KEY`             | การพิสูจน์ตัวตน Ollama (ไม่บังคับ) | ใช้ `llama-server` พร้อมพารามิเตอร์ `--api-key`            | llama.cpp ในเครื่องส่วนใหญ่จะทำงานโดยไม่มีการพิสูจน์ตัวตน โทเค็นที่ไม่ว่างเปล่าใดๆ จะทำงานได้เมื่อกำหนดค่าคีย์ไว้ |
| `XIAOMI_API_KEY`                | การพิสูจน์ตัวตน Xiaomi MiMo | ใช้ provider `xiaomi`                                        |                                                                                                     |
| `MOONSHOT_API_KEY`              | การพิสูจน์ตัวตน Moonshot | ใช้ provider `moonshot`                                      |                                                                                                     |
| `XAI_API_KEY`                   | การพิสูจน์ตัวตน xAI | ใช้โมเดล xAI                                                |                                                                                                     |
| `OPENROUTER_API_KEY`            | การพิสูจน์ตัวตน OpenRouter | ใช้โมเดล OpenRouter                                         | ยังใช้โดย image tool เมื่อ preferred/auto provider คือ OpenRouter                                  |
| `MISTRAL_API_KEY`               | การพิสูจน์ตัวตน Mistral | ใช้โมเดล Mistral                                            |                                                                                                     |
| `ZAI_API_KEY`                   | การพิสูจน์ตัวตน z.ai | ใช้โมเดล z.ai                                               | ยังใช้โดย z.ai web search provider                                                                  |
| `MINIMAX_API_KEY`               | การพิสูจน์ตัวตน MiniMax | ใช้ provider `minimax`                                       |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | การพิสูจน์ตัวตน MiniMax Code | ใช้ provider `minimax-code`                                  |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | การพิสูจน์ตัวตน MiniMax Code CN | ใช้ provider `minimax-code-cn`                               |                                                                                                     |
| `OPENCODE_API_KEY`              | การพิสูจน์ตัวตน OpenCode | ใช้โมเดล OpenCode                                           |                                                                                                     |
| `QIANFAN_API_KEY`               | การพิสูจน์ตัวตน Qianfan | ใช้ provider `qianfan`                                       |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | การพิสูจน์ตัวตน Qwen Portal | ใช้ `qwen-portal` ด้วย OAuth token                          | มีลำดับความสำคัญเหนือ `QWEN_PORTAL_API_KEY`                                                        |
| `QWEN_PORTAL_API_KEY`           | การพิสูจน์ตัวตน Qwen Portal | ใช้ `qwen-portal` ด้วย API key                              | Fallback หลังจาก `QWEN_OAUTH_TOKEN`                                                                 |
| `ZENMUX_API_KEY`                | การพิสูจน์ตัวตน ZenMux | ใช้ provider `zenmux`                                        | ใช้สำหรับเส้นทาง ZenMux OpenAI และ Anthropic-compatible                                            |
| `VLLM_API_KEY`                  | การพิสูจน์ตัวตน vLLM / เปิดใช้งานการค้นหา | ใช้ provider `vllm` (local OpenAI-compatible servers)        | ค่าที่ไม่ว่างเปล่าใดๆ จะทำงานได้สำหรับ local server ที่ไม่ต้องการการพิสูจน์ตัวตน                   |
| `CURSOR_ACCESS_TOKEN`           | การพิสูจน์ตัวตน Cursor provider | ใช้ Cursor provider                                          |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | การพิสูจน์ตัวตน Vercel AI Gateway | ใช้ provider `vercel-ai-gateway`                             |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | การพิสูจน์ตัวตน Cloudflare AI Gateway | ใช้ provider `cloudflare-ai-gateway`                         | Base URL ต้องกำหนดค่าเป็น `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### ห่วงโซ่โทเค็น GitHub/Copilot

| ตัวแปร | ใช้สำหรับ | ห่วงโซ่ |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | การพิสูจน์ตัวตน GitHub Copilot provider | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Fallback ของ Copilot; การพิสูจน์ตัวตน GitHub API ใน web scraper | ใน web scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Fallback ของ Copilot; การพิสูจน์ตัวตน GitHub API ใน web scraper | ใน web scraper: ตรวจสอบก่อน `GH_TOKEN` |

---

## 2) การกำหนดค่ารันไทม์เฉพาะ provider

### Anthropic Foundry Gateway (Azure / enterprise proxy)

เมื่อเปิดใช้งาน `CLAUDE_CODE_USE_FOUNDRY` คำขอ Anthropic จะเปลี่ยนไปใช้ Foundry mode:

- Base URL แก้ไขจาก `FOUNDRY_BASE_URL` (fallback ยังคงเป็น model/default base URL หากไม่ได้ตั้งค่า)
- การแก้ไข API key สำหรับ provider `anthropic` จะกลายเป็น:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`
- `ANTHROPIC_CUSTOM_HEADERS` ถูกแยกวิเคราะห์เป็นคู่ `key: value` ที่คั่นด้วยเครื่องหมายจุลภาค/บรรทัดใหม่ และรวมเข้าใน request headers
- วัสดุ TLS client/server สามารถฉีดได้จากค่า env:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`
  แต่ละตัวยอมรับ:
  - เส้นทางระบบไฟล์ไปยังเนื้อหา PEM หรือ
  - PEM แบบ inline (รวมถึงลำดับ `\n` ที่ escape แล้ว)

| ตัวแปร | ประเภทค่า | พฤติกรรม |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | สตริงแบบ Boolean (`1`, `true`, `yes`, `on`) | เปิดใช้งาน Foundry mode สำหรับ Anthropic provider |
| `FOUNDRY_BASE_URL` | สตริง URL | Anthropic endpoint base URL ใน Foundry mode |
| `ANTHROPIC_FOUNDRY_API_KEY` | สตริงโทเค็น | ใช้สำหรับ `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | สตริงรายการ header | Header เพิ่มเติม; รูปแบบ `header-a: value, header-b: value` หรือคั่นด้วยบรรทัดใหม่ |
| `NODE_EXTRA_CA_CERTS` | เส้นทาง PEM หรือ PEM แบบ inline | CA chain เพิ่มเติมสำหรับการตรวจสอบใบรับรองเซิร์ฟเวอร์ |
| `CLAUDE_CODE_CLIENT_CERT` | เส้นทาง PEM หรือ PEM แบบ inline | ใบรับรอง client สำหรับ mTLS |
| `CLAUDE_CODE_CLIENT_KEY` | เส้นทาง PEM หรือ PEM แบบ inline | private key ของ client สำหรับ mTLS (ต้องจับคู่กับใบรับรอง) |

### Amazon Bedrock

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `AWS_REGION` | แหล่งข้อมูล region หลัก |
| `AWS_DEFAULT_REGION` | Fallback หาก `AWS_REGION` ไม่ได้ตั้งค่า |
| `AWS_PROFILE` | เปิดใช้งาน named profile auth path |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | เปิดใช้งาน IAM key auth path |
| `AWS_BEARER_TOKEN_BEDROCK` | เปิดใช้งาน bearer token auth path |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | เปิดใช้งาน ECS task credential path |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | เปิดใช้งาน web identity auth path |
| `AWS_BEDROCK_SKIP_AUTH` | หากเป็น `1` จะฉีด dummy credentials (สถานการณ์ proxy/non-auth) |
| `AWS_BEDROCK_FORCE_HTTP1` | หากเป็น `1` จะบังคับใช้ Node HTTP/1 request handler |

Region fallback ในโค้ด provider: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`

### Azure OpenAI Responses

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `AZURE_OPENAI_API_KEY` | จำเป็นเว้นแต่จะส่ง API key เป็น option |
| `AZURE_OPENAI_API_VERSION` | ค่าเริ่มต้น `v1` |
| `AZURE_OPENAI_BASE_URL` | การแทนที่ base URL โดยตรง |
| `AZURE_OPENAI_RESOURCE_NAME` | ใช้เพื่อสร้าง base URL: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | สตริงการแมปแบบเลือกได้: `modelId=deploymentName,model2=deployment2` |

การแก้ไข Base URL: option `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → option/env resource name → `model.baseUrl`

### Google Vertex AI

| ตัวแปร | จำเป็น? | หมายเหตุ |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | ใช่ (เว้นแต่จะส่งใน options) | Fallback: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | Fallback | ใช้เป็นแหล่ง project ID สำรอง |
| `GOOGLE_CLOUD_LOCATION` | ใช่ (เว้นแต่จะส่งใน options) | ไม่มีค่าเริ่มต้นใน provider |
| `GOOGLE_APPLICATION_CREDENTIALS` | มีเงื่อนไข | หากตั้งค่าไว้ ไฟล์ต้องมีอยู่ มิฉะนั้นจะตรวจสอบ ADC fallback path (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | การแทนที่ OAuth host หลัก |
| `KIMI_OAUTH_HOST` | การแทนที่ OAuth host สำรอง |
| `KIMI_CODE_BASE_URL` | แทนที่ base URL ของ Kimi usage endpoint (`usage/kimi.ts`) |

ห่วงโซ่ OAuth host: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`

### ความเข้ากันได้ Antigravity/Gemini image

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | แทนที่แท็กเวอร์ชัน user-agent ของ Antigravity ใน Gemini CLI provider |

### OpenAI Codex responses (การควบคุม feature/debug)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` เปิดใช้งาน debug logging ของ Codex provider |
| `PI_CODEX_WEBSOCKET` | `1`/`true` เปิดใช้งานการตั้งค่าการขนส่งแบบ websocket |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` เปิดใช้งาน websocket v2 path |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | การแทนที่ด้วยจำนวนเต็มบวก (ค่าเริ่มต้น 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | การแทนที่ด้วยจำนวนเต็มไม่ติดลบ (ค่าเริ่มต้น 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | การแทนที่ base backoff ด้วยจำนวนเต็มบวก (ค่าเริ่มต้น 500) |

### Cursor provider debug

| ตัวแปร | พฤติกรรม |
|---|---|
| `DEBUG_CURSOR` | เปิดใช้งาน debug logs ของ provider; `2`/`verbose` สำหรับข้อมูล payload โดยละเอียด |
| `DEBUG_CURSOR_LOG` | เส้นทางไฟล์แบบเลือกได้สำหรับ JSONL debug log output |

### สวิตช์ความเข้ากันได้ของ prompt cache

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_CACHE_RETENTION` | หากเป็น `long` จะเปิดใช้งาน long retention ในกรณีที่รองรับ (`anthropic`, `openai-responses`, การแก้ไข Bedrock retention) |

---

## 3) ระบบย่อยการค้นหาเว็บ

### ข้อมูลประจำตัวของ search provider

| ตัวแปร | ใช้โดย |
|---|---|
| `EXA_API_KEY` | Exa search provider และ Exa MCP tools |
| `BRAVE_API_KEY` | Brave search provider |
| `PERPLEXITY_API_KEY` | Perplexity search provider แบบ API-key |
| `TAVILY_API_KEY` | Tavily search provider |
| `ZAI_API_KEY` | z.ai search provider (ยังตรวจสอบ OAuth ที่จัดเก็บไว้ใน `agent.db`) |
| `OPENAI_API_KEY` / Codex OAuth ใน DB | ความพร้อมใช้งาน/การพิสูจน์ตัวตนของ Codex search provider |

### ห่วงโซ่การพิสูจน์ตัวตน Anthropic web search

`packages/coding-agent/src/web/search/auth.ts` แก้ไข Anthropic web-search credentials ตามลำดับนี้:

1. `ANTHROPIC_SEARCH_API_KEY` (+ `ANTHROPIC_SEARCH_BASE_URL` แบบเลือกได้)
2. รายการ provider ใน `models.json` ที่มี `api: "anthropic-messages"`
3. Anthropic OAuth credentials จาก `agent.db` (ต้องไม่หมดอายุภายใน 5 นาที)
4. Generic Anthropic env fallback: provider key (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + `ANTHROPIC_BASE_URL` แบบเลือกได้ (`FOUNDRY_BASE_URL` เมื่อเปิดใช้งาน Foundry mode)

ตัวแปรที่เกี่ยวข้อง:

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | คีย์การค้นหาที่ระบุชัดเจนและมีลำดับความสำคัญสูงสุด |
| `ANTHROPIC_SEARCH_BASE_URL` | ค่าเริ่มต้นเป็น `https://api.anthropic.com` เมื่อไม่ได้ระบุ |
| `ANTHROPIC_SEARCH_MODEL` | ค่าเริ่มต้นเป็น `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | Generic fallback base URL สำหรับ tier-4 auth path |

### แฟล็กพฤติกรรม Perplexity OAuth flow

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_AUTH_NO_BORROW` | หากตั้งค่าไว้ จะปิดใช้งาน macOS native-app token borrowing path ใน Perplexity login flow |

---

## 4) เครื่องมือ Python และรันไทม์ kernel

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_PY` | การแทนที่โหมดเครื่องมือ Python: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; ค่าที่ไม่ถูกต้องจะถูกละเว้น |
| `PI_PYTHON_SKIP_CHECK` | หากเป็น `1` จะข้ามการตรวจสอบความพร้อมใช้งาน Python kernel/การตรวจสอบ warm |
| `PI_PYTHON_GATEWAY_URL` | หากตั้งค่าไว้ จะใช้ external kernel gateway แทน local shared gateway |
| `PI_PYTHON_GATEWAY_TOKEN` | โทเค็น auth แบบเลือกได้สำหรับ external gateway (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | หากเป็น `1` จะเปิดใช้งาน low-level IPC trace path ใน kernel module |
| `VIRTUAL_ENV` | เส้นทาง venv ที่มีลำดับความสำคัญสูงสุดสำหรับการแก้ไข Python runtime |

พฤติกรรมเงื่อนไขเพิ่มเติม:

- หาก `BUN_ENV=test` หรือ `NODE_ENV=test` การตรวจสอบความพร้อมใช้งาน Python จะถือว่าผ่านและข้ามการ warming
- การกรองสภาพแวดล้อม Python จะปฏิเสธตัวแปร API key ทั่วไปและอนุญาตเฉพาะตัวแปรพื้นฐานที่ปลอดภัยและ prefix `LC_`, `XDG_`, `PI_`

---

## 5) สวิตช์พฤติกรรม agent/runtime

| ตัวแปร                   | ค่าเริ่มต้น / พฤติกรรม                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | การแทนที่ model-role ชั่วคราวสำหรับ `smol` (CLI `--smol` มีลำดับความสำคัญสูงกว่า)               |
| `PI_SLOW_MODEL`            | การแทนที่ model-role ชั่วคราวสำหรับ `slow` (CLI `--slow` มีลำดับความสำคัญสูงกว่า)               |
| `PI_PLAN_MODEL`            | การแทนที่ model-role ชั่วคราวสำหรับ `plan` (CLI `--plan` มีลำดับความสำคัญสูงกว่า)               |
| `PI_NO_TITLE`              | หากตั้งค่าไว้ (ค่าใดๆ ที่ไม่ว่างเปล่า) จะปิดใช้งานการสร้างชื่อ session อัตโนมัติในข้อความผู้ใช้แรก   |
| `NULL_PROMPT`              | หากเป็น `true` ตัวสร้าง system prompt จะส่งคืนสตริงว่าง                                         |
| `PI_BLOCKED_AGENT`         | บล็อก subagent ประเภทเฉพาะใน task tool                                                        |
| `PI_SUBPROCESS_CMD`        | แทนที่คำสั่ง spawn ของ subagent (การข้ามการแก้ไข `xcsh` / `xcsh.cmd`)                           |
| `PI_TASK_MAX_OUTPUT_BYTES` | จำนวนไบต์ output สูงสุดที่จับได้ต่อ subagent (ค่าเริ่มต้น `500000`)                             |
| `PI_TASK_MAX_OUTPUT_LINES` | จำนวนบรรทัด output สูงสุดที่จับได้ต่อ subagent (ค่าเริ่มต้น `5000`)                             |
| `PI_TIMING`                | หากเป็น `1` จะเปิดใช้งาน log การวัดเวลา startup/tool                                           |
| `PI_DEBUG_STARTUP`         | เปิดใช้งาน debug prints ของ startup stage ไปยัง stderr ในหลาย startup path                     |
| `PI_PACKAGE_DIR`           | แทนที่การแก้ไข package asset base dir (การค้นหาเส้นทาง docs/examples/changelog)                |
| `PI_DISABLE_LSPMUX`        | หากเป็น `1` จะปิดใช้งานการตรวจจับ/การผสาน lspmux และบังคับใช้การ spawn LSP server โดยตรง      |
| `LITELLM_BASE_URL`         | LiteLLM proxy base URL เมื่อตั้งค่าพร้อมกับ `LITELLM_API_KEY` จะทริกเกอร์การสร้าง `models.yml` อัตโนมัติเมื่อรันครั้งแรกและ self-healing ทุกครั้งที่เริ่มต้น |
| `LM_STUDIO_BASE_URL`       | การแทนที่ LM Studio discovery base URL เริ่มต้นโดยปริยาย (`http://127.0.0.1:1234/v1` หากไม่ได้ตั้งค่า) |
| `OLLAMA_BASE_URL`          | การแทนที่ Ollama discovery base URL เริ่มต้นโดยปริยาย (`http://127.0.0.1:11434` หากไม่ได้ตั้งค่า) |
| `LLAMA_CPP_BASE_URL`       | การแทนที่ Llama.cpp discovery base URL เริ่มต้นโดยปริยาย (`http://127.0.0.1:8080` หากไม่ได้ตั้งค่า) |
| `PI_EDIT_VARIANT`          | หากเป็น `hashline` จะบังคับใช้ hashline read/grep display mode เมื่อ edit tool พร้อมใช้งาน     |
| `PI_NO_PTY`                | หากเป็น `1` จะปิดใช้งาน interactive PTY path สำหรับ bash tool                                  |

`PI_NO_PTY` ยังถูกตั้งค่าภายในเมื่อใช้ CLI `--no-pty`

---

## 6) เส้นทาง storage และ config root

ตัวแปรเหล่านี้ถูกใช้งานผ่าน `@f5-sales-demo/pi-utils/dirs` และส่งผลต่อที่ที่ coding-agent จัดเก็บข้อมูล

| ตัวแปร | ค่าเริ่มต้น / พฤติกรรม |
|---|---|
| `PI_CONFIG_DIR` | ชื่อ dirname ของ config root ภายใต้ home (ค่าเริ่มต้น `.xcsh`) |
| `PI_CODING_AGENT_DIR` | การแทนที่แบบสมบูรณ์สำหรับ agent directory (ค่าเริ่มต้น `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | ใช้เมื่อจับคู่ canonical current working directory ใน path helpers |

---

## 7) สภาพแวดล้อมการรัน shell/tool

(จาก `packages/utils/src/procmgr.ts` และการผสาน bash tool ของ coding-agent)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_BASH_NO_CI` | ระงับการฉีด `CI=true` อัตโนมัติเข้าสู่สภาพแวดล้อม shell ที่ spawn |
| `CLAUDE_BASH_NO_CI` | Legacy alias fallback สำหรับ `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | มีจุดประสงค์เพื่อปิดใช้งาน login shell mode |
| `CLAUDE_BASH_NO_LOGIN` | Legacy alias fallback สำหรับ `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | wrapper คำนำหน้าคำสั่งแบบเลือกได้ |
| `CLAUDE_CODE_SHELL_PREFIX` | Legacy alias fallback สำหรับ `PI_SHELL_PREFIX` |
| `VISUAL` | คำสั่ง external editor ที่ต้องการ |
| `EDITOR` | คำสั่ง external editor สำรอง |

หมายเหตุการใช้งานปัจจุบัน: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` ถูกอ่าน แต่ `getShellArgs()` ปัจจุบันส่งคืน `['-l','-c']` ในทั้งสองสาขา (ไม่มีผลจริงในปัจจุบัน)

---

## 8) การตรวจจับ UI/theme/session (สภาพแวดล้อมที่ตรวจจับอัตโนมัติ)

ตัวแปรเหล่านี้ถูกอ่านเป็นสัญญาณรันไทม์ โดยส่วนใหญ่ถูกตั้งค่าโดย terminal/OS แทนที่จะกำหนดค่าด้วยตนเอง

| ตัวแปร | ใช้สำหรับ |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | การตรวจจับความสามารถสี (theme color mode) |
| `COLORFGBG` | การตรวจจับพื้นหลัง terminal แบบ light/dark อัตโนมัติ |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | เอกลักษณ์ terminal ใน system prompt/context |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | การตรวจจับ desktop/window-manager ใน system prompt/context |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | ID การติดตาม session ที่เสถียรต่อ terminal |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | การวินิจฉัยข้อมูลระบบ |
| `APPDATA`, `XDG_CONFIG_HOME` | การแก้ไข lspmux config path |
| `HOME` | การย่อเส้นทางใน MCP command UI |

---

## 9) แฟล็ก native loader/debug

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_DEV` | เปิดใช้งาน verbose native addon load diagnostics ใน `packages/natives` |

## 10) แฟล็กรันไทม์ TUI (shared package ส่งผลต่อ UX ของ coding-agent)

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` ระงับการแจ้งเตือน desktop |
| `PI_TUI_WRITE_LOG` | หากตั้งค่าไว้ จะบันทึก TUI writes ลงไฟล์ |
| `PI_HARDWARE_CURSOR` | หากเป็น `1` จะเปิดใช้งาน hardware cursor mode |
| `PI_CLEAR_ON_SHRINK` | หากเป็น `1` จะล้างแถวว่างเมื่อเนื้อหาย่อขนาด |
| `PI_DEBUG_REDRAW` | หากเป็น `1` จะเปิดใช้งาน debug logging การ redraw |
| `PI_TUI_DEBUG` | หากเป็น `1` จะเปิดใช้งาน deep TUI debug dump path |

---

## 11) การควบคุมการสร้าง commit

| ตัวแปร | พฤติกรรม |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | หากเป็น `true` (ไม่คำนึงถึงตัวพิมพ์ใหญ่/เล็ก) จะบังคับใช้ fallback generation path ของ commit |
| `PI_COMMIT_NO_FALLBACK` | หากเป็น `true` จะปิดใช้งาน fallback เมื่อ agent ไม่ส่งคืน proposal |
| `PI_COMMIT_MAP_REDUCE` | หากเป็น `false` จะปิดใช้งาน map-reduce commit analysis path |
| `DEBUG` | หากตั้งค่าไว้ จะพิมพ์ stack trace ข้อผิดพลาดของ commit agent |

---

## ตัวแปรที่มีความอ่อนไหวด้านความปลอดภัย

ปฏิบัติต่อตัวแปรเหล่านี้เป็น secrets อย่าบันทึก log หรือ commit:

- Provider/API key และ OAuth/bearer credentials (ทั้งหมดที่เป็น `*_API_KEY`, `*_TOKEN`, OAuth access/refresh tokens)
- Cloud credentials (`AWS_*`, เส้นทาง `GOOGLE_APPLICATION_CREDENTIALS` อาจเปิดเผยข้อมูล service-account)
- ตัวแปร search/provider auth (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, Anthropic search keys)
- วัสดุ Foundry mTLS (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` เมื่อชี้ไปยัง private CA bundles)

Python runtime ยังลบตัวแปร key ทั่วไปหลายตัวออกอย่างชัดเจนก่อนที่จะ spawn kernel subprocesses (`packages/coding-agent/src/ipy/runtime.ts`)
