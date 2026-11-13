# 音视频创作策划工作台

Windows 优先的离线桌面工作台。当前仓库为首版工程基础：项目读写、素材导入、基础画布对象、分组、连接数据模型和命令撤销已建立。媒体处理、轨道播放与完整注释交互仍在开发中，当前版本不可作为首版验收包。

## 环境

- Node.js 20 以上、npm。
- Windows x64。
- 构建安装包前准备 FFmpeg 与 ffprobe，放入 `vendor/`。最终打包与媒体格式验收仍需执行。

首次安装依赖需要用户明确授权；依赖已安装后使用：

```powershell
npm.cmd run verify
npm.cmd run build
npm.cmd run dist:win
```

也可用 `powershell -ExecutionPolicy Bypass -File scripts/build.ps1` 顺序验证并打包。开发界面可运行 `npm.cmd run dev`，桌面容器的开发联调入口尚未实现。

项目保存在用户“文档/音视频创作策划工作台”目录。每个项目包含 `project.json`、`assets/`、`cache/`、`recovery/`。
