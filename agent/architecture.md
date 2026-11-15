# 项目作用与结构

音视频创作策划工作台面向个人创作者，在同一画布上组织图片、文字、音频和视频，进行时间标记、裁剪、注释、连线与策划。桌面版优先支持 Windows 离线使用；浏览器开发版用于快速查看界面与验证基础编辑流程。

## 运行路径

- `npm.cmd run dev`：浏览器预览，Vite 提供界面。浏览器项目和原始素材存入当前站点的 IndexedDB；浏览器安全模型不允许网页直接指定任意磁盘目录。浏览器模式不生成 FFmpeg 缩略图缓存。
- `npm.cmd run dev:desktop`：先构建 Electron 主进程，再启动 Vite 与未安装的 Electron。界面修改可热更新；主进程修改需重启命令。
- `npm.cmd run build`：检查 TypeScript，构建界面和桌面进程。`npm.cmd run dist:win` 在此基础上准备 FFmpeg 并生成 NSIS 安装包。
- `npm.cmd run verify`：类型检查、单元测试及端到端测试。桌面端测试需要本机 Electron 能正常启动。

## 目录职责

- `src/core/`：项目文档模型、校验、编辑命令、自动保存和时间刻度；文档是编辑器的单一事实来源。
- `src/ui/`：React 界面、画布、素材库、播放控件、任务状态、语言与设置面板。
- `src/platform/`：浏览器本地存储与素材 URL 适配。Electron 存储通过 preload 暴露的受限 API 调用。
- `electron/main.ts`：窗口、协议、设置和 IPC 边界。默认项目根目录保存在 Electron `userData/settings.json`；修改默认目录只影响以后新建的项目。
- `electron/preload.ts`：向渲染进程暴露受限 API；不直接暴露 Node 文件系统。
- `electron/worker.ts`：项目和素材文件读写、媒体时长检测、FFmpeg 缓存任务及恢复快照。
- `scripts/`：桌面构建、媒体工具准备、免安装开发入口与受限范围内的测试产物清理。所有脚本可从仓库根目录执行。
- `tests/e2e/` 与 `tests/fixtures/`：端到端用例和固定的小样本素材。测试项目使用独立临时目录，不写入正式用户项目。
- `vendor/`：FFmpeg 授权信息及本机准备的可执行文件。可执行文件不进 Git，打包前由 `prepare:media` 校验和准备。
- `agent/`：本文件及变更记录。`dist/`、`dist-electron/`、`release/`、`test-results/` 是生成物或临时目录，不是源码。

## 数据边界

桌面项目目录包含 `project.json`、`assets/`、`cache/`、`recovery/`。`project.json` 保存编辑器文档，原始素材复制到 `assets/`，媒体分析结果放在可重建的 `cache/`，`recovery/` 保存恢复快照。浏览器项目使用相同的文档模型，但存储在 IndexedDB；两端项目目前不自动迁移。界面语言存在当前应用环境的 localStorage，不写入项目文档。
