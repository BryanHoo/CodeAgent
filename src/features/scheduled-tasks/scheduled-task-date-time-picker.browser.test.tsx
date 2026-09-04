import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "../../shared/styles/globals.css";
import "../../shared/styles/scheduled-tasks.css";
import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import { ScheduledTaskDateTimePicker } from "./scheduled-task-date-time-picker.js";

describe("ScheduledTaskDateTimePicker", () => {
  it("keeps the calendar icon outside the formatted value", async () => {
    await i18n.changeLanguage("en");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskDateTimePicker
          minimum="2029-01-01T00:00"
          onChange={() => undefined}
          value="2030-01-02T09:15"
        />
      </I18nextProvider>,
    );

    const input = screen.getByRole("textbox", { name: "Trigger time" });
    expect(input.element().getAttribute("lang")).toBe("en");
    expect(input.element().getAttribute("type")).toBe("text");
    expect(input.element().getAttribute("value")).toContain("Jan");

    const icon = document.querySelector(".react-datepicker__calendar-icon");
    expect(icon).toBeInstanceOf(SVGElement);
    expect(window.getComputedStyle(icon!).right).toBe("10px");
    expect(
      Number.parseFloat(window.getComputedStyle(input.element()).paddingRight),
    ).toBeGreaterThanOrEqual(36);
  });

  it("accepts an arbitrary minute instead of a fixed interval", async () => {
    await i18n.changeLanguage("en");
    const onChange = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskDateTimePicker
          minimum="2029-01-01T00:00"
          onChange={onChange}
          value="2030-01-02T09:15"
        />
      </I18nextProvider>,
    );

    const input = screen.getByRole("textbox", { name: "Trigger time" });
    await input.click();
    await screen.getByLabelText("Time", { exact: true }).fill("09:17");
    expect(onChange).toHaveBeenLastCalledWith("2030-01-02T09:17");
  });

  it("keeps the selected background while hovering the selected day", async () => {
    await i18n.changeLanguage("en");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskDateTimePicker
          minimum="2029-01-01T00:00"
          onChange={() => undefined}
          value="2030-01-02T09:15"
        />
      </I18nextProvider>,
    );

    await screen.getByRole("textbox", { name: "Trigger time" }).click();
    const selectedDay = screen.getByRole("gridcell", { selected: true });
    await expect.element(selectedDay).toBeVisible();
    const selectedBackground = getComputedStyle(selectedDay.element()).backgroundColor;
    await selectedDay.hover();

    expect(getComputedStyle(selectedDay.element()).backgroundColor).toBe(selectedBackground);
  });

  it("switches the visible date format to Chinese with the app language", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskDateTimePicker
          minimum="2029-01-01T00:00"
          onChange={() => undefined}
          value="2030-01-02T09:15"
        />
      </I18nextProvider>,
    );

    const input = screen.getByRole("textbox", { name: "触发时间" });
    expect(input.element().getAttribute("lang")).toBe("zh-CN");
    expect(input.element().getAttribute("value")).toContain("2030年1月2日");
  });
});
