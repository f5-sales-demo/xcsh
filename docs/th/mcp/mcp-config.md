---
title: การกำหนดค่า MCP
description: >-
  การกำหนดค่า MCP server, การตรวจสอบความถูกต้อง, และการจัดการสำหรับ coding agent
  runtime
sidebar:
  order: 1
  label: การกำหนดค่า
i18n:
  sourceHash: ef8b49458ce9
  translator: machine
---

# การกำหนดค่า MCP ใน OMP

คู่มือนี้อธิบายวิธีการเพิ่ม แก้ไข และตรวจสอบความถูกต้องของ MCP server สำหรับ OMP coding agent

แหล่งข้อมูลอ้างอิงในโค้ด:

- ชนิดข้อมูลของ runtime config: `packages/coding-agent/src/mcp/types.ts`
- Config writer: `packages/coding-agent/src/mcp/config-writer.ts`
- Loader + validation: `packages/coding-agent/src/mcp/config.ts`
- การค้นหา `mcp.json` แบบ standalone: `packages/coding-agent/src/discovery/mcp-json.ts`
- Schema: `packages/coding-agent/src/config/mcp-schema.json`

## ตำแหน่งไฟล์กำหนดค่าที่แนะนำ

OMP สามารถค้นหา MCP server จากเครื่องมือหลายตัว (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json` และอื่นๆ) แต่สำหรับการกำหนดค่าเฉพาะของ OMP คุณควรใช้ไฟล์ใดไฟล์หนึ่งต่อไปนี้:

- ระดับโปรเจกต์: `.xcsh/mcp.json`
- ระดับผู้ใช้: `~/.xcsh/mcp.json`

OMP ยังรองรับไฟล์ standalone สำรองในรูทของโปรเจกต์:

- `mcp.json`
- `.mcp.json`

ใช้ `.xcsh/mcp.json` เมื่อคุณต้องการให้ OMP เป็นเจ้าของการกำหนดค่า ใช้ `mcp.json` / `.mcp.json` ที่รูทเฉพาะเมื่อคุณต้องการไฟล์สำรองที่พกพาได้ซึ่ง MCP client อื่นๆ อาจอ่านได้เช่นกัน

## เพิ่มการอ้างอิง schema

เพิ่มบรรทัดนี้ที่ด้านบนของไฟล์เพื่อรับ autocomplete และการตรวจสอบความถูกต้องในเอดิเตอร์:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

ปัจจุบัน OMP จะเขียนสิ่งนี้โดยอัตโนมัติเมื่อ `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` หรือขั้นตอนการเขียน config อื่นๆ สร้างหรืออัปเดตไฟล์ MCP ที่จัดการโดย OMP

## โครงสร้างไฟล์

OMP รองรับโครงสร้างระดับบนสุดนี้:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

คีย์ระดับบนสุด:

- `$schema` — URL ของ JSON Schema สำหรับเครื่องมือ (ไม่บังคับ)
- `mcpServers` — แมปชื่อ server ไปยังการกำหนดค่า server
- `disabledServers` — รายการปิดกั้นระดับผู้ใช้ที่ใช้ปิด server ที่ค้นพบตามชื่อ

ชื่อ server ต้องตรงกับ `^[a-zA-Z0-9_.-]{1,100}$`

## ฟิลด์ server ที่รองรับ

ฟิลด์ร่วมสำหรับทุก transport:

- `enabled?: boolean` — ข้ามเซิร์ฟเวอร์นี้เมื่อเป็น `false`
- `timeout?: number` — ระยะหมดเวลาการเชื่อมต่อเป็นมิลลิวินาที
- `auth?: { ... }` — ข้อมูลเมตาสำหรับการยืนยันตัวตนที่ OMP ใช้สำหรับขั้นตอน OAuth/API-key
- `oauth?: { ... }` — การตั้งค่า OAuth client แบบชัดเจนที่ใช้ระหว่างการ auth/reauth

### `stdio` transport

`stdio` เป็นค่าเริ่มต้นเมื่อไม่ได้ระบุ `type`

จำเป็น:

- `command: string`

ไม่บังคับ:

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

ตัวอย่างนี้ใช้แพ็กเกจ Filesystem MCP server อย่างเป็นทางการ (`@modelcontextprotocol/server-filesystem`)

### `http` transport

จำเป็น:

- `type: "http"`
- `url: string`

ไม่บังคับ:

- `headers?: Record<string, string>`

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

ตัวอย่างนี้ตรงกับ endpoint ของ GitHub MCP server แบบ hosted ของ GitHub

### `sse` transport

จำเป็น:

- `type: "sse"`
- `url: string`

ไม่บังคับ:

- `headers?: Record<string, string>`

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` ยังคงรองรับเพื่อความเข้ากันได้ แต่ข้อกำหนด MCP ปัจจุบันแนะนำให้ใช้ Streamable HTTP (`type: "http"`) สำหรับ server ใหม่

## ฟิลด์ Auth

OMP เข้าใจออบเจกต์ที่เกี่ยวข้องกับ auth สองตัว

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

ใช้เมื่อคุณต้องการให้ OMP จดจำวิธีการกู้คืนข้อมูลรับรองสำหรับ server

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

ใช้เมื่อ MCP server ต้องการการตั้งค่า OAuth client แบบชัดเจน

Slack เป็นตัวอย่างที่ชัดเจนที่สุดในปัจจุบัน MCP server ของ Slack โฮสต์อยู่ที่ `https://mcp.slack.com/mcp` ใช้ Streamable HTTP และต้องการ confidential OAuth ด้วย client credentials ของแอป Slack ของคุณ

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

Endpoint ที่เกี่ยวข้องของ Slack จากเอกสารของ Slack:

- MCP endpoint: `https://mcp.slack.com/mcp`
- Authorization endpoint: `https://slack.com/oauth/v2_user/authorize`
- Token endpoint: `https://slack.com/api/oauth.v2.user.access`

## ตัวอย่างที่พร้อมคัดลอกและวาง

### Filesystem server ผ่าน stdio

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### GitHub hosted server ผ่าน HTTP

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### GitHub local server ผ่าน Docker

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

ตัวอย่างนี้ตรงกับ Docker image อย่างเป็นทางการของ GitHub `ghcr.io/github/github-mcp-server`

### Slack hosted server ผ่าน OAuth

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## ค่าลับและการแปลงค่าตัวแปร

นี่คือส่วนที่มักทำให้ผู้ใช้สับสน

### ใน `.xcsh/mcp.json` และ `~/.xcsh/mcp.json`

ก่อนที่ OMP จะเปิด server หรือทำ HTTP request จะแปลงค่า `env` และ `headers` ดังนี้:

1. หากค่าเริ่มต้นด้วย `!` OMP จะรันเป็นคำสั่ง shell และใช้ stdout ที่ตัดช่องว่างแล้ว
2. มิฉะนั้น OMP จะตรวจสอบก่อนว่าค่าตรงกับชื่อตัวแปรสภาพแวดล้อมหรือไม่
3. หากตัวแปรสภาพแวดล้อมนั้นไม่ได้ถูกตั้งค่าไว้ OMP จะใช้สตริงตามตัวอักษร

ตัวอย่าง:

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

หมายความว่าวิธีนี้ใช้ได้และสะดวกสำหรับค่าลับในเครื่อง:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → คัดลอกจากสภาพแวดล้อม shell ปัจจุบัน
- `"Authorization": "Bearer hardcoded-token"` → ใช้ค่าตามตัวอักษร
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → สร้าง header จากคำสั่ง

### ใน `mcp.json` และ `.mcp.json` ที่รูท

ตัวโหลดไฟล์ standalone สำรองจะขยาย `${VAR}` และ `${VAR:-default}` ภายในสตริงระหว่างการค้นหาด้วย

ตัวอย่าง:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

หากคุณต้องการพฤติกรรมของ OMP ที่คาดเดาได้ง่ายที่สุด ให้เลือกใช้ `.xcsh/mcp.json` และใช้ค่า env/header แบบชัดเจน

## `disabledServers`

`disabledServers` มีประโยชน์หลักในไฟล์กำหนดค่าระดับผู้ใช้ (`~/.xcsh/mcp.json`) เมื่อ server ถูกค้นพบจากแหล่งอื่นและคุณต้องการให้ OMP เพิกเฉยโดยไม่ต้องแก้ไขไฟล์กำหนดค่าของเครื่องมืออื่น

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` เทียบกับการแก้ไข JSON โดยตรง

ใช้ `/mcp add` เมื่อคุณต้องการการตั้งค่าแบบมีตัวช่วยนำทาง

ใช้การแก้ไข JSON โดยตรงเมื่อ:

- คุณต้องการตัวเลือก transport หรือ auth ที่วิซาร์ดยังไม่ได้ถามถึง
- คุณต้องการวางคำจำกัดความ server จาก MCP client อื่น
- คุณต้องการการตรวจสอบความถูกต้องแบบ schema-backed ในเอดิเตอร์ของคุณ

หลังจากแก้ไขแล้ว ใช้:

- `/mcp reload` เพื่อค้นหาใหม่และเชื่อมต่อ server ใหม่ในเซสชันปัจจุบัน
- `/mcp list` เพื่อดูว่า server มาจากไฟล์กำหนดค่าไหน
- `/mcp test <name>` เพื่อทดสอบ server เดียว

## กฎการตรวจสอบความถูกต้องที่ OMP บังคับใช้

จาก `validateServerConfig()` ใน `packages/coding-agent/src/mcp/config.ts`:

- `stdio` ต้องการ `command`
- `http` และ `sse` ต้องการ `url`
- server ไม่สามารถตั้งค่าทั้ง `command` และ `url` พร้อมกันได้
- ค่า `type` ที่ไม่รู้จักจะถูกปฏิเสธ

ผลกระทบในทางปฏิบัติ:

- การไม่ระบุ `type` หมายถึง `stdio`
- หากคุณวางการกำหนดค่า remote server และลืม `"type": "http"` OMP จะถือว่าเป็น `stdio` และแจ้งว่า `command` หายไป
- `sse` ยังคงใช้ได้เพื่อความเข้ากันได้ แต่ hosted server ใหม่ควรกำหนดค่าเป็น `http`

## การค้นหาและลำดับความสำคัญ

OMP ไม่รวมคำจำกัดความ server ที่ซ้ำกันข้ามไฟล์ ผู้ให้บริการค้นหาจะถูกจัดลำดับความสำคัญ และคำจำกัดความที่มีลำดับความสำคัญสูงกว่าจะชนะ

ในทางปฏิบัติ:

- เลือกใช้ `.xcsh/mcp.json` หรือ `~/.xcsh/mcp.json` เมื่อคุณต้องการการแทนที่เฉพาะ OMP
- ตั้งชื่อ server ให้ไม่ซ้ำกันข้ามเครื่องมือเมื่อเป็นไปได้
- ใช้ `disabledServers` ในไฟล์กำหนดค่าระดับผู้ใช้เมื่อการกำหนดค่าจากบุคคลที่สามยังคงนำ server ที่คุณไม่ต้องการกลับมา

## การแก้ไขปัญหา

### `Server "name": stdio server requires "command" field`

คุณอาจลืมระบุ `type: "http"` บน remote server

### `Server "name": both "command" and "url" are set`

เลือก transport อย่างใดอย่างหนึ่ง OMP ถือว่า `command` เป็น stdio และ `url` เป็น http/sse

### `/mcp add` ทำงานแล้วแต่ server ยังไม่เชื่อมต่อ

JSON ถูกต้อง แต่ server อาจยังเข้าถึงไม่ได้ ใช้ `/mcp test <name>` และตรวจสอบว่า:

- ไบนารีหรือ Docker image มีอยู่
- ตัวแปรสภาพแวดล้อมที่จำเป็นถูกตั้งค่าแล้ว
- URL ระยะไกลสามารถเข้าถึงได้
- OAuth หรือ API token ถูกต้อง

### Server มีอยู่ในการกำหนดค่าของเครื่องมืออื่นแต่ไม่มีใน OMP

รัน `/mcp list` OMP ค้นหาไฟล์ MCP จากบุคคลที่สามได้หลายไฟล์ แต่การโหลดระดับโปรเจกต์อาจถูกปิดได้ผ่านการตั้งค่า `mcp.enableProjectConfig`

## เอกสารอ้างอิง

- ข้อกำหนด MCP transport: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- แพ็กเกจ Filesystem server: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP server: <https://github.com/github/github-mcp-server>
- เอกสาร Slack MCP server: <https://docs.slack.dev/ai/slack-mcp-server/>
