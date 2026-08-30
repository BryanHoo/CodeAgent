import type { ConversationItemRenderMode } from "../../../shared/components/agent/conversation.js";
import type { NormalizedAgentTurn } from "../../conversation/runtime/task-store.js";

const HOT_TURN_COUNT = 3;

export function getTaskTurnRenderMode(
  turn: Pick<NormalizedAgentTurn, "status"> | undefined,
  turnIndex: number,
  turnCount: number,
): ConversationItemRenderMode {
  // 运行中或尚未完成水合的 Turn 保持热渲染，避免实时内容被浏览器跳过。
  if (turn === undefined || turn.status === "running") return "hot";
  return turnIndex >= Math.max(0, turnCount - HOT_TURN_COUNT) ? "hot" : "cold";
}
