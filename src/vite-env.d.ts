import type { ProjectDocument } from './core/document';

declare global {
  interface Window {
    workbench?: {
      listProjects(): Promise<{ name: string; folder: string }[]>;
      createProject(name: string): Promise<string>;
      openProject(folder: string): Promise<ProjectDocument>;
      saveProject(document: ProjectDocument): Promise<{ revision: number }>;
      importAssets(): Promise<ProjectDocument['assets']>;
    };
  }
}
export {};
