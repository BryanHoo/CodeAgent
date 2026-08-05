export {
  CodeAgentHttpError,
  CodeAgentMutationError,
  CodeAgentResponseError,
  buildProjectAttachmentUrl,
  buildProjectImageFileUrl,
  buildTaskAttachmentUrl,
  type AgentAttachmentUploadInput,
  type CodeAgentClientOptions,
  type CodeAgentRequestTimeouts,
  type ListTasksOptions,
  type MutationOptions,
  type PendingRequestResolution,
  type ReadOptions,
  type UnauthorizedListener,
} from "./http-client-transport.js";
export { ProjectHttpClient } from "./http-client-projects.js";
export { TaskHttpClient } from "./http-client-tasks.js";

import { TaskHttpClient } from "./http-client-tasks.js";

export class CodeAgentClient extends TaskHttpClient {}
