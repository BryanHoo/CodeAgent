import { describe, expect, it } from "vitest";

import {
  draftToSchedule,
  formatScheduledTime,
  scheduleToDraft,
} from "./scheduled-task-schedule.js";

describe("scheduled task schedule", () => {
  it("builds compact presets and preserves custom RRULE values", () => {
    const daily = draftToSchedule(
      { dateTime: "2030-01-02T09:15", preset: "daily", rrule: "" },
      "Asia/Shanghai",
    );
    expect(daily).toMatchObject({
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=15",
      timezone: "Asia/Shanghai",
      type: "rrule",
    });
    const custom = {
      rrule: "RRULE:FREQ=YEARLY;BYMONTH=6",
      startAtUnixMs: 1_900_000_000_000,
      timezone: "UTC",
      type: "rrule" as const,
    };
    expect(scheduleToDraft(custom)).toMatchObject({ preset: "custom", rrule: custom.rrule });
    expect(
      draftToSchedule(
        { dateTime: "2030-03-17T08:00", preset: "custom", rrule: custom.rrule },
        "Asia/Shanghai",
      ),
    ).toMatchObject({
      rrule: custom.rrule,
      timezone: "Asia/Shanghai",
      type: "rrule",
    });
  });

  it("formats scheduled times with the configured app language", () => {
    const unixMs = new Date(2030, 0, 2, 9, 15).getTime();
    expect(formatScheduledTime(unixMs, "en")).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(unixMs),
    );
    expect(formatScheduledTime(unixMs, "zh-CN")).toBe(
      new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(unixMs),
    );
  });
});
