import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

const MIN_SESSION_TTL_MS = 60_000;
const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const UNIT_MS = { d: 24 * 60 * 60 * 1_000, h: 60 * 60 * 1_000, m: 60_000 } as const;

export const DEFAULT_LAN_SESSION_TTL = "24h";

export function parseSessionTtl(value: string): number {
  const match = /^(\d+)([mhd])$/u.exec(value);
  if (match === null) {
    throw new Error("Invalid session TTL; use a positive integer followed by m, h, or d");
  }
  const amount = BigInt(match[1] ?? "0");
  const unit = match[2] as keyof typeof UNIT_MS;
  const milliseconds = amount * BigInt(UNIT_MS[unit]);
  if (milliseconds < BigInt(MIN_SESSION_TTL_MS) || milliseconds > BigInt(MAX_SESSION_TTL_MS)) {
    throw new Error("Invalid session TTL; expected a duration from 1m through 30d");
  }
  return Number(milliseconds);
}

export function generateLanPairingCode(): string {
  // 16 个随机字节提供 128 bit 熵，Base64URL 可安全人工传递且不会进入 URL。
  return randomBytes(16).toString("base64url");
}

export function listLanAccessUrls(
  port: number,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): readonly string[] {
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal && isIP(entry.address) === 4)
    .map((entry) => entry.address);
  return [...new Set(addresses)]
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((address) => `http://${address}:${String(port)}`);
}
