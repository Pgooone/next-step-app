"use client";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "@/hooks/useTheme";
import { usePipelineStore } from "@/lib/stores/usePipelineStore";
import PipelineBoard from "@/components/PipelineBoard";
import PipelineEditor from "@/components/PipelineEditor";
import { DispatchContent } from "./DispatchPanel";

type PipelineModalProps = {
  projectId: string;
  /** 项目根目录（绝对路径）；透传给「快速派发」tab 的 DispatchContent（产物相对路径拼绝对路径）。 */
  projectRoot: string | null;
  onClose: () => void;
  onOpenArtifact: (artifactId: string) => void;
  /** 点击 assignment 产物链接时回调（绝对路径 + 文件名）；透传给 DispatchContent（T7 合并入口）。 */
  onOpenFile: (filePath: string, fileName: string) => void;
  /** T4 只透传给子组件，真正消费（进完整对话）在 T6（StageSessionMenu）。 */
  onOpenSession: (sessionId: string) => void;
  onArtifactsChanged?: () => void;
  onSessionsChanged?: () => void;
};

/**
 * 左栏「Pipeline」入口的模态外壳（仿 DispatchPanel.tsx:170-199 fixed inset-0 + backdrop 点击关闭）。
 * 两 tab：「流水线」=看板/编辑器（本地 view 切换）｜「快速派发」=占位（旧快派表单并入由 T7 接）。
 */
export default function PipelineModal({
  projectId,
  projectRoot,
  onClose,
  onOpenArtifact,
  onOpenFile,
  onOpenSession,
  onArtifactsChanged,
  onSessionsChanged,
}: PipelineModalProps) {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<"pipeline" | "dispatch">("pipeline");
  const [view, setView] = useState<"board" | "editor">("board");
  // 运行控制条选中的蓝图（D-R7-04：起 run 触发放模态、board 保持纯渲染）。
  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // 进模态即拉蓝图（决定空态/默认进哪个 view）。
  const { blueprints, loadBlueprints, loadRuns, startRun, selectRun } = usePipelineStore(
    useShallow((s) => ({
      blueprints: s.blueprints,
      loadBlueprints: s.loadBlueprints,
      loadRuns: s.loadRuns,
      startRun: s.startRun,
      selectRun: s.selectRun,
    })),
  );
  useEffect(() => {
    void loadBlueprints(projectId).catch(() => {});
  }, [projectId, loadBlueprints]);

  // 蓝图到位后把控制条默认选中第一个（仅当当前选中为空或已不在列表里时同步，避免覆盖用户手选）。
  useEffect(() => {
    if (blueprints.length === 0) return;
    setSelectedBlueprintId((prev) =>
      prev && blueprints.some((b) => b.id === prev) ? prev : blueprints[0].id,
    );
  }, [blueprints]);

  // 选中蓝图变化 → 拉其历史 run（看板 run 下拉用）；切蓝图时清当前视图（不串显旧 run）。
  useEffect(() => {
    if (!selectedBlueprintId) return;
    void loadRuns(projectId, selectedBlueprintId).catch(() => {});
  }, [projectId, selectedBlueprintId, loadRuns]);

  const handleStartRun = async () => {
    if (starting || !selectedBlueprintId) return;
    setStarting(true);
    setRunError(null);
    try {
      // 成功后 store 自动 set currentRun → board 渲染 live run、轮询自启。
      await startRun(projectId, selectedBlueprintId);
    } catch (e) {
      // 422（蓝图引用已删 agent）等后端错误就地显示一行。
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      data-testid="pipeline-modal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(720px, 94vw)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        {/* 头部：tab 头 + 关闭 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <TabButton active={tab === "pipeline"} onClick={() => setTab("pipeline")} testid="pipeline-tab">
            流水线
          </TabButton>
          <TabButton active={tab === "dispatch"} onClick={() => setTab("dispatch")} testid="dispatch-tab">
            快速派发
          </TabButton>
          <button
            onClick={onClose}
            title="关闭"
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {/* 主体 */}
        <div style={{ padding: 16, overflowY: "auto" }}>
          {tab === "pipeline" ? (
            view === "board" ? (
              <>
                {/* 运行控制条（D-R7-04）：选蓝图 + ▶运行；仅有蓝图时显示，无蓝图走 board 空态引导新建。 */}
                {blueprints.length > 0 && (
                  <div
                    data-testid="pipeline-run-bar"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 12,
                      padding: "8px 10px",
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  >
                    <select
                      data-testid="pipeline-run-blueprint"
                      value={selectedBlueprintId}
                      onChange={(e) => {
                        setRunError(null);
                        selectRun(null); // 切蓝图清当前视图，待新蓝图 loadRuns/起 run
                        setSelectedBlueprintId(e.target.value);
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        padding: "6px 8px",
                        background: "var(--bg)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      {blueprints.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button
                      data-testid="pipeline-run-btn"
                      onClick={handleStartRun}
                      disabled={starting || !selectedBlueprintId}
                      style={{
                        flexShrink: 0,
                        padding: "6px 14px",
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: 6,
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: starting || !selectedBlueprintId ? "not-allowed" : "pointer",
                        opacity: starting || !selectedBlueprintId ? 0.65 : 1,
                      }}
                    >
                      {starting ? "发起中…" : "▶ 运行"}
                    </button>
                  </div>
                )}
                {/* 资源警示（D-V1.2-41 红线变更三件套之②）：并发上限可配 + 风险自担。纯静态文本，不读运行时配置值。 */}
                {blueprints.length > 0 && (
                  <div
                    data-testid="pipeline-concurrency-note"
                    style={{
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: "var(--text-muted)",
                      marginBottom: 10,
                    }}
                  >
                    ⓘ 单进程并发会话默认上限 3、最高可配 100。可在 ~/.pi/factory-config.json 调整
                    maxConcurrentSessions；调高 = 更多会话同时跑，受 CPU 与下游模型限流约束、响应可能变慢（内存非瓶颈）。
                  </div>
                )}
                {runError && (
                  <div
                    data-testid="pipeline-run-error"
                    style={{ color: "#dc2626", fontSize: 12, lineHeight: 1.4, marginBottom: 10, overflowWrap: "anywhere" }}
                  >
                    {runError}
                  </div>
                )}
                <PipelineBoard
                  isDark={isDark}
                  onOpenArtifact={onOpenArtifact}
                  onOpenSession={onOpenSession}
                  onEditBlueprint={() => setView("editor")}
                />
              </>
            ) : (
              <PipelineEditor
                projectId={projectId}
                onSaved={(bp) => {
                  // 存完顺手把控制条选中新蓝图（blueprints 已在 store 更新），回看板。
                  if (bp?.id) setSelectedBlueprintId(bp.id);
                  setView("board");
                }}
                onCancel={() => setView("board")}
              />
            )
          ) : (
            <DispatchContent
              projectId={projectId}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
              onOpenArtifact={onOpenArtifact}
              onArtifactsChanged={onArtifactsChanged}
              onSessionsChanged={onSessionsChanged}
            />
          )}
          {/* 编辑器入口（看板视图常驻，便于新建/改蓝图） */}
          {tab === "pipeline" && view === "board" && blueprints.length > 0 && (
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button
                data-testid="pipeline-edit-btn"
                onClick={() => setView("editor")}
                style={{
                  fontSize: 12,
                  padding: "5px 12px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                + 新建流水线
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  testid,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      style={{
        padding: "6px 14px",
        background: active ? "var(--bg-hover)" : "none",
        border: "none",
        borderRadius: 8,
        color: active ? "var(--text)" : "var(--text-muted)",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
