import { describe, it, expect } from "vitest";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isNodeVersionOk,
  checkDeps,
  checkPiHome,
  checkCredentials,
} from "./doctor-checks";

describe("isNodeVersionOk", () => {
  it("低于阈值返回 false", () => {
    expect(isNodeVersionOk("v19.9.0")).toBe(false);
  });
  it("等于阈值返回 true", () => {
    expect(isNodeVersionOk("v20.0.0")).toBe(true);
  });
  it("高于阈值返回 true", () => {
    expect(isNodeVersionOk("v22.22.3")).toBe(true);
  });
  it("自定义阈值生效", () => {
    expect(isNodeVersionOk("v20.0.0", 22)).toBe(false);
  });
  it("畸形输入不崩溃，返回 false", () => {
    expect(isNodeVersionOk("")).toBe(false);
    expect(isNodeVersionOk("garbage")).toBe(false);
    expect(isNodeVersionOk("v")).toBe(false);
  });
});

describe("checkDeps", () => {
  it("已安装的内核包加载成功", { timeout: 15000 }, async () => {
    expect((await checkDeps()).ok).toBe(true);
  });
});

describe("checkPiHome", () => {
  it("临时可写目录返回 true", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-home-ok-"));
    try {
      expect(checkPiHome(dir).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("不可写目录下的子路径返回 false", () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-home-ro-"));
    chmodSync(parent, 0o555);
    try {
      // parent 为只读，mkdir 其子目录会失败
      expect(checkPiHome(join(parent, "sub")).ok).toBe(false);
    } finally {
      chmodSync(parent, 0o755);
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("checkCredentials", () => {
  it("不抛异常，返回布尔 ok", async () => {
    const result = await checkCredentials();
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.detail).toBe("string");
  });
});
