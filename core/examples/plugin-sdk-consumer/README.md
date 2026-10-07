# Plugin SDK Consumer

This example acts as a small third-party application embedding `optimuse-plugin-sdk`.

The application owns the JavaScript engine implementation and asset source. The SDK owns package parsing, package state, and ToolPkg orchestration.

Run:

```powershell
$env:RUSTFLAGS='-Awarnings'
cargo run
```
