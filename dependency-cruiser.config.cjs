/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: ["(^|/)(index|main|cli|.*\\.config)\\.[cm]?[jt]sx?$", "\\.d\\.ts$"],
      },
      to: {},
    },
    {
      name: "protocol-is-independent",
      severity: "error",
      from: { path: "^packages/protocol/src" },
      to: { path: "^(packages/(engine-node|server|client)|apps/web|src)" },
    },
    {
      name: "engine-node-does-not-depend-on-delivery",
      severity: "error",
      from: { path: "^packages/engine-node/src" },
      to: { path: "^(packages/(server|client)|apps/web|src)" },
    },
    {
      name: "client-is-independent-from-server-runtime",
      severity: "error",
      from: { path: "^packages/client/src" },
      to: { path: "^packages/(engine-node|server)/src" },
    },
    {
      name: "client-does-not-depend-on-host-transports",
      severity: "error",
      from: { path: "^packages/client/src" },
      to: { path: "^packages/transport-(http|tauri)/src" },
    },
    {
      name: "http-transport-does-not-depend-on-tauri-transport",
      severity: "error",
      from: { path: "^packages/transport-http/src" },
      to: { path: "^packages/transport-tauri/src" },
    },
    {
      name: "tauri-transport-does-not-depend-on-http-transport",
      severity: "error",
      from: { path: "^packages/transport-tauri/src" },
      to: { path: "^packages/transport-http/src" },
    },
    {
      name: "web-only-uses-client-and-protocol",
      severity: "error",
      from: { path: "^apps/web/src" },
      to: { path: "^packages/(engine-node|server)/src" },
    },
    {
      name: "web-host-transport-only-through-composition-root",
      severity: "error",
      from: {
        path: "^apps/web/src",
        pathNot: "^apps/web/src/app/create-host-client(?:\\.test)?\\.ts$",
      },
      to: { path: "^packages/transport-(http|tauri)/src" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|coverage|node_modules|target)/" },
    // 分析编译前的 TypeScript 类型依赖，避免纯类型契约被误判为 orphan。
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "default"],
      exportsFields: ["exports"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/[^/]+" },
    },
  },
};
