const MACOS_TARGET = "aarch64-apple-darwin";

function findTarget(argumentsList) {
  for (let index = 1; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--target" || argument === "-t") {
      return argumentsList[index + 1];
    }
    if (argument.startsWith("--target=")) {
      return argument.slice("--target=".length);
    }
  }
  return undefined;
}

export function resolveTauriArguments(argumentsList, platform = process.platform) {
  const resolved = [...argumentsList];
  if (platform !== "darwin" || resolved[0] !== "build") {
    return resolved;
  }

  const explicitTarget = findTarget(resolved);
  if (explicitTarget && explicitTarget !== MACOS_TARGET) {
    throw new Error(`macOS builds only support ${MACOS_TARGET}`);
  }
  if (!explicitTarget) {
    // 统一项目构建入口，避免 Intel 主机隐式生成 x86_64 应用。
    resolved.splice(1, 0, "--target", MACOS_TARGET);
  }
  return resolved;
}
