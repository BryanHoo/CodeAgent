import type { ReactNode } from "react";

import type { TaskNotifier } from "../notifications/desktop-task-notifier.js";
import type { NativeWorkbenchClient } from "./project-queries.js";

export type ProjectProviderProps = Readonly<{
  children: ReactNode;
  client?: NativeWorkbenchClient;
  taskNotifier?: TaskNotifier;
}>;
