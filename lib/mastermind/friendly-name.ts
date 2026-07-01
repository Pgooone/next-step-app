// 临时角色显示层：把「role-<uuid8>」形态的名字剥成 friendly 名（纯函数、零 import、客户端安全）。
//
// 背景（D-R8.6-11 Q2·克制）：主脑运行期会临时造 agent 档案，id/name 常带 `-[0-9a-f]{8}` 后缀
// （PipelineStageCard.tsx:108-109 现直显 role-uuid8 很丑）。T5 仅做**显示层**剥后缀——不删档、不加
// 「临时」徽章、不给 AgentManager 加过滤（那些需新字段或改端点、外溢，留二期）。

/** 剥掉结尾的 `-<8位十六进制>` 后缀；剥完为空则回退原串（保底不显空）。 */
export function friendlyAgentName(name: string): string {
  if (!name) return name;
  const stripped = name.replace(/-[0-9a-f]{8}$/i, "");
  return stripped.trim() || name;
}
