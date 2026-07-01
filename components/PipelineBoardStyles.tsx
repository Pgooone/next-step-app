"use client";

/**
 * Kimi(A) 块样式（CSS 变量 token + 组件类 + 关键帧），亮/暗双主题；严格对照 看板视觉定稿-kimi-v11.html。
 *
 * **抽取自** PipelineBoard.tsx 原内联 `PipelineBoardStyles()`（第七轮 T4）——第 8.6 轮 T5 把 `.brow` 卡片
 * 内联进 ChatWindow 时，`.brow` 全部 CSS 与 `--run-accent/--card/--sub/--line/--pop` 等 token **只**定义在
 * `.pipeline-board.t-kimi-{light|dark}` 作用域内。为让 PipelineBoard 与 MastermindTeammateCards 两处共用
 * **同一份**样式（不复制粘贴、避免漂移），抽成独立 exported 组件；两处都渲一次即可（`<style>` 幂等去重）。
 *
 * ⚠️ T7 交汇铁律：本 `<style>` 内含 `.btn`（无）/ pb-breathe / pb-pulse-led 等动画属 T7 打磨范畴。
 * T5 仅原样搬运、**不改任何一行**；T7 再在此 re-read 修（reduced-motion 守卫等）。
 */
export default function PipelineBoardStyles() {
  return (
    <style>{`
.pipeline-board.t-kimi-light{--bg:#eceef1;--container:#fff;--card:#fff;--card-bd:transparent;--text:#191a1c;--sub:#7c7c84;--task:#9a9aa1;--line:#cdcdd3;--accent:#0a84ff;--run-bg:#eef5ff;--run-accent:#0a84ff;--run-glow:rgba(10,132,255,.15);--led:#10b981;--ledoff:#d6d8dc;--done-bg:rgba(16,185,129,.13);--done-fg:#0a9d6e;--badge-bg:#eef0f3;--badge-fg:#8a8a90;--pop:#fff;--avab:rgba(0,0,0,.06);--error:#ff3b30;--bg-hover:#f3f3f5;--border:#cdcdd3;--text-muted:#7c7c84}
.pipeline-board.t-kimi-dark{--bg:#0c0c0e;--container:#161619;--card:transparent;--card-bd:transparent;--text:#e9e9ec;--sub:#8a8a90;--task:#6e6e74;--line:#46464c;--accent:#3b9eff;--run-bg:#11161f;--run-accent:#3b9eff;--run-glow:rgba(59,158,255,.3);--led:#30d158;--ledoff:#3a3a40;--done-bg:rgba(48,209,88,.16);--done-fg:#30d158;--badge-bg:#26262b;--badge-fg:#8a8a90;--pop:#1f1f24;--avab:rgba(255,255,255,.1);--error:#ff453a;--bg-hover:#26262b;--border:#46464c;--text-muted:#8a8a90}

.pipeline-board.board{border-radius:14px;padding:.7rem;background:var(--bg);color:var(--text)}
.pipeline-board .hd{padding:.35rem .5rem .65rem}
.pipeline-board .hd1{display:flex;align-items:center;gap:.45rem;font-size:.8rem;font-weight:650;color:var(--text)}
.pipeline-board .hd1 .fork{color:var(--accent);display:inline-flex;align-items:center}
.pipeline-board .hd1 .cnt{margin-left:auto;font-size:.72rem;font-weight:500;color:var(--sub);font-variant-numeric:tabular-nums}
.pipeline-board .hd2{display:flex;align-items:center;gap:.55rem;margin-top:.45rem}
.pipeline-board .hd2 .rst{font-size:.68rem;color:var(--run-accent);font-weight:500}
.pipeline-board .gbar{display:inline-flex;gap:2px;vertical-align:middle}
.pipeline-board .gbar i{width:8px;height:10px;border-radius:2px;display:block}
.pipeline-board .clist{background:var(--container);border-radius:11px;padding:.35rem}
.pipeline-board .brow{display:flex;align-items:center;gap:.65rem;padding:.5rem .65rem;border-radius:10px;background:var(--card);border:1px solid var(--card-bd);margin-bottom:.35rem;cursor:pointer}
.pipeline-board .brow:last-child{margin-bottom:0}
.pipeline-board .brow.running{background:var(--run-bg);border-left:3px solid var(--run-accent);animation:pb-breathe 2.8s ease-in-out infinite}
.pipeline-board .brow.failed{border-left:3px solid var(--error)}
.pipeline-board .brow.wait{opacity:.5}
.pipeline-board .brow:hover{outline:2px solid var(--accent);outline-offset:1px}
.pipeline-board .ava{width:32px;height:32px;border-radius:50%;overflow:hidden;flex-shrink:0;box-shadow:inset 0 0 0 1px var(--avab)}
.pipeline-board .ava img{width:100%;height:100%;display:block}
.pipeline-board .rmain{flex:1;min-width:0}
.pipeline-board .rtop{display:flex;align-items:baseline;gap:.4rem}
.pipeline-board .rname{font-size:.86rem;font-weight:650;white-space:nowrap;color:var(--text);letter-spacing:-.01em}
.pipeline-board .brow.done .rname{color:var(--sub);font-weight:600}
.pipeline-board .rrole{font-size:.72rem;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pipeline-board .rno{margin-left:auto;font-size:.7rem;font-variant-numeric:tabular-nums;letter-spacing:.04em;color:var(--task)}
.pipeline-board .brow.running .rno{color:var(--run-accent);font-weight:700}
.pipeline-board .rtask{display:flex;align-items:center;gap:.5rem;margin-top:.25rem}
.pipeline-board .rtask .tline{color:var(--line);flex:none;font-size:.8rem}
.pipeline-board .brow.running .rtask .tline{color:var(--run-accent)}
.pipeline-board .rtask .tk{font-size:.72rem;color:var(--task);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;line-height:1.3}
.pipeline-board .chev{font-size:.95rem;flex-shrink:0;color:var(--line)}
.pipeline-board .badge{font-size:.63rem;padding:.1rem .45rem;border-radius:999px;white-space:nowrap;flex-shrink:0;font-weight:500}
.pipeline-board .badge.badge-wait{background:var(--badge-bg);color:var(--badge-fg)}
.pipeline-board .badge.badge-run{background:var(--run-bg);color:var(--run-accent);border:1px solid var(--run-accent)}
.pipeline-board .badge.badge-done{background:var(--done-bg);color:var(--done-fg)}
.pipeline-board .badge.badge-failed{background:rgba(255,59,48,.16);color:var(--error)}
@keyframes pb-breathe{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 0 3px var(--run-glow)}}
@keyframes pb-pulse-led{0%,100%{opacity:1}50%{opacity:.55}}
.pipeline-board .led-live{animation:pb-pulse-led 1.5s ease-in-out infinite}
`}</style>
  );
}
