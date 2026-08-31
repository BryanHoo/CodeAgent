import { Type, type Static } from "@sinclair/typebox";

export const RunningTaskSnapshotSchema = Type.Object(
  {
    projectId: Type.String({ maxLength: 128, minLength: 1 }),
    taskId: Type.String({ maxLength: 128, minLength: 1 }),
    taskName: Type.String({ maxLength: 512, minLength: 1 }),
  },
  { additionalProperties: false },
);

export type RunningTaskSnapshot = Readonly<Static<typeof RunningTaskSnapshotSchema>>;
