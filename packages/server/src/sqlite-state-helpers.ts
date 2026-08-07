import { createHash } from "node:crypto";

export function createProjectId(name: string, rootPath: string): string {
  const slug = name
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  const hash = createHash("sha256").update(rootPath).digest("hex").slice(0, 12);
  return `${slug || "project"}-${hash}`;
}

export function deserializeWorkerError(error: Readonly<{ message: string; name: string }>): Error {
  const result = new Error(error.message);
  result.name = error.name;
  return result;
}
