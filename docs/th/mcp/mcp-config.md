---
title: การตั้งค่า MCP
description: การตั้งค่า การตรวจสอบ และการจัดการ MCP server สำหรับ coding agent runtime
sidebar:
  order: 1
  label: การตั้งค่า
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# การตั้งค่า MCP ใน OMP

คู่มือนี้อธิบายวิธีการเพิ่ม แก้ไข และตรวจสอบ MCP servers สำหรับ OMP coding agent

แหล่งข้อมูลหลักในโค้ด:

- ประเภทการตั้งค่า Runtime: `packages/coding-agent/src/mcp/types.ts`
- ตัวเขียนการตั้งค่า: `packages/coding-agent/src/mcp/config-writer.ts`
- ตัวโหลด + การตรวจสอบ: `packages/coding-agent/src/mcp/config.ts`
- การค้นหา `mcp.json` แบบ standalone: `packages/coding-agent/src/discovery/mcp-json.ts`
- Schema: `packages/coding-agent/src/config/mcp-schema.json`

## ตำแหน่งไฟล์การตั้งค่าที่แนะนำ

OMP สามารถค้นหา MCP servers จากเครื่องมือหลายตัว (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json` และอื่นๆ) แต่สำหรับการตั้งค่าเฉพาะ OMP คุณควรใช้ไฟล์ใดไฟล์หนึ่งต่อไปนี้:

- ระดับโปรเจกต์: `.xcsh/mcp.json`
- ระดับผู้ใช้: `~/.xcsh/mcp.json`

OMP ยังรับไฟล์ standalone สำรองในไดเรกทอรีรากของโปรเจกต์ด้วย:

- `mcp.json`
- `.mcp.json`

ใช้ `.xcsh/mcp.json` เมื่อคุณต้องการให้ OMP เป็นเจ้าของการตั้งค่า ใช้ `mcp.json` / `.mcp.json` ที่ราก เฉพาะเมื่อคุณต้องการไฟล์สำรองแบบพกพาที่ MCP clients ตัวอื่นอาจอ่านได้ด้วย

## เพิ่มการอ้างอิง schema

เพิ่มบรรทัดนี้ที่ด้านบนของไฟล์เพื่อให้ editor มี autocomplete และการตรวจสอบ:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

ตอนนี้ OMP จะเขียนสิ่งนี้โดยอัตโนมัติเมื่อ `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth` หรือขั้นตอนการเขียนการตั้งค่าอื่นๆ สร้างหรืออัปเดตไฟล์ MCP ที่จัดการโดย OMP

## โครงสร้างไฟล์

OMP รองรับโครงสร้างระดับบนสุดดังนี้:

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
- `mcpServers` — แผนผังของชื่อ server ไปยังการตั้งค่า server
- `disabledServers` — รายการปฏิเสธระดับผู้ใช้ที่ใช้ปิด server ที่ถูกค้นพบตามชื่อ

ชื่อ server ต้องตรงกับ `^[a-zA-Z0-9_.-]{1,100}$`

## ฟิลด์ server ที่รองรับ

ฟิลด์ที่ใช้ร่วมกันสำหรับทุก transport:

- `enabled?: boolean` — ข้ามเซิร์ฟเวอร์นี้เมื่อเป็น `false`
- `timeout?: number` — ระยะเวลาหมดเวลาการเชื่อมต่อในหน่วยมิลลิวินาที
- `auth?: { ... }` — ข้อมูลเมตาการยืนยันตัวตนที่ OMP ใช้สำหรับขั้นตอน OAuth/API-key
- `oauth?: { ... }` — การตั้งค่า OAuth client แบบชัดเจนที่ใช้ระหว่างการยืนยันตัวตน/ยืนยันตัวตนใหม่

### transport แบบ `stdio`

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

ตัวอย่างนี้ใช้แพ็คเกจ Filesystem MCP server อย่างเป็นทางการ (`@modelcontextprotocol/server-filesystem`)

### transport แบบ `http`

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

ตัวอย่างนี้ตรงกับ endpoint ของ GitHub MCP server ที่โฮสต์โดย GitHub

### transport แบบ `sse`

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

`sse` ยังคงรองรับเพื่อความเข้ากันได้ แต่ MCP spec ปัจจุบันแนะนำให้ใช้ Streamable HTTP (`type: "http"`) สำหรับ server ใหม่

## ฟิลด์การยืนยันตัวตน

OMP เข้าใจอ็อบเจกต์ที่เกี่ยวข้องกับการยืนยันตัวตนสองอ็อบเจกต์

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

ใช้สิ่งนี้เมื่อ OMP ควรจำวิธีการกู้คืน credentials สำหรับ server

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

ใช้สิ่งนี้เมื่อ MCP server ต้องการการตั้งค่า OAuth client แบบชัดเจน

Slack เป็นตัวอย่างที่ชัดเจนที่สุดในปัจจุบัน MCP server ของ Slack โฮสต์อยู่ที่ `https://mcp.slack.com/mcp` ใช้ Streamable HTTP และต้องการ confidential OAuth พร้อม client credentials ของ Slack app ของคุณ

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

Endpoint ที่เกี่ยวข้องของ Slack จากเอกสาร Slack:

- MCP endpoint: `https://mcp.slack.com/mcp`
- Authorization endpoint: `https://slack.com/oauth/v2_user/authorize`
- Token endpoint: `https://slack.com/api/oauth.v2.user.access`

## ตัวอย่างพร้อมคัดลอกวางที่พบบ่อย

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

## ข้อมูลลับและการแปลงค่าตัวแปร

นี่คือส่วนที่มักทำให้คนสับสน

### ใน `.xcsh/mcp.json` และ `~/.xcsh/mcp.json`

ก่อนที่ OMP จะเริ่มต้น server หรือทำ HTTP request ระบบจะแปลงค่า `env` และ `headers` ดังนี้:

1. ถ้าค่าเริ่มต้นด้วย `!` OMP จะรันเป็นคำสั่ง shell และใช้ stdout ที่ตัดช่องว่างแล้ว
2. มิฉะนั้น OMP จะตรวจสอบก่อนว่าค่าตรงกับชื่อตัวแปรสภาพแวดล้อมหรือไม่
3. ถ้าตัวแปรสภาพแวดล้อมนั้นไม่ได้ตั้งค่าไว้ OMP จะใช้สตริงตามตัวอักษร

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

นั่นหมายความว่าสิ่งต่อไปนี้ใช้ได้และสะดวกสำหรับข้อมูลลับในเครื่อง:

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → คัดลอกจากสภาพแวดล้อม shell ปัจจุบัน
- `"Authorization": "Bearer hardcoded-token"` → ใช้ค่าตามตัวอักษร
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → สร้าง header จากคำสั่ง

### ใน `mcp.json` และ `.mcp.json` ที่ราก

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

ถ้าคุณต้องการพฤติกรรมที่คาดเดาได้ง่ายที่สุดของ OMP ให้ใช้ `.xcsh/mcp.json` และใช้ค่า env/header แบบชัดเจน

## `disabledServers`

`disabledServers` มีประโยชน์มากที่สุดในไฟล์การตั้งค่าผู้ใช้ (`~/.xcsh/mcp.json`) เมื่อ server ถูกค้นพบจากแหล่งอื่นและคุณต้องการให้ OMP ละเว้นโดยไม่ต้องแก้ไขการตั้งค่าของเครื่องมืออื่นนั้น

ตัวอย่าง:

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` กับการแก้ไข JSON โดยตรง

ใช้ `/mcp add` เมื่อคุณต้องการการตั้งค่าแบบมีคำแนะนำ

ใช้การแก้ไข JSON โดยตรงเมื่อ:

- คุณต้องการ transport หรือตัวเลือกการยืนยันตัวตนที่ wizard ยังไม่ได้ถามถึง
- คุณต้องการวางคำจำกัดความ server จาก MCP client ตัวอื่น
- คุณต้องการการตรวจสอบที่มี schema รองรับใน editor ของคุณ

หลังจากแก้ไข ให้ใช้:

- `/mcp reload` เพื่อค้นหาใหม่และเชื่อมต่อ server ใหม่ในเซสชันปัจจุบัน
- `/mcp list` เพื่อดูว่า server มาจากไฟล์การตั้งค่าไหน
- `/mcp test <name>` เพื่อทดสอบ server เดียว

## กฎการตรวจสอบที่ OMP บังคับใช้

จาก `validateServerConfig()` ใน `packages/coding-agent/src/mcp/config.ts`:

- `stdio` ต้องมี `command`
- `http` และ `sse` ต้องมี `url`
- server ไม่สามารถตั้งค่าทั้ง `command` และ `url` พร้อมกัน
- ค่า `type` ที่ไม่รู้จักจะถูกปฏิเสธ

ผลกระทบเชิงปฏิบัติ:

- การไม่ระบุ `type` หมายถึง `stdio`
- ถ้าคุณวางการตั้งค่า remote server แล้วลืม `"type": "http"` OMP จะถือว่าเป็น `stdio` และแจ้งว่าขาด `command`
- `sse` ยังคงใช้ได้เพื่อความเข้ากันได้ แต่ hosted server ใหม่ควรตั้งค่าเป็น `http`

## การค้นหาและลำดับความสำคัญ

OMP ไม่รวมคำจำกัดความ server ที่ซ้ำกันข้ามไฟล์ ผู้ให้บริการการค้นหาจะถูกจัดลำดับความสำคัญ และคำจำกัดความที่มีลำดับความสำคัญสูงกว่าจะชนะ

ในทางปฏิบัติ:

- ใช้ `.xcsh/mcp.json` หรือ `~/.xcsh/mcp.json` เมื่อคุณต้องการ override เฉพาะ OMP
- ทำให้ชื่อ server ไม่ซ้ำกันข้ามเครื่องมือเมื่อเป็นไปได้
- ใช้ `disabledServers` ในการตั้งค่าผู้ใช้เมื่อการตั้งค่าของบุคคลที่สามเพิ่ม server ที่คุณไม่ต้องการเข้ามาซ้ำ

## การแก้ไขปัญหา

### `Server "name": stdio server requires "command" field`

คุณอาจลืมระบุ `type: "http"` บน remote server

### `Server "name": both "command" and "url" are set`

เลือก transport เดียว OMP ถือว่า `command` เป็น stdio และ `url` เป็น http/sse

### `/mcp add` ทำงานแล้วแต่ server ยังเชื่อมต่อไม่ได้

JSON ถูกต้อง แต่ server อาจยังเข้าถึงไม่ได้ ใช้ `/mcp test <name>` และตรวจสอบว่า:

- ไบนารีหรือ Docker image มีอยู่หรือไม่
- ตัวแปรสภาพแวดล้อมที่จำเป็นถูกตั้งค่าแล้วหรือไม่
- URL ระยะไกลเข้าถึงได้หรือไม่
- OAuth หรือ API token ถูกต้องหรือไม่

### Server มีอยู่ในการตั้งค่าของเครื่องมืออื่นแต่ไม่อยู่ใน OMP

รัน `/mcp list` OMP ค้นหาไฟล์ MCP ของบุคคลที่สามหลายไฟล์ แต่การโหลดระดับโปรเจกต์สามารถปิดได้ผ่านการตั้งค่า `mcp.enableProjectConfig`

## เอกสารอ้างอิง

- MCP transport spec: <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- แพ็คเกจ Filesystem server: <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP server: <https://github.com/github/github-mcp-server>
- เอกสาร Slack MCP server: <https://docs.slack.dev/ai/slack-mcp-server/>
