import {
  BracesIcon,
  CheckIcon,
  CircleDotIcon,
  FolderTreeIcon,
  GitCommitHorizontalIcon,
  HistoryIcon,
  ListChecksIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
  ServerIcon,
  TerminalIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";

import type { WorkbenchDispatch } from "@/app/app-shell";
import { CHANGES, FILE_TREE } from "@/app/workbench-data";
import type { InspectorTab, WorkbenchState } from "@/app/workbench-state";
import { FileTree } from "@/components/ai-elements/file-tree";
import { Button } from "@/components/ui/button";

const DiffViewer = lazy(async () => {
  const module = await import("@/components/ai-elements/diff-viewer");
  return { default: module.DiffViewer };
});
const WORKBENCH_PATCH = `--- a/src/app/app-shell.tsx
+++ b/src/app/app-shell.tsx
@@ -28,3 +28,3 @@ export function AppShell() {
   return (
-  grid-template-columns: 292px minmax(0, 1fr) 328px;
+  grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--inspector-width);
   );
`;

const tabs: readonly Readonly<{ icon: typeof FolderTreeIcon; label: string; value: InspectorTab }>[] = [
  { icon: FolderTreeIcon, label: "项目", value: "project" },
  { icon: GitCommitHorizontalIcon, label: "更改", value: "changes" },
  { icon: BracesIcon, label: "上下文", value: "context" },
  { icon: HistoryIcon, label: "历史", value: "history" },
];

export function ProjectPanel({
  dispatch,
  state,
}: Readonly<{ dispatch: WorkbenchDispatch; state: WorkbenchState }>) {
  return (
    <aside className="workbench-inspector" id="workbench-inspector" aria-label="工作台检查器">
      <header className="inspector-tabs" role="tablist">
        {tabs.map(({ icon: Icon, label, value }) => (
          <button aria-selected={state.inspectorTab === value} key={value} onClick={() => dispatch({ tab: value, type: "selectInspectorTab" })} role="tab" type="button"><Icon aria-hidden="true" /><span>{label}</span>{value === "changes" ? <small>3</small> : null}</button>
        ))}
        <Button aria-label="收起检查器" onClick={() => dispatch({ type: "toggleInspector" })} size="icon" title="收起检查器" variant="ghost"><PanelRightCloseIcon aria-hidden="true" /></Button>
      </header>
      <div className="inspector-content" role="tabpanel">
        {state.inspectorTab === "project" ? <ProjectView /> : null}
        {state.inspectorTab === "changes" ? <ChangesView /> : null}
        {state.inspectorTab === "context" ? <ContextView /> : null}
        {state.inspectorTab === "history" ? <HistoryView /> : null}
      </div>
    </aside>
  );
}

function ProjectView() {

  return (
    <div className="project-inspector-view">
      <div className="inspector-project-heading"><div><strong>CodeAgent</strong><span>~/Develop/person/CodeAgent</span></div><Button aria-label="刷新项目" size="icon" title="刷新项目" variant="ghost"><RefreshCwIcon aria-hidden="true" /></Button></div>
      <div className="inspector-root"><GitCommitHorizontalIcon aria-hidden="true" /><span>main</span><small>3 个更改</small></div>
      <FileTree entries={FILE_TREE} onSelect={(name) => toast.info(`已选择 ${name}`)} />
    </div>
  );
}

function ChangesView() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(CHANGES.map((change) => change.path)));
  const [message, setMessage] = useState("feat(workbench): 复刻桌面工作台");
  const toggle = (path: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  return (
    <div className="changes-view">
      <div className="inspector-section-title"><div><strong>工作区更改</strong><span>+406 −130</span></div><Button aria-label="刷新更改" size="icon" variant="ghost"><RefreshCwIcon aria-hidden="true" /></Button></div>
      <div className="change-list">{CHANGES.map((change) => <label className="change-row" key={change.path}><input checked={selected.has(change.path)} onChange={() => toggle(change.path)} type="checkbox" /><span className={`change-status change-status--${change.status.toLowerCase()}`}>{change.status}</span><span>{change.path}</span><small><b>+{change.additions}</b> <i>−{change.deletions}</i></small></label>)}</div>
      <div className="diff-preview"><header><span>app-shell.tsx</span><small>1 / 3 files</small></header><Suspense fallback={<div className="diff-loading">正在加载差异...</div>}><DiffViewer patch={WORKBENCH_PATCH} /></Suspense></div>
      <div className="commit-box"><label><span>提交消息</span><textarea onChange={(event) => setMessage(event.currentTarget.value)} rows={2} value={message} /></label><button disabled={selected.size === 0 || message.trim().length === 0} onClick={() => toast.success("本地演示提交已创建")} type="button"><GitCommitHorizontalIcon aria-hidden="true" />提交 {selected.size} 个文件</button></div>
    </div>
  );
}

function ContextView() {
  const [goalPaused, setGoalPaused] = useState(false);
  return (
    <div className="context-view">
      <section className="context-card"><header><TargetDot /><strong>目标</strong><button onClick={() => setGoalPaused((value) => !value)} type="button">{goalPaused ? "继续" : "暂停"}</button></header><p>完整复刻 Codexly 桌面工作台的前端功能、交互与设计。</p><div className={goalPaused ? "goal-state paused" : "goal-state"}><CircleDotIcon aria-hidden="true" />{goalPaused ? "已暂停" : "进行中"}</div></section>
      <section className="context-card"><header><ListChecksIcon aria-hidden="true" /><strong>计划</strong><span>3 / 4</span></header><ul><li className="done"><CheckIcon aria-hidden="true" />建立全局 tokens</li><li className="done"><CheckIcon aria-hidden="true" />重建工作台布局</li><li className="done"><CheckIcon aria-hidden="true" />补齐前端交互</li><li><CircleDotIcon aria-hidden="true" />视觉与性能验证</li></ul></section>
      <section className="context-card"><header><TerminalIcon aria-hidden="true" /><strong>后台终端</strong><span>1</span></header><div className="runtime-row"><span className="running-dot" /><code>pnpm check:web</code><small>运行中</small></div></section>
      <section className="context-card"><header><ServerIcon aria-hidden="true" /><strong>MCP 服务器</strong><span>2</span></header><div className="runtime-row"><span className="online-dot" /><span>fast-context</span><small>不可用</small></div><div className="runtime-row"><span className="online-dot" /><span>filesystem</span><small>已连接</small></div></section>
    </div>
  );
}

function TargetDot() {
  return <span className="target-dot" aria-hidden="true"><CircleDotIcon /></span>;
}

function HistoryView() {
  const commits = [{ hash: "a48f7d1", message: "完善运行时状态投影", time: "2 小时前" }, { hash: "1c9b602", message: "建立 Tauri 桌面端基础结构", time: "昨天" }, { hash: "a13d8e4", message: "初始化 CodeAgent 项目", time: "3 天前" }];
  return <div className="history-view"><div className="inspector-section-title"><div><strong>Git 历史</strong><span>main</span></div><Button aria-label="刷新历史" size="icon" variant="ghost"><RefreshCwIcon aria-hidden="true" /></Button></div><div className="commit-list">{commits.map((commit, index) => <button key={commit.hash} type="button"><span className="commit-graph"><i />{index < commits.length - 1 ? <b /> : null}</span><span><strong>{commit.message}</strong><small>{commit.hash} · BryanHu · {commit.time}</small></span></button>)}</div></div>;
}
