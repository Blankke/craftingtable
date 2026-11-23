import type { ProjectDocument } from './core/document';

declare global {
  interface Window {
    workbench?: {
      getSettings(): Promise<{ projectsRoot: string; documentSchemaVersion: number }>;
      clipboardCommand(command: 'copy' | 'cut' | 'paste' | 'pasteAndMatchStyle' | 'selectAll'): Promise<void>;
      readClipboardText(): Promise<string>;
      copyGraphic(input: { png: string; svg?: string }): Promise<void>;
      openLink(href: string): Promise<void>;
      chooseProjectsRoot(): Promise<{ projectsRoot: string }>;
      listProjects(): Promise<{ name: string; folder: string; revision?: number; status: 'ready' | 'recovery' | 'invalid'; summary: { objects: number; assets: number; notes: number }; preview: { canvas?: string; media?: string; note?: string } }[]>;
      createProject(name: string): Promise<string>;
      openProject(folder: string): Promise<ProjectDocument & { recovered?: boolean }>;
      pickProjectFolder(): Promise<{ folder: string; document: ProjectDocument & { recovered?: boolean } } | null>;
      revealProject(folder: string): Promise<void>;
      deleteProject(folder: string): Promise<boolean>;
      renameProject(folder: string, name: string): Promise<{ revision: number }>;
      exportNote(input: { name: string; markdown: string }): Promise<boolean>;
      saveProject(document: ProjectDocument): Promise<{ revision: number }>;
      leaveProject(): Promise<void>;
      importAssets(): Promise<{ assets: ProjectDocument['assets']; errors: { name: string; message: string }[] }>;
      revealAsset(assetPath: string): Promise<void>;
      removeAsset(assetPath: string): Promise<{ removed: boolean }>;
      importDroppedFiles(files: File[]): Promise<{ assets: ProjectDocument['assets']; errors: { name: string; message: string }[] }>;
      relinkAsset(kind: 'video' | 'audio' | 'image' | 'text'): Promise<ProjectDocument['assets'][number] | null>;
      createTextAsset(input: { name: string; content: string }): Promise<ProjectDocument['assets'][number]>;
      analyzeAsset(input: { assetId: string; assetPath: string; kind: 'audio' | 'video'; inUs: number; outUs: number; pixelsPerSecond: number; taskId: string }): Promise<{ ok: true; result: { waveform?: { path: string; samplesPerSecond: number; durationUs: number }; frames?: { path: string; timeUs: number }[] } } | { ok: false; error: { code: string; message: string; retryable: boolean } }>;
      cancelTask(taskId: string): Promise<{ cancelled: boolean }>;
      onTaskProgress(handler: (progress: { taskId: string; assetId: string; percent: number }) => void): () => void;
      onBackendRestart(handler: () => void): () => void;
      onFlushRequest(handler: () => Promise<boolean>): () => void;
    };
  }
}
export {};
