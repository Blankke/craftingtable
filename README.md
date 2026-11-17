# 音视频创作策划工作台

Windows 优先的离线桌面工作台。当前开发版已实现项目读写、画布编辑、音视频轨道、素材缩略预览、时间标记、裁剪、播放、自动保存和恢复。桌面端运行仍需在目标 Windows 环境验收。

## 环境

- Node.js 20 以上、npm。
- Windows x64。
- 若agent在wsl中运行，请调用powershell.exe来执行命令，或在 Windows 终端中切换到 PowerShell 选项卡。
- 获得人工稳定发布确认后，`npm run dist:win` 会自动运行 `scripts/prepare-media.ps1`，下载并校验固定版本的 FFmpeg 与 ffprobe，放入 `vendor/`。

## 直接预览桌面界面

在仓库根目录运行：

```powershell
npm.cmd run dev
```

此命令先把 `electron/` 下的主进程、preload 和后台程序编译到 `dist-electron/`，然后启动 Vite 与 **Electron 桌面窗口**。Vite 仅作为窗口内部的界面热更新服务，不提供浏览器项目模式。开发入口会将 Windows 控制台切换为 UTF-8，并输出界面服务、窗口创建和页面加载状态。窗口打开后命令会持续运行；按 `Ctrl+C` 关闭预览。修改 `src/` 中的界面代码会热更新，修改 `electron/` 后需要停止并重新运行命令。

`dev` 不安装软件，也不生成安装包。当前工作区已有 `node_modules/` 时，无需再次安装依赖。若是全新检出的仓库且没有 `node_modules/`，需先用 `npm.cmd ci` 安装项目依赖一次。仅查看空白界面不需要安装 FFmpeg；导入音视频并生成缩略图、波形或时长时需要 FFmpeg/ffprobe，可运行 `npm.cmd run prepare:media` 准备。

开发实例默认把新项目放在 `.runtime/projects/`，可以在顶部“设置”中改为其他文件夹；同处的“强制播放动画”开启后会忽略系统的“减少动态效果”偏好。Electron 的设置、缓存和网络数据保存在开发环境的用户配置目录中，正式安装版使用独立的数据目录。

如果终端暂时只显示启动命令，请等待界面服务和窗口加载状态输出。若窗口创建成功但未显示，检查系统窗口切换与已有实例；若出现“界面加载失败”“界面进程异常退出”或 `GPU process exited`，保留完整终端输出和 `runtime.log` 以便定位。`Port 5173 is in use, trying another one` 表示 Vite 自动换端口，通常不影响窗口启动。

需要检查编译是否成功，可以单独运行 `npm.cmd run build`；此命令不打开窗口。`npm.cmd run start` 运行最近一次构建的桌面程序，不提供热更新。
构建会先运行 `scripts/generate-hello-path.mjs`，用 `src/assets/fonts/handwriting.ttf` 生成离线 Hello 路径；字体授权见同目录 `OFL.txt`。视觉核对可在构建后、沙箱外运行 `node scripts/preview-home.mjs`，脚本会导入固定真实图片并输出 Hello、文件夹静止与展开截图到忽略提交的 `test-results/`；完整比较方法与验收标准见 `agent/visual-verification.md`。
开屏字形依据用户提供的 [Handwriting SVG](https://21st.dev/@pulkitxm/components/handwriting-svg) 组件及其 Indie Flower 字体；首页文件夹使用用户提供的 [Glass Folder Cards（@kedhareswer）](https://21st.dev/@kedhareswer/components/glass-folder-cards) 源码适配。
字体的 OFL 授权和文件夹组件的 MIT 授权均随安装包置于 `vendor/` 资源目录。
桌面进程将启动和异常退出信息写入 Electron 用户数据目录下的 `runtime.log`。遇到异常弹窗时保留该日志，以区分 GPU、界面和后台进程异常。冒烟与端到端测试使用软件渲染；桌面验收应在目标系统环境执行。

## 工作台编辑

- 从资源管理器拖入文字文件、图片、音频、视频，会同时加入项目素材库并放到鼠标释放位置；也可拖入外部选中的纯文字。支持 TXT、MD、PNG、JPEG、WebP、GIF、BMP、MP3、WAV、M4A、AAC、OGG、FLAC、MP4、MOV、MKV、WebM，播放能力取决于文件编码。
- 拖动工具、素材或画布对象时显示半透明虚影，松开后放置；右键或 Esc 取消。媒体轨道通过顶部标题区域移动，波形区域用于定位播放时间。
- 单击媒体，按 `M` 添加标记，再单击橙色标记；从其上方蓝色圆点拖出笔记，可连接已有文字。播放、显示长度、时间裁剪及标记时间/说明都在右侧“媒体工作区”。
- 右侧图标分别开关工具、素材库、对象面板。拖动侧栏左边缘改变宽度，拖动面板之间的水平分隔线只调整相邻两块高度；侧栏宽度与面板高度保存在用户配置中，所有项目共享。
- 图片初次放置保持原图比例。在“对象 → 排列”调整尺寸、锁定/解锁比例、按原图百分比裁剪或恢复原图。画布选中框右下角也可缩放；裁剪不会覆盖素材文件。
- 工具提供固定的 43 种基础图形，按 General、Basic、Arrows、Flowchart 分组，可搜索和折叠；工具图标、拖动虚影、画布和首页封面复用同一份几何定义。双击形状或文字编辑内容；“编辑 → 样式”设置填充、渐变、线条颜色/宽度/虚线、周长间距和不透明度；“文本”设置字体、字号、颜色、粗斜体、下划线和对齐；“排列”调整位置、大小、旋转、对齐、分布、层级和分组。此实现参考 draw.io 的编辑方式，不涉及 draw.io 文件导入。
- 首页文件夹显示项目画布、媒体和笔记的实际预览，空项目显示空态。音频以单声道 PCM 峰值缓存绘制波形，改色、裁剪与时间缩放都只重采样，不重新分析源文件。
- 笔记在素材区可复制、删除或拖入画布；同一笔记的多个画布缩略图共享正文。双击缩略图进入阅读模式，选字后浮动菜单可统一单色划线或添加批注；编辑删去引用原文时批注保留并显示失效提示。顶部圆角“开始”组调整选区字体/字号与整篇行距/版心。

## 验证和构建命令

```powershell
npm.cmd run clean:test
npm.cmd run verify
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run start
npm.cmd run smoke
```

`verify` 依次执行 TypeScript、Vitest 和 Playwright 桌面端到端测试；`test:e2e` 可单独运行，会先准备固定版本媒体工具，使用独立临时项目目录，不会下载浏览器。测试样本包含 6 种素材、4 条媒体轨道、43 个画布对象与嵌套分组。也可用 `powershell -ExecutionPolicy Bypass -File scripts/build.ps1` 执行完整回归验证；开发预览与人工检查统一使用 `npm.cmd run dev`。

`clean:test` 只清除仓库内的 Playwright 结果、旧安装冒烟目录和打包调试配置，不删除测试样本、已构建程序或安装包。协作资料与目录职责见根目录 `AGENTS.md` 和 `agent/`。

桌面版默认将新建项目保存在用户“文档/音视频创作策划工作台”目录。首页或编辑页顶部的“设置”可指定后续新建项目的保存文件夹，并切换简体中文或英语；更改默认目录不搬移已有项目。首页点击“+”可新建项目，或选择“打开项目文件夹”打开搬移后的项目。每个项目包含 `project.json`、`assets/`、`cache/`、`recovery/`。主文件损坏时会读取最近有效恢复快照，并自动保存到主文件；保存失败会在界面提示并允许重试。

取得人工稳定发布确认后，Windows 安装包输出到 `release/`。在此之前不生成或保留安装包，人工检查使用 `npm.cmd run dev`。冒烟模式会验证项目读写、六种素材导入、导入中断残留清理、图片/音频/视频缩略预览、媒体时长探测、Chromium 的资源解码和视频播放、时间标记与对象箭头、不支持媒体的错误提示、后台异常重启与保存重试、恢复快照以及项目文件夹搬移。媒体工具及许可证来自 [Gyan 的 FFmpeg Windows 构建](https://www.gyan.dev/ffmpeg/builds/)，随包版权信息见 `vendor/NOTICE.txt`。

验证解包程序时，在 PowerShell 中设置 `$env:WORKBENCH_SMOKE='1'`，再运行 `release/win-unpacked/音视频创作策划工作台.exe`。结果写入系统临时目录的 `media-workbench-smoke/smoke-result.json`。

人工明确宣布可发布后，运行 `npm.cmd run dist:win` 生成 Windows 安装包并验收；日常开发与桌面预览使用 `npm.cmd run dev`。运行桌面预览要求目标系统能够正常启动 Electron。
