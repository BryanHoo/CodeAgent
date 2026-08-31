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

function hasBundleSelection(argumentsList) {
  return argumentsList.some(
    (argument) =>
      argument === "--no-bundle" ||
      argument === "--bundles" ||
      argument === "-b" ||
      argument.startsWith("--bundles="),
  );
}

export function resolveTauriArguments(argumentsList, platform = process.platform) {
  const resolved = [...argumentsList];
  if (resolved[0] !== "build") {
    return resolved;
  }

  if (platform === "win32") {
    if (!hasBundleSelection(resolved)) {
      // Windows 默认输出可直接运行的 EXE，避免生成需要安装的 NSIS/MSI 包。
      resolved.splice(1, 0, "--no-bundle");
    }
    return resolved;
  }

  if (platform !== "darwin") {
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
