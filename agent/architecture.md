# 项目作用与结构

音视频创作策划工作台面向个人创作者，在同一画布上组织图片、文字、音频和视频，进行时间标记、裁剪、注释、连线与策划。产品只提供 Electron 桌面应用，优先支持 Windows 离线使用。

## 运行路径

- `npm.cmd run dev`：先构建 Electron 主进程，再启动 Vite 与未安装的 Electron 桌面窗口。Vite 只服务该窗口的界面热更新；主进程修改需重启命令。开发项目默认在忽略提交的 `.runtime/projects/`；Electron 设置、缓存和网络数据保存在 Windows 用户目录的 `media-planning-workbench-dev/`，与正式安装版隔离。
- `npm.cmd run build`：检查 TypeScript，构建界面和桌面进程。开发预览和人工检查统一使用 `npm.cmd run dev`；仅在用户明确确认稳定发布后，才运行 `npm.cmd run dist:win` 准备 FFmpeg 并生成 NSIS 安装包。
- `npm.cmd run verify`：类型检查、单元测试及端到端测试。此命令会启动 Electron，必须在沙箱外执行；`smoke`、`test:e2e`、`dev` 和 `start` 同理。具体复测边界见根目录 `AGENTS.md` 与 `agent/project-rules.md`。

## 目录职责

- `src/core/`：项目文档模型、校验、编辑命令、自动保存和时间刻度；文档是编辑器的单一事实来源。
- `src/ui/`：React 界面、画布、素材库、播放控件、任务状态、语言与设置面板。
- `src/ui/WorkspaceDock.tsx`：图标视图栏、侧栏宽度调整和面板高度调整；媒体工作区位于素材库下方。画布通过 ResizeObserver 跟随可用空间。
- `src/core/appearance.ts`、`src/core/shapeGeometry.ts`、`src/ui/ObjectAppearance.tsx`、`src/ui/ObjectInspector.tsx`：统一处理图形样式、文字、尺寸及图片裁剪；`shapeGeometry.ts` 是固定图库的单一几何来源，画布、工具图标和首页预览均复用它。
- `src/core/theme.ts`、`src/ui/themeStore.ts`、`src/ui/ThemePicker.tsx`：主题 Token（以 oklch 为权威值，含明暗两套）、颜色换算（oklch↔sRGB）、主题持久化与选择界面；`useTheme()` 提供当前 Token，CSS 变量由 `applyCssVars` 注入。设置面板中的“强制播放动画”也由主题存储持久化，并以根节点属性覆盖系统的减少动态效果偏好。
- `src/core/elementStyles.ts`、`src/core/pantone.ts`、`src/ui/ColorEditor.tsx`、`src/ui/ConnectionInspector.tsx`、`src/ui/ShapeIcon.tsx`：元素样式预设、箭头线型/头部样式、Pantone 年度色库、颜色编辑器、连接线样式编辑与工具区形状预览。
- 图库按 General、Basic、Arrows、Flowchart 四类组织，可折叠和搜索；固定的图形标识、工具预览、画布和首页预览复用 `shapeGeometry.ts` 的几何定义，避免预览退化为方块。
- `src/core/note.ts`、`src/ui/NoteEditor.tsx`、`src/ui/SplashScreen.tsx`、`src/ui/GlassFolderCard.tsx`：笔记的单一 Tiptap JSON 正文、稳定批注 mark、项目素材图片节点、笔记编辑器、手写启动画面与玻璃文件夹项目卡片。
- Hello 路径由 `scripts/generate-hello-path.mjs` 从本地 Indie Flower 字体生成，构建和桌面开发入口会自动重建 `src/ui/helloPath.ts`。字体及 OFL 授权保存在 `src/assets/fonts/`；文件夹原版组件保存在 `src/ui/vendor/GlassFolderOriginal.tsx`，项目入口由 `GlassFolderCard` 包装。
- 笔记正文组件按需加载，单个 Tiptap 编辑器管理跨段选区、中文组合输入、粘贴与撤销；图片节点引用项目素材，外部图片粘贴或拖入经受限 IPC 导入后插入光标位置，可调整宽度与左右对齐。批注用稳定 ID mark 锚定，可跨段复用；右侧卡片按实际文字位置避让并以虚线正交连线，滚动、编辑、缩放和版心变化后会重算。引用原文删除后保留批注并标记失效。笔记复制会同步生成独立批注 ID；多个画布缩略图仍可指向同一笔记，双击以阅读模式打开。
- `src/ui/mediaSource.ts`：把项目相对路径映射到 Electron 受限媒体协议；项目读写通过 preload 暴露的受限 API 调用。
- `electron/main.ts`：窗口、协议、设置和 IPC 边界。默认项目根目录保存在 Electron `userData/settings.json`；修改默认目录只影响以后新建的项目。
- 桌面主进程在 `userData/runtime.log` 记录启动、子进程退出和未捕获异常；冒烟与端到端测试使用软件渲染，正常桌面运行保留硬件加速。
- `electron/devDirectories.ts`：计算开发实例的用户数据目录与项目目录，防止 Chromium 缓存落在仓库所在卷。
- `electron/preload.ts`：向渲染进程暴露受限 API；不直接暴露 Node 文件系统。
- `electron/worker.ts`：项目和素材文件读写、媒体时长检测、FFmpeg 缓存任务及恢复快照。
- 首页列表只读项目文档，按修订缓存由实际对象生成的 SVG 预览和 FFmpeg 媒体缩略图；画布预览复现项目保存的最后相机视口，列出项目不切换活动项目。音频波形缓存为透明白色 PNG，画布按轨道颜色即时着色，改色不重新分析素材。
- `scripts/`：桌面构建、媒体工具准备、免安装开发入口与受限范围内的测试产物清理。`dev-desktop.mjs` 在 Windows 下先切换 UTF-8 控制台，再打印 Vite 和 Electron 启动进度并保留子进程日志供排查；`preview-home.mjs` 使用独立临时项目和固定真实图片截取 Hello、文件夹静止与展开状态，供视觉闭环验收。所有脚本可从仓库根目录执行。
- `tests/e2e/` 与 `tests/fixtures/`：端到端用例和固定的小样本素材。测试项目使用独立临时目录，不写入正式用户项目。
- `vendor/`：FFmpeg 授权信息及本机准备的可执行文件。可执行文件不进 Git，打包前由 `prepare:media` 校验和准备。
- `agent/`：本文件、变更记录、完整项目守则 `project-rules.md` 与视觉验收方法 `visual-verification.md`；根目录 `AGENTS.md` 保留入口及 Electron 复测硬性规则。`dist/`、`dist-electron/`、`release/`、`test-results/` 是生成物或临时目录，不是源码；其中 `release/` 仅在取得稳定发布确认后生成。

## 数据边界

项目目录包含 `project.json`、`assets/`、`cache/`、`recovery/`。`project.json` 保存编辑器文档，原始素材复制到 `assets/`，媒体分析结果放在可重建的 `cache/`，`recovery/` 保存恢复快照。当前项目格式为 `schemaVersion: 3`，正文为每篇笔记的一份 Tiptap JSON 文档；后台仅在读取历史文件时统一迁移，校验成功后先在 `recovery/` 备份原件，再原子写入主文件，恢复快照也经过同一迁移入口。笔记图片和画布对象共同参与素材引用校验。界面语言存在 Electron 会话的 localStorage，不写入项目文档。

外部文件拖入后由 preload 的 `webUtils.getPathForFile` 提取路径，通过校验过的 `assets:drop` IPC 复用后台导入；绝对路径不暴露给页面。图片放置前读取自然尺寸，默认锁定比例；裁剪以原图归一化区域保存，只改变显示，不覆盖源文件。对象样式包含填充、渐变、线型、周长间距、透明度和字体属性。

对象移动和尺寸手势使用独立虚影，松开才提交文档，右键、Esc、窗口失焦或释放到画布外取消。素材库与工具使用 Pointer Events 预览放置，避免原生内部拖动吞掉右键。媒体注释只引用已存在标记：选中媒体后按 M 打标，再选中标记拖动其上方连接柄；普通箭头不会隐式创建标记。标记时间在媒体工作区中编辑。
连接线保存在顶层独立图层，样式支持直线、正交折线、曲线、圆角、预设及自定义间隔、起止头部、端点尺寸、透明度与标签。多选连接线的样式修改一次提交为一次撤销，复制对象时保留连接线样式。
