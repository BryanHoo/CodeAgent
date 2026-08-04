import { LAN_PAIRING_CODE, expect, test } from "./fixtures/lan-access.js";

test("pairs real browsers, persists the cookie, and invalidates it on logout", async ({
  browser,
  lanServerUrl,
  page,
}) => {
  const businessRequests: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/projects")) {
      businessRequests.push(request.url());
    }
  });
  page.on("websocket", (socket) => sockets.push(socket.url()));

  await page.goto("/p/code-agent/t/task-realtime");
  await expect(page.getByRole("region", { name: "CodeAgent" })).toContainText("连接可信局域网会话");
  expect(businessRequests).toEqual([]);
  expect(sockets).toEqual([]);

  const codeInput = page.getByRole("textbox", { name: "配对码" });
  await expect(page.locator("#access-pairing-code")).toHaveCount(1);
  await codeInput.focus();
  await expect(codeInput).toHaveCSS("outline-style", "none");
  await codeInput.fill("wrong-pairing-code");
  await page.getByRole("button", { name: "配对" }).click();
  await expect(page.getByRole("alert")).toContainText("无法完成配对");
  await expect(page.getByRole("button", { name: "切换项目 CodeAgent" })).toHaveCount(0);

  await codeInput.fill(LAN_PAIRING_CODE);
  await page.getByRole("button", { name: "配对" }).click();
  await expect(page.getByRole("button", { name: "切换项目 CodeAgent" })).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);

  const cookies = await page.context().cookies(lanServerUrl);
  expect(cookies).toContainEqual(
    expect.objectContaining({
      httpOnly: true,
      name: "codeagent_session",
      sameSite: "Strict",
      secure: false,
    }),
  );

  await page.reload();
  await expect(page.getByRole("button", { name: "切换项目 CodeAgent" })).toBeVisible();

  const otherContext = await browser.newContext({ baseURL: lanServerUrl, locale: "zh-CN" });
  try {
    const otherPage = await otherContext.newPage();
    await otherPage.goto("/");
    await expect(otherPage.getByRole("region", { name: "CodeAgent" })).toContainText(
      "连接可信局域网会话",
    );
  } finally {
    await otherContext.close();
  }

  await page.getByRole("button", { name: /设置，终端连接状态/u }).click();
  const dialog = page.getByRole("dialog", { name: "全局设置" });
  await dialog.getByRole("button", { name: "局域网访问" }).click();
  await dialog.getByRole("button", { name: "退出局域网访问" }).click();

  await expect(page.getByRole("region", { name: "CodeAgent" })).toContainText("连接可信局域网会话");
  await expect(page.getByRole("button", { name: "切换项目 CodeAgent" })).toHaveCount(0);
});
