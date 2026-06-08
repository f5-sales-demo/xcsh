---
title: 'pi-mono에서 이식하기: 실용적인 병합 가이드'
description: pi-mono 모노레포에서 xcsh 코드베이스로 코드를 마이그레이션하기 위한 실용 가이드입니다.
sidebar:
  order: 9
  label: pi-mono에서 이식하기
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# pi-mono에서 이식하기: 실용적인 병합 가이드

이 가이드는 pi-mono의 변경사항을 이 저장소로 이식하기 위한 반복 가능한 체크리스트입니다.
단일 파일, 기능 브랜치, 전체 릴리스 동기화 등 모든 병합에 활용하세요.

## 마지막 동기화 지점

**커밋:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**날짜:** 2026-03-22

각 동기화 후 이 섹션을 업데이트하세요. 이전 범위를 재사용하지 마세요.

새로운 동기화를 시작할 때, 이 커밋부터 패치를 생성하세요:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) 범위 정의

- 업스트림 참조(커밋, 태그, 또는 PR)를 식별합니다.
- 수정할 패키지 또는 폴더를 나열합니다.
- 범위에 포함되는 기능과 의도적으로 제외하는 기능을 결정합니다.

## 1) 코드를 안전하게 가져오기

- 전체 복사보다는 깔끔하고 집중된 diff를 선호합니다.
- 빌드 아티팩트나 생성된 파일을 복사하지 마세요.
- 업스트림에서 새 파일을 추가한 경우, 명시적으로 추가하고 내용을 검토하세요.

## 2) import 확장자 규칙 맞추기

대부분의 런타임 TypeScript 소스는 내부 import에서 `.js`를 생략하지만, 일부 test/bench 진입점은 ESM
런타임 호환성을 위해 `.js`를 유지합니다. 로컬 패키지의 기존 스타일을 따르세요. 무조건 확장자를 제거하지 마세요.

- `packages/coding-agent` 런타임 소스에서는 비-TS 에셋을 import하는 경우가 아니라면 내부 import에 확장자를 넣지 마세요.
- `packages/tui/test`와 `packages/natives/bench`에서는 주변 파일이 이미 `.js`를 사용하고 있다면 유지하세요.
- 도구가 요구하는 실제 파일 확장자는 유지하세요 (예: `.json`, `.css`, `.md` 텍스트 임베드).
- 예시: `import { x } from "./foo.js";` → `import { x } from "./foo";` (패키지 규칙이 확장자를 생략하는 경우에만).

## 3) import 스코프 교체

업스트림은 다른 패키지 스코프를 사용합니다. 일관되게 교체하세요.

- 이전 스코프를 여기서 사용하는 로컬 스코프로 교체합니다.
- 예시 (이식하는 실제 패키지에 맞게 조정하세요):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Bun API가 Node보다 나은 경우 사용

Bun에서 실행합니다. Bun이 더 나은 대안을 제공할 때만 Node API를 교체하세요.

**교체할 것:**

- 프로세스 생성: `child_process.spawn` → 간단한 명령에는 Bun Shell `$`, 스트리밍 또는 장시간 실행 작업에는 `Bun.spawn`/`Bun.spawnSync`
- 파일 I/O: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP 클라이언트: `node-fetch`, `axios` → 네이티브 `fetch`
- 암호화 해싱: `node:crypto` → Web Crypto 또는 `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- 환경변수 로딩: `dotenv` → Bun이 `.env`를 자동으로 로드

**교체하지 말 것 (Bun에서 정상 작동):**

- `os.homedir()` — `Bun.env.HOME`, `Bun.env.HOME`, 또는 리터럴 `"~"`로 교체하지 마세요
- `os.tmpdir()` — `Bun.env.TMPDIR || "/tmp"` 또는 하드코딩된 경로로 교체하지 마세요
- `fs.mkdtempSync()` — 수동 경로 구성으로 교체하지 마세요
- `path.join()`, `path.resolve()` 등 — 이들은 정상 작동합니다

**Import 스타일:** 네임스페이스 import에서만 `node:` 접두사를 사용하세요 (명명된 import는 `node:fs`나 `node:path`에서 사용하지 마세요).

**추가 Bun 규칙:**

- 짧고 스트리밍이 아닌 명령에는 Bun Shell `$`를 선호하세요. 스트리밍 I/O나 프로세스 제어가 필요할 때만 `Bun.spawn`을 사용하세요.
- 파일에는 `Bun.file()`/`Bun.write()`를, 디렉토리에는 `node:fs/promises`를 사용하세요.
- `Bun.file().exists()` 검사를 피하세요. try/catch에서 `isEnoent` 처리를 사용하세요.
- `setTimeout` 래퍼보다 `Bun.sleep(ms)`를 선호하세요.

**잘못된 예:**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**올바른 예:**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) Bun 임베드 선호 (복사 금지)

빌드 시 런타임 에셋이나 벤더 파일을 복사하지 마세요.

- 업스트림이 에셋을 dist 폴더에 복사하는 경우, Bun 친화적인 임베드로 교체하세요.
- 프롬프트는 정적 `.md` 파일입니다. 인라인 프롬프트 문자열 대신 Bun 텍스트 import (`with { type: "text" }`)와 Handlebars를 사용하세요.
- 인접한 비텍스트 리소스를 로드하려면 `import.meta.dir` + `Bun.file`을 사용하세요.
- 에셋을 저장소 내에 유지하고 번들러가 포함하도록 하세요.
- 사용자가 명시적으로 요청하지 않는 한 복사 스크립트를 제거하세요.
- 업스트림이 런타임에 번들된 폴백 파일을 읽는 경우, 파일시스템 읽기를 Bun 텍스트 임베드 import로 교체하세요.
  - 예시 (Codex 지침 폴백):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> 제거
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - `readFileSync(FALLBACK_PROMPT_PATH, "utf8")` 대신 `return FALLBACK_INSTRUCTIONS;`를 사용

## 6) `package.json` 신중하게 이식

`package.json`을 계약으로 취급하세요. 의도적으로 병합하세요.

- 이식에 변경이 필요하지 않는 한 기존 `name`, `version`, `type`, `exports`, `bin`을 유지하세요.
- npm/node 스크립트를 Bun 동등한 것으로 교체하세요 (예: `bun check`, `bun test`).
- 의존성이 올바른 스코프를 사용하는지 확인하세요.
- 타입 오류를 수정하기 위해 의존성을 다운그레이드하지 마세요. 대신 업그레이드하세요.
- 워크스페이스 패키지 링크와 `peerDependencies`를 검증하세요.

## 7) 코드 스타일과 도구 정렬

- 기존 포맷팅 규칙을 유지하세요.
- 필요한 경우가 아니면 `any`를 도입하지 마세요.
- 동적 import와 인라인 타입 import를 피하세요. 최상위 import만 사용하세요.
- 코드에서 프롬프트를 구성하지 마세요. 프롬프트는 Handlebars로 렌더링되는 정적 `.md` 파일입니다.
- coding-agent에서는 `console.log`/`console.warn`/`console.error`를 절대 사용하지 마세요. `@f5xc-salesdemos/pi-utils`의 `logger`를 사용하세요.
- `new Promise((resolve, reject) => ...)` 대신 `Promise.withResolvers()`를 사용하세요.
- **클래스 필드나 메서드에 `private`/`protected`/`public` 키워드를 사용하지 마세요.** 캡슐화에는 ES `#` 프라이빗 필드를 사용하고, 접근 가능한 멤버는 키워드 없이 그대로 두세요. 유일한 예외는 생성자 매개변수 속성 (`constructor(private readonly x: T)`)으로, TypeScript에서 키워드가 필수입니다. `private foo`나 `protected bar`를 사용하는 업스트림 코드를 이식할 때는 `#foo` (프라이빗) 또는 바로 `bar` (접근 가능)로 변환하세요.
- 새로운 임시 코드보다 기존 헬퍼와 유틸리티를 선호하세요.
- 이 저장소에 이미 적용된 Bun 우선 인프라 변경사항을 보존하세요:
  - 런타임은 Bun입니다 (Node 진입점 없음).
  - 패키지 매니저는 Bun입니다 (npm 락파일 없음).
  - 무거운 Node API (`child_process`, `readline`)는 Bun 동등물로 교체되었습니다.
  - 가벼운 Node API (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`)는 유지됩니다.
  - CLI shebang은 `bun`을 사용합니다 (`node`, `tsx`가 아님).
  - 패키지는 소스 파일을 직접 사용합니다 (TypeScript 빌드 단계 없음).
  - CI 워크플로우는 install/check/test에 Bun을 실행합니다.

## 8) 이전 호환성 레이어 제거

요청이 없는 한 업스트림 호환성 심을 제거하세요.

- 교체된 이전 API를 삭제하세요.
- 모든 호출 지점을 새 API로 직접 업데이트하세요.
- `*_v2`나 병렬 버전을 유지하지 마세요.

## 9) 문서와 참조 업데이트

- pi-mono 저장소 링크를 적절히 교체하세요.
- 예시를 Bun과 올바른 패키지 스코프로 업데이트하세요.
- README 지침이 현재 저장소 동작과 일치하는지 확인하세요.

## 10) 이식 검증

변경 후 표준 검사를 실행하세요:

- `bun check`

변경사항과 관련 없는 기존 실패 검사가 있다면 명시하세요.
테스트는 Bun의 러너를 사용합니다 (Vitest가 아님). 명시적으로 요청된 경우에만 `bun test`를 실행하세요.

## 11) 개선된 기능 보호 (회귀 방지 목록)

로컬에서 이미 개선한 동작이 있다면 **양보 불가**로 취급하세요. 이식하기 전에
개선사항을 기록하고 명시적 검사를 추가하여 병합 과정에서 사라지지 않도록 하세요.

- **예상 동작을 고정하세요**: 각 개선사항에 대해 짧은 "이전/이후" 메모를 작성하세요 (입력, 출력,
  기본값, 엣지 케이스). 이는 자동 롤백을 방지합니다.
- **이전 → 새 API를 매핑하세요**: 업스트림이 개념명을 변경한 경우 (hooks → extensions, custom tools → tools 등),
  모든 이전 진입점이 여전히 연결되는지 확인하세요. 하나의 플래그나 export를 놓치면 기능을 잃게 됩니다.
- **export를 확인하세요**: `package.json` `exports`, 공개 타입, 배럴 파일을 검사하세요. 업스트림 이식 시
  종종 로컬 추가사항의 재export를 잊습니다.
- **비정상 경로를 커버하세요**: 에러 처리, 타임아웃, 폴백 로직을 수정한 경우, 테스트나
  최소한 해당 경로를 실행하는 수동 체크리스트를 추가하세요.
- **기본값과 설정 병합 순서를 확인하세요**: 개선사항은 종종 기본값에 존재합니다. 새 기본값이
  되돌아가지 않았는지 확인하세요 (예: 새로운 설정 우선순위, 비활성화된 기능, 도구 목록).
- **환경/셸 동작을 감사하세요**: 실행이나 샌드박싱을 수정한 경우, 새 경로가 여전히 정리된
  환경을 사용하고 별칭/함수 오버라이드를 재도입하지 않는지 확인하세요.
- **대상 샘플을 다시 실행하세요**: "정상 작동 확인된" 최소 예제 집합을 유지하고 이식 후 실행하세요
  (CLI 플래그, 확장 등록, 도구 실행).

## 12) 재작성된 코드 감지 및 처리

파일을 이식하기 전에 업스트림이 크게 리팩토링했는지 확인하세요:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

diff가 파일이 **재작성되었음**을 보여주면 (단순 패치가 아닌):

- 새로운 추상화, 이름 변경된 개념, 병합된 모듈, 변경된 데이터 흐름

이식하기 전에 **새 구현을 철저히 읽어야** 합니다. 재작성된 코드를 무작정 병합하면 다음과 같은 이유로 기능을 잃게 됩니다:

참고: 인터랙티브 모드는 최근 controllers/utils/types로 분리되었습니다. 관련 변경사항을 백포트할 때, 우리가 생성한 개별 파일에 업데이트를 이식하고 `interactive-mode.ts` 연결이 동기화 상태를 유지하는지 확인하세요.

1. **기본값이 자동으로 변경됩니다** - 새 변수 `defaultFoo = [a, b]`가 `[a, b, c, d, e]`를 반환하던 이전 `getAllFoo()`를 대체할 수 있습니다.

2. **API 옵션이 누락됩니다** - 시스템이 병합될 때 (예: `hooks` + `customTools` → `extensions`), 이전 옵션이 새 구현에 연결되지 않을 수 있습니다.

3. **코드 경로가 부실해집니다** - 이름이 변경된 개념 (예: `hookMessage` → `custom`)은 정의뿐만 아니라 모든 switch 문, 타입 가드, 핸들러에서 업데이트가 필요합니다.

4. **컨텍스트/기능이 축소됩니다** - 이전 API가 노출하던 `{ logger, typebox, pi }`를 새 API가 포함하지 않을 수 있습니다.

### 의미론적 이식 프로세스

업스트림이 모듈을 재작성한 경우:

1. **이전 구현을 읽으세요** - 무엇을 했는지, 어떤 옵션을 받았는지, 무엇을 노출했는지 이해하세요.

2. **새 구현을 읽으세요** - 새로운 추상화와 이전 동작에 매핑되는 방식을 이해하세요.

3. **기능 동등성을 확인하세요** - 이전 코드의 각 기능에 대해, 새 코드가 보존하거나 명시적으로 제거하는지 확인하세요.

4. **잔여 항목을 검색하세요** - switch 문, 핸들러, UI 컴포넌트에서 누락되었을 수 있는 이전 이름/개념을 검색하세요.

5. **경계를 테스트하세요** - CLI 플래그, SDK 옵션, 이벤트 핸들러, 기본값 — 이곳이 회귀가 숨어있는 곳입니다.

### 빠른 검사

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) 빠른 감사 체크리스트

완료하기 전 최종 확인으로 사용하세요:

- [ ] import 확장자가 로컬 패키지 규칙을 따름 (무조건 `.js` 제거 금지)
- [ ] 새로/이식된 코드에 Node 전용 API 없음
- [ ] 모든 패키지 스코프 업데이트 완료
- [ ] `package.json` 스크립트가 Bun 사용
- [ ] 프롬프트가 `.md` 텍스트 import (인라인 프롬프트 문자열 없음)
- [ ] coding-agent에 `console.*` 없음 (`logger` 사용)
- [ ] 에셋이 Bun 임베드 패턴으로 로드 (복사 스크립트 없음)
- [ ] 테스트 또는 검사 실행 (또는 차단됨으로 명시)
- [ ] 기능 회귀 없음 (섹션 11-12 참조)

## 14) 커밋 메시지 형식

백포트를 커밋할 때, 저장소 형식 `<type>(scope): <과거형 설명>`을 따르고 제목에 커밋
범위를 유지하세요.

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**예시:**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**규칙:**

- 패키지별로 변경사항을 그룹화하세요
- 관례적 커밋 타입을 사용하세요 (`fix`, `feat`, `refactor`, `perf`, `docs`)
- 외부 기여에 대해 업스트림 이슈/PR 번호와 기여자 표시를 포함하세요
- 제목의 커밋 범위는 동기화 지점을 추적하는 데 도움이 됩니다

## 15) 의도적 차이점

우리 포크는 업스트림과 다른 아키텍처 결정을 가지고 있습니다. **다음 업스트림 패턴을 이식하지 마세요:**

### UI 아키텍처

| 업스트림                                    | 우리 포크                                                  | 이유                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` 클래스                  | `StatusLineComponent`                                     | 더 간단하고 통합된 상태 라인                                       |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | 비-TUI 모드에서 스텁                                     | TUI에서 구현, 그 외에서는 no-op                                   |
| `ctx.ui.setEditorComponent()`               | 비-TUI 모드에서 스텁                                     | TUI에서 구현, 그 외에서는 no-op                                   |
| `InteractiveModeOptions` 옵션 객체     | 위치 기반 생성자 인수 (옵션 타입은 여전히 export) | 생성자 시그니처 유지; 업스트림이 필드를 추가하면 타입 업데이트 |

### 컴포넌트 이름

| 업스트림                     | 우리 포크                |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API 이름

| 업스트림                                 | 우리 포크                                 | 참고                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | 전체적으로 `sessionName`을 사용           |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | 동일 (업스트림 RPC와 통일)               |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | 동일                                      |

### 파일 통합

| 업스트림                                           | 우리 포크                                | 이유                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (도구 파일) | `@f5xc-salesdemos/pi-natives` 클립보드 모듈 | N-API 네이티브 구현으로 병합           |

### 테스트 프레임워크

| 업스트림                  | 우리 포크                      |
| ------------------------- | ----------------------------- |
| `vitest`와 `vi.mock()` | `bun:test`와 bun의 `vi` |
| `node:test` 어설션    | `expect()` 매처           |

### 도구 아키텍처

| 업스트림                            | 우리 포크                                                          | 참고                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `BUILTIN_TOOLS` 레지스트리를 통한 `createTools(session: ToolSession)`  | 도구 팩토리는 `ToolSession`을 받고 `null`을 반환할 수 있음 |
| 도구별 `*Operations` 인터페이스   | 도구별 인터페이스 유지 (`FindOperations`, `GrepOperations`)   | SSH/원격 오버라이드에 사용                             |
| 모든 곳에서 Node.js `fs/promises`    | 파일에 `Bun.file()`/`Bun.write()`; 디렉토리에 `node:fs/promises` | 간소화될 때 Bun API 선호                        |

### 인증 저장소

| 업스트림                        | 우리 포크                                    | 참고                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | 자격 증명은 `agent.db`에만 저장 |
| 공급자당 단일 자격 증명  | 라운드 로빈 선택의 다중 자격 증명 | 세션 어피니티와 백오프 로직 보존 |

### 확장

| 업스트림                      | 우리 포크                                   |
| ----------------------------- | ------------------------------------------ |
| TypeScript 로딩에 `jiti` | 네이티브 Bun `import()`                      |
| `pkg.pi` 매니페스트 필드       | `pkg.xcsh ?? pkg.pi` (우리 네임스페이스 우선) |

### 이 업스트림 기능은 건너뛰세요

이식할 때 다음 파일/기능은 **완전히 건너뛰세요**:

- `footer-data-provider.ts` — StatusLineComponent를 사용
- `clipboard-image.ts` — 클립보드는 `@f5xc-salesdemos/pi-natives` N-API 모듈에 있음
- GitHub 워크플로우 파일 — 자체 CI가 있음
- `models.generated.ts` — 자동 생성됨, 로컬에서 재생성 (models.json으로)

### 우리가 추가한 기능 (보존할 것)

이들은 우리 포크에 존재하지만 업스트림에는 없습니다. **절대 덮어쓰지 마세요:**

- 인터랙티브 모드의 `StatusLineComponent`
- 세션 어피니티를 가진 다중 자격 증명 인증
- 기능 기반 디스커버리 시스템 (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability` 등)
- MCP/Exa/SSH 통합
- 저장 시 포맷을 위한 LSP writethrough
- Bash 가로채기 (`checkBashInterception`)
- 읽기 도구의 퍼지 경로 제안
