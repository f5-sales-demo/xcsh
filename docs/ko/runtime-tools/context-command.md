---
title: F5 XC 컨텍스트
description: 'xcsh를 F5 Distributed Cloud 테넌트에 연결 -- 인증 컨텍스트를 생성, 전환 및 관리합니다.'
sidebar:
  order: 1
  label: F5 XC 컨텍스트
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC 컨텍스트

xcsh는 **컨텍스트**를 통해 F5 Distributed Cloud에 연결합니다 -- 컨텍스트는 테넌트 URL, API 토큰, 네임스페이스를 바인딩하는 이름이 지정된 자격 증명 세트입니다. `kubectl config use-context` 또는 `kubectx`를 사용해 본 적이 있다면 워크플로는 동일합니다: 컨텍스트를 생성하고, 이름으로 전환하며, `-`를 사용하여 이전 컨텍스트로 돌아갑니다.

## 시작하기

### 1. 첫 번째 컨텍스트 생성

F5 XC 콘솔에서 세 가지가 필요합니다: 테넌트 URL, API 토큰, 그리고 선택적으로 네임스페이스입니다.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

단계별 프롬프트를 선호한다면 가이드 마법사를 사용할 수도 있습니다:

```
/context wizard
```

### 2. 활성화

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ XCSH_TENANT     acme                                         │
│ XCSH_API_URL    https://acme.console.ves.volterra.io         │
│ XCSH_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ XCSH_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

활성화되면 xcsh가 테넌트 자격 증명을 세션에 주입합니다. 이제 에이전트가 F5 XC API 호출을 수행할 수 있으며, 상태 표시줄에 활성 컨텍스트가 표시됩니다.

### 3. 컨텍스트 추가 및 전환

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

이름으로 전환 -- 하위 명령 동사가 필요 없습니다:

```
/context staging
```

이전 컨텍스트로 돌아가기 (`cd -` 스타일):

```
/context -
```

`/context -`를 두 번 호출하면 시작했던 곳으로 돌아갑니다.

### 4. 현재 상태 확인

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

`*`는 활성 컨텍스트를 표시합니다.

## 일상적인 명령어

| 명령어 | 설명 |
|---|---|
| `/context` | 모든 컨텍스트 나열 |
| `/context <name>` | 해당 컨텍스트로 전환 |
| `/context -` | 이전 컨텍스트로 전환 |
| `/context show` | 활성 컨텍스트 세부 정보 표시 (토큰 마스킹) |
| `/context status` | 현재 인증 상태 표시 |

## 컨텍스트 수명주기

| 명령어 | 설명 |
|---|---|
| `/context create <name> <url> <token> [namespace]` | 컨텍스트 생성 |
| `/context delete <name> --confirm` | 컨텍스트 삭제 (`--confirm` 필요) |
| `/context rename <old> <new>` | 컨텍스트 이름 변경 |
| `/context validate <name>` | 전환하지 않고 자격 증명 테스트 |
| `/context export [name] [--include-token]` | JSON으로 내보내기 (기본적으로 토큰 마스킹) |
| `/context import <path-or-json> [--overwrite]` | 파일 또는 인라인 JSON에서 가져오기 |
| `/context wizard` | 가이드 대화형 설정 |

## 네임스페이스 전환

각 컨텍스트에는 기본 네임스페이스가 있습니다. 컨텍스트를 변경하지 않고 네임스페이스만 전환할 수 있습니다:

```
/context namespace system
```

탭 완성은 활성 테넌트의 네임스페이스 이름을 제공합니다.

## 컨텍스트의 환경 변수

컨텍스트는 활성화 시 세션에 주입되는 추가 환경 변수를 포함할 수 있습니다. 자격 증명 세트에 포함되지 않는 테넌트별 구성에 유용합니다.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

별칭: `add` = `set`, `remove`/`clear` = `unset`.

## 탭 완성

`/context `를 입력하고 Tab을 누르세요. 드롭다운에 다음이 표시됩니다:

1. **컨텍스트 이름** -- 테넌트 URL 힌트가 포함되어 테넌트를 구분할 수 있습니다
2. **`-`** -- 이전에 전환한 적이 있을 때 표시되며, 어떤 컨텍스트로 전환될지 보여줍니다
3. **하위 명령** -- `list`, `create`, `delete` 등

전환이 가장 일반적인 작업이므로 컨텍스트 이름이 먼저 표시됩니다.

하위 명령 수준의 완성도 작동합니다: `/context activate <Tab>`은 컨텍스트 이름을 완성하고, `/context namespace <Tab>`은 네임스페이스를 완성하며, `/context unset <Tab>`은 알려진 환경 변수 키를 완성합니다.

## 이름 규칙

컨텍스트 이름은 1-64자여야 합니다: 문자, 숫자, 하이픈, 밑줄.

하위 명령과 충돌하는 이름은 거부됩니다:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

전체 예약어 세트: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. 비교는 대소문자를 구분하지 않습니다.

## 환경 변수 오버라이드

xcsh를 실행하기 전에 셸 환경에 `XCSH_API_URL`과 `XCSH_API_TOKEN`이 설정되어 있으면 모든 컨텍스트보다 우선합니다. 이는 영구 컨텍스트를 생성하지 않으려는 CI/CD 파이프라인이나 일회성 세션에 유용합니다.

이 모드에서 실행할 때 `/context`는 환경 변수에서 가져온 자격 증명을 `(via env vars)` 레이블과 함께 표시합니다.

## 이전 컨텍스트 동작

- **세션 범위**: 이전 컨텍스트는 xcsh를 재시작하면 초기화됩니다. 디스크에 저장되지 않습니다.
- **핑퐁**: `/context -`를 두 번 실행하면 시작했던 곳으로 돌아갑니다.
- **변경에 안전**: 이전 컨텍스트를 삭제하면 포인터가 제거됩니다. 이름을 변경하면 포인터가 새 이름을 따라갑니다.
- **재활성화는 무연산**: 이미 `production`에 있을 때 `/context production`을 실행하면 이전 포인터가 재설정되지 않습니다.

## 설계 규칙

`/context` UX는 다음을 따릅니다:

- **kubectx**: 전환에 `kubectx <name>`, 이전으로 `kubectx -`, 나열에 `kubectx` 단독 사용
- **kubectl**: 명시적 형식으로 `kubectl config use-context`
- **셸**: 이전 디렉토리 추적을 위한 `cd -` / `OLDPWD`
