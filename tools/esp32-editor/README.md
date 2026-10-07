# 共用 LVGL 开发调试台

## ESP32 模拟设备：真实配对与聊天

运行 `npm start --prefix tools/esp32-editor`，打开 http://127.0.0.1:8766，点击“启动模拟设备”。
首次启动需要可用的桌面 Rust/Cargo 工具链，工具会编译并启动本机 Rust 模拟器。
界面展示实际 TCP 地址、Edge Token、配对码、连接状态和编译日志；停止按钮会终止模拟设备，编辑器退出也会回收进程。

1. 在运行本次 Edge 功能版本的 Core 应用中打开 Space 设备面板，选择 Edge 配对。
2. 填写模拟器显示的局域网 TCP 地址（默认监听 `0.0.0.0:18765`，面板会显示可连接的局域网 IP）和“复制 Token”得到的令牌。
3. Core 发起配对后，模拟 ESP32 屏幕的 Network 页面显示六位配对码；将其填回 Core 完成配对。
4. 在模拟 ESP32 屏幕上进入 Network / Chat 页面。搜索、配对和聊天入口都由共享 LVGL 设备 UI 处理；编辑器面板只负责模拟器生命周期、Token 和开发日志。
5. 检查流式回复、Core 端历史记录和错误提示。停止模拟器后 Core 应显示离线；重启保留设备身份与配对凭据，Core 重新连接后恢复固定聊天。

如需指定绑定地址，在启动编辑器的终端设置 `$env:OPTIMUSE_SIM_BIND = "0.0.0.0:18765"`；
也可设置 `$env:OPTIMUSE_SIM_ADVERTISE = "192.168.1.20"` 指定面板展示给 Core 的局域网 IP。防火墙需允许该 TCP 端口。
模拟器的身份与真实板卡分开；令牌及配对凭据保存在忽略提交的 `generated/simulator/`，聊天数据仍存于 Core。

运行时直接编译固件的 `apps/esp32/src/edge_session.rs` 和 `edge_chat.rs`，使用已有
`optimuse-edge-transport`、加密认证、PeerLink 与 SpaceBinding 路由。
编辑器到本机进程的 IPC 只承接 UI 和生命周期，不替代节点之间的 Link 协议。
LVGL 画布继续运行共享 C/Wasm，连接指示跟随真实会话。聊天界面复用固件的 Web Chat 页面；当前固件本身还没有 LVGL 聊天输入页。
此环境模拟设备运行能力，不执行 ESP32 指令集，不模拟 Wi-Fi 无线电、SPI 时序或板上 RAM 限制。

验证命令（仓库根目录执行）：

```powershell
cargo test --manifest-path tools/esp32-editor/simulator/Cargo.toml
npm run check --prefix tools/esp32-editor
npm test --prefix tools/esp32-editor
```

Rust 测试通过真实 TCP 连接检查密码学配对、固件聊天的 routed call/watch、回复显示、权限错误回传和持久身份重连。
其中相邻 Core 使用协议测试端；真实 Core 的 Binding 与权限执行仍由 `optimuse-node-runtime` 集成测试及上述联调流程验证。

浏览器与 ESP32 使用同一个 `apps/esp32/lvgl_port/optimuse_lvgl.c`，不再用 JavaScript 重写界面。
LVGL 的布局、字体、按钮事件和滑动动画在 WebAssembly 中运行；HTML 仅提供开发面板，Canvas 显示 LVGL 输出的 RGB565 像素。

## 使用与开发构建

普通使用只需 Node.js 18+ 和已有的 `generated/ui.mjs`、`ui.wasm`、`manifest.json`：

```powershell
npm install --prefix ./tools/esp32-editor
npm start --prefix ./tools/esp32-editor
```

如果首次启动提示构建清单 404，说明忽略的 `generated/` 产物尚未生成。安装并激活 Emscripten 4.0.14 后执行：

```powershell
npm run build --prefix ./tools/esp32-editor
```

然后重新打开编辑器。底层 C/Rust 运行时变更则执行 `npm run build:firmware --prefix ./tools/esp32-editor`。

访问 http://127.0.0.1:8766 。页面直接编辑首页和各子页；保存项目写入 JSON；部署到设备使用现成运行时。USB 操作需要电脑已安装 espflash、Python/pyserial；Wi-Fi 下发不需要串口工具。手机可通过端口转发访问此服务，默认不开放局域网监听。

开发者修改共享 C/Rust 或新增底层能力后，在开发环境执行：

```powershell
npm run build:firmware --prefix ./tools/esp32-editor
```

只生成浏览器预览时用 `npm run build --prefix ./tools/esp32-editor`。构建需要 Node.js、Emscripten 4.0.14、Rust/ESP-IDF 工具链。通过 `EMSDK` 或 `--emsdk` 指定 Emscripten 安装目录；不在代码中写入机器绝对路径。Windows 上脚本自动把 Cargo target 放在当前工作区所在盘的 `\esp32`，并把 `CARGO_TARGET_DIR` 与 `CARGO_WORKSPACE_DIR` 注入固件构建。LVGL 默认复用该目录中的 v9.3.0 构建目录，也可传 `--lvgl`。仅保留当前增量对象与当前产物。

- 保存 JSON / 编辑 C 都不会自动启动编译；调试面板只显示运行时状态。
- 显式构建生成同源 Wasm 与基础固件。构建失败保留旧预览并显示错误。
- `apps/esp32/dist/optimuse-esp32.bin` 是程序镜像（0x10000），另含 bootloader（0x1000）和 partition-table（0x8000）。网页烧录这些已有文件，保留 NVS 和布局分区。
- 合并的 `optimuse-esp32-4mb-full.bin` 用于初始部署，不应当作日常界面修改方式。
- 调试面板的临时状态不写设备设置。默认设计请编辑项目 JSON；新增设备命令才修改 C/Rust。

## 边界

这是实际 LVGL UI 的 WebAssembly 执行环境，不模拟 ESP32 CPU / SPI / Wi-Fi。Web 字体与图标现在来自同一 LVGL 源码和配置，不再使用浏览器近似替代。触摸事件交给 LVGL 本身处理。
渲染时间是浏览器指标；内存显示是 LVGL 池占用，不是整板 RAM。
当前共用 UI 仅支持 320×240，其他分辨率需要先调整同一份 C 布局，不能只拉伸网页。

## 文件

- `src/build.mts`：编译 LVGL 和共用 UI、生成 Wasm、可同时构建 ESP32，记录产物哈希。`npm run build` / `npm run build:firmware`。
- `wasm/bridge.c`：RGB565 帧缓冲、触摸、LVGL 内存统计和动作回调。
- `wasm/esp_timer.h`：浏览器时钟适配。
- `web/app.ts`：WebAssembly 宿主和调试面板，不包含按钮布局绘制逻辑。
- `src/server.mts`：本地服务、运行时状态、布局/AI/部署接口。
- `src/api/`：布局、部署、AI 的 HTTP 路由。
- `src/layout/`：项目模型、组件目录、路由和设备布局包。
- `src/source/`：组件源码引用。
- `tests/`：Node 测试与 C store 夹具。
- `generated/`：忽略提交的构建产物和日志。

集成软件本体时可将前端与 `generated/ui.mjs`、`ui.wasm` 放入 WebView；布局与部署由后端管理，基础运行时构建由开发环境完成。

## 磁盘占用

仅保留一份当前预览（约 450 KB）和一份增量编译对象缓存（约 1.2 MB），对象按源文件覆盖，已删除源文件的缓存自动移除。不保存历史固件或预览版本。
临时链接文件与发布暂存文件在构建结束（包括失败）时自动清理；固件日志只保留最新 256 KiB，服务内存中的构建输出限制为 16,000 字符。
Emscripten 编译工具链单独安装，不属于调试器运行包；运行已构建的预览无需携带工具链。安装下载包及分片无需保留。

## 拖拽布局与组件库

左侧列出当前 LVGL 组件，29 种可直接创建，图片/序列帧/图片按钮/像素画布标注资源需求。拖入画布后可移动、四角缩放（4 px 对齐）、编辑属性、选择父容器、删除或撤销（最多 20 步，仅内存）。关闭“编辑布局”可操作真实 LVGL 控件。

布局的源文件是 `apps/esp32/ui/layout.json`（v2），首页及 Apps/Theme/Settings/Network/Face/Terminal/Plugins 都可直接编辑。根 `nodes` 是首页，`pages` 是其余页面。页面关系图展示点击、长按、左右滑动连接；新建页面后通过 `go:页面ID` 或滑动连接进入。按钮矩阵自动展开为容器和三个独立按钮，分别移动、改大小、文本与路由。

**保存项目只写入 JSON，不运行编译器。** 网页当前草稿立即由现成 Wasm 运行时渲染；“部署到设备”将草稿打包成 `.oui`，通过局域网传入已安装的基础固件，切换页面并持久保存。修改默认页面并不逐项重写手写 C，JSON 就是这部分的代码源文件。JSON 导出可用于版本控制、AI 编辑和分享。旧草稿仅保留一份在 `legacy-draft.json`。

首次安装：在“部署到设备 → 首次安装 / 更新基础固件”刷新串口，选择 ESP32，烧录开发者已生成的 `apps/esp32/dist` 产物。不启动编译，不擦除 NVS/Wi-Fi。基础固件必须支持 `/ui/capabilities` 协议 1，旧固件会提示更新。烧录后填写设备 HTTP 地址；已设置 Edge Token 的设备需要同一令牌。未设置令牌时只适合受信任局域网，部署仍要求专用请求头，禁止跨站表单请求。

开发者新增控件/底层能力才运行 `npm run build:firmware --prefix tools/esp32-editor`。编译保留单份增量对象；页面修改不会触发构建。设备布局分区位于 `0x3E0000`，64 KiB，两个32 KiB槽位，单包上限28 KiB；CRC/尺寸/层级/复杂度验证通过才写入提交头，当前页面在 LVGL 主循环安全切换。失败或中断保留上一份。读取使用 Flash 映射，上传缓冲512字节，不把整份 JSON/页面树加载到堆。


Agent 接口和 MCP 配置见 [AGENT_API.md](AGENT_API.md)。服务处理版本冲突；GUI 有未保存草稿时不会被 Agent 更新或自动刷新覆盖。资源类组件需要后续接入资产管线，当前不能直接拖入；组件目录不等于所有 LVGL 属性已开放。

## 自适应编辑器与软件内嵌

桌面使用组件库 / 画布 / 检查面板三栏；手机通过底部导航切换画布、组件、设计、图层、调试。默认自动适配画布宽度，仍以 320×240 逻辑像素编辑。支持轻点添加、拖动移动和缩放、复制容器及子组件、撤销/重做、方向键及手机按钮微调。无 npm 依赖和持久化草稿缓存。

软件内“AI 对话修改硬件界面”的模块边界、宿主入口和后续接入步骤见 [FRONTEND.md](FRONTEND.md)。已增加 Flutter 工作区浏览器到当前对话的桥接源码；需要运行含此更改的软件版本。在工作区浏览器打开本机端口 8766，点击 AI 开发即可发送任务；普通浏览器可改选独立 API。

## 组件逻辑与 AI 对话

编辑时右键 / 长按组件，或点击“功能 / AI”，配置点击、长按路由，填写功能需求并附带组件上下文。已连接软件宿主时可发送到对话；独立调试页可复制给 AI，再粘贴结构化路由回复并校验应用。当前包含首页、应用网格、主题、设置、网络、表情、终端页面跳转，以及在线表情和运行节点命令。运行模式触摸验证后保存，同步编译 Wasm 和固件。

路由描述见 `src/layout/routes.mts`，共用执行逻辑在 `optimuse_lvgl.c`。新页面只需编辑项目数据；新设备能力需要修改共享 C/Rust 并更新基础运行时。软件聊天桥接规范见 [FRONTEND.md](FRONTEND.md)，AI 回复示例见 [AGENT_API.md](AGENT_API.md)。


组件面板现在以**源码引用交给 AI**为主：附带布局文件实际行号、组件 ID / JSON pointer、源代码片段和事件/路由实现入口。AI 可直接阅读并修改功能代码，不要求仅返回路由 JSON。未保存组件明确标为草稿且不编造磁盘行号；手动选择现有路由保留为折叠的辅助功能。

USB 离线部署：在“部署到设备”刷新串口，选择 COM 口，点击“USB 下发布局，无需编译”。后端先读取设备分区表和两个布局槽位，核对地址/尺寸/CRC/版本，只覆盖非当前槽位并递增版本；不改程序分区或 NVS。临时读取文件和布局文件结束后删除。接口为 `POST /api/deploy/usb-layout {port,document}`，状态仍用 `GET /api/deploy/flash`。与 Wi-Fi 热更新不同，USB 使用 ROM 引导器，会重启设备。
