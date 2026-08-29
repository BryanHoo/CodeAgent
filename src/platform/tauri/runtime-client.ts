import type { MutationOptions, ReadOptions } from "@/platform/native-client-types.js";
import type {
  AgentCapabilities,
  AppInfoResponse,
  HealthResponse,
  UploadAgentFeedbackRequest,
  UploadAgentFeedbackResponse,
  WorkbenchPetCatalogResponse,
  WorkbenchPetDownloadResponse,
} from "@/protocol/index.js";

import { TauriCatalogClient } from "./catalog-client.js";
import {
  mapNativePet,
  type NativePetCatalogResponse,
  type NativePetDownloadResponse,
} from "./workbench-pet-catalog.js";

export type NativeWorkbenchBackgroundResponse = Readonly<{ assetPath: string }>;

export class TauriRuntimeClient extends TauriCatalogClient {
  public async getHealth(_options: ReadOptions = {}): Promise<HealthResponse> {
    await this.ensureRuntime();
    return { status: "ok", version: 1 };
  }

  public async getCapabilities(_options: ReadOptions = {}): Promise<AgentCapabilities> {
    await this.ensureRuntime();
    return {
      feedback: { upload: true },
      goals: { clear: true, read: true, update: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: { compact: true, interrupt: true, review: true, start: true, steer: true },
    };
  }

  public async uploadFeedback(
    projectId: string,
    taskId: string,
    input: UploadAgentFeedbackRequest,
    _options: MutationOptions = {},
  ): Promise<UploadAgentFeedbackResponse> {
    return this.call("upload_feedback", { input, projectId, taskId });
  }

  public async getAppInfo(_options: ReadOptions = {}): Promise<AppInfoResponse> {
    return this.call("get_app_info");
  }

  public async getWorkbenchBackground(day: string): Promise<NativeWorkbenchBackgroundResponse> {
    return this.call("get_workbench_background", { day });
  }

  public async listWorkbenchPets(_options: ReadOptions = {}): Promise<WorkbenchPetCatalogResponse> {
    const response = await this.call<NativePetCatalogResponse>("list_workbench_pets");
    return { data: response.data.map(mapNativePet) };
  }

  public async downloadWorkbenchPet(
    petId: string,
    _options: MutationOptions = {},
  ): Promise<WorkbenchPetDownloadResponse> {
    const response = await this.call<NativePetDownloadResponse>("download_workbench_pet", {
      petId,
    });
    return { data: mapNativePet(response.data) };
  }
}
