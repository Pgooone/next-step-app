import { describe, expect, it } from "vitest";
import { friendlyAgentName } from "./friendly-name";

describe("friendlyAgentName：剥临时档案的 -uuid8 后缀（显示层克制）", () => {
  it("剥掉结尾 8 位十六进制后缀", () => {
    expect(friendlyAgentName("研究员-a1b2c3d4")).toBe("研究员");
    expect(friendlyAgentName("architect-0f9e8d7c")).toBe("architect");
  });

  it("大小写十六进制都剥（i 标志）", () => {
    expect(friendlyAgentName("worker-ABCDEF12")).toBe("worker");
  });

  it("无后缀 → 原样返回", () => {
    expect(friendlyAgentName("研究员")).toBe("研究员");
    expect(friendlyAgentName("plain-name")).toBe("plain-name");
  });

  it("非 8 位 / 非十六进制的尾巴不误剥", () => {
    expect(friendlyAgentName("v-abcdefg")).toBe("v-abcdefg"); // 7 位
    expect(friendlyAgentName("x-ghijklmn")).toBe("x-ghijklmn"); // 非 hex
    expect(friendlyAgentName("id-123456789")).toBe("id-123456789"); // 9 位
  });

  it("剥完为空 → 回退原串（保底不显空）", () => {
    expect(friendlyAgentName("-a1b2c3d4")).toBe("-a1b2c3d4");
  });

  it("空串 → 原样", () => {
    expect(friendlyAgentName("")).toBe("");
  });
});
