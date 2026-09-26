import { expect, test } from "@playwright/test";

test("public shell and health endpoint work without provider requests", async ({
  page,
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ status: "ok", service: "bragi" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel("Authenticator 6 位驗證碼")).toBeVisible();
  await expect(page.getByRole("button", { name: "登入", exact: true })).toBeDisabled();
});
