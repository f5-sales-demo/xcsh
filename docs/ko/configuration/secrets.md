---
title: 시크릿 난독화
description: 세션 로그 및 출력에서 민감한 값을 삭제하는 시크릿 난독화 파이프라인.
sidebar:
  order: 3
  label: 시크릿
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# 시크릿 난독화

민감한 값(API 키, 토큰, 비밀번호)이 LLM 제공자에게 전송되는 것을 방지합니다. 활성화된 경우, 시크릿은 프로세스를 떠나기 전에 결정론적 플레이스홀더로 대체되며, 모델이 반환한 도구 호출 인수에서 복원됩니다.

## 활성화

기본적으로 활성화되어 있습니다. `/settings` UI를 통해 토글하거나 `config.yml`에서 직접 설정합니다:

```yaml
secrets:
  enabled: false
```

## 작동 방식

1. 세션 시작 시, 시크릿은 두 가지 소스에서 수집됩니다:
   - 값이 8자 이상인 일반적인 시크릿 패턴(`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` 등)과 일치하는 **환경 변수**
   - **`secrets.yml` 파일** (아래 참조)

2. LLM으로 전송되는 아웃바운드 메시지에서 모든 시크릿 값은 `<<$env:S0>>`, `<<$env:S1>>` 등의 플레이스홀더로 대체됩니다.

3. 모델이 반환한 도구 호출 인수는 실행 전에 깊이 탐색되어 플레이스홀더가 원래 값으로 복원됩니다.

각 시크릿에 적용되는 동작을 제어하는 두 가지 모드:

| 모드 | 동작 | 복원 가능 |
|---|---|---|
| `obfuscate` (기본값) | 인덱스 플레이스홀더 `<<$env:SN>>`으로 대체 | 예 (도구 인수에서 역난독화) |
| `replace` | 결정론적 동일 길이 문자열로 대체 | 아니오 (단방향) |

## secrets.yml

YAML에서 커스텀 시크릿 항목을 정의합니다. 두 위치가 확인됩니다:

| 레벨 | 경로 | 목적 |
|---|---|---|
| 전역 | `~/.xcsh/agent/secrets.yml` | 모든 프로젝트에 걸친 시크릿 |
| 프로젝트 | `<cwd>/.xcsh/secrets.yml` | 프로젝트별 시크릿 |

프로젝트 항목은 일치하는 `content`를 가진 전역 항목을 재정의합니다.

### 스키마

배열의 각 항목에는 다음 필드가 있습니다:

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `type` | `"plain"` 또는 `"regex"` | 예 | 매칭 전략 |
| `content` | 문자열 | 예 | 시크릿 값(plain) 또는 정규식 패턴(regex) |
| `mode` | `"obfuscate"` 또는 `"replace"` | 아니오 | 기본값: `"obfuscate"` |
| `replacement` | 문자열 | 아니오 | 커스텀 대체 문자열 (replace 모드 전용) |
| `flags` | 문자열 | 아니오 | 정규식 플래그 (regex 타입 전용) |

### 예시

#### Plain 시크릿

```yaml
# 특정 API 키 난독화 (기본 모드)
- type: plain
  content: sk-proj-abc123def456

# 데이터베이스 비밀번호를 고정 문자열로 대체
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### Regex 시크릿

```yaml
# AWS 스타일의 키 난독화
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# 명시적 플래그를 사용한 대소문자 구분 없는 매칭
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# 정규식 리터럴 구문 (하나의 문자열에 패턴과 플래그 포함)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Regex 항목은 항상 전역적으로 스캔합니다(`g` 플래그는 자동으로 적용됩니다). 정규식 리터럴 구문 `/pattern/flags`는 별도의 `content` + `flags` 필드의 대안으로 지원됩니다. 패턴 내의 이스케이프된 슬래시(`\\/`)는 올바르게 처리됩니다.

#### Replace 모드와 regex

```yaml
# 연결 문자열 단방향 대체 (복원 불가)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## 환경 변수 감지와의 상호작용

환경 변수는 항상 먼저 수집됩니다. 파일에 정의된 항목은 그 이후에 추가되므로, 파일 항목은 환경 변수에 없는 시크릿(설정 파일, 하드코딩된 값 등)을 처리할 수 있습니다. 동일한 값이 양쪽에 모두 존재하는 경우, 파일 항목의 모드가 우선 적용됩니다.

## 주요 파일

- `src/secrets/index.ts` -- 로딩, 병합, 환경 변수 수집
- `src/secrets/obfuscator.ts` -- `SecretObfuscator` 클래스, 플레이스홀더 생성, 메시지 난독화
- `src/secrets/regex.ts` -- 정규식 리터럴 파싱 및 컴파일
- `src/config/settings-schema.ts` -- `secrets.enabled` 설정 정의
