import type { MutationOptions, ReadOptions } from "@/platform/native-client-types.js";
import type {
  AgentGlobalSettings,
  AgentGlobalSettingsResponse,
  AgentMcpServerPage,
  AgentModelPage,
  AgentProjectDefaults,
  AgentProjectDefaultsResponse,
  AgentProviderConnectionMutationResponse,
  AgentProviderConnectionStatus,
  AgentSkillPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
  StartOfficialProviderLoginResponse,
} from "@/protocol/index.js";

import { TauriWorkspaceClient } from "./workspace-client.js";

export class TauriCatalogClient extends TauriWorkspaceClient {
  public async listModels(_options: ReadOptions = {}): Promise<AgentModelPage> {
    return this.call("list_models");
  }

  public async getProviderConnection(
    _options: ReadOptions = {},
  ): Promise<AgentProviderConnectionStatus> {
    return this.call("get_provider_connection");
  }

  public async startOfficialProviderLogin(
    _options: MutationOptions = {},
  ): Promise<StartOfficialProviderLoginResponse> {
    return this.call("start_official_provider_login");
  }

  public async cancelProviderLogin(
    loginId: string,
    _options: MutationOptions = {},
  ): Promise<AgentProviderConnectionMutationResponse> {
    return this.call("cancel_provider_login", { loginId });
  }

  public async configureCustomProvider(
    input: ConfigureCustomProviderRequest,
    _options: MutationOptions = {},
  ): Promise<ConfigureCustomProviderResponse> {
    return this.call("configure_custom_provider", { input });
  }

  public async logoutProvider(
    _options: MutationOptions = {},
  ): Promise<AgentProviderConnectionMutationResponse> {
    return this.call("logout_provider");
  }

  public async getGlobalSettings(
    _options: ReadOptions = {},
  ): Promise<AgentGlobalSettingsResponse> {
    return this.call("get_global_settings");
  }

  public async updateGlobalSettings(
    settings: AgentGlobalSettings,
    _options: MutationOptions = {},
  ): Promise<AgentGlobalSettingsResponse> {
    return this.call("update_global_settings", { settings });
  }

  public async getProjectDefaults(
    projectId: string,
    _options: ReadOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.call("get_project_defaults", { projectId });
  }

  public async updateProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
    _options: MutationOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.call("update_project_defaults", { projectId, settings });
  }

  public async listSkills(
    projectId: string,
    _options: ReadOptions = {},
  ): Promise<AgentSkillPage> {
    return this.call("list_skills", { forceReload: false, projectId });
  }

  public async listMcpServers(
    projectId: string,
    taskId: string,
    _options: ReadOptions = {},
  ): Promise<AgentMcpServerPage> {
    return this.call("list_mcp_servers", { projectId, taskId });
  }

  public async retryMcpServers(
    projectId: string,
    taskId: string,
    _options: MutationOptions = {},
  ): Promise<AgentMcpServerPage> {
    return this.call("retry_mcp_servers", { projectId, taskId });
  }
}
