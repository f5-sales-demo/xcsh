---
title: xcsh 문서
description: >-
  AI-powered development CLI with TypeScript coding agent and Rust native layer
  for long-lived sessions, MCP support, and platform packaging.
sidebar:
  order: 0
  label: 개요
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh는 TypeScript 코딩 에이전트와 Rust 네이티브 레이어(`pi-natives`)를 갖춘 AI 기반 개발 CLI입니다. 오픈 소스
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) 계열을 확장하여
강화된 런타임, 트리 탐색 및 압축이 가능한 장기 세션,
Python IPython 도구, 완전한 MCP 지원, 스킬 시스템, 그리고
Linux, macOS, Windows를 대상으로 하는 플랫폼 패키징을 제공합니다.

## 시작하기

- **[F5 XC 컨텍스트](/runtime-tools/context-command)** — F5 Distributed Cloud
  테넌트에 연결합니다. 컨텍스트를 생성하고, 전환하며, 네임스페이스와 자격 증명을 관리합니다.
- **구성** — xcsh가 구성을 검색, 해석, 계층화하는 방법입니다.
- **런타임 및 도구** — bash / notebook / resolve 도구 런타임과
  슬래시 명령어 인터페이스입니다.
- **세션** — 추가 전용 항목 로그, 트리 탐색, 압축, 그리고
  자율 메모리 시스템입니다.
- **네이티브 (Rust)** — shell / PTY / 미디어 / 검색을 지원하는
  `pi-natives` N-API 애드온의 아키텍처입니다.
- **MCP** — 구성, 프로토콜 내부 구조, 런타임 생명주기, 그리고
  서버와 도구를 작성하는 방법입니다.
- **확장 기능, 스킬 및 플러그인** — 작성, 로딩, 매칭 규칙,
  마켓플레이스, 그리고 플러그인 설치 프로그램입니다.
- **프로바이더 및 모델** — 모델 구성, 스트리밍 내부 구조, 그리고
  Python / IPython 런타임입니다.
- **TUI** — 테마 설정, `/tree` 명령어, 그리고 확장 기능 및
  사용자 정의 도구를 위한 통합 훅입니다.

## 이 문서 세트의 구성 방식

사이드바의 각 최상위 그룹은 에이전트의 하위 시스템에 대응합니다. 그룹 내에서
페이지는 "개요"에서 "내부 구조" 순으로 진행되므로, 현재 작업에 필요한
충분한 맥락을 얻은 시점에서 읽기를 중단할 수 있습니다.
