import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CipherAlgorithm, HashAlgorithm } from '@/core/types/crypto';

export interface SettingsState {
  autoLockMinutes: number;
  rememberPasswordInSession: boolean;
  defaultCipher: CipherAlgorithm;
  defaultHashAlg: HashAlgorithm;
  setAutoLockMinutes(value: number): void;
  setRememberPasswordInSession(value: boolean): void;
  setDefaultCipher(value: CipherAlgorithm): void;
  setDefaultHashAlg(value: HashAlgorithm): void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoLockMinutes: 10,
      rememberPasswordInSession: false,
      defaultCipher: 'AES-256-GCM',
      defaultHashAlg: 'SHA-256',
      setAutoLockMinutes(value) {
        set({ autoLockMinutes: Math.max(0, Math.min(120, value)) });
      },
      setRememberPasswordInSession(value) {
        set({ rememberPasswordInSession: value });
      },
      setDefaultCipher(value) {
        set({ defaultCipher: value });
      },
      setDefaultHashAlg(value) {
        set({ defaultHashAlg: value });
      },
    }),
    {
      name: 'sfv-settings-v1',
      version: 1,
    },
  ),
);
