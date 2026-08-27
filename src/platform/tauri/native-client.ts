import { invoke } from "@tauri-apps/api/core";

import { ensureCodexRuntime, subscribeAgentEvents } from "./runtime.js";

export type InvokeImplementation = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type TauriClientOptions = Readonly<{
  ensureRuntime?: () => Promise<unknown>;
  invoke?: InvokeImplementation;
  subscribeAgentEvents?: typeof subscribeAgentEvents;
}>;

export class TauriNativeClient {
  protected readonly ensureRuntime: () => Promise<unknown>;
  protected readonly invokeNative: InvokeImplementation;
  protected readonly subscribeNativeEvents: typeof subscribeAgentEvents;
  protected readonly taskProjects = new Map<string, string>();

  public constructor(options: TauriClientOptions = {}) {
    this.ensureRuntime = options.ensureRuntime ?? ensureCodexRuntime;
    this.invokeNative = options.invoke ?? invoke;
    this.subscribeNativeEvents = options.subscribeAgentEvents ?? subscribeAgentEvents;
  }

  protected async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    await this.ensureRuntime();
    return args === undefined
      ? this.invokeNative<T>(command)
      : this.invokeNative<T>(command, args);
  }
}
