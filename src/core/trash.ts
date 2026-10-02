/** Workspace file retention metadata; never a second authored project or runtime state. */
export const trashRetentionMs = 30 * 24 * 60 * 60 * 1000;
export interface TrashedFile {
  id: string;
  path: string;
  version: string;
  deletedAt: number;
  expiresAt: number;
  bytes: number;
}
