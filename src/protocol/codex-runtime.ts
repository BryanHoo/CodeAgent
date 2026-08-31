export type CodexRuntimeAvailabilityStatus =
  | "compatible"
  | "failed"
  | "incompatible"
  | "missing";

export type CodexRuntimeAvailability = Readonly<{
  detectedVersion: string | null;
  globalInstallCommand: string;
  requiredVersion: string;
  status: CodexRuntimeAvailabilityStatus;
}>;

export type CodexRuntimeInstallProgress = Readonly<{
  downloadedBytes: number;
  sequence: number;
  totalBytes: number | null;
}>;
