---
title: Secret Obfuscation
description: 세션 로그 및 출력에서 민감한 값을 편집하는 비밀 난독화 파이프라인.
sidebar:
  order: 3
  label: Secrets
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# 비밀 난독화

민감한 값(API 키, 토큰, 비밀번호)이 LLM 제공자에게 전송되는 것을 방지합니다. 활성화되면 비밀은 프로세스를 떠나기 전에 결정론적 플레이스홀더로 대체되며, 모델이 반환한 도구 호출 인자에서 원래 값으로 복원됩니다.

## 활성화

기본적으로 활성화되어 있습니다. `/settings` UI 또는 `config.yml`에서 직접 전환할 수 있습니다:

```yaml
secrets:
  enabled: false
```

## 작동 방식

1. 세션 시작 시 두 가지 소스에서 비밀이 수집됩니다:
   - **환경 변수** 중 일반적인 비밀 패턴(`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` 등)과 일치하며 값이 8자 이상인 것
   - **`secrets.yml` 파일** (아래 참조)

2. LLM으로 전송되는 아웃바운드 메시지에서 모든 비밀 값이 `<<$env:S0>>`, `<<$env:S1>>` 등과 같은 플레이스홀더로 대체됩니다.

3. 모델이 반환한 도구 호출 인자는 깊이 순회(deep-walk)되어 실행 전에 플레이스홀더가 원래 값으로 복원됩니다.

두 가지 모드가 각 비밀의 처리 방식을 제어합니다:

| 모드 | 동작 | 가역성 |
|---|---|---|
| `obfuscate` (기본값) | 인덱싱된 플레이스홀더 `<<$env:SN>>`으로 대체 | 예 (도구 인자에서 역난독화) |
| `replace` | 동일 길이의 결정론적 문자열로 대체 | 아니오 (단방향) |

## secrets.yml

YAML로 사용자 정의 비밀 항목을 정의합니다. 두 위치가 확인됩니다:

| 레벨 | 경로 | 용도 |
|---|---|---|
| 전역 | `~/.xcsh/agent/secrets.yml` | 모든 프로젝트에 걸친 비밀 |
| 프로젝트 | `<cwd>/.xcsh/secrets.yml` | 프로젝트별 비밀 |

프로젝트 항목은 `content`가 일치하는 전역 항목을 재정의합니다.

### 스키마

배열의 각 항목은 다음 필드를 가집니다:

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `type` | `"plain"` 또는 `"regex"` | 예 | 매칭 전략 |
| `content` | string | 예 | 비밀 값(plain) 또는 정규식 패턴(regex) |
| `mode` | `"obfuscate"` 또는 `"replace"` | 아니오 | 기본값: `"obfuscate"` |
| `replacement` | string | 아니오 | 사용자 정의 대체 문자열(replace 모드만 해당) |
| `flags` | string | 아니오 | 정규식 플래그(regex 타입만 해당) |

### 예시

#### 일반 텍스트 비밀

```yaml
# Obfuscate a specific API key (default mode)
- type: plain
  content: sk-proj-abc123def456

# Replace a database password with a fixed string
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### 정규식 비밀

```yaml
# Obfuscate any AWS-style key
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Case-insensitive match with explicit flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex literal syntax (pattern and flags in one string)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

정규식 항목은 항상 전역적으로 스캔합니다(`g` 플래그가 자동으로 적용됨). 정규식 리터럴 구문 `/pattern/flags`는 별도의 `content` + `flags` 필드의 대안으로 지원됩니다. 패턴 내의 이스케이프된 슬래시(`\\/`)는 올바르게 처리됩니다.

#### 정규식을 사용한 replace 모드

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## 환경 변수 감지와의 상호작용

환경 변수는 항상 먼저 수집됩니다. 파일에 정의된 항목은 그 후에 추가되므로, 파일 항목은 환경 변수에 존재하지 않는 비밀(설정 파일, 하드코딩된 값 등)을 포함할 수 있습니다. 동일한 값이 양쪽 모두에 나타나는 경우, 파일 항목의 모드가 우선합니다.

## 주요 파일

- `src/secrets/index.ts` -- 로딩, 병합, 환경 변수 수집
- `src/secrets/obfuscator.ts` -- `SecretObfuscator` 클래스, 플레이스홀더 생성, 메시지 난독화
- `src/secrets/regex.ts` -- 정규식 리터럴 파싱 및 컴파일
- `src/config/settings-schema.ts` -- `secrets.enabled` 설정 정의
