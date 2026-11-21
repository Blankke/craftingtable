# UI 美术与精修工作流

## 目录职责

- 本仓库自写的项目约束、设计判断和工作流程统一放在 `agent/`。
- 外来技能不存放在本仓库；四个可用 skill 安装在 Codex 用户级技能目录，以实际 `$CODEX_HOME/skills` 为准，未设置时使用 `~/.codex/skills`。WSL 通过符号链接复用共享源码；使用 `~/.codex-alt` 等独立配置目录时，也必须在该目录的 `skills/` 下建立入口。
- 使用与构建说明维护在根目录 `README.md`。
- 根目录 `AGENTS.md` 是入口；本文件说明项目 UI 任务何时读取和组合四个外来技能。

产品方向和生成式默认审查见 `agent/ui-art-direction.md`。批准后的设计决策应进入 `agent/ui-design-system.md`；批准前不将候选方向当作实现规范。界面实现与验收同时遵循 `agent/visual-verification.md` 和 `agent/project-rules.md`。

## 技能的职责与使用时机

### `frontend-design` — 产品视觉方向

来源：Anthropic，`$CODEX_HOME/skills/frontend-design/SKILL.md`。

在建立新界面、重做主要工作区、重新确定产品视觉语言或需要摆脱通用模板时使用。先检查真实产品行为与现有界面，再形成明确视觉主张和层级方案；结合 `agent/ui-art-direction.md`，不直接照搬技能示例或输出风格。

小范围控件修复、单纯 bug 修复不必调用它。

### `ui-ux-pro-max` — 设计资料与方案检索

来源：UI UX Pro Max，`$CODEX_HOME/skills/ui-ux-pro-max/SKILL.md` 及同目录的配套资源。

当需要比较适合桌面编辑器/工作站的布局、字体、配色、组件模式，或需从设计资料中检索可用方案时使用。将结果作为备选依据，并按项目技术栈、离线桌面场景、明暗主题和已批准视觉方向筛选。不要为了使用检索结果而改变产品方向。

已有批准规范且任务只涉及局部精修时通常不必检索。

### `impeccable` — 现有界面审查与减法精修

来源：Impeccable，`$CODEX_HOME/skills/impeccable/SKILL.md` 及同目录的配套资源，采用上游面向 Codex 的入口。

在视觉方向已明确后，用于审查现有页面、识别层级/排版/间距/边界问题、批评设计或执行有范围的 polish 与 distill。先对照项目规范和截图证据，再采纳具体建议。调用其脚本前阅读对应技能步骤；不得因技能建议而改动无关页面。

尚未确定产品方向时先用 `frontend-design` 做方向工作，不以 polish 替代方向决策。

### `emil-design-eng` — 控件手感与动效细节

来源：Emil Kowalski，`$CODEX_HOME/skills/emil-design-eng/SKILL.md`。

在布局与视觉语言稳定后，用于改进按钮反馈、弹层、拖拽、过渡、缓动、进出场节奏和组件细节。动作需服务状态变化，保留键盘等价操作并遵循减少动态效果偏好。不要用动效掩盖层级或可用性问题。

静态排版、颜色方向和信息架构任务一般不需要调用。

## 常用协作顺序

按任务范围组合技能，不要求每次全部运行：

1. 新方向或大范围视觉更新：`frontend-design`；需要比较或检索方向资料时补充 `ui-ux-pro-max`。
2. 方向确定后的现有 UI 精修：`impeccable`。
3. 交互视觉已稳定、需要调节手感时：`emil-design-eng`。
4. 按真实界面截图完成视觉验证和减法复核，记录可见结果与未覆盖状态。

若本文件、根目录 `AGENTS.md` 或项目守则与外来技能指导冲突，遵循本项目约束。依赖项、代码结构和产品行为变更仍需按一般工程流程审查。

按上述确切路径读取所需技能。技能提出的项目规则、PRODUCT/DESIGN 等设计材料统一归入 `agent/`，采用现有架构、方向与设计系统文档作为权威来源，避免产生重复规范。若上游工具无法使用项目约定的路径，先按其文本指导完成当前工作，再明确工具限制。运行 UI UX Pro Max 的 Python 检索脚本前，遵循项目虚拟环境与解释器确认规则。

## 技能环境

安装目录以实际 `$CODEX_HOME/skills` 为准，未设置时使用 `~/.codex/skills`。每个技能目录包含 `SKILL.md`；跨环境复用、工具安装与版本更新在用户级目录维护，仓库只保存调用职责与上游来源。使用前读取当前技能说明，并检查实际可用的运行环境；执行 Python 工具时遵循虚拟环境与解释器确认规则。

## 美术方向与实现门槛

1. 从真实产品出发，识别主要工作、信息密度、交互频率、产品类型、退入背景的区域和唯一视觉重点。
2. 按 `agent/ui-art-direction.md` 检查生成式默认；移除产品名后能原样套用到无关 SaaS 的方案需要重做。
3. 每个方向只保留一个主要视觉签名，其余界面保持安静。
4. 提供三种方向，分别明确视觉主张、字体、几何、表面、边界、圆角、密度、强调色、选中态、控件、动效、签名和刻意不做风格化的部分。方向阶段先写提案，获选后才实施。
5. 逐一检验矩形是否表达边界、状态、交互或间距无法表达的层级；全部不满足则移除。边框消失不丢信息则移除；卡片应代表独立对象；按钮按必要程度采用安静样式，并保持清晰的 hover、pressed、focus-visible 反馈。
6. 优先用字号、字重、行高、前景对比、间距、对齐、缩进和分组建立层次，必要时才增加装饰表面。
7. 首轮实现后执行 DISTILL PASS，移除多余容器、装饰边框、重复底色、冗余标签、无用阴影、过量圆角和重复强调。同条件复拍，逐项记录减少的可见设计元素以及更清楚的层级；截图闭环以 `agent/visual-verification.md` 为准。

## 上游来源

- Anthropic：<https://github.com/anthropics/skills/tree/main/skills/frontend-design>
- Impeccable：<https://github.com/pbakaus/impeccable>
- UI UX Pro Max：<https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>
- Emil Design Engineering：<https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng>
