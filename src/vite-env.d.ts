import type { ProjectDocument } from './core/document';

declare global {
  interface Window {
    workbench?: {
      getSettings(): Promise<{ projectsRoot: string }>;
      chooseProjectsRoot(): Promise<{ projectsRoot: string }>;
      listProjects(): Promise<{ name: string; folder: string }[]>;
      createProject(name: string): Promise<string>;
      openProject(folder: string): Promise<ProjectDocument & { recovered?: boolean }>;
      pickProjectFolder(): Promise<{ folder: string; document: ProjectDocument & { recovered?: boolean } } | null>;
      saveProject(document: ProjectDocument): Promise<{ revision: number }>;
      leaveProject(): Promise<void>;
      importAssets(): Promise<{ assets: ProjectDocument['assets']; errors: { name: string; message: string }[] }>;
      relinkAsset(kind: 'video' | 'audio' | 'image' | 'text'): Promise<ProjectDocument['assets'][number] | null>;
      createTextAsset(input: { name: string; content: string }): Promise<ProjectDocument['assets'][number]>;
      analyzeAsset(input: { assetId: string; assetPath: string; kind: 'audio' | 'video'; inUs: number; outUs: number; pixelsPerSecond: number; taskId: string }): Promise<{ ok: true; result: { waveform?: string; frames?: { path: string; timeUs: number }[] } } | { ok: false; error: { code: string; message: string; retryable: boolean } }>;
      cancelTask(taskId: string): Promise<{ cancelled: boolean }>;
      onTaskProgress(handler: (progress: { taskId: string; assetId: string; percent: number }) => void): () => void;
      onBackendRestart(handler: () => void): () => void;
      onFlushRequest(handler: () => Promise<boolean>): () => void;
    };
  }
}
export {};
