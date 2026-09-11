# Changelog

All notable changes to this project are documented in this file.

## Unreleased

## 0.1.0

- Add opt-in strict write validation, generated-field protection, ISO UTC datetime output, and validation of resolved model defaults.
- Add revision optimistic concurrency, stable keyset cursor pagination, revision-aware nested deletion, and write returning.
- Add read-only SQLite snapshots with WAL/query-only enforcement, limits, metrics, close draining, and observable cleanup failures.
- Add validated SQLite runtime pragmas, online backup, integrity checks, migration locking, rollback coverage, and batched stored-data validation.
- Add sanitized diagnostics, contract coverage, isolated package smoke coverage, and the required `tslib` runtime dependency.
- Declare `better-sqlite3` as an optional peer dependency for SQLite consumers.
- Add reproducible release verification, supply-chain checks, trusted GitHub Actions publishing, and release metadata validation.

## 0.0.16

- Baseline release before the `0.1.0` audit remediation work.
