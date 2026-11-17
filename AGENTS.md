# 仓库协作入口

## 项目 UI 设计工作流

项目 UI 工作流入口见 [agent/ui-design-workflow.md](agent/ui-design-workflow.md)，视觉方向见 [agent/ui-art-direction.md](agent/ui-art-direction.md)。

本仓库的完整项目守则见 [agent/project-rules.md](agent/project-rules.md)。开始工作前先阅读该文件，再阅读 `agent/architecture.md`、`agent/change-log.md`，并检查 `git status` 与最近提交。用户在会话中给出的指令优先于仓库守则。

## 视觉任务验收

视觉类任务必须遵循 [agent/visual-verification.md](agent/visual-verification.md) 的截图闭环：以真实内容建立可复现场景，固定主题、缩放、窗口与交互状态，先截基线再依据可见差异做小范围修改，并在相同条件复拍比较。验收至少覆盖需求指定状态；未指定时覆盖静止/交互稳定帧、明暗主题和 Windows 100%／150% 缩放。检查布局、内容可见性、层级遮挡、材质、文字可读性、动画和键盘可用性；截图及桌面视觉预览只能在沙箱外执行，结果写入 `test-results/`，不提交。视觉结论必须基于截图逐项说明，无法量化的差异保留为待确认项。

## Electron 桌面复测硬性规则

不要在文件系统或进程沙箱内启动本项目的 Electron。`npm.cmd run verify` 会启动 Playwright 桌面用例，因此也必须在沙箱外运行；`npm.cmd run smoke`、`npm.cmd run test:e2e`、`npm.cmd run dev`、`npm.cmd start` 同理。在本环境中，使用 `exec_command` 的 `sandbox_permissions: "require_escalated"` 直接运行相应命令；若该方式不可用，改由用户在宿主机 PowerShell 运行，并如实注明桌面验证未完成。不要把沙箱内的 Electron 崩溃判定为应用回归。

依据：2026-11-16 沙箱内桌面测试的 `runtime.log` 记录 GPU 子进程反复以 `-1073741515`（Windows `0xC0000135`，DLL 加载失败）退出，界面进程随后报告 `launch-failed 49`；同版代码在沙箱外的冒烟测试通过。`0x80000003` 是弹窗中的断点异常码；现有日志未定位具体缺失的 DLL，也未把这次弹窗准确绑定到某个子进程。复测时先确认没有仍在运行的前一次测试，再从仓库根目录于沙箱外依次执行 `npm.cmd run smoke`、`npm.cmd run verify`，检查退出码及 `runtime.log`；如仍弹窗，保留进程信息和日志继续排查。
