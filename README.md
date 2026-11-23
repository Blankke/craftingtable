<div align="center">

<img src="build/icon.png" alt="CraftingTable 工作台" width="112" />

# CraftingTable · 工作台

**把媒体、想法和笔记，放到同一张创作画布上。**

[![版本](https://img.shields.io/badge/version-0.1.0-5268e8)](https://github.com/Blankke/craftingtable/releases/tag/v0.1)
[![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4)](#下载安装)
[![Linux](https://img.shields.io/badge/Linux-x64-FCC624)](#下载安装)
[![Electron](https://img.shields.io/badge/Electron-45-47848F)](https://www.electronjs.org/)
[![本地保存](https://img.shields.io/badge/storage-local-2E8B57)](#项目文件与备份)

**中文** | [English](README_EN.md)

[下载应用](https://github.com/Blankke/craftingtable/releases/tag/v0.1) · [功能特色](#功能特色) · [快速上手](#快速上手) · [源码构建](#源码构建) · [问题反馈](https://github.com/Blankke/craftingtable/issues)

</div>

CraftingTable 是面向视频、播客、访谈和视觉研究的桌面创作工作台。你可以在画布上排列音频、视频、图片与文字，把笔记连接到录音中的某个时刻，再到笔记工作区整理提纲、素材研究和长篇文稿。

项目保存在自己指定的文件夹中。编辑、媒体分析和保存均在本地完成，安装包自带 FFmpeg 与 ffprobe，方便离线创作。

## 功能特色

| 能力 | 可以做什么 |
| --- | --- |
| 多媒体创作画布 | 拖入音频、视频、图片和文字，与图形、箭头、自由画笔一起组织材料。 |
| 围绕时间组织内容 | 查看波形与视频帧，调整源片段的显示区间和时间比例，添加时间标记，将标记连接到文字批注。 |
| 画布与笔记联动 | 使用标题、列表、待办、表格、图片与链接撰写文稿，支持 Markdown 预览、公式、代码高亮、分屏和 Markdown 导出。 |
| 阅读与批注 | 跨段选择原文、添加批注并回到引用位置，结合全文查找替换、多标签和专注模式整理长篇材料。 |
| 精确编排 | 提供 43 种图形、对齐分布、组合、旋转和样式编辑。标准比例锁保持圆形、正方形及规则多边形。 |
| 连贯的编辑反馈 | 拖动先预览、松开后提交，Esc 可取消；连续数值调整只占一次撤销。修改其他对象时，媒体画面保持稳定。 |
| 可调整的工作空间 | 调整、展开或收起面板，在笔记与画布之间切换，选择明暗主题及中英文界面。 |
| 本地项目管理 | 原始素材随项目保存，自动保存编辑结果，并保留最近有效文档的恢复快照。 |

## 下载安装

前往 **[GitHub Releases](https://github.com/Blankke/craftingtable/releases/tag/v0.1)**，选择适合系统的安装包。

| 系统 | 文件 | 使用方式 |
| --- | --- | --- |
| Windows 10 / 11，x64 | `CraftingTable-0.1.0-win-x64.exe` | 安装版，可选择安装目录。 |
| Windows 10 / 11，x64 | `CraftingTable-0.1.0-win-x64-portable.exe` | 免安装版，直接运行。 |
| Linux，x64 | `CraftingTable-0.1.0-linux-x86_64.AppImage` | 适用于常见桌面发行版的便携包。 |
| Debian / Ubuntu / Linux Mint，x64 | `CraftingTable-0.1.0-linux-amd64.deb` | 使用系统包管理器安装。 |
| Fedora，x64 | `CraftingTable-0.1.0-linux-x86_64.rpm` | RPM 安装包。 |

Linux 面向使用 glibc 的现代桌面系统，以 Ubuntu 22.04/24.04、Debian 12、Linux Mint 21/22 等系统系列为兼容目标；具体实测环境见 Release 说明。本次提供 x64 产物，ARM64 与 Alpine/musl 需单独适配。

```bash
# AppImage：增加执行权限后，以普通桌面用户运行。
chmod +x CraftingTable-0.1.0-linux-x86_64.AppImage
./CraftingTable-0.1.0-linux-x86_64.AppImage

# Ubuntu / Debian / Mint
sudo apt install ./CraftingTable-0.1.0-linux-amd64.deb

# Fedora
sudo dnf install ./CraftingTable-0.1.0-linux-x86_64.rpm
```

系统没有 FUSE 时，可使用 `./CraftingTable-0.1.0-linux-x86_64.AppImage --appimage-extract-and-run`，也可安装 DEB/RPM。请使用普通桌面用户启动应用。下载页附带 `SHA256SUMS.txt` 校验文件；Windows 包未配置代码签名证书，系统可能提示确认发布者。

## 快速上手

1. 在首页新建项目，需要时到“设置”更改默认项目文件夹。
2. 导入素材，或从文件管理器将媒体文件拖入画布。
3. 选中媒体轨道、定位播放头，按 **M** 添加标记；选中标记后，从连接柄拖出文字批注或连接已有文字。
4. 切换到“笔记”撰写提纲、整理资料或阅读转录文稿；双击画布上的笔记缩略图即可打开正文。
5. 双击文本框、形状或媒体批注直接输入文字，点击“完成”、按 **Ctrl+Enter** 或点击外部保存，**Esc** 取消本次输入。在“编辑”面板修改样式、位置与尺寸；规则图形可开启“锁定标准比例”。

在画布上按 **Ctrl+V** 可直接粘贴文字或图片。文字生成 320px 宽、无填充无边框的文本框，内容增加时自动增高；图片同时加入素材库并保存在项目 `assets/` 中。画布文字支持 Markdown 输入和粘贴，标题、粗斜体、列表、待办、引用、代码与表格转换为可编辑格式。形状文字默认居中，长文字向上下延伸，图形尺寸保持不变；“双击编辑文字”提示在输入时消失。切换明暗主题会立即适配已有元素的文字、填充和线条配色。

多选至少两个图片或叠图后，右键选择“收起为叠图”，已有叠图可继续合并其他图片或叠图。点击叠图上的“查看”或双击，使用双页翻动效果浏览；当前图片按原比例适应大窗口。使用滚轮、右上角按钮或 **+ / −** 缩放（相对适应尺寸的 50%～500%），放大后拖动查看细节，按 **0** 或“适应窗口”复位。适应大小时可拖动翻页，方向键、翻页按钮和缩略图列表始终可切换图片，切换后自动适应新图。每张图片下方可添加独立备注，浏览时直接显示，并随项目保存。右键“拆开叠图”可还原图片，备注、裁剪和连线继续保留；**Ctrl+Z** 可一次撤销收起、继续合并或拆开，备注修改也可撤销。

双击工具栏的箭头、画笔或文字可持续使用，按钮显示图钉标记；按 **Esc** 或切换工具退出。持续文字工具支持在画布上点击或拖出文本框，输入完成后可继续放置；工具按钮聚焦时 **Shift+Enter** 也可启用持续使用。单击保留原有行为：箭头画完回到选择，文字创建一个文本框，画笔可连续绘制。画布选区使用固定屏幕粗细的实线和角点，缩小画布后仍可辨认。

画布对象右键提供删除、剪切、复制、粘贴、副本、复制为图像／SVG、组合、锁定、层级移动和样式编辑；图片可直接打开裁剪，笔记卡片可打开正文。对象信息、外部链接和自定义连接点也可从菜单编辑。默认样式按对象类型保存在本机，应用于之后创建的同类对象。空白区域右键可全选、粘贴、撤销和重做。

笔记与画布正文共用文字右键菜单，可设置格式、段落、链接、列表、表格及纯文本粘贴；笔记另有查找、图片、批注和移动选区到其他笔记。移动操作可通过顶栏撤销同时恢复两篇内容。方向键可操作菜单，**Shift+F10** 打开菜单，**Esc** 关闭并返回编辑区。

| 操作 | 快捷键 |
| --- | --- |
| 剪切／复制／粘贴；副本 | Ctrl+X／C／V；画布 Ctrl+D |
| 组合／取消组合；锁定／解锁 | 画布 Ctrl+G／Ctrl+Shift+G；Ctrl+L |
| 上移／下移一层；置顶／置底 | Ctrl+]／[；Ctrl+Shift+]／[ |
| 粗体／斜体／下划线 | Ctrl+B／I／U |
| 左／中／右对齐 | Ctrl+Shift+L／E／R |
| 增大／减小字号 | Ctrl+Shift+>／< |
| 删除线／行内代码／清除格式 | 正文 Ctrl+Shift+X／Ctrl+E／Ctrl+\ |
| 无序／有序／待办列表 | 正文 Ctrl+Shift+8／7／9 |
| 标题 1–6／普通段落 | 正文 Ctrl+Alt+1–6／Ctrl+Alt+0 |
| 编辑链接；纯文本粘贴 | 正文 Ctrl+K；Ctrl+Shift+V |
| 撤销／重做 | Ctrl+Z／Ctrl+Y 或 Ctrl+Shift+Z |

拖放操作显示虚影，松开提交，右键或 **Esc** 取消。**Ctrl+S** 保存，**Ctrl+Z** 撤销，项目名称旁显示保存状态。面板大小、收藏与主题偏好保存在本机。

可导入 TXT、MD、PNG、JPEG、WebP、GIF、BMP、MP3、WAV、M4A、AAC、OGG、FLAC、MP4、MOV、MKV、WebM。实际播放取决于文件编码，同一容器中的不同编码可能有不同的播放支持情况。

## 项目文件与备份

```text
我的项目/
├── project.json   # 画布、笔记、标记与连接关系
├── assets/        # 原始素材副本
├── cache/         # 可重新生成的波形、缩略图
└── recovery/      # 恢复快照
```

默认新项目位于用户“文档/工作台”目录。备份或搬移时，复制完整项目文件夹，再从首页选择“打开项目文件夹”。图片裁剪和媒体区间调整会保留源文件；素材缺失时，可在素材库中“重新关联”。

## 源码构建

需要 **Node.js 22.21+** 和 npm。Windows 与 Linux 应分别安装依赖，Electron 等构建工具包含平台专用二进制文件。

```bash
npm ci
npm run prepare:media
npm run dev
```

PowerShell 的执行策略限制 `npm.ps1` 时，使用 `npm.cmd`。`dev` 启动 Electron 窗口和 Vite 热更新；修改界面自动刷新，修改 `electron/` 或共享项目格式后需关闭开发窗口并重新运行命令。开发项目默认写入 `.runtime/projects/`，开发版和安装版的应用设置分开保存。

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 类型检查，构建界面与桌面进程。 |
| `npm run test:unit` | 类型检查与单元测试。 |
| `npm run smoke` | 用实际桌面进程验证项目读写、媒体和恢复。 |
| `npm run verify` | 单元测试、工程脚本测试及 Electron 端到端测试。 |
| `npm run profile:performance -- sample` | 用 300 个富文本对象测量撤销历史内存、排版/配色耗时及滚轮帧耗时；结果与截图写入 `test-results/performance/`。 |
| `npm run visual:release` | 复现媒体稳定性、比例锁、图标及开屏验收，覆盖两种主题和缩放。 |
| `npm run dist:win` | 在 Windows 构建安装版与便携版 EXE。 |
| `npm run dist:linux` | 在 Linux 构建 AppImage、DEB、RPM；需要 `binutils`（ar）、`rpm`/`rpmbuild` 和 `xz-utils`。 |
| `npm run dist:linux:docker` | 使用 Docker 在隔离的 Debian 环境构建 Linux 包。 |
| `npm run release:checksums` | 为当前版本的安装包生成校验文件。 |
| `npm run clean -- --dry-run` | 预览可清理的构建及验收产物。 |

发布产物输出到 `release/`。媒体工具的固定版本、下载地址及 SHA-256 保存在 `scripts/build/media-tools.json`，构建会核验归档和已提取的工具。受代理管理的网络可通过 `HTTP_PROXY`、`HTTPS_PROXY` 配置代理。Docker 构建支持 `CRAFTINGTABLE_NODE_IMAGE`、`CRAFTINGTABLE_DEBIAN_MIRROR` 和 `CRAFTINGTABLE_BUILD_NETWORK`；Electron 镜像可通过 `ELECTRON_MIRROR` 配置，下载仍按官方校验值核验。

桌面测试需要实际桌面会话，或原生 Linux CI runner 上的 Xvfb。Docker 构建负责编译和打包，桌面验收在宿主机运行。截图与临时结果输出到 `test-results/`。

验证已打包程序：

```powershell
# Windows PowerShell
node scripts/test/smoke-desktop.mjs --executable=release/win-unpacked/工作台.exe
# 直接在打包程序中复测文本框、形状和媒体批注的双击输入
$env:WORKBENCH_TEST_EXECUTABLE = 'release/win-unpacked/工作台.exe'
npx playwright test tests/e2e/canvas-text.spec.ts
Remove-Item Env:WORKBENCH_TEST_EXECUTABLE
# 在未安装工作台的测试用户中验证 NSIS 安装、图标、离线媒体与卸载
powershell -ExecutionPolicy Bypass -File scripts/test/verify-windows-package.ps1
```

```bash
# Linux 桌面环境
node scripts/test/smoke-desktop.mjs --executable=release/linux-unpacked/craftingtable
```

## 项目结构

| 目录 | 职责 |
| --- | --- |
| `src/core/` | 文档模型、编辑命令、图形几何及媒体分析调度。 |
| `src/ui/` | 画布、笔记、媒体、主题和工作区面板。 |
| `electron/` | 桌面窗口、受限 IPC、项目存储和媒体后台。 |
| `scripts/` | 可复现的开发、构建、测试、视觉验收及维护入口。 |
| `tests/` | 桌面用例、真实媒体样本及工程脚本测试。 |
| `build/`、`vendor/` | 应用图标、媒体工具和第三方授权信息。 |

## 反馈与致谢

反馈问题时，请提供系统版本、应用版本、复现步骤，以及应用用户数据目录中 `runtime.log` 的相关片段。问题入口：[Blankke/craftingtable Issues](https://github.com/Blankke/craftingtable/issues)。

项目使用 Electron、React、Konva、Tiptap、Markdown-it、KaTeX、highlight.js 和 FFmpeg。第三方组件归属见 [vendor/NOTICE.txt](vendor/NOTICE.txt)，媒体工具随包提供许可证与对应源码信息；手写开屏使用 [Indie Flower 字体](src/assets/fonts/OFL.txt)。
