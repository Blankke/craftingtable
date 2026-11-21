// markdown-it 扩展没有随包提供 TypeScript 声明，统一限定为标准插件接口。
declare module 'markdown-it-footnote' { const plugin: import('markdown-it').PluginSimple; export default plugin; }
declare module 'markdown-it-mark' { const plugin: import('markdown-it').PluginSimple; export default plugin; }
declare module 'markdown-it-task-lists' { const plugin: import('markdown-it').PluginWithOptions<{ enabled?: boolean }>; export default plugin; }
declare module 'markdown-it-texmath' { const plugin: import('markdown-it').PluginWithOptions<{ engine: unknown; delimiters: string; katexOptions: Record<string, unknown> }>; export default plugin; }
