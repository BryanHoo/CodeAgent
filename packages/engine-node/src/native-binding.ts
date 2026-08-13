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
  readonly arch?: NodeJS.Architecture;
  readonly binding?: NativeBinding;
  readonly load?: (path: string) => unknown;
  readonly platform?: NodeJS.Platform;
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

const developmentAddonPaths = [
  fileURLToPath(new URL("../native/code-agent-node-binding.node", import.meta.url)),
  fileURLToPath(new URL("./native/code-agent-node-binding.node", import.meta.url)),
] as const;
const nativePackages = new Map<string, string>([
  ["darwin-arm64", "@bryanhu/code-agent-darwin-arm64"],
  ["darwin-x64", "@bryanhu/code-agent-darwin-x64"],
  ["linux-x64", "@bryanhu/code-agent-linux-x64-gnu"],
  ["win32-x64", "@bryanhu/code-agent-win32-x64-msvc"],
]);

export function resolveNativeBindingPackage(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string {
  const target = `${platform}-${arch}`;
  const packageName = nativePackages.get(target);
  if (packageName === undefined) {
    throw new Error(`不支持 native addon 平台: ${target}`);
  }
  return packageName;
}

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

  const load = options.load ?? createRequire(import.meta.url);
  const addonPath =
    options.addonPath ??
    resolveNativeBindingPackage(options.platform ?? process.platform, options.arch ?? process.arch);
  try {
    const binding: unknown = load(addonPath);
    if (!isNativeBinding(binding)) {
      throw new TypeError("native addon exports are invalid");
    }
    return binding;
  } catch (packageError) {
    if (options.addonPath === undefined) {
      // Workspace 开发构建保留一个确定性回退；发布包不会携带该文件。
      const developmentAddonPath = developmentAddonPaths.find((path) => existsSync(path));
      if (developmentAddonPath !== undefined) {
        try {
          const binding: unknown = load(developmentAddonPath);
          if (isNativeBinding(binding)) return binding;
        } catch (error) {
          throw new NativeBindingLoadError(developmentAddonPath, { cause: error });
        }
      }
    }
    throw new NativeBindingLoadError(addonPath, { cause: packageError });
  }
}
