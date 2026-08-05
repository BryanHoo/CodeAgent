export type BuildPlanAction = () => Promise<boolean>;
export type ForkTaskAction = (idempotencyKey: string) => Promise<void>;
