<!-- markdownlint-configure-file { "MD024": { "siblings_only": true } } -->

# Changelog

## [Unreleased]

### Fixed

- Normalized partial legacy usage costs before SQLite insertion and restricted the dashboard to
  explicit IPv4 loopback without wildcard CORS access ([#3724](https://github.com/f5-sales-demo/xcsh/issues/3724)).

## [20.0.0] - 2026-08-01

### Fixed

- Reconstruct request details from the ordered parent-message chain, including safe handling of missing parents and malformed cycles.

## [13.6.0] - 2026-03-03

### Fixed

- Include subtask session files in usage stats ([#250](https://github.com/can1357/oh-my-pi/issues/250))
