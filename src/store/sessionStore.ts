import { create } from 'zustand';
import type {
  CreateVaultInput,
  PublicKeyringInfo,
  UnlockedSession,
} from '@/core/types/key';
import { logAudit } from '@/core/audit/auditService';
import { cleanupPendingFiles } from '@/core/storage/repositories/fileRepo';
import {
  createVault,
  installRestoredKey,
  loadPublicKeyringInfo,
  replaceSigningKeyWithRestored,
  unlockVault,
  type InstallRestoredKeyInput,
} from '@/core/keys/keyring';
import { toAppError } from '@/core/errors/AppError';

export type SessionStatus = 'booting' | 'no-vault' | 'locked' | 'unlocked' | 'error';

interface ReplaceSigningKeyInput {
  currentPassword: string;
  pkcs8: Uint8Array;
  certInfo: Parameters<typeof replaceSigningKeyWithRestored>[1]['certInfo'];
  publicKeyJwk: JsonWebKey;
  displayName: string;
  trustedCerts: Parameters<typeof replaceSigningKeyWithRestored>[1]['trustedCerts'];
}

export interface SessionState {
  status: SessionStatus;
  keyring?: PublicKeyringInfo;
  session?: UnlockedSession;
  bootstrapError?: string;
  storagePersisted?: boolean;
  skipPasswordForSession: boolean;
  bootstrap(): Promise<void>;
  retryBootstrap(): Promise<void>;
  refreshKeyring(): Promise<void>;
  createVault(input: CreateVaultInput): Promise<void>;
  unlock(password: string): Promise<void>;
  installRestoredKey(input: InstallRestoredKeyInput): Promise<void>;
  replaceSigningKey(input: ReplaceSigningKeyInput): Promise<void>;
  applySession(session: UnlockedSession): Promise<void>;
  lock(): void;
  setSkipPasswordForSession(value: boolean): void;
  requestPersistence(): Promise<void>;
}

let bootstrapPromise: Promise<void> | null = null;

async function loadSessionInfo(): Promise<{
  keyring?: PublicKeyringInfo;
  status: SessionStatus;
}> {
  const keyring = await loadPublicKeyringInfo();
  return keyring ? { keyring, status: 'locked' } : { status: 'no-vault' };
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'booting',
  skipPasswordForSession: false,

  async bootstrap() {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      try {
        await cleanupPendingFiles();
        const info = await loadSessionInfo();
        set({ ...info, bootstrapError: undefined });
        void get().requestPersistence();
      } catch (error) {
        set({
          status: 'error',
          bootstrapError: toAppError(error).message,
        });
      }
    })();
    return bootstrapPromise;
  },

  async retryBootstrap() {
    bootstrapPromise = null;
    set({ status: 'booting', bootstrapError: undefined });
    await get().bootstrap();
  },

  async refreshKeyring() {
    const keyring = await loadPublicKeyringInfo();
    set({ keyring });
  },

  async createVault(input) {
    const session = await createVault(input);
    await logAudit('vault.create', 'success', {
      detail: { displayName: session.displayName },
    });
    await get().applySession(session);
  },

  async unlock(password) {
    try {
      const session = await unlockVault(password);
      await logAudit('vault.unlock', 'success');
      await get().applySession(session);
    } catch (error) {
      const appError = toAppError(error);
      await logAudit('vault.unlock', 'failure', {
        stage: appError.stage,
        errorCode: appError.code,
      });
      throw error;
    }
  },

  async installRestoredKey(input) {
    const session = await installRestoredKey(input);
    await logAudit('key.restore', 'success', {
      detail: { displayName: session.displayName, mode: 'new-vault' },
    });
    await get().applySession(session);
  },

  async replaceSigningKey(input) {
    const session = await replaceSigningKeyWithRestored(input.currentPassword, {
      pkcs8: input.pkcs8,
      certInfo: input.certInfo,
      publicKeyJwk: input.publicKeyJwk,
      displayName: input.displayName,
      trustedCerts: input.trustedCerts,
    });
    await logAudit('key.restore', 'success', {
      detail: { displayName: session.displayName, mode: 'replace-signing-key' },
    });
    await get().applySession(session);
  },

  async applySession(session) {
    await get().refreshKeyring();
    set({
      status: 'unlocked',
      session,
      skipPasswordForSession: false,
      bootstrapError: undefined,
    });
  },

  lock() {
    if (get().status !== 'unlocked') return;
    set({
      status: 'locked',
      session: undefined,
      skipPasswordForSession: false,
    });
    void logAudit('vault.lock', 'success');
  },

  setSkipPasswordForSession(value) {
    set({ skipPasswordForSession: value });
  },

  async requestPersistence() {
    try {
      if (navigator.storage?.persist) {
        const persisted = await navigator.storage.persist();
        set({ storagePersisted: persisted });
      }
    } catch {
      set({ storagePersisted: false });
    }
  },
}));
