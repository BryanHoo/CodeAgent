import { lazy, Suspense, useMemo, useState } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Input } from "../../shared/components/core/input.js";
import {
  SCHEDULE_WEEKDAYS,
  resolveScheduledTaskLocale,
  toLocalDateTimeInput,
  type ScheduleDraft,
  type SchedulePreset,
  type ScheduleWeekday,
} from "./scheduled-task-schedule.js";

// 日历仅在一次性或自定义任务需要日期时加载，重复预设使用轻量原生控件。
const ScheduledTaskDateTimePicker = lazy(async () => {
  const module = await import("./scheduled-task-date-time-picker.js");
  return { default: module.ScheduledTaskDateTimePicker };
});
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

export function ScheduledTaskScheduleFields({
  schedule,
  onChange,
}: Readonly<{
  schedule: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
}>) {
  const { i18n, t } = useTranslation("workbench");
  const [minimum] = useState(() => toLocalDateTimeInput(Date.now()));
  const needsDate = schedule.preset === "once" || schedule.preset === "custom";
  const language = resolveScheduledTaskLocale(i18n.resolvedLanguage);
  const weekdayNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(language, { timeZone: "UTC", weekday: "short" });
    // 固定从周一开始的 UTC 日期，避免宿主时区改变星期标签。
    return SCHEDULE_WEEKDAYS.map((_, index) => formatter.format(new Date(Date.UTC(2024, 0, index + 1))));
  }, [language]);

  return (
    <>
      <label>
        <span>{t("scheduledTasks.repeat")}</span>
        <select
          onChange={(event) => onChange({ ...schedule, preset: event.currentTarget.value as SchedulePreset })}
          value={schedule.preset}
        >
          {(["once", "daily", "weekdays", "weekly", "monthly", "custom"] as const).map((preset) => (
            <option key={preset} value={preset}>{t(`scheduledTasks.${preset}`)}</option>
          ))}
        </select>
      </label>
      {schedule.preset === "weekly" ? (
        <label>
          <span>{t("scheduledTasks.weekday")}</span>
          <select
            onChange={(event) => onChange({ ...schedule, weekday: event.currentTarget.value as ScheduleWeekday })}
            value={schedule.weekday}
          >
            {SCHEDULE_WEEKDAYS.map((day, index) => <option key={day} value={day}>{weekdayNames[index]}</option>)}
          </select>
        </label>
      ) : null}
      {schedule.preset === "monthly" ? (
        <label>
          <span>{t("scheduledTasks.monthDay")}</span>
          <select
            onChange={(event) => onChange({ ...schedule, monthDay: Number(event.currentTarget.value) })}
            value={schedule.monthDay}
          >
            {MONTH_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
          </select>
        </label>
      ) : null}
      {needsDate ? (
        // 日历包含多个交互元素，不能嵌入 label，否则整行点击会转发并反复切换焦点。
        <div className="scheduled-task-field">
          <span>{t("scheduledTasks.time")}</span>
          <Suspense fallback={<Input aria-label={t("scheduledTasks.time")} aria-busy="true" disabled value="" />}>
            <ScheduledTaskDateTimePicker
              minimum={schedule.preset === "once" ? minimum : ""}
              onChange={(dateTime) => onChange({ ...schedule, dateTime })}
              value={schedule.dateTime}
            />
          </Suspense>
        </div>
      ) : (
        <label>
          <span>{t("scheduledTasks.timeOfDay")}</span>
          <Input
            onChange={(event) => onChange({ ...schedule, time: event.currentTarget.value })}
            step={60}
            type="time"
            value={schedule.time}
          />
        </label>
      )}
      {schedule.preset === "custom" ? (
        <label className="scheduled-task-fields__wide">
          <span>{t("scheduledTasks.rrule")}</span>
          <Input
            maxLength={2_048}
            onChange={(event) => onChange({ ...schedule, rrule: event.currentTarget.value })}
            placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0"
            spellCheck={false}
            value={schedule.rrule}
          />
        </label>
      ) : null}
    </>
  );
}
