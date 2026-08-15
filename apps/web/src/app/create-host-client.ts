import { CodeAgentClient } from "@code-agent/client";
import {
  createHostExternalUrlApi,
  createHostNotificationApi,
  createHostTransport,
} from "@code-agent/host-transport";

export function createHostClient(): CodeAgentClient {
  return new CodeAgentClient(createHostTransport());
}

// 应用生命周期内只创建一个宿主 Client，统一复用取消、订阅和认证监听状态。
export const codeAgentClient = createHostClient();
export const hostExternalUrlApi = createHostExternalUrlApi();
export const hostNotificationApi = createHostNotificationApi(codeAgentClient);
