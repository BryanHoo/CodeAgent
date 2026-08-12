import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface NativeBinding {
  readonly addonVersion: () => string;
  readonly NodeEngine: Readonly<{
    open: (options: unknown) => Promise<unknown>;
  }>;
}

export interface NativeBindingLoaderOptions {
  readonly addonPath?: string;
  readonly binding?: NativeBinding;
  readonly load?: (path: string) => unknown;
}

export class NativeBindingLoadError extends Error {
  public readonly code = "NATIVE_BINDING_LOAD_FAILED";

  public constructor(
    public readonly addonPath: string,
    options: ErrorOptions,
  ) {
    super(`无法加载 CodeAgent native addon: ${addonPath}`, options);
    this.name = "NativeBindingLoadError";
  }
}

const sourceAddonPath = fileURLToPath(
  new URL("../native/code-agent-node-binding.node", import.meta.url),
);
const bundledAddonPath = fileURLToPath(
  new URL("./native/code-agent-node-binding.node", import.meta.url),
);

// 仅检查两个确定位置，兼顾 workspace 源码执行与扁平化发布产物。
const defaultAddonPath = existsSync(sourceAddonPath) ? sourceAddonPath : bundledAddonPath;

function isNativeBinding(value: unknown): value is NativeBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    "addonVersion" in value &&
    typeof value.addonVersion === "function" &&
    "NodeEngine" in value &&
    typeof value.NodeEngine === "function" &&
    "open" in value.NodeEngine &&
    typeof value.NodeEngine.open === "function"
  );
}

export function loadNativeBinding(options: NativeBindingLoaderOptions = {}): NativeBinding {
  if (options.binding !== undefined) {
    return options.binding;
  }

  const addonPath = options.addonPath ?? defaultAddonPath;
  const load = options.load ?? createRequire(import.meta.url);
  try {
    const binding: unknown = load(addonPath);
    if (!isNativeBinding(binding)) {
      throw new TypeError("native addon exports are invalid");
    }
    return binding;
  } catch (error) {
    throw new NativeBindingLoadError(addonPath, { cause: error });
  }
}
