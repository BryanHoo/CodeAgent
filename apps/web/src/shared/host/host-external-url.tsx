import { createContext, useContext, type ReactNode } from "react";

export type HostExternalUrlOpener = (url: string) => void;

const HostExternalUrlContext = createContext<HostExternalUrlOpener | undefined>(undefined);

export function HostExternalUrlProvider({
  children,
  open,
}: Readonly<{ children: ReactNode; open: HostExternalUrlOpener | undefined }>) {
  return <HostExternalUrlContext.Provider value={open}>{children}</HostExternalUrlContext.Provider>;
}

export function useHostExternalUrl(): HostExternalUrlOpener | undefined {
  return useContext(HostExternalUrlContext);
}
