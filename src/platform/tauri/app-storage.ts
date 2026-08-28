import { invoke as tauriInvoke } from "@tauri-apps/api/core";

// WebView 仅保留同步内存镜像，所有持久化统一通过受限 Tauri 命令完成。

const CODEAGENT_KEY_PREFIXES = ["codeagent.", "codeagent:"] as const;
const LEGACY_BACKGROUND_DATABASE = "codeagent-workbench";
const LEGACY_BACKGROUND_STORE = "background-images";
const PREFERENCE_WRITE_DELAY_MS = 100;

type AppStorageInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

type LegacyStorage = Readonly<{
  getItem: (key: string) => string | null;
  key: (index: number) => string | null;
  length: number;
  removeItem: (key: string) => void;
}>;

export type NativeCustomBackground = Readonly<{
  bytes: number[];
  createdAt: number;
  id: string;
  mediaType: string;
  name: string;
}>;

export type NativeCustomBackgroundMetadata = Omit<NativeCustomBackground, "bytes">;

type InitializeAppStorageOptions = Readonly<{
  invoke?: AppStorageInvoke;
  localStorage?: LegacyStorage;
  readLegacyBackgrounds?: () => Promise<readonly NativeCustomBackground[]>;
}>;

const values = new Map<string, string>();
let nativeInvoke: AppStorageInvoke = tauriInvoke;
let initialized = false;
const pendingPreferenceUpdates = new Map<string, string | null>();
let preferenceWriteTimer: ReturnType<typeof setTimeout> | undefined;
let writeQueue = Promise.resolve();

function isCodeAgentKey(key: string): boolean {
  return CODEAGENT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function getLegacyStorage(): LegacyStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function collectLegacyPreferences(storage: LegacyStorage | undefined): Record<string, string> {
  const preferences: Record<string, string> = {};
  if (storage === undefined) return preferences;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !isCodeAgentKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) preferences[key] = value;
  }
  return preferences;
}

async function readLegacyBackgrounds(): Promise<readonly NativeCustomBackground[]> {
  if (typeof window === "undefined" || window.indexedDB === undefined) return [];
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(LEGACY_BACKGROUND_DATABASE);
    request.onerror = () => reject(request.error ?? new Error("Unable to read legacy backgrounds"));
    request.onblocked = () => reject(new Error("Legacy background storage is blocked"));
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LEGACY_BACKGROUND_STORE)) {
        database.close();
        resolve([]);
        return;
      }
      const transaction = database.transaction(LEGACY_BACKGROUND_STORE, "readonly");
      const readRequest = transaction.objectStore(LEGACY_BACKGROUND_STORE).getAll();
      readRequest.onerror = () =>
        reject(readRequest.error ?? new Error("Unable to read legacy backgrounds"));
      readRequest.onsuccess = () => {
        void Promise.all(
          readRequest.result.map(async (record: unknown) => {
            if (!isLegacyBackground(record)) return null;
            return {
              bytes: Array.from(new Uint8Array(await record.blob.arrayBuffer())),
              createdAt: record.createdAt,
              id: record.id,
              mediaType: record.blob.type,
              name: record.name,
            } satisfies NativeCustomBackground;
          }),
        ).then(
          (backgrounds) => resolve(backgrounds.filter((item) => item !== null)),
          (error: unknown) => reject(error),
        );
      };
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error("Legacy background migration was aborted"));
      };
    };
  });
}

function isLegacyBackground(
  value: unknown,
): value is Readonly<{ blob: Blob; createdAt: number; id: string; name: string }> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<{ blob: Blob; createdAt: number; id: string; name: string }>;
  return (
    candidate.blob instanceof Blob &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string"
  );
}

function clearLegacyStorage(storage: LegacyStorage | undefined, keys: readonly string[]): void {
  if (storage !== undefined) {
    for (const key of keys) storage.removeItem(key);
  }
  if (typeof window !== "undefined" && window.indexedDB !== undefined) {
    window.indexedDB.deleteDatabase(LEGACY_BACKGROUND_DATABASE);
  }
}

function enqueuePreferenceWrite(key: string, value: string | null): void {
  if (!initialized) return;
  pendingPreferenceUpdates.set(key, value);
  preferenceWriteTimer ??= setTimeout(flushPreferenceWrites, PREFERENCE_WRITE_DELAY_MS);
}

function flushPreferenceWrites(): void {
  preferenceWriteTimer = undefined;
  if (pendingPreferenceUpdates.size === 0) return;
  const updates = Object.fromEntries(pendingPreferenceUpdates);
  pendingPreferenceUpdates.clear();
  writeQueue = writeQueue
    .then(() => nativeInvoke("update_app_preferences", { updates }))
    .then(() => undefined, () => undefined);
}

export const appPreferenceStorage = {
  getItem(key: string): string | null {
    return values.get(key) ?? null;
  },
  removeItem(key: string): void {
    values.delete(key);
    enqueuePreferenceWrite(key, null);
  },
  setItem(key: string, value: string): void {
    values.set(key, value);
    enqueuePreferenceWrite(key, value);
  },
};

export async function initializeAppStorage(
  options: InitializeAppStorageOptions = {},
): Promise<void> {
  if (initialized) return;
  nativeInvoke = options.invoke ?? tauriInvoke;
  const legacyStorage = options.localStorage ?? getLegacyStorage();
  const legacyPreferences = collectLegacyPreferences(legacyStorage);
  const legacyBackgrounds = await (options.readLegacyBackgrounds ?? readLegacyBackgrounds)();
  const stored = (await nativeInvoke("initialize_app_storage", {
    legacyBackgrounds,
    legacyPreferences,
  })) as Record<string, string>;
  values.clear();
  Object.entries(stored).forEach(([key, value]) => values.set(key, value));
  initialized = true;
  clearLegacyStorage(legacyStorage, Object.keys(legacyPreferences));
}

export async function listNativeCustomBackgrounds(): Promise<readonly NativeCustomBackgroundMetadata[]> {
  return (await nativeInvoke("list_custom_backgrounds")) as NativeCustomBackgroundMetadata[];
}

export async function readNativeCustomBackground(id: string, mediaType?: string): Promise<Blob> {
  const response = (await nativeInvoke("read_custom_background", { id })) as Readonly<{
    bytes: number[];
  }>;
  const resolvedMediaType =
    mediaType ?? (await listNativeCustomBackgrounds()).find((image) => image.id === id)?.mediaType;
  if (resolvedMediaType === undefined) throw new Error("Custom background metadata is unavailable");
  return new Blob([new Uint8Array(response.bytes)], { type: resolvedMediaType });
}

export async function updateNativeCustomBackgrounds(
  deletedIds: readonly string[],
  images: readonly NativeCustomBackground[],
): Promise<void> {
  await nativeInvoke("update_custom_backgrounds", {
    deletedIds: [...deletedIds],
    images: [...images],
  });
}

export function resetAppStorageForTest(): void {
  if (preferenceWriteTimer !== undefined) clearTimeout(preferenceWriteTimer);
  values.clear();
  pendingPreferenceUpdates.clear();
  preferenceWriteTimer = undefined;
  nativeInvoke = tauriInvoke;
  initialized = false;
  writeQueue = Promise.resolve();
}
