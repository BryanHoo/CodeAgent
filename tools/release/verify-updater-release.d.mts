export interface VerifySignatureInput {
  artifactPath: string;
  publicKeyPath: string;
  signaturePath: string;
}

export interface UpdaterManifest {
  version: string;
  platforms: Record<string, { signature: string; url: string }>;
}

export interface UpdaterRelease {
  assets: { id: number; name: string }[];
  draft: boolean;
  tag_name: string;
}

export function verifyUpdaterRelease(options: {
  artifactDirectory: string;
  expectedTag: string;
  expectedVersion: string;
  manifest: UpdaterManifest;
  publicKeyPath: string;
  release: UpdaterRelease;
  verifySignature: (input: VerifySignatureInput) => boolean | Promise<boolean>;
}): Promise<{ mode: "bootstrap"; platformCount: number }>;
