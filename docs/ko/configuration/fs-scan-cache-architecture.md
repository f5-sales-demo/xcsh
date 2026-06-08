---
title: 파일시스템 스캔 캐시 아키텍처
description: 빠른 파일 탐색과 stale-while-revalidate 시맨틱을 위한 파일시스템 스캔 캐시 계약.
sidebar:
  order: 8
  label: 파일시스템 스캔 캐시
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# 파일시스템 스캔 캐시 아키텍처 계약

이 문서는 Rust(`crates/pi-natives/src/fs_cache.rs`)로 구현된 공유 파일시스템 스캔 캐시의 현재 계약을 정의하며, `packages/coding-agent`에 노출된 네이티브 탐색/검색 API가 이를 사용합니다.

## 이 캐시가 무엇인가

캐시는 스캔 범위와 탐색 정책으로 키가 지정된 전체 디렉터리 스캔 항목 목록(`GlobMatch[]`)을 저장한 후, 상위 수준 작업(glob 필터링, 퍼지 스코어링, grep 파일 선택)이 캐시된 항목에 대해 실행되도록 합니다.

주요 목표:

- 반복적인 탐색/검색 호출에서 파일시스템 워크를 반복하지 않기
- `glob`, `fuzzyFind`, `grep`이 동일한 스캔 정책을 공유할 때 일관성 유지
- 빈 결과에 대한 명시적 오래된 데이터 복구 및 파일 변경 후 명시적 무효화 허용

## 소유권과 공개 인터페이스

- 캐시 구현 및 정책: `crates/pi-natives/src/fs_cache.rs`
- 네이티브 소비자:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- JS 바인딩/내보내기:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agent 변경 무효화 헬퍼:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## 캐시 키 파티셔닝 (엄격한 계약)

각 항목은 다음으로 키가 지정됩니다:

- 정규화된 `root` 디렉터리 경로
- `include_hidden` 불리언
- `use_gitignore` 불리언

함의:

- 숨김 파일 포함 스캔과 비포함 스캔은 항목을 **공유하지 않습니다**.
- gitignore를 준수하는 스캔과 무시를 비활성화한 스캔은 항목을 **공유하지 않습니다**.
- 소비자는 숨김/gitignore 동작에 대해 안정적인 시맨틱을 전달해야 합니다. 어느 플래그든 변경하면 다른 캐시 파티션이 생성됩니다.

`node_modules` 포함 여부는 캐시 키에 **포함되지 않습니다**. 캐시는 `node_modules`가 포함된 항목을 저장하며, 소비자별 필터링은 조회 후에 적용됩니다.

## 스캔 수집 동작

캐시 채우기는 `include_hidden`과 `use_gitignore`로 구성된 결정적 워커(`ignore::WalkBuilder`)를 사용합니다:

- `follow_links(false)`
- 파일 경로별로 정렬
- `.git`은 항상 건너뜀
- `node_modules`는 캐시 스캔 시점에 항상 수집됨(이후 선택적으로 필터링)
- 항목 파일 유형 + `mtime`은 `symlink_metadata`를 통해 캡처됨

검색 루트는 `resolve_search_path`에 의해 해석됩니다:

- 상대 경로는 현재 cwd를 기준으로 해석됨
- 대상은 기존 디렉터리여야 함
- 루트는 가능한 경우 정규화됨

## 신선도 및 퇴거 정책

전역 정책(환경 변수로 재정의 가능):

- `FS_SCAN_CACHE_TTL_MS` (기본값 `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (기본값 `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (기본값 `16`)

동작:

- `get_or_scan(...)`
  - TTL이 `0`인 경우: 캐시를 완전히 우회하고 항상 새로운 스캔 수행 (`cache_age_ms = 0`)
  - TTL 내 캐시 히트 시: 캐시된 항목 + 0이 아닌 `cache_age_ms` 반환
  - 만료된 히트 시: 키를 퇴거하고, 재스캔하고, 새로운 항목을 저장
- 최대 항목 수 강제는 `created_at` 기준 가장 오래된 것부터 퇴거

## 빈 결과 빠른 재확인 (일반 히트와 별도)

일반 캐시 히트:

- TTL 내의 캐시 히트는 캐시된 항목을 반환하고 다른 작업은 수행하지 않습니다.

빈 결과 빠른 재확인:

- 이것은 `ScanResult.cache_age_ms`를 사용하는 **호출자 측** 정책입니다
- 필터링/쿼리 결과가 비어 있고 캐시된 스캔 나이가 최소 `empty_recheck_ms()` 이상이면, 호출자가 `force_rescan(...)`을 한 번 수행하고 재시도합니다
- 파일이 최근에 추가되었지만 캐시가 아직 TTL 내에 있을 때 오래된 부정 결과를 줄이기 위한 것입니다

현재 소비자:

- `glob`: 필터링된 매치가 비어 있고 스캔 나이가 임계값을 초과할 때 재확인
- `fuzzyFind` (`fd.rs`): 쿼리가 비어 있지 않고 스코어링된 매치가 비어 있을 때만 재확인
- `grep`: 선택된 후보 파일 목록이 비어 있을 때 재확인

## 소비자 기본값 및 캐시 사용

캐시는 모든 노출된 API에서 옵트인입니다 (`cache?: boolean`, 기본값 `false`).

네이티브 API의 현재 기본값:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, 캐시 스캔은 항상 `use_gitignore=true` 사용

현재 Coding-agent 호출자:

- 대량의 멘션 후보 탐색은 캐시를 활성화합니다:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - 프로필: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- 도구 수준 `grep` 통합은 현재 스캔 캐시를 비활성화합니다 (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## 무효화 계약

네이티브 무효화 진입점:

- `invalidateFsScanCache(path?: string)`
  - `path` 포함 시: 루트가 대상 경로의 접두사인 캐시 항목을 제거
  - `path` 없이: 모든 스캔 캐시 항목을 지움

경로 처리 세부사항:

- 상대 무효화 경로는 cwd를 기준으로 해석됨
- 무효화 시 정규화를 시도함
- 대상이 존재하지 않는 경우(예: 삭제), 부모를 정규화하고 가능한 경우 파일 이름을 다시 연결하는 대체 방법을 사용
- 이는 한쪽이 존재하지 않을 수 있는 생성/삭제/이름 변경에 대한 무효화 동작을 보존합니다

## Coding-agent 변경 흐름 책임

Coding-agent 코드는 성공적인 파일시스템 변경 후 무효화해야 합니다.

중앙 헬퍼:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (경로가 다를 경우 양쪽 모두 무효화)

현재 변경 도구 호출 위치:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (hashline/patch/replace 흐름)

규칙: 흐름이 파일시스템 콘텐츠나 위치를 변경하면서 이러한 헬퍼를 우회하면 캐시 오래된 데이터 버그가 예상됩니다.

## 새로운 캐시 소비자를 안전하게 추가하기

새로운 스캐너/검색 경로에 캐시 사용을 도입할 때:

1. **안정적인 스캔 정책 입력을 사용하세요**
   - 먼저 숨김/gitignore 시맨틱을 결정하세요
   - 캐시 파티션이 의도적이 되도록 `get_or_scan`/`force_rescan`에 일관되게 전달하세요

2. **캐시 데이터를 탐색 정책에 의한 사전 필터링만 된 것으로 취급하세요**
   - 도구별 필터링(glob 패턴, 유형 필터, node_modules 규칙)은 조회 후에 적용하세요
   - 캐시된 항목이 이미 상위 수준 필터를 반영한다고 가정하지 마세요

3. **빈 결과 빠른 재확인은 오래된 부정 결과 위험이 있는 경우에만 구현하세요**
   - `scan.cache_age_ms >= empty_recheck_ms()`를 사용하세요
   - `force_rescan(..., store=true, ...)`으로 한 번 재시도하세요
   - 이 경로를 일반 캐시 히트 로직과 분리하세요

4. **캐시 비활성화 모드를 명시적으로 준수하세요**
   - 호출자가 캐시를 비활성화하면, `force_rescan(..., store=false, ...)`를 호출하세요
   - 캐시 비활성화 요청 경로에서 공유 캐시를 채우지 마세요

5. **새로운 쓰기 경로에 대해 변경 무효화를 연결하세요**
   - 성공적인 쓰기/편집/삭제/이름 변경 후, coding-agent 무효화 헬퍼를 호출하세요
   - 이름 변경/이동의 경우, 이전 경로와 새 경로 모두 무효화하세요

6. **호출별 TTL 설정을 추가하지 마세요**
   - 현재 계약은 전역 정책만 해당됩니다(환경 변수로 구성), 요청별 TTL 재정의는 없습니다

## 알려진 경계

- 캐시 범위는 프로세스 로컬 인메모리(`DashMap`)이며, 프로세스 재시작 간에 지속되지 않습니다.
- 캐시는 최종 도구 결과가 아닌 스캔 항목을 저장합니다.
- `glob`/`fuzzyFind`/`grep`은 키 차원(`root`, `hidden`, `gitignore`)이 일치할 때만 스캔 항목을 공유합니다.
- `.git`은 호출자 옵션에 관계없이 스캔 수집 시점에 항상 제외됩니다.
