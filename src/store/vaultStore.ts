import { create } from 'zustand';
import type { StoredFileRecord } from '@/core/storage/schema';
import { listCommittedFiles } from '@/core/storage/repositories/fileRepo';
import { deleteStoredFile } from '@/core/vault/importExport';
import { toAppError } from '@/core/errors/AppError';

export interface VaultState {
  files: StoredFileRecord[];
  loading: boolean;
  error?: string;
  refresh(): Promise<void>;
  remove(fileId: string): Promise<void>;
}

export const useVaultStore = create<VaultState>((set) => ({
  files: [],
  loading: false,

  async refresh() {
    set({ loading: true });
    try {
      const files = await listCommittedFiles();
      set({ files, loading: false, error: undefined });
    } catch (error) {
      set({
        loading: false,
        error: toAppError(error).message,
      });
    }
  },

  async remove(fileId) {
    await deleteStoredFile(fileId);
    const files = await listCommittedFiles();
    set({ files });
  },
}));
