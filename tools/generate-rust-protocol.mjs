import { spawnSync } from "node:child_process";

const packageManagerCli = process.env["npm_execpath"];
if (!packageManagerCli) {
  throw new Error("protocol:rust:generate must run through pnpm");
}

function run(arguments_, environment = process.env) {
  const result = spawnSync(process.execPath, [packageManagerCli, ...arguments_], {
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// 通过进程环境传递更新开关，避免 package script 依赖 POSIX 语法。
run(["exec", "vitest", "run", "packages/protocol/src/rust-runtime-schema.test.ts"], {
  ...process.env,
  CODE_AGENT_UPDATE_RUST_PROTOCOL: "1",
});
run([
  "exec",
  "cargo",
  "run",
  "-p",
  "code-agent-protocol-gen",
  "--locked",
  "--",
  "schemas/code-agent-runtime.schema.json",
  "crates/protocol/src/generated.rs",
]);
