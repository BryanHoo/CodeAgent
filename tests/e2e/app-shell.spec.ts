import { expect, test } from "@playwright/test";

test("mounts the application shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-root")).toBeAttached();
});
