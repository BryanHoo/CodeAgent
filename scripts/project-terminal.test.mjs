import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commands = ["connect_project_terminals", "create_project_terminal", "write_project_terminal", "resize_project_terminal", "ack_project_terminal", "close_project_terminal", "remove_project_terminal"];

await test("terminal commands are registered and granted only to the main command set", async () => {
  const manifest = await readFile(new URL("../src-tauri/build.rs", import.meta.url), "utf8");
  const handlers = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const permissions = await readFile(new URL("../src-tauri/permissions/window-command-sets.toml", import.meta.url), "utf8");
  const sets = permissions.split("[[set]]").slice(1);
  for (const command of commands) {
    assert.ok(manifest.includes(`"${command}"`), `${command} missing from build manifest`);
    assert.ok(handlers.includes(`terminal_commands::${command}`), `${command} missing from handlers`);
    const permission = `"allow-${command.replaceAll("_", "-")}"`;
    for (const set of sets) {
      assert.equal(set.includes(permission), set.includes('identifier = "main-window-commands"'), `${command} has an incorrect window grant`);
    }
  }
});

await test("native lifecycle owns terminal cleanup before hide and settings cleanup", async () => {
  const lifecycle = await readFile(new URL("../src-tauri/src/application/app_lifecycle.rs", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src-tauri/src/application/sidebar_commands.rs", import.meta.url), "utf8");
  assert.ok(lifecycle.includes("terminal_lifecycle::request_close"));
  assert.ok(lifecycle.includes("terminal_lifecycle::request_exit"));
  const removal = sidebar.slice(sidebar.indexOf("pub async fn remove_project("), sidebar.indexOf("pub async fn reorder_projects("));
  assert.ok(removal.indexOf("terminals.invalidate_project") > 0);
  assert.ok(removal.indexOf("terminals.invalidate_project") < removal.indexOf("delete_project_task_settings("));
});

await test("terminal close confirmation is parented to its initiating native window", async () => {
  const lifecycle = await readFile(new URL("../src-tauri/src/application/terminal_lifecycle.rs", import.meta.url), "utf8");
  const close = lifecycle.slice(lifecycle.indexOf("pub(crate) fn request_close("), lifecycle.indexOf("pub(crate) fn request_exit("));
  assert.ok(close.includes(".parent(window)"));
});
