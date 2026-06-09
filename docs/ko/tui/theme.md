---
title: 테마 참조 문서
description: '색상 토큰, 글꼴 설정, 테마 커스터마이징을 포함하는 TUI 테마 참조 문서입니다.'
sidebar:
  order: 3
  label: 테마
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# 테마 참조 문서

이 문서는 현재 coding-agent에서 테마가 어떻게 작동하는지 설명합니다: 스키마, 로딩, 런타임 동작, 그리고 실패 모드를 다룹니다.

## 테마 시스템이 제어하는 것

테마 시스템은 다음을 구동합니다:

- TUI 전체에서 사용되는 전경/배경 색상 토큰
- 마크다운 스타일링 어댑터 (`getMarkdownTheme()`)
- 셀렉터/에디터/설정 목록 어댑터 (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- 심볼 프리셋 + 심볼 오버라이드 (`unicode`, `nerd`, `ascii`)
- 네이티브 하이라이터(`@f5xc-salesdemos/pi-natives`)에서 사용하는 구문 강조 색상
- 상태 줄 세그먼트 색상

주요 구현: `src/modes/theme/theme.ts`.

## 테마 JSON 형태

테마 파일은 `theme.ts`(`ThemeJsonSchema`)의 런타임 스키마에 대해 검증되고 `src/modes/theme/theme-schema.json`에 미러링된 JSON 객체입니다.

최상위 필드:

- `name` (필수)
- `colors` (필수; 모든 색상 토큰 필수)
- `vars` (선택; 재사용 가능한 색상 변수)
- `export` (선택; HTML 내보내기 색상)
- `symbols` (선택)
  - `preset` (선택: `unicode | nerd | ascii`)
  - `overrides` (선택: `SymbolKey`에 대한 키/값 오버라이드)

색상 값으로 허용되는 것:

- hex 문자열 (`"#RRGGBB"`)
- 256색 인덱스 (`0..255`)
- 변수 참조 문자열 (`vars`를 통해 해석됨)
- 빈 문자열 (`""`) — 터미널 기본값을 의미 (`\x1b[39m` 전경, `\x1b[49m` 배경)

## 필수 색상 토큰 (현재)

아래의 모든 토큰은 `colors`에서 필수입니다.

### 핵심 텍스트 및 테두리 (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### 배경 블록 (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### 메시지/도구 텍스트 (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### 마크다운 (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### 도구 diff + 구문 강조 (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### 모드/사고 테두리 (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### 상태 줄 세그먼트 색상 (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## 선택적 토큰

### `export` 섹션 (선택)

HTML 내보내기 테마 헬퍼에 사용됩니다:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

생략하면 내보내기 코드가 해석된 테마 색상에서 기본값을 파생합니다.

### `symbols` 섹션 (선택)

- `symbols.preset`은 테마 수준의 기본 심볼 세트를 설정합니다.
- `symbols.overrides`는 개별 `SymbolKey` 값을 오버라이드할 수 있습니다.

런타임 우선순위:

1. 설정의 `symbolPreset` 오버라이드 (설정된 경우)
2. 테마 JSON의 `symbols.preset`
3. 폴백 `"unicode"`

유효하지 않은 오버라이드 키는 무시되고 로그에 기록됩니다 (`logger.debug`).

## 내장 테마 vs 커스텀 테마 소스

테마 조회 순서 (`loadThemeJson`):

1. 내장 임베디드 테마 (`defaults/xcsh-dark.json` 및 `defaults/xcsh-light.json`이 `defaultThemes`로 컴파일됨)
2. 커스텀 테마 파일: `<customThemesDir>/<name>.json`

커스텀 테마 디렉토리는 `getCustomThemesDir()`에서 가져옵니다:

- 기본값: `~/.xcsh/agent/themes`
- `PI_CODING_AGENT_DIR`로 오버라이드 (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()`는 병합된 내장 + 커스텀 이름을 정렬하여 반환하며, 이름 충돌 시 내장 테마가 우선합니다.

## 로딩, 검증, 해석

커스텀 테마 파일의 경우:

1. JSON 읽기
2. JSON 파싱
3. `ThemeJsonSchema`에 대해 검증
4. `vars` 참조를 재귀적으로 해석
5. 해석된 값을 터미널 색상 능력 모드에 따라 ANSI로 변환

검증 동작:

- 필수 색상 토큰 누락: 명시적 그룹화된 오류 메시지
- 잘못된 토큰 타입/값: JSON 경로를 포함한 검증 오류
- 알 수 없는 테마 파일: `Theme not found: <name>`

변수 참조 동작:

- 중첩 참조 지원
- 누락된 변수 참조 시 예외 발생
- 순환 참조 시 예외 발생

## 터미널 색상 모드 동작

색상 모드 감지 (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM`이 `dumb`, `linux`, 또는 빈 값 => 256color
- 그 외 => truecolor

변환 동작:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- 숫자 -> `38;5` / `48;5` ANSI
- `""` -> 기본 전경/배경 리셋

## 런타임 전환 동작

### 초기 테마 (`initTheme`)

`main.ts`가 설정으로 테마를 초기화합니다:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

자동 테마 슬롯 선택은 `COLORFGBG` 배경 감지를 사용합니다:

- `COLORFGBG`에서 배경 인덱스 파싱
- `< 8` => 다크 슬롯 (`theme.dark`)
- `>= 8` => 라이트 슬롯 (`theme.light`)
- 파싱 실패 => 다크 슬롯

설정 스키마의 현재 기본값:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### 명시적 전환 (`setTheme`)

- 선택된 테마를 로드합니다
- 전역 `theme` 싱글톤을 업데이트합니다
- 선택적으로 워처를 시작합니다
- `onThemeChange` 콜백을 트리거합니다

실패 시:

- 내장 `dark`로 폴백합니다
- `{ success: false, error }`를 반환합니다

### 미리보기 전환 (`previewTheme`)

- 임시 미리보기 테마를 전역 `theme`에 적용합니다
- 자체적으로 영구 설정을 변경하지 **않습니다**
- 폴백 교체 없이 성공/오류를 반환합니다

설정 UI는 이것을 라이브 미리보기에 사용하며, 취소 시 이전 테마를 복원합니다.

## 워처와 라이브 리로드

워처가 활성화된 경우 (`setTheme(..., true)` / 대화형 초기화):

- 커스텀 파일 경로 `<customThemesDir>/<currentTheme>.json`만 감시합니다
- 내장 테마는 사실상 감시되지 않습니다
- 파일 `change`: 리로드 시도 (디바운스 적용)
- 파일 `rename`/삭제: `dark`로 폴백하고 워처를 닫습니다

자동 모드는 `SIGWINCH` 리스너도 설치하며, 터미널 상태가 변경될 때 다크/라이트 슬롯 매핑을 재평가할 수 있습니다.

## 색맹 모드 동작

`colorBlindMode`는 런타임에서 하나의 토큰만 변경합니다:

- `toolDiffAdded`가 HSV 조정됩니다 (초록색이 파란색 방향으로 이동)
- 해석된 값이 hex 문자열인 경우에만 조정이 적용됩니다

다른 토큰은 변경되지 않습니다.

## 테마 설정이 저장되는 위치

테마 관련 설정은 `Settings`에 의해 전역 설정 YAML에 저장됩니다:

- 경로: `<agentDir>/config.yml`
- 기본 에이전트 디렉토리: `~/.xcsh/agent`
- 유효 기본 파일: `~/.xcsh/agent/config.yml`

저장되는 키:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

레거시 마이그레이션이 존재합니다: 이전의 플랫 `theme: "name"` 형식은 휘도 감지를 기반으로 중첩된 `theme.dark` 또는 `theme.light`로 마이그레이션됩니다.

## 커스텀 테마 만들기 (실용)

1. 커스텀 테마 디렉토리에 파일을 생성합니다. 예: `~/.xcsh/agent/themes/my-theme.json`.
2. `name`, 선택적 `vars`, 그리고 **모든 필수** `colors` 토큰을 포함합니다.
3. 선택적으로 `symbols`와 `export`를 포함합니다.
4. 원하는 자동 슬롯에 따라 설정에서 테마를 선택합니다 (`Display -> Dark theme` 또는 `Display -> Light theme`).

최소 골격입니다. `colors`의 모든 키는 필수이며 — 런타임 검증기
(`additionalProperties: false`)는 누락된 키와 알 수 없는 키 모두를 거부합니다.
제공되는 참조 구현은
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
및 [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json)을 참조하세요.

상태 줄에는 이슈 #242에 문서화된 두 개의 병렬 색상 시스템이 있습니다:

- Hex 텍스트 색상 (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`)은 non-powerline
  렌더링을 구동합니다.
- 256색 팔레트 인덱스 (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)는
  powerline 세그먼트 채우기를 구동합니다. 이들은 위의 hex 키와 독립적이며 —
  둘 다 설정해야 합니다.

```json
{
  "name": "my-theme",
  "vars": {
    "accent": "#7aa2f7",
    "muted": 244
  },
  "colors": {
    "accent": "accent",
    "chromeAccent": "accent",
    "spinnerAccent": "accent",
    "contentAccent": "muted",
    "border": "#4c566a",
    "borderAccent": "accent",
    "borderMuted": "muted",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "muted",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "muted",

    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accent",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "muted",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "accent",

    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "muted",

    "syntaxComment": "#565f89",
    "syntaxKeyword": "#bb9af7",
    "syntaxFunction": "#7aa2f7",
    "syntaxVariable": "#c0caf5",
    "syntaxString": "#9ece6a",
    "syntaxNumber": "#ff9e64",
    "syntaxType": "#2ac3de",
    "syntaxOperator": "#89ddff",
    "syntaxPunctuation": "#9aa5ce",
    "syntaxControl": "#bb9af7",

    "thinkingOff": 240,
    "thinkingMinimal": 244,
    "thinkingLow": "#7aa2f7",
    "thinkingMedium": "#2ac3de",
    "thinkingHigh": "#bb9af7",
    "thinkingXhigh": "#f7768e",

    "bashMode": "#2ac3de",
    "pythonMode": "#bb9af7",

    "statusLineBg": "#16161e",
    "statusLineSep": 240,
    "statusLineModel": "#bb9af7",
    "statusLinePath": "#7aa2f7",
    "statusLineGitClean": "#9ece6a",
    "statusLineGitDirty": "#e0af68",
    "statusLineContext": "#2ac3de",
    "statusLineSpend": "#7dcfff",
    "statusLineStaged": "#9ece6a",
    "statusLineDirty": "#e0af68",
    "statusLineUntracked": "#f7768e",
    "statusLineOutput": "#c0caf5",
    "statusLineCost": "#ff9e64",
    "statusLineSubagents": "#bb9af7",

    "statusLineOsIconBg": 7,
    "statusLineOsIconFg": 232,
    "statusLinePathBg": 4,
    "statusLinePathFg": 254,
    "statusLineGitCleanBg": 2,
    "statusLineGitCleanFg": 0,
    "statusLineGitDirtyBg": 3,
    "statusLineGitDirtyFg": 0,
    "statusLineGitStagedBg": 64,
    "statusLineGitStagedFg": 0,
    "statusLineGitUntrackedBg": 39,
    "statusLineGitUntrackedFg": 0,
    "statusLineGitConflictBg": 1,
    "statusLineGitConflictFg": 7,
    "statusLinePlanModeBg": 236,
    "statusLinePlanModeFg": 117,
    "statusLineProfileF5xcBg": "accent",
    "statusLineProfileF5xcFg": 231
  }
}
```

## 커스텀 테마 테스트

다음 워크플로를 사용하세요:

1. 대화형 모드를 시작합니다 (시작 시 워처 활성화).
2. 설정을 열고 테마 값을 미리 봅니다 (라이브 `previewTheme`).
3. 커스텀 테마 파일의 경우, 실행 중에 JSON을 편집하고 저장 시 자동 리로드를 확인합니다.
4. 주요 화면들을 테스트합니다:
   - 마크다운 렌더링
   - 도구 블록 (대기 중/성공/오류)
   - diff 렌더링 (추가/제거/컨텍스트)
   - 상태 줄 가독성
   - 사고 수준 테두리 변경
   - bash/python 모드 테두리 색상
5. 테마가 글리프 너비/외관에 의존하는 경우 두 심볼 프리셋 모두 검증합니다.

## 실제 제약 조건 및 주의 사항

- 커스텀 테마에는 모든 `colors` 토큰이 필수입니다.
- `export`와 `symbols`는 선택 사항입니다.
- 테마 JSON의 `$schema`는 정보 제공용이며; 런타임 검증은 코드 내 컴파일된 TypeBox 스키마에 의해 강제됩니다.
- `setTheme` 실패 시 `dark`로 폴백합니다; `previewTheme` 실패 시 현재 테마를 교체하지 않습니다.
- 파일 워처 리로드 오류는 성공적인 리로드 또는 폴백 경로가 트리거될 때까지 현재 로드된 테마를 유지합니다.
