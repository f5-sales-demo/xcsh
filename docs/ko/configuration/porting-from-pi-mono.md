---
title: 'pi-mono에서 포팅하기: 실용적인 머지 가이드'
description: pi-mono 모노레포에서 xcsh 코드베이스로 코드를 마이그레이션하기 위한 실용적인 가이드입니다.
sidebar:
  order: 9
  label: pi-mono에서 포팅하기
i18n:
  sourceHash: fd4e8c09303d
  translator: machine
---

# pi-mono에서 포팅하기: 실용적인 머지 가이드

이 가이드는 pi-mono에서 이 저장소로 변경 사항을 포팅하기 위한 반복 가능한 체크리스트입니다.
단일 파일, 기능 브랜치, 또는 전체 릴리스 동기화 등 모든 머지에 사용하십시오.

## 마지막 동기화 지점

**커밋:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**날짜:** 2026-03-22

각 동기화 후에 이 섹션을 업데이트하십시오. 이전 범위를 재사용하지 마십시오.

새로운 동기화를 시작할 때, 이 커밋부터 패치를 생성합니다:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) 범위 정의

- 업스트림 참조(커밋, 태그, 또는 PR)를 식별합니다.
- 수정할 패키지 또는 폴더를 나열합니다.
- 범위에 포함할 기능과 의도적으로 건너뛸 기능을 결정합니다.

## 1) 코드를 안전하게 가져오기

- 전체 복사보다는 깔끔하고 집중된 diff를 선호합니다.
- 빌드 결과물이나 생성된 파일은 복사하지 않습니다.
- 업스트림에서 새 파일을 추가한 경우, 명시적으로 추가하고 내용을 검토합니다.

## 2) import 확장자 규칙 맞추기

대부분의 런타임 TypeScript 소스는 내부 import에서 `.js`를 생략하지만, 일부 테스트/벤치마크 진입점은 ESM
런타임 호환성을 위해 `.js`를 유지합니다. 로컬 패키지의 기존 스타일을 따르십시오. 확장자를 일괄적으로 제거하지 마십시오.

- `packages/coding-agent` 런타임 소스에서는 비-TS 자산을 import하는 경우가 아니라면 내부 import에서 확장자를 생략합니다.
- `packages/tui/test`와 `packages/natives/bench`에서는 주변 파일이 이미 사용하는 경우 `.js`를 유지합니다.
- 도구에서 요구하는 경우 실제 파일 확장자를 유지합니다(예: `.json`, `.css`, `.md` 텍스트 임베드).
- 예시: `import { x } from "./foo.js";` → `import { x } from "./foo";` (패키지 규칙이 확장자 생략인 경우에만).

## 3) import 스코프 교체

업스트림은 다른 패키지 스코프를 사용합니다. 일관되게 교체하십시오.

- 이전 스코프를 여기에서 사용하는 로컬 스코프로 교체합니다.
- 예시 (포팅하는 실제 패키지에 맞게 조정):
  - `@mariozechner/pi-coding-agent` → `@f5-sales-demo/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5-sales-demo/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5-sales-demo/pi-tui`
  - `@mariozechner/pi-ai` → `@f5-sales-demo/pi-ai`

## 4) Bun API가 Node보다 나은 경우 사용

우리는 Bun에서 실행합니다. Bun이 더 나은 대안을 제공하는 경우에만 Node API를 교체합니다.

**교체해야 하는 것:**

- 프로세스 스폰: `child_process.spawn` → 간단한 명령에는 Bun Shell `$`, 스트리밍 또는 장시간 실행 작업에는 `Bun.spawn`/`Bun.spawnSync`
- 파일 I/O: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP 클라이언트: `node-fetch`, `axios` → 네이티브 `fetch`
- 암호화 해싱: `node:crypto` → Web Crypto 또는 `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- 환경 변수 로딩: `dotenv` → Bun이 `.env`를 자동으로 로드

**교체하지 말아야 하는 것 (Bun에서 잘 동작):**

- `os.homedir()` — `Bun.env.HOME`, `Bun.env.HOME`, 또는 리터럴 `"~"`로 교체하지 마십시오
- `os.tmpdir()` — `Bun.env.TMPDIR || "/tmp"` 또는 하드코딩된 경로로 교체하지 마십시오
- `fs.mkdtempSync()` — 수동 경로 구성으로 교체하지 마십시오
- `path.join()`, `path.resolve()` 등 — 그대로 사용해도 됩니다

**Import 스타일:** `node:` 접두사는 네임스페이스 import에서만 사용합니다(`node:fs`나 `node:path`에서 named import를 하지 마십시오).

**추가 Bun 규칙:**

- 짧은 비스트리밍 명령에는 Bun Shell `$`를 선호합니다. 스트리밍 I/O나 프로세스 제어가 필요한 경우에만 `Bun.spawn`을 사용합니다.
- 파일에는 `Bun.file()`/`Bun.write()`를, 디렉토리에는 `node:fs/promises`를 사용합니다.
- `Bun.file().exists()` 검사를 피하고, try/catch에서 `isEnoent` 처리를 사용합니다.
- `setTimeout` 래퍼보다 `Bun.sleep(ms)`를 선호합니다.

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

빌드 시 런타임 자산이나 벤더 파일을 복사하지 마십시오.

- 업스트림이 자산을 dist 폴더에 복사하는 경우, Bun 친화적인 임베드로 교체합니다.
- 프롬프트는 정적 `.md` 파일입니다. 인라인 프롬프트 문자열 대신 Bun 텍스트 import(`with { type: "text" }`)와 Handlebars를 사용합니다.
- 인접한 비텍스트 리소스를 로드하려면 `import.meta.dir` + `Bun.file`을 사용합니다.
- 자산을 저장소 내에 유지하고 번들러가 포함하도록 합니다.
- 사용자가 명시적으로 요청하지 않는 한 복사 스크립트를 제거합니다.
- 업스트림이 런타임에 번들된 폴백 파일을 읽는 경우, 파일시스템 읽기를 Bun 텍스트 임베드 import로 교체합니다.
  - 예시 (Codex instructions 폴백):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> 제거
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - `readFileSync(FALLBACK_PROMPT_PATH, "utf8")` 대신 `return FALLBACK_INSTRUCTIONS;`를 사용

## 6) `package.json` 신중하게 포팅

`package.json`을 계약으로 취급하십시오. 의도적으로 머지합니다.

- 포팅에 변경이 필요하지 않는 한 기존 `name`, `version`, `type`, `exports`, `bin`을 유지합니다.
- npm/node 스크립트를 Bun 동등물로 교체합니다(예: `bun check`, `bun test`).
- 의존성이 올바른 스코프를 사용하는지 확인합니다.
- 타입 오류를 수정하기 위해 의존성을 다운그레이드하지 마십시오. 대신 업그레이드합니다.
- 워크스페이스 패키지 링크와 `peerDependencies`를 검증합니다.

## 7) 코드 스타일 및 도구 정렬

- 기존 포맷팅 규칙을 유지합니다.
- 필요하지 않는 한 `any`를 도입하지 않습니다.
- 동적 import와 인라인 타입 import를 피합니다. 최상위 import만 사용합니다.
- 코드에서 프롬프트를 구성하지 않습니다. 프롬프트는 Handlebars로 렌더링되는 정적 `.md` 파일입니다.
- coding-agent에서는 절대 `console.log`/`console.warn`/`console.error`를 사용하지 않습니다. `@f5-sales-demo/pi-utils`의 `logger`를 사용합니다.
- `new Promise((resolve, reject) => ...)` 대신 `Promise.withResolvers()`를 사용합니다.
- **클래스 필드나 메서드에 `private`/`protected`/`public` 키워드를 사용하지 않습니다.** 캡슐화에는 ES `#` 프라이빗 필드를 사용하고, 접근 가능한 멤버는 키워드 없이 그대로 둡니다. 유일한 예외는 생성자 매개변수 속성(`constructor(private readonly x: T)`)으로, TypeScript에서 키워드가 필수입니다. `private foo`나 `protected bar`를 사용하는 업스트림 코드를 포팅할 때는 `#foo`(프라이빗) 또는 `bar`(접근 가능)로 변환합니다.
- 새로운 임시 코드보다 기존 헬퍼와 유틸리티를 선호합니다.
- 이 저장소에서 이미 수행된 Bun 우선 인프라 변경 사항을 유지합니다:
  - 런타임은 Bun입니다(Node 진입점 없음).
  - 패키지 매니저는 Bun입니다(npm lockfile 없음).
  - 무거운 Node API(`child_process`, `readline`)는 Bun 동등물로 교체되었습니다.
  - 가벼운 Node API(`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`)는 유지됩니다.
  - CLI shebang은 `bun`을 사용합니다(`node`나 `tsx`가 아님).
  - 패키지는 소스 파일을 직접 사용합니다(TypeScript 빌드 단계 없음).
  - CI 워크플로우는 설치/검사/테스트에 Bun을 실행합니다.

## 8) 이전 호환성 레이어 제거

요청하지 않는 한 업스트림 호환성 심을 제거합니다.

- 교체된 이전 API를 삭제합니다.
- 모든 호출 지점을 새 API로 직접 업데이트합니다.
- `*_v2` 또는 병렬 버전을 유지하지 않습니다.

## 9) 문서 및 참조 업데이트

- 적절한 경우 pi-mono 저장소 링크를 교체합니다.
- 예시를 Bun과 올바른 패키지 스코프를 사용하도록 업데이트합니다.
- README 지침이 현재 저장소 동작과 여전히 일치하는지 확인합니다.

## 10) 포팅 검증

변경 후 표준 검사를 실행합니다:

- `bun check`

저장소에 이미 변경 사항과 관련 없는 실패한 검사가 있는 경우, 이를 명시합니다.
테스트는 Bun의 러너를 사용합니다(Vitest가 아님). 명시적으로 요청된 경우에만 `bun test`를 실행합니다.

## 11) 개선된 기능 보호 (회귀 방지 목록)

로컬에서 이미 동작을 개선한 경우, 이를 **양보 불가**로 취급합니다. 포팅 전에
개선 사항을 기록하고 머지에서 유실되지 않도록 명시적인 검사를 추가합니다.

- **예상 동작 동결**: 각 개선 사항에 대해 짧은 "이전/이후" 메모를 추가합니다(입력, 출력,
  기본값, 엣지 케이스). 이는 무음 롤백을 방지합니다.
- **이전 → 새 API 매핑**: 업스트림이 개념 이름을 변경한 경우(hooks → extensions, custom tools → tools 등),
  모든 이전 진입점이 여전히 연결되는지 확인합니다. 하나의 누락된 플래그나 export는 기능 손실을 의미합니다.
- **export 검증**: `package.json` `exports`, 공개 타입, 배럴 파일을 확인합니다. 업스트림 포팅 시
  로컬 추가 사항을 다시 export하는 것을 잊는 경우가 많습니다.
- **비정상 경로 확인**: 오류 처리, 타임아웃, 또는 폴백 로직을 수정한 경우, 해당 경로를 실행하는
  테스트 또는 최소한 수동 체크리스트를 추가합니다.
- **기본값 및 설정 머지 순서 확인**: 개선 사항은 종종 기본값에 있습니다. 새 기본값이
  되돌아가지 않았는지 확인합니다(예: 새로운 설정 우선순위, 비활성화된 기능, 도구 목록).
- **환경/셸 동작 감사**: 실행 또는 샌드박싱을 수정한 경우, 새 경로가 여전히 정제된
  환경을 사용하고 별칭/함수 오버라이드를 다시 도입하지 않는지 확인합니다.
- **대상 샘플 재실행**: 최소한의 "알려진 양호" 예시 세트를 유지하고 포팅 후 실행합니다
  (CLI 플래그, 확장 등록, 도구 실행).

## 12) 재작업된 코드 감지 및 처리

파일을 포팅하기 전에 업스트림이 크게 리팩터링했는지 확인합니다:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

diff에서 파일이 **재작업**되었음을 보여주는 경우 (단순 패치가 아닌):

- 새로운 추상화, 이름 변경된 개념, 병합된 모듈, 변경된 데이터 흐름

그렇다면 포팅하기 전에 **새 구현을 철저히 읽어야** 합니다. 재작업된 코드를 무분별하게 머지하면 다음과 같은 이유로 기능이 유실됩니다:

참고: 인터랙티브 모드는 최근 controllers/utils/types로 분할되었습니다. 관련 변경 사항을 백포팅할 때, 우리가 생성한 개별 파일에 업데이트를 포팅하고 `interactive-mode.ts` 연결이 동기화 상태를 유지하는지 확인하십시오.

1. **기본값이 무음으로 변경됨** - 새 변수 `defaultFoo = [a, b]`가 `[a, b, c, d, e]`를 반환하던 이전 `getAllFoo()`를 교체할 수 있습니다.

2. **API 옵션이 삭제됨** - 시스템이 병합될 때(예: `hooks` + `customTools` → `extensions`), 이전 옵션이 새 구현에 연결되지 않을 수 있습니다.

3. **코드 경로가 오래됨** - 이름이 변경된 개념(예: `hookMessage` → `custom`)은 정의뿐만 아니라 모든 switch 문, 타입 가드, 핸들러에서 업데이트가 필요합니다.

4. **컨텍스트/기능이 축소됨** - 이전 API가 노출하던 `{ logger, typebox, pi }`를 새 API가 포함하지 않을 수 있습니다.

### 의미론적 포팅 프로세스

업스트림이 모듈을 재작업한 경우:

1. **이전 구현 읽기** - 무엇을 했는지, 어떤 옵션을 받았는지, 무엇을 노출했는지 이해합니다.

2. **새 구현 읽기** - 새로운 추상화와 이전 동작에 어떻게 매핑되는지 이해합니다.

3. **기능 동등성 검증** - 이전 코드의 각 기능에 대해, 새 코드가 이를 보존하거나 명시적으로 제거했는지 확인합니다.

4. **누락 검색** - switch 문, 핸들러, UI 컴포넌트에서 누락되었을 수 있는 이전 이름/개념을 검색합니다.

5. **경계 테스트** - CLI 플래그, SDK 옵션, 이벤트 핸들러, 기본값 — 이곳에 회귀가 숨어 있습니다.

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

완료하기 전 최종 점검으로 사용합니다:

- [ ] Import 확장자가 로컬 패키지 규칙을 따름 (일괄 `.js` 제거 없음)
- [ ] 새로/포팅된 코드에 Node 전용 API 없음
- [ ] 모든 패키지 스코프 업데이트 완료
- [ ] `package.json` 스크립트가 Bun 사용
- [ ] 프롬프트가 `.md` 텍스트 import임 (인라인 프롬프트 문자열 없음)
- [ ] coding-agent에 `console.*` 없음 (`logger` 사용)
- [ ] 자산이 Bun 임베드 패턴으로 로드됨 (복사 스크립트 없음)
- [ ] 테스트 또는 검사가 실행됨 (또는 차단 상태로 명시적으로 기록됨)
- [ ] 기능 회귀 없음 (섹션 11-12 참조)

## 14) 커밋 메시지 형식

백포트를 커밋할 때, 저장소 형식 `<type>(scope): <과거형 설명>`을 따르고 제목에 커밋
범위를 유지합니다.

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

- 패키지별로 변경 사항을 그룹화
- 컨벤셔널 커밋 타입 사용 (`fix`, `feat`, `refactor`, `perf`, `docs`)
- 외부 기여에 대해 업스트림 이슈/PR 번호 및 기여자 귀속 포함
- 제목의 커밋 범위는 동기화 지점 추적에 도움

## 15) 의도적 차이점

우리 포크에는 업스트림과 다른 아키텍처 결정이 있습니다. **다음 업스트림 패턴을 포팅하지 마십시오:**

### UI 아키텍처

| 업스트림                                    | 우리 포크                                                  | 이유                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` 클래스                  | `StatusLineComponent`                                     | 더 간단하고 통합된 상태 표시줄                                       |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | 비TUI 모드에서 스텁                                     | TUI에서 구현, 다른 곳에서는 무연산                                   |
| `ctx.ui.setEditorComponent()`               | 비TUI 모드에서 스텁                                     | TUI에서 구현, 다른 곳에서는 무연산                                   |
| `InteractiveModeOptions` 옵션 객체     | 위치 기반 생성자 인수 (옵션 타입은 여전히 export됨) | 생성자 시그니처 유지; 업스트림이 필드를 추가하면 타입 업데이트 |

### 컴포넌트 네이밍

| 업스트림                     | 우리 포크                |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API 네이밍

| 업스트림                                 | 우리 포크                                 | 비고                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | 우리는 전체적으로 `sessionName`을 사용           |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | 동일 (업스트림의 RPC에 맞추어 통일) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | 동일                                      |

### 파일 통합

| 업스트림                                           | 우리 포크                                | 이유                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (도구 파일) | `@f5-sales-demo/pi-natives` clipboard 모듈 | N-API 네이티브 구현으로 병합 |

### 테스트 프레임워크

| 업스트림                  | 우리 포크                      |
| ------------------------- | ----------------------------- |
| `vitest`와 `vi.mock()` | `bun:test`와 bun의 `vi` |
| `node:test` 어설션    | `expect()` 매처           |

### 도구 아키텍처

| 업스트림                            | 우리 포크                                                          | 비고                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `BUILTIN_TOOLS` 레지스트리를 통한 `createTools(session: ToolSession)`  | 도구 팩토리는 `ToolSession`을 받고 `null`을 반환할 수 있음 |
| 도구별 `*Operations` 인터페이스   | 도구별 인터페이스 유지 (`FindOperations`, `GrepOperations`)   | SSH/원격 오버라이드에 사용                             |
| 모든 곳에서 Node.js `fs/promises`    | 파일에는 `Bun.file()`/`Bun.write()`; 디렉토리에는 `node:fs/promises` | 간소화될 때 Bun API 선호                        |

### 인증 저장소

| 업스트림                        | 우리 포크                                    | 비고                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | 자격 증명은 `agent.db`에만 저장 |
| 공급자당 단일 자격 증명  | 라운드 로빈 선택의 다중 자격 증명 | 세션 친화성 및 백오프 로직 보존 |

### 확장

| 업스트림                      | 우리 포크                                   |
| ----------------------------- | ------------------------------------------ |
| TypeScript 로딩을 위한 `jiti` | 네이티브 Bun `import()`                      |
| `pkg.pi` 매니페스트 필드       | `pkg.xcsh ?? pkg.pi` (우리 네임스페이스 선호) |

### 건너뛸 업스트림 기능

포팅 시 다음 파일/기능을 **완전히 건너뜁니다**:

- `footer-data-provider.ts` — 우리는 StatusLineComponent를 사용
- `clipboard-image.ts` — 클립보드는 `@f5-sales-demo/pi-natives` N-API 모듈에 있음
- GitHub 워크플로우 파일 — 우리만의 CI가 있음
- `models.generated.ts` — 자동 생성됨, 로컬에서 재생성 (models.json으로 대신)

### 우리가 추가한 기능 (보존 필수)

이들은 우리 포크에 존재하지만 업스트림에는 없습니다. **절대 덮어쓰지 마십시오:**

- 인터랙티브 모드의 `StatusLineComponent`
- 세션 친화성이 있는 다중 자격 증명 인증
- 기능 기반 디스커버리 시스템 (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability` 등)
- MCP/Exa/SSH 통합
- 저장 시 포맷을 위한 LSP writethrough
- Bash 가로채기 (`checkBashInterception`)
- 읽기 도구의 퍼지 경로 제안
