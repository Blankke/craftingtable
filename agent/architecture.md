# 项目作用与结构

工作台面向个人创作者，在同一画布上组织图片、文字、音频和视频，进行时间标记、裁剪、注释、连线与策划。产品只提供 Electron 桌面应用，支持 Windows 与 Linux x64 离线使用。

## 运行路径

- `npm.cmd run dev`：先构建 Electron 主进程，再启动 Vite 与未安装的 Electron 桌面窗口。Vite 只服务该窗口的界面热更新；主进程修改需重启命令。开发项目默认在忽略提交的 `.runtime/projects/`；Electron 设置、缓存和网络数据保存在 Windows 用户目录的 `media-planning-workbench-dev/`，与正式安装版隔离。
- `npm.cmd run build`：检查 TypeScript，构建界面和桌面进程。开发预览和人工检查统一使用 `npm.cmd run dev`；仅在用户明确确认稳定发布后，才运行 `npm run dist:win` 生成 NSIS 与便携 EXE，或 `npm run dist:linux` 生成 AppImage、DEB、RPM；`dist:linux:docker` 在 Debian 12 隔离构建并复制产物，桌面验收在宿主机执行。
- `npm.cmd run verify`：类型检查、单元测试及端到端测试。此命令会启动 Electron，必须在沙箱外执行；`smoke`、`test:e2e`、`dev` 和 `start` 同理。具体复测边界见根目录 `AGENTS.md` 与 `agent/project-rules.md`。

## 目录职责

- `src/core/mediaAnalysis.ts` 与 `src/ui/media/useMediaAnalysis.ts`：每条轨道按媒体输入独立调度，后台读取编辑器最近提交的文档；无关编辑与数值预览不取消任务，新抽帧完成前保留已有结果，过期响应不能覆盖新任务。
- `src/core/`：项目文档模型、校验、编辑命令、自动保存和时间刻度；文档是编辑器的单一事实来源。自动保存保留载入修订号，并在订阅建立时检查当前快照，覆盖首帧快速操作。
- `src/ui/`：`App.tsx` 编排应用；`home/`、`notes/`、`canvas/`、`media/`、`theme/`、`workspace/` 分别组织首页、笔记、画布、媒体、主题和分栏；共用控件、语言与设置放在 `shared/`，全局样式放在 `styles/`。测试与模块就近放置，避免平铺或重复入口。
- `src/types/`：第三方 Markdown 插件的补充类型声明；Vite 环境和桌面桥接声明保留在 `src/vite-env.d.ts`。
- `src/ui/workspace/WorkspaceDock.tsx`、`src/ui/workspace/dockLayout.ts`：顶部视图开关、侧栏收起、面板展开/还原与分栏；每块面板由固定标题和独立滚动内容组成。侧栏宽度与三块面板高度写入 localStorage；高度分配先满足最小值，再按比例分配剩余空间，拖动只调整相邻两块。画布 ResizeObserver 在切换模式后重新订阅可用空间。
- `src/ui/shared/EditorControls.tsx`：共用图标按钮和分隔拖柄，支持 Pointer Capture、方向键、Shift 加速、Home/End、宽度双击复位、Esc/失焦取消；拖动结束与卸载时恢复鼠标和选区样式。
- `src/ui/styles/workspace.css`：笔记与画布面板的实色表面、分栏、边界和响应式布局。玻璃材质只用于首页文件夹；线性图标统一使用 Lucide，下划线标签按 21st / Origin UI with-line 的几何和状态适配，授权保存在 `vendor/OriginUI-MIT.txt`。
- `src/ui/workspace/WorkspaceModeSwitch.tsx`：基于 21st / Halaska Segmented Control 的笔记/画布单选切换器，以图标文字和独立底板表达模式；ResizeObserver 根据按钮真实尺寸定位底板，鼠标切换使用 350ms 过渡，键盘即时切换。方向键、Home/End 与单个 Tab 入口遵循 radiogroup 语义，主题和减少动态效果使用项目统一设置；`App` 显式持有模式。
- `src/core/appearance.ts`、`src/core/shapeGeometry.ts`、`src/ui/canvas/ObjectAppearance.tsx`、`src/ui/canvas/ObjectInspector.tsx`：统一处理图形样式、文字、尺寸及图片裁剪；`shapeGeometry.ts` 是固定图库的单一几何来源，画布、工具图标和首页预览均复用它。
- `src/core/richText.ts`：笔记与画布共用的结构化正文契约；`canvasText.ts` 负责画布 Markdown 导入、纯文本提取和安全 HTML 输出。`CanvasTextEditor.tsx` 为画布与侧栏提供同一 Tiptap 输入组件；`canvasTextLayout.ts` 和 `canvasText.css` 统一 DOM 测量、编辑排版及 SVG 字形。字形作为 Konva 图片绘制，遵循对象叠放顺序；文本框增高与正文修改在同一编辑事务中完成，形状只扩展文字绘制范围。
- `src/ui/shared/ContextMenu.tsx`、`CommandDialog.tsx` 统一右键浮层与字段对话框；菜单支持子菜单翻转、窗口限位、滚动、键盘和焦点返回。`RichTextContextMenu.tsx` 保存并同步恢复 ProseMirror 焦点与选区，字段对话框在解除模态后执行恢复，避免下一帧 focus 覆盖后续按键产生的选区；`FormattingShortcuts.ts` 统一笔记和画布正文快捷键；剪贴板命令通过主进程固定白名单调用，PNG/SVG 使用当前 Electron ClipboardItem 原子写入多种格式。Electron 45 的 `image/*` 写入路径仅解码位图，SVG 通过 `electron application/osclipboard` 写入 Chromium 对应的原生格式（Windows/Linux 为 `image/svg+xml`，macOS 为 `public.svg-image`），同时保留 PNG 和纯文本。
- `src/core/canvasColors.ts`：按主题背景和对象填充派生显示色，以 OKLCH 亮度调整补足文字及线条对比度；保留项目原始配色，切换主题不增加修订，也不改图片和视频像素。
- `src/ui/canvas/interactionStore.ts` 统一持有工具及持续使用状态；双击或工具按钮上的 Shift+Enter 启用，创建完成通过 `finishTool` 决定保留工具，Esc、显式切换及项目切换清除状态。`CanvasStage` 支持持续文本的点击/拖框与原位输入；选区在独立顶层绘制，轮廓、角点及缩放柄按相机比例反算尺寸，保持固定屏幕线宽并独立于对象透明度。
- `CanvasObjectMenu.tsx` 提供所有画布对象及连接线的右键入口，按选区能力显示剪贴板、组合、锁定、层级、样式、数据、链接、连接点和叠图操作；`ImageStackViewer.tsx` 通过原生模态对话框承载用户提供的 `vendor/JournalSpreadCarousel.tsx` 双页折叠组件。图片使用项目素材协议，每图备注通过编辑器连续预览、失焦或翻页一次提交；浏览器支持拖动、方向键、缩略图列表、明暗主题和减少动态效果，模态内输入不触发画布快捷键。查看器使用 96vw/96vh 可用窗口，按当前图片自然比例适应；缩放与平移只存在本地组件状态，围绕指针缩放并限制拖动边界，放大后拖动当前图片，翻页重置缩放。尺寸观察与翻页帧循环独立清理，避免图片比例变化打断动画。
- `src/core/waveform.ts`：单声道 PCM 峰值聚合、带版本头的二进制缓存编解码与按屏幕像素重采样（包含相机缩放与设备像素比），后台 worker 与渲染端共用；删除固定 PNG 波形方案。
- `src/core/theme.ts`、`src/ui/theme/themeStore.ts`、`src/ui/theme/ThemePicker.tsx`：主题 Token（以 oklch 为权威值，含明暗两套）、颜色换算（oklch↔sRGB）、主题持久化与选择界面；`useTheme()` 提供当前 Token，CSS 变量由 `applyCssVars` 注入。设置面板中的“强制播放动画”也由主题存储持久化，并以根节点属性覆盖系统的减少动态效果偏好。
- `src/core/elementStyles.ts`、`src/core/pantone.ts`、`src/ui/theme/ColorEditor.tsx`、`src/ui/canvas/ConnectionInspector.tsx`、`src/ui/canvas/ShapeIcon.tsx`：元素样式预设、箭头线型/头部样式、Pantone 年度色库、统一颜色弹层（主题色/Pantone/自定义）、连接线样式编辑与工具区无填充描边轮廓预览。
- 图库按 General、Basic、Arrows、Flowchart 四类组织，可折叠和搜索；固定的图形标识、工具预览、画布和首页预览复用 `shapeGeometry.ts` 的几何定义，避免预览退化为方块。
- `src/core/note.ts`、`src/ui/notes/NoteEditor.tsx`：单一 Tiptap JSON 正文、稳定批注 mark、textStyle 字体/字号、BubbleMenu、项目图片节点；语义标题、列表、待办、表格、链接和文本格式由 Tiptap 扩展实现，`noteMarkdown.ts` 统一生成阅读 HTML、字符位置映射和保留源语法的 Markdown；Markdown-it 承担语义解析，KaTeX 与 highlight.js 处理公式和代码。导出经 `notes:export` IPC 与系统另存为对话框写盘。
- `src/ui/notes/NotesWorkspace.tsx`：笔记导航、标题/正文搜索、收藏、多标签、新建/复制/删除及可调整导航宽度。收藏与导航宽度是本机偏好，正文仍写入项目；显示宽度和拖柄上限按可用空间同步限幅。
- `src/ui/notes/NoteSearch.ts`：跨格式文字查找与 ProseMirror 装饰，匹配索引对应原始 Unicode 文本。替换通过单次事务完成并隔开撤销历史；查找高亮不写入正文。
- `src/ui/home/SplashScreen.tsx`、`src/ui/home/splashStore.ts`、`src/ui/home/GlassFolderCard.tsx`：一次性手写启动画面与玻璃文件夹项目卡片。
- Hello 路径由 `scripts/build/generate-hello-path.mjs` 从本地 Indie Flower 字体以 288px 字号居中生成，构建和桌面开发入口会自动重建 `src/ui/home/helloPath.ts`。字体及 OFL 授权保存在 `src/assets/fonts/`；文件夹原版组件保存在 `src/ui/home/vendor/GlassFolderOriginal.tsx`，项目入口由 `GlassFolderCard` 包装。
- 笔记正文组件按需加载，单个 Tiptap 编辑器管理跨段选区、中文组合输入、粘贴与撤销；选择、粘贴或拖入的图片经受限 IPC 导入后插入光标位置，支持尺寸与对齐。图片工具条锚定真实图片，并跟随滚动/尺寸/对齐更新，限制在正文边界内。批注通过稳定 ID mark 锚定，辅助栏按列表呈现，点击定位原文；引用删除后保留批注并标记失效，删除批注同步清除正文 mark。复制笔记生成独立批注 ID；画布缩略图共享正文，双击以阅读模式打开。外部正文先用当前 schema 规范化再比较，菜单布局事务不触发 React 正文重绘；焦点离开正文及浮动菜单时关闭菜单，避免选区恢复和层级遮挡问题。
- `src/ui/media/mediaSource.ts`：把项目相对路径映射到 Electron 受限媒体协议；项目读写通过 preload 暴露的受限 API 调用。画布图片与视频帧先读取协议响应，再通过当前页面的 Blob URL 解码，避免跨协议图片污染 Canvas 并使图像导出失败；请求和临时 URL 随组件生命周期清理。
- `electron/main.ts`：窗口、协议、设置和 IPC 边界。默认项目根目录保存在 Electron `userData/settings.json`；修改默认目录只影响以后新建的项目。
- 桌面主进程在 `userData/runtime.log` 记录启动、子进程退出和未捕获异常；冒烟与端到端测试使用软件渲染，正常桌面运行保留硬件加速。设置 `WORKBENCH_E2E_ROOT` 的测试窗口禁用宿主机鼠标命中及原生焦点，并关闭后台节流；Playwright 仍通过 DevTools 注入真实页面事件，避免外部鼠标移动打断拖动、菜单和文字编辑。
- `electron/devDirectories.ts`：计算开发实例的用户数据目录与项目目录，防止 Chromium 缓存落在仓库所在卷。
- `electron/preload.ts`：向渲染进程暴露受限 API；不直接暴露 Node 文件系统。
- `electron/worker.ts`：项目和素材文件读写、媒体时长检测、FFmpeg 缓存任务及恢复快照。
- 首页列表只读项目文档，按修订缓存由实际对象生成的 SVG 预览和 FFmpeg 媒体缩略图；画布预览复现项目保存的最后相机视口，列出项目不切换活动项目。音频波形缓存为带版本头的单声道 PCM 峰值二进制文件，画布按裁剪区间与 pixelsPerSecond 重采样到像素列并以单条 Konva Shape 绘制 1px 峰值线，改色与时间缩放不重新分析素材。
- `electron/mediaTools.ts`：主进程与后台共用平台媒体工具路径；开发使用 `vendor/win-x64` 或 `vendor/linux-x64`，发行包放在 resources/vendor。`scripts/build/prepare-media.mjs` 依据固定下载清单校验归档和工具 SHA-256，支持断点续传。
- `scripts/build/`：Electron 编译、Hello 路径、图标生成和媒体工具准备；`scripts/dev/`：免安装桌面入口；`scripts/test/`：完整回归与冒烟入口。所有 npm 命令从仓库根目录运行，脚本资源路径随目录统一更新。
- `scripts/test/smoke-desktop.mjs`：开发与打包程序共用冒烟入口；每次使用独立项目目录并核对本次结果。Windows 安装验收脚本在临时目录完成安装、图标、冒烟与卸载，图标提取使用独立进程避免资源句柄占用 EXE。
- `scripts/visual/`：首页、工作台、模式切换及发布修复的可复现验收脚本，默认使用 Electron。工作台脚本的 `--browser` 使用内存 IPC 夹具，仅作为 UI 检查。截图存入 `test-results/`，脚本退出时释放本次临时项目。
- `scripts/maintenance/clean.mjs`：`clean:test` 只清理截图和测试报告；`clean` 同时清理构建输出、Vite 缓存、媒体解压副本与旧渲染缓存，`--dry-run` 只预览。固定白名单保留用户项目、本机设置、依赖、媒体可执行文件与下载归档，预检所有目标及父目录以拒绝符号链接或目录联接。
- `tests/e2e/` 与 `tests/fixtures/`：端到端用例和固定的小样本素材。测试项目使用独立临时目录，不写入正式用户项目；`canvas-text.spec.ts` 可通过 `WORKBENCH_TEST_EXECUTABLE` 指定打包程序，在发布产物中复测双击输入、保存、撤销及标记连接；`tests/tooling/` 验证清理工具的范围、预览及目录联接边界，并纳入 `verify`。
- `build/`：应用图标；源图位于 `build/source/`，可用 `scripts/build/make-icon.ps1` 重新生成。
- `vendor/`：FFmpeg 授权信息及按需准备的可执行文件。可执行文件不进 Git，打包前由 `prepare:media` 校验和准备。
- `agent/`：本文件、变更记录、完整项目守则 `project-rules.md` 与视觉验收方法 `visual-verification.md`；根目录 `AGENTS.md` 保留入口及 Electron 复测硬性规则。`dist/`、`dist-electron/`、`release/`、`test-results/` 是生成物或临时目录，不是源码；其中 `release/` 仅在取得稳定发布确认后生成。

协作资料按用途分层：`agent/` 保存项目自写约束、美术方向和技能职责；使用与构建说明放在 `README.md`。外来 skill 安装在 Codex 用户级技能目录，读取方式与职责见 `agent/ui-design-workflow.md`。

## 数据边界

项目目录包含 `project.json`、`assets/`、`cache/`、`recovery/`。`project.json` 保存编辑器文档，原始素材复制到 `assets/`，媒体分析结果放在可重建的 `cache/`，`recovery/` 保存恢复快照。当前项目格式为 `schemaVersion: 4`，笔记、文本框和形状正文统一使用 Tiptap JSON 文档；后台仅在读取历史文件时统一迁移，校验成功后先在 `recovery/` 备份原件，再原子写入主文件，恢复快照也经过同一迁移入口。历史画布普通文字按字面保留，默认编辑提示转为空正文。笔记图片和画布对象共同参与素材引用校验。界面语言存在 Electron 会话的 localStorage，不写入项目文档。

创建或打开前通过 `settings:get.documentSchemaVersion` 核对桌面进程与界面格式，开发进程过期时提示重启；失败时清理后台活动项目。关闭保存监听覆盖整个 App 生命周期，首页也能响应；关闭前先让当前输入失焦提交，再刷新保存队列。主进程防止重复关闭请求；真正保存失败时允许返回编辑或主动放弃未保存修改。

首页列表统一通过带请求序号的刷新入口更新，过期响应不覆盖最新列表。确认删除后按路径防止重复提交，成功即移除卡片并刷新真实目录；主进程先验证项目属于根目录，再允许已不存在的目录重复删除，外部路径仍拒绝。

叠图使用 `imageStack` 对象，`images` 内保存至少两张图片的完整数据及相对封面的位置；图片的可选 `caption` 是独立备注，拆开后保留。内部图片 ID 仍参与全局唯一性、连线和素材引用校验，`objectMemberIds` 与 `objectAssetIds` 统一处理容器内引用；复制时重建内部 ID，删除时清除相关连线。多选可混合图片与叠图，继续合并时展开为同一层图片列表，原容器连线映射到对应封面身份。合并与拆开共用世界坐标换算以保留移动、缩放和旋转，各为一次可撤销的编辑命令；首页预览和画布均使用真实封面。查看器当前图片平展且移除书脊高光，以半像素重叠消除两页之间的接缝，翻页时仍保留折叠运动。

外部文件拖入后由 preload 的 `webUtils.getPathForFile` 提取路径，通过校验过的 `assets:drop` IPC 复用后台导入；绝对路径不暴露给页面。图形可开启标准比例锁，矩形、椭圆、菱形保持 1:1，三角形、六边形和五角星按几何外接框比例缩放；数值输入与画布手柄共用尺寸函数。图库 SVG 为描边预留边界并使用固定线宽，避免四边裁切。图片放置前读取自然尺寸，默认锁定比例；裁剪以原图归一化区域保存，只改变显示，不覆盖源文件。对象可保存锁定状态、名称、说明、外部链接和最多 32 个归一化连接点；连线锚点可引用对象内稳定 pointId，位置和旋转实时参与解析。锁定保护删除、移动、尺寸、组合、层级和文字编辑；样式默认值由创建入口注入，读取历史对象时不覆盖其样式。对象样式包含填充、渐变、线型、周长间距、透明度和字体属性。

剪贴板无路径图片经 `assets:paste-image` 传递限定大小的字节，后台校验 PNG/JPEG/GIF/WebP 签名并写入素材目录。画布使用标准 copy/paste 事件，内部对象以自定义 MIME 保存复制当时的项目片段快照（对象、组、相关连线、标记、笔记及素材），剪切后仍可粘贴；`canvasClipboard.ts` 复用编辑命令重建身份和引用，单独复制连线时保留当前几何端点；普通文字按 Markdown 转为固定 320px 宽的无框文本，图片同时添加素材和画布对象，一次操作对应一次撤销。粘贴位置优先取最近画布指针，否则取视口中央；输入框和笔记编辑保持自身粘贴行为。

对象移动和尺寸手势使用独立虚影，松开才提交文档，右键、Esc、窗口失焦或释放到画布外取消。素材库与工具使用 Pointer Events 预览放置，避免原生内部拖动吞掉右键。媒体注释只引用已存在标记：选中媒体后按 M 打标，再选中标记拖动其上方连接柄；普通箭头不会隐式创建标记。标记时间在媒体工作区中编辑。
连接线保存在顶层独立图层，样式支持直线、正交折线、曲线、圆角、预设及自定义间隔、起止头部、端点尺寸、透明度与标签。多选连接线的样式修改一次提交为一次撤销，复制对象时保留连接线样式。
## 工作台项目操作与主题入口

- 首页项目卡片的省略号是独立的项目操作入口，菜单提供打开项目、在系统文件管理器中显示项目目录、重命名和删除项目；菜单触发事件必须阻止向下冒泡；展开状态与导航回调独立，外部点击和 Esc 只收起文件夹。卡片以目录为稳定身份，预览列表受控更新。重命名在后台保存队列中更新项目名与修订号，保持素材目录稳定。
- 素材移除遵循“先文件、后文档”的顺序：渲染层通过受限 IPC 请求删除 `assets/` 内未被引用的文件，成功后再由编辑器删除资产元数据。仍被画布对象或笔记引用的素材保持禁用状态。
- 深色/浅色模式由 `ThemeToggle` 提供全局入口，首页与工作台页头都必须可用；`ThemePicker` 只负责主题方案与自定义主题管理。切换按钮参考作者公开 CCgather 日月图标，以 1740ms 可逆运动和天空交叉淡化呈现状态；遵循减少动态效果及强制动画设置，授权见 vendor/CCgather-Apache-2.0.txt。
- 工作台侧栏的工具、素材库、编辑入口采用统一线性图标和紧凑文字，当前可见面板以实色背景表示。属性按样式、文本、排列分组；颜色弹层通过 Portal 脱离滚动容器，并根据窗口边缘翻转定位。
- 笔记采用导航、正文、可切换目录/批注辅助栏；分屏预览与辅助栏可同时显示，阅读模式替换正文，专注模式收起导航、标签与格式工具。批注持续固定在右侧；正文与预览按剩余空间分配宽度，版心按实际正文列限幅，极窄窗口只在正文/预览区域横向滚动。排版弹层默认收起，字体/字号仅在有选区时启用，无选区时留空；正文横线默认显示，字数、阅读时长和缩放位于底栏。
- 笔记编辑保留常见 Markdown 源标记（例如 `# `），Markdown 预览根据源标记生成排版结果；画布正文在输入或粘贴时转换为结构化格式并保存。
- 选择工具下双击画布对象会选中对象并自动展开编辑面板；文本框、形状（含尚无文字的形状）和媒体标记批注同时进入共用的原位文字编辑器并获得焦点，隐藏原画布字形与空态提示。编辑层透明、文字跟随当前主题，形状默认居中、文字可上下溢出，文本框自动增高。通过“完成”、Ctrl+Enter 或失焦一次提交，Esc 放弃输入；侧栏取消时退出焦点并还原正文，防止已取消内容残留。笔记缩略图仍打开正文。共享 NumberField 在按住微调按钮或方向键期间连续预览，松手、松键或失焦时只提交一次；Esc 取消。位置、尺寸和旋转固定显示在属性页签上方。画布移动提交时吸附到整数像素，保证拖动结果稳定。
- 工具库与笔记素材均通过 Pointer Events 拖入画布；画布内放置虚影复用 ObjectView、待提交对象和相机坐标，因此尺寸、颜色、轮廓与释放结果一致，形状默认采用无填充极简描边样式。
- 工作台顶栏由应用内导航栏统一承载模式、撤销、重做、主题和设置入口；Electron 默认原生 File/Edit 菜单被移除，语言设置只作用于应用内导航与内容。
