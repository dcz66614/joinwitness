import { describe, expect, it } from "vitest";
import { APP_TITLE, APP_SUBTITLE, App } from "../src/main";

describe("P008-T001 skeleton smoke test", () => {
  it("exports valid application placeholder title and component", () => {
    expect(APP_TITLE).toBe("P008 倍行镜 JoinWitness");
    expect(APP_SUBTITLE).toBe("LEFT JOIN 键倍增归因与反例生成器");
    expect(typeof App).toBe("function");
  });

  it("verifies Node 24 runtime environment", () => {
    const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
    expect(major).toBe(24);
  });
});
