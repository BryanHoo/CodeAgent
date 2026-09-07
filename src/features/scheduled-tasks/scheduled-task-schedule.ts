import type { ScheduledTaskSchedule } from "@/protocol/index.js";

export type SchedulePreset = "once" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";
export const SCHEDULE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type ScheduleWeekday = (typeof SCHEDULE_WEEKDAYS)[number];

export type ScheduleDraft = Readonly<{
  dateTime: string;
  preset: SchedulePreset;
  rrule: string;
  time: string;
  weekday: ScheduleWeekday;
  monthDay: number;
}>;

export function resolveScheduledTaskLocale(language: string | undefined): "en" | "zh-CN" {
  return language === "en" ? "en" : "zh-CN";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toLocalDateTimeInput(unixMs: number): string {
  const date = new Date(unixMs);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function defaultScheduleDraft(now = Date.now()): ScheduleDraft {
  const date = new Date(now + 60 * 60 * 1_000);
  date.setSeconds(0, 0);
  return draftFromDate(date.getTime());
}

function draftFromDate(unixMs: number): ScheduleDraft {
  const date = new Date(unixMs);
  return {
    dateTime: toLocalDateTimeInput(unixMs),
    preset: "once",
    rrule: "",
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    weekday: SCHEDULE_WEEKDAYS[(date.getDay() + 6) % 7]!,
    monthDay: date.getDate(),
  };
}

export function scheduleToDraft(schedule: ScheduledTaskSchedule): ScheduleDraft {
  if (schedule.type === "once") return draftFromDate(schedule.atUnixMs);
  const draft = draftFromDate(schedule.startAtUnixMs);
  const custom: ScheduleDraft = { ...draft, preset: "custom", rrule: schedule.rrule };
  // 仅识别表单能完整表达的规则；额外约束或多值规则保留为自定义，避免保存时丢失语义。
  const entries = schedule.rrule.trim().replace(/^RRULE:/u, "").split(";").map((part) => part.split("="));
  if (entries.some((entry) => entry.length !== 2)) return custom;
  const fields = new Map(entries.map(([key, value]) => [key!, value!]));
  if (fields.size !== entries.length) return custom;
  const hour = fields.get("BYHOUR");
  const minute = fields.get("BYMINUTE");
  if (hour === undefined || minute === undefined || !/^\d{1,2}$/u.test(hour) || !/^\d{1,2}$/u.test(minute)) return custom;
  const time = `${pad(Number(hour))}:${pad(Number(minute))}`;
  if (!validTime(time)) return custom;
  const frequency = fields.get("FREQ");
  const weekday = fields.get("BYDAY");
  const monthDay = Number(fields.get("BYMONTHDAY"));
  if (frequency === "DAILY" && fields.size === 3) return { ...draft, preset: "daily", time };
  if (frequency === "WEEKLY" && fields.size === 4 && weekday !== undefined) {
    if (weekday === "MO,TU,WE,TH,FR") return { ...draft, preset: "weekdays", time };
    if (SCHEDULE_WEEKDAYS.includes(weekday as ScheduleWeekday)) {
      return { ...draft, preset: "weekly", time, weekday: weekday as ScheduleWeekday };
    }
  }
  if (frequency === "MONTHLY" && fields.size === 4 && validMonthDay(monthDay)) {
    return { ...draft, preset: "monthly", monthDay, time };
  }
  return custom;
}

function validTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/u.test(time);
}

function validMonthDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

export function draftToSchedule(
  draft: ScheduleDraft,
  timezone: string,
  now = Date.now(),
): ScheduledTaskSchedule | undefined {
  if (draft.preset === "once" || draft.preset === "custom") {
    const startAtUnixMs = new Date(draft.dateTime).getTime();
    if (!Number.isFinite(startAtUnixMs)) return undefined;
    if (draft.preset === "once") return { atUnixMs: startAtUnixMs, type: "once" };
    const rrule = draft.rrule.trim();
    return rrule === "" ? undefined : { rrule, startAtUnixMs, timezone, type: "rrule" };
  }
  if (!validTime(draft.time)) return undefined;
  if (draft.preset === "weekly" && !SCHEDULE_WEEKDAYS.includes(draft.weekday)) return undefined;
  if (draft.preset === "monthly" && !validMonthDay(draft.monthDay)) return undefined;
  const [hour, minute] = draft.time.split(":").map(Number);
  const time = `BYHOUR=${String(hour)};BYMINUTE=${String(minute)}`;
  const recurrence =
    draft.preset === "daily"
      ? `FREQ=DAILY;${time}`
      : draft.preset === "weekdays"
        ? `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;${time}`
        : draft.preset === "weekly"
          ? `FREQ=WEEKLY;BYDAY=${draft.weekday};${time}`
          : `FREQ=MONTHLY;BYMONTHDAY=${String(draft.monthDay)};${time}`;
  // 预设从保存时生效；清除秒数，后端 RRULE 引擎负责寻找下一次触发及跳过无对应月日的月份。
  const startAtUnixMs = Math.floor(now / 60_000) * 60_000;
  return { rrule: `RRULE:${recurrence}`, startAtUnixMs, timezone, type: "rrule" };
}

export function formatScheduledTime(unixMs: number | null, language: string | undefined): string {
  if (unixMs === null) return "-";
  return new Intl.DateTimeFormat(resolveScheduledTaskLocale(language), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(unixMs);
}
