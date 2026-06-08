---
title: การกำหนดค่า MCP
description: >-
  การกำหนดค่า MCP server, การตรวจสอบความถูกต้อง, และการจัดการสำหรับ runtime ของ
  coding agent
sidebar:
  order: 1
  label: การกำหนดค่า
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# การกำหนดค่า MCP ใน OMP

คู่มือนี้อธิบายวิธีการเพิ่ม แก้ไข และตรวจสอบความถูกต้องของ MCP server สำหรับ OMP coding agent

แหล่งข้อมูลหลักในโค้ด:

- ประเภทการกำหนดค่า runtime: `packages/coding-agent/src/mcp/types.ts`
- ตัวเขียนการกำหนดค่า: `packages/coding-agent/src/mcp/config-writer.ts`
- ตัวโหลด + การตรวจสอบความถูกต้อง: `packages/coding-agent/src/mcp/config.ts`
- การค้นหา `mcp.json` แบบ standalone: `packages/coding-agent/src/discovery/mcp-json.ts`
- Schema: `packages/coding-agent/src/config/mcp-schema.json`

## ตำแหน่งไฟล์กำหนดค่าที่แนะนำ

OMP สามารถค้นหา MCP server จากเครื่องมือหลายตัว (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json` และอื่นๆ) แต่สำหรับการกำหนดค่าเฉพาะของ OMP คุณควรใช้ไฟล์ใดไฟล์หนึ่งต่อไปนี้:

- ระดับโปรเจกต์: `.xcsh/mcp.json`
- ระดับผู้ใช้: `~/.xcsh/mcp.json`

OMP ยังรองรับไฟล์ standalone สำรองในรูทของโปรเจกต์:

- `mcp.json`
- `.mcp.json`

ใช้ `.xcsh/mcp.json` เมื่อคุณต้องการให้ OMP เป็นเจ้าของการกำหนดค่า ใช้ `mcp.json` / `.mcp.json` ที่รูทเฉพาะเมื่อคุณต้องการไฟล์สำรองแบบพกพาที่ MCP client อื่นๆ อาจอ่านได้เช่นกัน

## เพิ่มการอ้างอิง schema

เพิ่มบรรทัดนี้ที่ด้านบนของไฟล์เพื่อให้โปรแกรมแก้ไขเติมข้อความอัตโนมัติและตรวจสอบความถูกต้อง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

ตอนนี้ OMP จะเขียนสิ่งนี้โดยอัตโนมัติเมื่อ `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` หรือ flow การเขียนการกำหนดค่าอื่นๆ สร้างหรืออัปเดตไฟล์ MCP ที่จัดการโดย OMP

## โครงสร้างไฟล์

OMP รองรับโครงสร้างระดับบนสุดนี้:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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
- `mcpServers` — แมปของชื่อ server ไปยังการกำหนดค่า server
- `disabledServers` — รายการ denylist ระดับผู้ใช้ที่ใช้ปิด server ที่ค้นพบตามชื่อ

ชื่อ server ต้องตรงกับ `^[a-zA-Z0-9_.-]{1,100}$`

## ฟิลด์ server ที่รองรับ

ฟิลด์ที่ใช้ร่วมกันสำหรับทุก transport:

- `enabled?: boolean` — ข้าม server นี้เมื่อเป็น `false`
- `timeout?: number` — timeout ของการเชื่อมต่อเป็นมิลลิวินาที
- `auth?: { ... }` — ข้อมูลเมตาการยืนยันตัวตนที่ OMP ใช้สำหรับ flow OAuth/API-key
- `oauth?: { ... }` — การตั้งค่า OAuth client แบบชัดเจนที่ใช้ระหว่างการยืนยันตัวตน/ยืนยันตัวตนซ้ำ

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
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

ตัวอย่างนี้ตรงกับ endpoint ของ GitHub MCP server แบบโฮสต์ของ GitHub

### `sse` transport

จำเป็น:

- `type: "sse"`
- `url: string`

ไม่บังคับ:

- `headers?: Record<string, string>`

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` ยังคงรองรับเพื่อความเข้ากันได้ แต่ข้อกำหนด MCP ปัจจุบันแนะนำให้ใช้ Streamable HTTP (`type: "http"`) สำหรับ server ใหม่

## ฟิลด์ auth

OMP เข้าใจออบเจกต์ที่เกี่ยวข้องกับการยืนยันตัวตนสองรายการ

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

Slack เป็นตัวอย่างที่ชัดเจนที่สุดในปัจจุบัน Slack MCP server โฮสต์ที่ `https://mcp.slack.com/mcp` ใช้ Streamable HTTP และต้องการ OAuth แบบ confidential กับข้อมูลรับรอง client ของแอป Slack ของคุณ

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

## ตัวอย่างที่พร้อมคัดลอกใช้งาน

### Filesystem server ผ่าน stdio

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
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

## ข้อมูลลับและการแทนที่ตัวแปร

นี่คือส่วนที่มักทำให้ผู้คนสับสน

### ใน `.xcsh/mcp.json` และ `~/.xcsh/mcp.json`

ก่อนที่ OMP จะเปิดใช้งาน server หรือส่งคำขอ HTTP จะทำการแทนที่ค่า `env` และ `headers` ดังนี้:

1. หากค่าเริ่มต้นด้วย `!` OMP จะรันเป็นคำสั่ง shell และใช้ stdout ที่ตัดช่องว่างแล้ว
2. มิฉะนั้น OMP จะตรวจสอบก่อนว่าค่าตรงกับชื่อตัวแปรสภาพแวดล้อมหรือไม่
3. หากตัวแปรสภาพแวดล้อมนั้นไม่ได้ตั้งค่าไว้ OMP จะใช้สตริงตามตัวอักษร

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

นั่นหมายความว่าสิ่งเหล่านี้ใช้งานได้และสะดวกสำหรับข้อมูลลับในเครื่อง:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → คัดลอกจากสภาพแวดล้อม shell ปัจจุบัน
- `"Authorization": "Bearer hardcoded-token"` → ใช้ค่าตามตัวอักษร
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → สร้าง header จากคำสั่ง

### ใน `mcp.json` และ `.mcp.json` ที่รูท

ตัวโหลดสำรองแบบ standalone ยังขยาย `${VAR}` และ `${VAR:-default}` ภายในสตริงระหว่างการค้นหาด้วย

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

หากคุณต้องการพฤติกรรมของ OMP ที่ไม่สร้างความสับสน ให้ใช้ `.xcsh/mcp.json` และใช้ค่า env/header แบบชัดเจน

## `disabledServers`

`disabledServers` มีประโยชน์หลักในไฟล์กำหนดค่าระดับผู้ใช้ (`~/.xcsh/mcp.json`) เมื่อ server ถูกค้นพบจากแหล่งอื่นและคุณต้องการให้ OMP ละเว้นโดยไม่ต้องแก้ไขการกำหนดค่าของเครื่องมืออื่น

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` เทียบกับการแก้ไข JSON โดยตรง

ใช้ `/mcp add` เมื่อคุณต้องการการตั้งค่าแบบมีตัวช่วยแนะนำ

ใช้การแก้ไข JSON โดยตรงเมื่อ:

- คุณต้องการ transport หรือตัวเลือก auth ที่ตัวช่วยยังไม่ได้ถามในขณะนี้
- คุณต้องการวางคำจำกัดความ server จาก MCP client อื่น
- คุณต้องการการตรวจสอบความถูกต้องที่รองรับ schema ในโปรแกรมแก้ไขของคุณ

หลังจากแก้ไขแล้ว ใช้:

- `/mcp reload` เพื่อค้นหาใหม่และเชื่อมต่อ server ใหม่ในเซสชันปัจจุบัน
- `/mcp list` เพื่อดูว่า server มาจากไฟล์กำหนดค่าใด
- `/mcp test <name>` เพื่อทดสอบ server เดียว

## กฎการตรวจสอบความถูกต้องที่ OMP บังคับใช้

จาก `validateServerConfig()` ใน `packages/coding-agent/src/mcp/config.ts`:

- `stdio` ต้องมี `command`
- `http` และ `sse` ต้องมี `url`
- server ไม่สามารถตั้งค่าทั้ง `command` และ `url` พร้อมกัน
- ค่า `type` ที่ไม่รู้จักจะถูกปฏิเสธ

ผลกระทบในทางปฏิบัติ:

- การละเว้น `type` หมายถึง `stdio`
- หากคุณวางการกำหนดค่า server แบบ remote แล้วลืมใส่ `"type": "http"` OMP จะถือว่าเป็น `stdio` และแจ้งว่า `command` หายไป
- `sse` ยังคงใช้ได้เพื่อความเข้ากันได้ แต่ hosted server ใหม่ควรกำหนดค่าเป็น `http`

## การค้นหาและลำดับความสำคัญ

OMP ไม่รวมคำจำกัดความ server ที่ซ้ำกันข้ามไฟล์ ผู้ให้บริการการค้นหาจะถูกจัดลำดับความสำคัญ และคำจำกัดความที่มีลำดับสูงกว่าจะชนะ

ในทางปฏิบัติ:

- ใช้ `.xcsh/mcp.json` หรือ `~/.xcsh/mcp.json` เมื่อคุณต้องการ override เฉพาะ OMP
- รักษาชื่อ server ให้ไม่ซ้ำกันข้ามเครื่องมือเมื่อเป็นไปได้
- ใช้ `disabledServers` ในการกำหนดค่าระดับผู้ใช้เมื่อการกำหนดค่าของเครื่องมือภายนอกยังคงเพิ่ม server ที่คุณไม่ต้องการกลับมา

## การแก้ไขปัญหา

### `Server "name": stdio server requires "command" field`

คุณอาจละเว้น `type: "http"` บน server แบบ remote

### `Server "name": both "command" and "url" are set`

เลือก transport อย่างใดอย่างหนึ่ง OMP ถือว่า `command` เป็น stdio และ `url` เป็น http/sse

### `/mcp add` ทำงานสำเร็จแต่ server ยังคงเชื่อมต่อไม่ได้

JSON ถูกต้อง แต่ server อาจยังคงเข้าถึงไม่ได้ ใช้ `/mcp test <name>` และตรวจสอบว่า:

- ไฟล์ binary หรือ Docker image มีอยู่
- ตัวแปรสภาพแวดล้อมที่จำเป็นถูกตั้งค่าแล้ว
- URL แบบ remote สามารถเข้าถึงได้
- OAuth หรือ API token ถูกต้อง

### Server มีอยู่ในการกำหนดค่าของเครื่องมืออื่นแต่ไม่มีใน OMP

รัน `/mcp list` OMP ค้นหาไฟล์ MCP ของเครื่องมือภายนอกหลายตัว แต่การโหลดระดับโปรเจกต์ก็อาจถูกปิดใช้งานผ่านการตั้งค่า `mcp.enableProjectConfig` ได้เช่นกัน

## เอกสารอ้างอิง

- ข้อกำหนด MCP transport: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- แพ็กเกจ Filesystem server: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP server: <https://github.com/github/github-mcp-server>
- เอกสาร Slack MCP server: <https://docs.slack.dev/ai/slack-mcp-server/>
