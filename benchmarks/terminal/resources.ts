import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export type ResourceSample = { elapsedMs: number; appRssKiB: number; shellRssKiB: number; appCpuSeconds: number; shellCpuSeconds: number };

function cpuSeconds(value: string): number {
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export async function sampleResources(appPid: number, shellPids: number[], started: number): Promise<ResourceSample> {
  const { stdout } = await run("/bin/ps", ["-p", [appPid, ...shellPids].join(","), "-o", "pid=,rss=,time="], { maxBuffer: 16384 });
  const sample: ResourceSample = { elapsedMs: performance.now() - started, appRssKiB: 0, shellRssKiB: 0, appCpuSeconds: 0, shellCpuSeconds: 0 };
  // 仅查询已知测试进程的数值字段，不读取 args、comm 或环境变量。
  for (const row of stdout.trim().split("\n")) {
    const [pid, rss, time] = row.trim().split(/\s+/);
    if (Number(pid) === appPid) { sample.appRssKiB = Number(rss); sample.appCpuSeconds = cpuSeconds(time!); }
    else { sample.shellRssKiB += Number(rss); sample.shellCpuSeconds += cpuSeconds(time!); }
  }
  return sample;
}

export function summarizeResources(samples: ResourceSample[]) {
  const first = samples[0]!;
  const last = samples.at(-1)!;
  return {
    appCpuPercent: (last.appCpuSeconds - first.appCpuSeconds) / ((last.elapsedMs - first.elapsedMs) / 1000) * 100,
    shellCpuPercent: (last.shellCpuSeconds - first.shellCpuSeconds) / ((last.elapsedMs - first.elapsedMs) / 1000) * 100,
    appRssKiB: { first: first.appRssKiB, last: last.appRssKiB, max: Math.max(...samples.map((sample) => sample.appRssKiB)) },
    shellRssKiB: { first: first.shellRssKiB, last: last.shellRssKiB, max: Math.max(...samples.map((sample) => sample.shellRssKiB)) },
  };
}
