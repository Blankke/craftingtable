# 音视频创作策划工作台

Windows 优先的离线桌面工作台。当前开发版已实现项目读写、画布编辑、音视频轨道、素材缩略预览、时间标记、裁剪、播放、自动保存和恢复。桌面端运行仍需在目标 Windows 环境验收。

## 环境

- Node.js 20 以上、npm。
- Windows x64。
- `npm run dist:win` 会自动运行 `scripts/prepare-media.ps1`，下载并校验固定版本的 FFmpeg 与 ffprobe，放入 `vendor/`。

依赖已安装后使用：

```powershell
npm.cmd run dev
npm.cmd run dev:desktop
npm.cmd run clean:test
npm.cmd run verify
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run start
npm.cmd run smoke
npm.cmd run dist:win
```

`dev` 直接在浏览器查看并热更新界面；`dev:desktop` 启动 Vite 与未安装的 Electron，可检查桌面文件操作，不需要先生成安装包。`verify` 依次执行 TypeScript、Vitest 和 Playwright 桌面与浏览器端到端测试；`test:e2e` 可单独运行，会先准备固定版本媒体工具，使用独立临时项目目录，不会下载浏览器。浏览器测试使用本机 Chrome 或 Edge。测试样本包含 6 种素材、4 条媒体轨道、43 个画布对象与嵌套分组。也可用 `powershell -ExecutionPolicy Bypass -File scripts/build.ps1` 顺序验证并打包。`start` 运行最近一次构建结果。

`clean:test` 只清除仓库内的 Playwright 结果、旧安装冒烟目录和打包调试配置，不删除测试样本、已构建程序或安装包。协作资料与目录职责见根目录 `AGENTS.md` 和 `agent/`。

桌面版默认将新建项目保存在用户“文档/音视频创作策划工作台”目录。首页或编辑页顶部的“设置”可指定后续新建项目的保存文件夹，并切换简体中文或英语；更改默认目录不搬移已有项目。首页点击“+”可新建项目，或选择“打开项目文件夹”打开搬移后的项目。每个项目包含 `project.json`、`assets/`、`cache/`、`recovery/`。主文件损坏时会读取最近有效恢复快照，并自动保存到主文件；保存失败会在界面提示并允许重试。

Windows 安装包输出到 `release/`。冒烟模式会验证项目读写、六种素材导入、导入中断残留清理、图片/音频/视频缩略预览、媒体时长探测、Chromium 的资源解码和视频播放、时间标记与对象箭头、不支持媒体的错误提示、后台异常重启与保存重试、恢复快照以及项目文件夹搬移。媒体工具及许可证来自 [Gyan 的 FFmpeg Windows 构建](https://www.gyan.dev/ffmpeg/builds/)，随包版权信息见 `vendor/NOTICE.txt`。

验证解包程序时，在 PowerShell 中设置 `$env:WORKBENCH_SMOKE='1'`，再运行 `release/win-unpacked/音视频创作策划工作台.exe`。结果写入系统临时目录的 `media-workbench-smoke/smoke-result.json`。

## 当前开发入口

运行 `npm.cmd run dev` 后，在浏览器中可新建项目和导入本地素材；项目文档与素材保存在该浏览器的 IndexedDB 中。浏览器模式不生成 FFmpeg 波形和视频帧缓存。桌面版使用独立的项目目录，两种模式的数据不自动互通。

桌面安装包需要在代码修改后重新运行 `npm.cmd run dist:win` 生成；直接运行 `release/` 中的旧安装包不会包含最新修复。桌面端环境需能正常启动 Electron。
