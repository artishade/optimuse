# Agent UI editing contract

All clients edit the same `apps/esp32/ui/layout.json`; there is no Agent-specific copy.
The GUI, HTTP clients and MCP adapter share validation and optimistic revision checks.

## HTTP (any language / host)

Base URL: `http://127.0.0.1:8766`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/components` | Entire catalog with editable/resource requirements, limits and actions |
| GET | `/api/component-source?id=ID&revision=REV` | Actual layout lines, excerpt, event/router implementation entrypoints; 409 on stale revision |
| GET | `/api/layout` | `{document, revision}` |
| PUT | `/api/layout` | Replace with `{revision, document}` |
| PATCH | `/api/layout` | `{revision, operations}` |
| POST | `/api/layout/validate` | `{document}` → `{errors}`; no write |
| GET | `/api/build` | Build progress, failure, source/firmware manifest |
| POST | `/api/build` | Build preview and firmware; never flash |

PATCH operations:

```json
{"revision":"COPY_FROM_GET","operations":[
  {"op":"update","id":"home_brand","changes":{"text":"MY DEVICE","x":20}},
  {"op":"document","changes":{"enabled":true}}
]}
```

Other operations: `{op:"add",node:{...}}` and `{op:"remove",id:"..."}`. Removing a panel removes descendants.
A stale revision returns HTTP 409. Read again, compare the new document, and deliberately merge changes; never retry by blindly replacing another editor's work.

## CLI

```powershell
node tools/esp32-editor/src/agent.mjs ui_components
node tools/esp32-editor/src/agent.mjs ui_read
node tools/esp32-editor/src/agent.mjs ui_patch @patch.json
node tools/esp32-editor/src/agent.mjs ui_build_status
```

Use a JSON file for arguments to avoid shell quoting. `OPTIMUSE_UI_URL` overrides the service URL.

## MCP stdio

Register this command in an Agent's MCP configuration:

```json
{
  "command":"node",
  "args":["./tools/esp32-editor/src/agent.mjs","--mcp"],
  "env":{"OPTIMUSE_UI_URL":"http://127.0.0.1:8766"}
}
```

Tools: `ui_component_source`, `ui_read`, `ui_components`, `ui_patch`, `ui_validate`, `ui_build_status`, `ui_build`.
The adapter implements JSON-RPC initialization, tools/list, tools/call and ping; no dependencies or model-provider coupling.

Windows/macOS/Linux Agents can use HTTP or MCP. Android/iOS/Web/OHOS Agents use their host's HTTP capability or existing MCP/remote-tool bridge to this development service. Their `localhost` is not the development PC: use the software's existing forwarding/bridge, not the device's loopback address. This change provides a shared protocol and adapter; it does not install MCP configuration or network forwarding into every host automatically. The service remains bound to the PC's loopback and is not a public unauthenticated editor.

## Data and firmware

Version 1 supports the current board's 320×240 layout, up to 24 nodes and a conservative complexity budget of 40. Nested children reference a preceding `panel`; coordinates are relative to their parent. Bounds, unique IDs, supported widget types, actions, and strings are validated before writes. The current embedded font supports ASCII; arbitrary C code and file paths cannot be submitted through layout operations.

`enabled:true` uses this layout as firmware home. With `false`, the editor previews the draft while firmware retains its built-in home. `compile-layout.mjs` generates a small C descriptor header; the same LVGL factory creates widgets for Wasm and firmware. Dragging changes the live LVGL object without compiling; Save persists the document and triggers a dual build. Build failures remain visible, and the previous successful preview is retained.

Read `/api/build` after editing. An accepted JSON write is not proof of successful compilation or adequate real-device memory/performance. Board flashing remains a separate operation.

## Component conversations and interaction routes

Right-click / touch-hold an editor component to compose a function request. The context includes `kind: "hardware.example.component"`, `componentId`, component, complete document, revision, dirty flag, request and route capabilities. Never treat an unsaved draft as the persisted document. When dirty, preserve the attached draft and coordinate it before changing persisted layout; do not silently overwrite it with `ui_patch`.

Both GUI and API expose click (`action`) and optional long-press (`longAction`). `GET /api/components` / `ui_components` provides route IDs, labels, targets and event fields. Known routes include `home`, `apps`, `page:theme`, `page:settings`, `page:network`, `page:face`, `page:terminal`, `face_online`, `run_node`, and the empty string to unbind. Unknown routes are rejected. Navigation runs in the shared LVGL C implementation; device commands use the existing firmware callback. Registering a name alone does not implement a new feature.

Example reply to a component conversation (paste into the editor's AI reply field):

```json
{"componentId":"openApps","operations":[
  {"op":"update","id":"openApps","changes":{"action":"page:theme","longAction":"home"}}
]}
```

Only the referenced component's action fields are accepted in this reply flow; no automatic execution or saving. For direct MCP/API updates, wrap operations with a freshly read `revision`. In run mode, short tap navigates to Theme; long press returns Home and does not also trigger the click. In edit mode, long press opens component context instead. To add new pages or capabilities, update the shared C/Rust implementation, route catalog and tests, then build both targets.


## Source-reference workflow (v2, primary)

The component attachment now includes `codeReference.location` (path, 1-based start/end lines, JSON pointer, excerpt, per-field lines, revision) and `codeReference.implementation` (C event/router functions, Rust command handling and route catalog locations). Use `ui_component_source` with `{id,revision?}` to refresh these references. Use IDs as stable identity; re-read before editing because line numbers move.

The user's request is to implement behavior in the project, not merely generate route JSON. Read the referenced files, modify the selected component's binding and implement any needed page/command code and registered routes, then validate and build both targets. The JSON proposal example above is an optional compatibility path for small binding-only edits. New unsaved components have no file line number (`location:null`); their ID, draft pointer and full draft document identify them without inventing a saved position.

## v2 项目与直接部署

当前默认项目为 v2：根 nodes/background 是 home，pages 是附加页面（总数最多12），entryPage 是启动页；每页24组件、复杂度40。组件 ID 全项目唯一，parent 同页且指向前面的 panel。节点可设 binding clock/connection/expression，fontSize14/48。路由 `go:页面ID` 无需重新编译；swipeLeft/swipeRight 是目标页面 ID。

补丁新增 `addPage {page}`、`updatePage {id,changes}`、`removePage {id}`；`add` 可带 pageId。删除页面清除所有入向路由，首页/当前启动页不能直接删除。矩阵推荐 panel+独立 child button；不要把用户交互做成不可选中的内部控件。

保存是修改真实 `apps/esp32/ui/layout.json` 源文件，不自动改写 C，也不启动编译。`src/layout/package-layout.mts` 生成设备 OUI2 数据包，普通用户通过网页下发，或 POST `/api/deploy/layout`。只有新硬件能力才修改 C/Rust 并显式构建基础运行时。部署协议详见 FRONTEND.md。共享运行时支持的数据约束不可在网页单独放宽。

AI 开发任务 kind `optimuse.hardware.task` 带 task/context；context 包含当前完整草稿、页面/组件ID、JSON pointer、实际源码行号与 revision。默认发到软件当前对话；独立API通过 `/api/ai/develop` 返回审阅提案。密钥不得写入项目。

USB 离线部署：在“部署到设备”刷新串口，选择 COM 口，点击“USB 下发布局，无需编译”。后端先读取设备分区表和两个布局槽位，核对地址/尺寸/CRC/版本，只覆盖非当前槽位并递增版本；不改程序分区或 NVS。临时读取文件和布局文件结束后删除。接口为 `POST /api/deploy/usb-layout {port,document}`，状态仍用 `GET /api/deploy/flash`。与 Wi-Fi 热更新不同，USB 使用 ROM 引导器，会重启设备。
