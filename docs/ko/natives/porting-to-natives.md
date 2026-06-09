---
title: pi-natives (N-API)로 포팅하기 — 현장 노트
description: Node.js child_process 및 셸 코드를 Rust N-API 네이티브 레이어로 마이그레이션하기 위한 현장 노트.
sidebar:
  order: 9
  label: pi-natives로 포팅하기
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# pi-natives (N-API)로 포팅하기 — 현장 노트

이 문서는 핫 패스를 `crates/pi-natives`로 이동하고 JS 바인딩을 통해 연결하는 실용적인 가이드입니다. 같은 실패가 두 번 발생하는 것을 방지하기 위해 작성되었습니다.

## 포팅 시점

다음 중 하나라도 해당되면 포팅하세요:

- 핫 패스가 렌더 루프, 빈번한 UI 업데이트 또는 대규모 배치에서 실행되는 경우.
- JS 할당이 지배적인 경우 (문자열 생성/소멸, 정규식 역추적, 대용량 배열).
- 이미 JS 베이스라인이 있어 두 버전을 나란히 벤치마크할 수 있는 경우.
- 작업이 CPU 바운드이거나 libuv 스레드 풀에서 실행할 수 있는 블로킹 I/O인 경우.
- 작업이 Tokio 런타임에서 실행할 수 있는 비동기 I/O인 경우 (예: 셸 실행).

JS 전용 상태나 동적 임포트에 의존하는 포팅은 피하세요. N-API 내보내기는 순수하게 데이터 입력/데이터 출력이어야 합니다. 장시간 실행되는 작업은 `task::blocking` (CPU 바운드/블로킹 I/O) 또는 `task::future` (비동기 I/O)를 통해 취소 기능과 함께 처리해야 합니다.

## 네이티브 내보내기의 구조

**Rust 측:**

- 구현체는 `crates/pi-natives/src/<module>.rs`에 위치합니다. 새 모듈을 추가하는 경우 `crates/pi-natives/src/lib.rs`에 등록하세요.
- `#[napi]`로 내보내기; snake_case 내보내기는 자동으로 camelCase로 변환됩니다. 실제 별칭이나 기본이 아닌 이름에만 명시적 `js_name`을 사용하세요. 구조체에는 `#[napi(object)]`를 사용하세요.
- CPU 바운드 또는 블로킹 작업에는 `task::blocking(tag, cancel_token, work)` (`crates/pi-natives/src/task.rs` 참조)를 사용하세요. Tokio가 필요한 비동기 작업(예: 셸 세션)에는 `task::future(env, tag, work)`를 사용하세요. `timeoutMs` 또는 `AbortSignal`을 노출할 때는 `CancelToken`을 전달하세요.

**JS 측:**

- `packages/natives/src/bindings.ts`에 기본 `NativeBindings` 인터페이스가 있습니다.
- `packages/natives/src/<module>/types.ts`에서 TS 타입을 정의하고 선언 병합을 통해 `NativeBindings`를 확장합니다.
- `packages/natives/src/native.ts`에서 각 `<module>/types.ts` 파일을 임포트하여 선언을 활성화합니다.
- `packages/natives/src/<module>/index.ts`에서 `packages/natives/src/native.ts`의 `native` 바인딩을 래핑합니다.
- `packages/natives/src/native.ts`에서 애드온을 로드하고 `validateNative`가 필수 내보내기를 검증합니다.
- `packages/natives/src/index.ts`에서 `packages/*`의 호출자를 위해 래퍼를 재내보내기합니다.

## 포팅 체크리스트

1. **Rust 구현 추가**

- 핵심 로직을 일반 Rust 함수에 넣으세요.
- 새 모듈인 경우 `crates/pi-natives/src/lib.rs`에 추가하세요.
- `#[napi]`로 노출하여 기본 snake_case -> camelCase 매핑이 일관되게 유지되도록 하세요.
- 시그니처를 소유형이고 단순하게 유지하세요: `String`, `Vec<String>`, `Uint8Array`, 또는 대용량 문자열/바이트 입력에는 `Either<JsString, Uint8Array>`를 사용하세요.
- CPU 바운드 또는 블로킹 작업에는 `task::blocking`을, 비동기 작업에는 `task::future`를 사용하세요. `CancelToken`을 전달하고 긴 루프 내부에서 `heartbeat()`를 호출하세요.

2. **JS 바인딩 연결**

- `packages/natives/src/<module>/types.ts`에 타입과 `NativeBindings` 확장을 추가하세요.
- `packages/natives/src/native.ts`에서 `./<module>/types`를 임포트하여 선언 병합을 트리거하세요.
- `packages/natives/src/<module>/index.ts`에 `native`를 호출하는 래퍼를 추가하세요.
- `packages/natives/src/index.ts`에서 재내보내기하세요.

3. **네이티브 검증 업데이트**

- `validateNative` (`packages/natives/src/native.ts`)에 `checkFn("newExport")`를 추가하세요.

4. **벤치마크 추가**

- 벤치마크를 소유 패키지 옆에 두세요 (`packages/tui/bench`, `packages/natives/bench`, 또는 `packages/coding-agent/bench`).
- JS 베이스라인과 네이티브 버전을 같은 실행에 포함하세요.
- `Bun.nanoseconds()`와 고정 반복 횟수를 사용하세요.
- 벤치마크 입력을 작고 현실적으로 유지하세요 (핫 패스에서 실제로 관찰된 데이터).

5. **네이티브 바이너리 빌드**

- `bun --cwd=packages/natives run build`
- `bun --cwd=packages/natives run build`를 사용하고, 테스트 중 로더 진단 정보를 원하면 `PI_DEV=1`을 설정하세요.

6. **벤치마크 실행**

- `bun run packages/<pkg>/bench/<bench>.ts` (또는 `bun --cwd=packages/natives run bench`)

7. **사용 여부 결정**

- 네이티브가 더 느리면 **JS를 유지**하고 네이티브 내보내기는 사용하지 않은 채로 남겨두세요.
- 네이티브가 더 빠르면 호출 지점을 네이티브 래퍼로 전환하세요.

## 문제점과 해결 방법

### 1) 오래된 `pi_natives.node`가 새 내보내기를 차단함

로더는 `packages/natives/native`에 있는 플랫폼 태그 바이너리 (`pi_natives.<platform>-<arch>.node`)를 우선합니다. `PI_DEV=1`은 이제 로더 진단 정보만 활성화하며, 더 이상 별도의 개발용 애드온 파일명으로 전환하지 않습니다. `pi_natives.node` 폴백도 있습니다. 컴파일된 바이너리는 `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`로 추출됩니다. 이 중 하나라도 오래되면 내보내기가 업데이트되지 않습니다.

**해결:** 재빌드 전에 오래된 파일을 삭제하세요.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

컴파일된 바이너리를 실행 중이라면 캐시된 애드온 디렉터리를 삭제하세요:

```bash
rm -rf ~/.xcsh/natives/<version>
```

그런 다음 바이너리에 내보내기가 존재하는지 확인하세요:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) `validateNative`의 "내보내기 누락" 오류

이것은 **좋은 것**입니다 — 무음 불일치를 방지합니다. 다음과 같은 메시지가 표시될 때:

```
Native addon missing exports ... Missing: visibleWidth
```

이는 바이너리가 오래되었거나, Rust 내보내기 이름(또는 사용된 명시적 별칭)이 JS 이름과 일치하지 않거나, 내보내기가 컴파일되지 않았다는 의미입니다. 빌드와 네이밍 불일치를 수정하세요. 검증을 약화시키지 마세요.

### 3) Rust 시그니처 불일치

단순하고 소유형으로 유지하세요. `String`, `Vec<String>`, `Uint8Array`가 작동합니다. 공개 내보내기에서 `&str` 같은 참조를 피하세요. 구조화된 데이터가 필요하면 `#[napi(object)]` 구조체로 감싸세요.

### 4) 벤치마킹 실수

- 서로 다른 입력이나 할당을 비교하지 마세요.
- JS와 네이티브가 동일한 입력 배열을 사용하도록 하세요.
- 두 버전을 같은 벤치마크 파일에서 실행하여 편차를 방지하세요.

## 벤치마크 템플릿

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## 검증 체크리스트

- `validateNative` 통과 (누락된 내보내기 없음).
- `NativeBindings`가 `packages/natives/src/<module>/types.ts`에서 확장되고 래퍼가 `packages/natives/src/index.ts`에서 재내보내기됨.
- `Object.keys(require(...))`에 새 내보내기가 포함됨.
- 벤치마크 수치가 PR/노트에 기록됨.
- 호출 지점은 네이티브가 더 빠르거나 동등한 **경우에만** 업데이트됨.

## 경험 법칙

- 네이티브가 더 느리면 **전환하지 마세요**. 향후 작업을 위해 내보내기는 유지하되, TUI는 더 빠른 경로를 유지해야 합니다.
- 네이티브가 더 빠르면 호출 지점을 전환하고 벤치마크를 유지하여 성능 저하를 감지하세요.
