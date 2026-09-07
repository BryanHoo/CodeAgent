import { describe, expect, it } from "vitest";

import {
  draftToSchedule,
  defaultScheduleDraft,
  formatScheduledTime,
  scheduleToDraft,
} from "./scheduled-task-schedule.js";

describe("scheduled task schedule", () => {
  it("builds compact presets and preserves custom RRULE values", () => {
    const daily = draftToSchedule(
      { ...defaultScheduleDraft(), dateTime: "2030-01-02T09:15", time: "09:15", preset: "daily", rrule: "" },
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
        { ...defaultScheduleDraft(), dateTime: "2030-03-17T08:00", preset: "custom", rrule: custom.rrule },
        "Asia/Shanghai",
      ),
    ).toMatchObject({
      rrule: custom.rrule,
      timezone: "Asia/Shanghai",
      type: "rrule",
    });
  });

  it("uses explicit recurring fields independently of the once date", () => {
    const now = new Date(2030, 0, 2, 8).getTime();
    const draft = { ...defaultScheduleDraft(now), dateTime: "2040-12-25T23:59", time: "09:15" };
    expect(draftToSchedule({ ...draft, preset: "weekly", weekday: "FR" }, "Asia/Shanghai", now))
      .toMatchObject({ rrule: "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=15", startAtUnixMs: now });
    expect(draftToSchedule({ ...draft, preset: "monthly", monthDay: 31 }, "Asia/Shanghai", now))
      .toMatchObject({ rrule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=31;BYHOUR=9;BYMINUTE=15", startAtUnixMs: now });
    expect(draftToSchedule({ ...draft, dateTime: "", preset: "daily" }, "Asia/Shanghai", now))
      .toMatchObject({ rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=15" });
  });

  it("restores recurrence fields from the rule instead of its start date", () => {
    const schedule = { type: "rrule" as const, startAtUnixMs: new Date(2030, 0, 2, 8).getTime(), timezone: "Asia/Shanghai" };
    expect(scheduleToDraft({ ...schedule, rrule: "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=45" }))
      .toMatchObject({ preset: "weekly", weekday: "FR", time: "17:45" });
    expect(scheduleToDraft({ ...schedule, rrule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=31;BYHOUR=9;BYMINUTE=5" }))
      .toMatchObject({ preset: "monthly", monthDay: 31, time: "09:05" });
    for (const rrule of ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;BYHOUR=9;BYMINUTE=0", "RRULE:FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=0"]) {
      expect(scheduleToDraft({ ...schedule, rrule })).toMatchObject({ preset: "custom", rrule });
    }
  });

  it("rejects incomplete or invalid recurring fields", () => {
    const draft = { ...defaultScheduleDraft(), preset: "monthly" as const };
    for (const monthDay of [0, 32, 1.5, NaN]) {
      expect(draftToSchedule({ ...draft, monthDay }, "UTC")).toBeUndefined();
    }
    for (const time of ["", "25:00", "09:60"]) {
      expect(draftToSchedule({ ...draft, time }, "UTC")).toBeUndefined();
    }
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
