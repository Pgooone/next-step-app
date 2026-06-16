# M2 · chat-file-upload（功能#4）

对话框支持选文本类文件 → 读成文字 → 按 `<file>` 内联进消息。
纯前端，**不碰内核 / pi-ai**。批次 1，无依赖。详见 详细设计.md · M2。

- [ ] 读 `components/ChatInput.tsx`，摸清现有文件选择器与 `processImageFiles` 多模态通道
- [ ] 文件选择器 `accept` 在 `image/*` 之外新增文本类白名单：`.md,.txt,.json,.csv,.log,.py,.ts,.tsx,.js,.jsx,.html,.css,.yaml,.yml,.xml,.sql,.sh`
- [ ] 选中后分流：图片走现有 `processImageFiles`（不动）；文本类 `FileReader.readAsText` 读出
- [ ] 文本块拼成内核官方格式 `<file name="文件名">\n<内容>\n</file>`，附加到本条消息文本再发送（浏览器上传无绝对路径，`name` 用文件名；与内核 `@file` 的绝对路径语义不同、本功能可接受）
- [ ] 把「文本 → `<file>` 拼装」抽成可复用纯函数（供 M8 转交载荷复用）
- [ ] 输入框上方显示「已附文本文件」小标签（可移除），与图片预览并列
- [ ] 软提示：单文件 > 256KB inline 提示「大文件会消耗大量 token」，不阻断
- [ ] 二进制 / 非白名单文件：提示「暂不支持，建议转成文本」，不静默失败
- [ ] 写/补单测（文本读取拼装、分流、软提示阈值、非白名单拒绝）
- [ ] 跑质量门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收：选并发送文本文件、确认模型读到内容；图片功能不受影响；大文件有软提示（browser-e2e）
- [ ] 不做：PDF/docx/xlsx 后端文本提取（记录待后续迭代）
