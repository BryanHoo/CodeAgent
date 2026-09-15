import { useEffect, useRef } from "react";

type GitStatusQuery = Readonly<{
  isPending: boolean;
  refetch: () => Promise<unknown>;
}>;

export function useProjectGitStatusRouteRefresh(
  routeScope: string,
  enabled: boolean,
  query: GitStatusQuery,
): void {
  const previousRouteScopeRef = useRef<string | undefined>(undefined);
  const { isPending, refetch } = query;

  useEffect(() => {
    const routeChanged = previousRouteScopeRef.current !== routeScope;
    previousRouteScopeRef.current = routeScope;
    // 首次无缓存加载已经在请求；复用缓存或切换任务时必须重新读取。
    if (!enabled || !routeChanged || isPending) return;
    void refetch();
  }, [enabled, isPending, refetch, routeScope]);
}

export function useProjectGitDetailsRefresh(
  scope: string,
  enabled: boolean,
  statusSnapshot: string | undefined,
  detailsSnapshot: string | undefined,
  fetching: boolean,
  refetch: () => Promise<unknown>,
): void {
  const refreshedMismatchRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled || statusSnapshot === undefined || detailsSnapshot === undefined || fetching) return;
    if (statusSnapshot === detailsSnapshot) {
      refreshedMismatchRef.current = undefined;
      return;
    }
    // 文件可能在轻量读取与详情读取之间再次修改；补读当前状态，让详情查询切换到真实快照。
    // 同一不一致只校准一次，避免读取失败或仓库持续变化造成重复请求。
    const mismatch = JSON.stringify([scope, statusSnapshot, detailsSnapshot]);
    if (refreshedMismatchRef.current === mismatch) return;
    refreshedMismatchRef.current = mismatch;
    void refetch();
  }, [detailsSnapshot, enabled, fetching, refetch, scope, statusSnapshot]);
}
