import { ArchiveIcon, FolderPlusIcon, MoonIcon, PaletteIcon, SunIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import type { WorkbenchDispatch } from "@/app/app-shell";
import type { WorkbenchState } from "@/app/workbench-state";
import { Button } from "@/components/ui/button";

export function WorkbenchDialogs({
  dispatch,
  state,
}: Readonly<{ dispatch: WorkbenchDispatch; state: WorkbenchState }>) {
  if (state.dialog === null) return null;

  return (
    <DialogPrimitive.Root
      onOpenChange={(open) => {
        if (!open) dispatch({ type: "closeDialog" });
      }}
      open
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-backdrop" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          aria-label={dialogTitles[state.dialog]}
          className="workbench-dialog"
        >
        <header className="dialog-header">
          <div><span className="dialog-eyebrow">CodeAgent</span><DialogPrimitive.Title asChild><h2>{dialogTitles[state.dialog]}</h2></DialogPrimitive.Title></div>
          <Button aria-label="关闭弹窗" onClick={() => dispatch({ type: "closeDialog" })} size="icon" variant="ghost"><XIcon aria-hidden="true" /></Button>
        </header>
        {state.dialog === "settings" ? <SettingsDialog dispatch={dispatch} state={state} /> : null}
        {state.dialog === "project" ? <ProjectDialog dispatch={dispatch} /> : null}
        {state.dialog === "archived" ? <ArchivedDialog dispatch={dispatch} /> : null}
        {state.dialog === "task" ? <RenameTaskDialog dispatch={dispatch} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const dialogTitles = {
  archived: "已归档任务",
  project: "添加项目",
  settings: "全局设置",
  task: "重命名任务",
} as const;

function SettingsDialog({
  dispatch,
  state,
}: Readonly<{ dispatch: WorkbenchDispatch; state: WorkbenchState }>) {
  const [section, setSection] = useState<"appearance" | "general">("general");
  return (
    <div className="settings-layout">
      <nav aria-label="设置分类" className="settings-nav">
        <button aria-current={section === "general" ? "page" : undefined} onClick={() => setSection("general")} type="button"><FolderPlusIcon aria-hidden="true" />通用</button>
        <button aria-current={section === "appearance" ? "page" : undefined} onClick={() => setSection("appearance")} type="button"><PaletteIcon aria-hidden="true" />外观</button>
      </nav>
      <div className="settings-content">
        {section === "general" ? (
          <><h3>工作台</h3><label className="settings-field"><span><strong>默认编辑器</strong><small>从工作台快速打开项目时使用</small></span><select defaultValue="Zed"><option>Zed</option><option>Visual Studio Code</option><option>Finder</option></select></label><label className="settings-field"><span><strong>桌面通知</strong><small>任务完成或等待确认时提醒</small></span><input defaultChecked type="checkbox" /></label></>
        ) : (
          <><h3>主题</h3><div className="theme-segmented" role="group" aria-label="主题选择"><button aria-pressed={state.theme === "light"} onClick={() => state.theme === "dark" && dispatch({ type: "toggleTheme" })} type="button"><SunIcon aria-hidden="true" />浅色</button><button aria-pressed={state.theme === "dark"} onClick={() => state.theme === "light" && dispatch({ type: "toggleTheme" })} type="button"><MoonIcon aria-hidden="true" />深色</button></div><label className="settings-field"><span><strong>紧凑密度</strong><small>适合长时间浏览任务和文件</small></span><input defaultChecked type="checkbox" /></label></>
        )}
      </div>
    </div>
  );
}

function ProjectDialog({ dispatch }: Readonly<{ dispatch: WorkbenchDispatch }>) {
  const [path, setPath] = useState("~/Develop/person/");
  return <div className="dialog-body"><div className="dialog-symbol"><FolderPlusIcon aria-hidden="true" /></div><p>选择本地目录并添加到项目列表。</p><label className="dialog-input"><span>目录路径</span><input onChange={(event) => setPath(event.currentTarget.value)} value={path} /></label><footer className="dialog-actions"><Button onClick={() => dispatch({ type: "closeDialog" })} variant="ghost">取消</Button><Button onClick={() => dispatch({ type: "closeDialog" })}>添加项目</Button></footer></div>;
}

function ArchivedDialog({ dispatch }: Readonly<{ dispatch: WorkbenchDispatch }>) {
  return <div className="dialog-body"><div className="archived-row"><ArchiveIcon aria-hidden="true" /><span><strong>验证桌面端打包流程</strong><small>归档于 2 天前</small></span><Button variant="outline">恢复</Button></div><div className="archived-row"><ArchiveIcon aria-hidden="true" /><span><strong>清理旧工作台样式</strong><small>归档于 5 天前</small></span><Button variant="outline">恢复</Button></div><footer className="dialog-actions"><Button onClick={() => dispatch({ type: "closeDialog" })}>完成</Button></footer></div>;
}

function RenameTaskDialog({ dispatch }: Readonly<{ dispatch: WorkbenchDispatch }>) {
  const [title, setTitle] = useState("借鉴 Codexly 完善工作台");
  return <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); dispatch({ type: "closeDialog" }); }}><label className="dialog-input"><span>任务名称</span><input autoFocus onChange={(event) => setTitle(event.currentTarget.value)} value={title} /></label><footer className="dialog-actions"><Button onClick={() => dispatch({ type: "closeDialog" })} variant="ghost">取消</Button><Button type="submit">保存</Button></footer></form>;
}
