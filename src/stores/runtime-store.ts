import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";

import type { AppEvent, RuntimeSnapshot } from "@/domain/runtime";
import { initializeRuntimeChannel } from "@/platform/tauri/runtime-channel";
import {
  INITIAL_RUNTIME_STATE,
  reduceRuntimeEvent,
  type RuntimeStoreState,
} from "@/stores/runtime-reducer";

type Listener = () => void;

const listeners = new Set<Listener>();
let state = INITIAL_RUNTIME_STATE;
let initialized = false;

function emitChange(nextState: RuntimeStoreState) {
  if (Object.is(state, nextState)) {
    return;
  }

  state = nextState;
  listeners.forEach((listener) => listener());
}

function handleRuntimeEvent(event: AppEvent) {
  emitChange(reduceRuntimeEvent(state, event));
}

function handleConnected(snapshot: RuntimeSnapshot) {
  emitChange({
    connection: "connected",
    snapshot,
    error: null,
  });
}

function handleConnectionError(error: unknown) {
  emitChange({
    ...state,
    connection: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}

export function initializeRuntimeStore() {
  if (initialized) {
    return;
  }

  initialized = true;
  emitChange({ ...state, connection: "connecting" });
  void initializeRuntimeChannel(handleRuntimeEvent)
    .then(handleConnected)
    .catch(handleConnectionError);
}

export function subscribeRuntimeStore(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRuntimeSnapshot() {
  return state;
}

export function useRuntimeStore<Selection>(
  selector: (snapshot: RuntimeStoreState) => Selection,
) {
  return useSyncExternalStoreWithSelector(
    subscribeRuntimeStore,
    getRuntimeSnapshot,
    getRuntimeSnapshot,
    selector,
  );
}
