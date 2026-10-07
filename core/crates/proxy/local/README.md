# optimuse-proxy-local

Concrete core-app proxy runtime.

## Scope

- Exposes `LocalCoreProxy`, an in-process `CoreLinkClient` backed by `OptimuseApplication`.
- Includes generated Rust dispatch emitted by `optimuse-proxy-rust-codegen`.
- Wires scanned core-app services into Link calls, watches, and push streams.
- Orchestrates build-time scanning and language emitters in `build.rs`.

## Build Pipeline

1. `optimuse-proxy-scan` scans the registered core-app roots.
2. `optimuse-proxy-rust-codegen` writes Rust dispatch and schema artifacts.
3. `optimuse-proxy-dart-codegen` writes Flutter Dart proxy artifacts.

## Boundaries

- Does not own the shared IR or type parser; those live in `optimuse-rslink-codegen`.
- Does not own runtime value conversion; conversion lives in `optimuse-rslink-runtime`.
- Does not own generic shared-client bridge wrappers; bridge wrappers live in `optimuse-proxy-bridge`.
