import { describe, expect, it } from "vitest";
import { displayIsOn, displaySchema, indicatorLightSchema } from "../src/appearance";

describe("endpoint appearance", () => {
  it("preserves legacy appearance and validates brightness bounds", () => {
    expect(displayIsOn(displaySchema.parse({}), "America/Fortaleza")).toBe(true);
    expect(indicatorLightSchema.parse({}).enabled).toBe(false);
    for (const bad of [
      { listeningBrightness: 101 },
      { speakingMinBrightness: -1 },
      { speakingMaxBrightness: 50.5 },
      { speakingMinBrightness: 80, speakingMaxBrightness: 20 },
    ])
      expect(indicatorLightSchema.safeParse(bad).success).toBe(false);
  });
  it.each([
    ["2026-09-23T00:59:00Z", true],
    ["2026-09-23T01:00:00Z", false],
    ["2026-09-23T09:59:00Z", false],
    ["2026-09-23T10:00:00Z", true],
  ])("applies an overnight window in the home timezone at %s", (instant, expected) => {
    const cfg = displaySchema.parse({ scheduleEnabled: true });
    expect(displayIsOn(cfg, "America/Fortaleza", new Date(instant))).toBe(expected);
  });
  it("supports daytime windows, manual overrides and daylight-saving transitions", () => {
    const cfg = displaySchema.parse({ scheduleEnabled: true, offAt: "09:00", onAt: "17:00" });
    const noon = new Date("2026-09-23T15:00:00Z");
    expect(displayIsOn(cfg, "America/Fortaleza", noon)).toBe(false);
    expect(displayIsOn({ ...cfg, mode: "on" }, "America/Fortaleza", noon)).toBe(true);
    expect(
      displayIsOn({ ...cfg, mode: "off", scheduleEnabled: false }, "America/Fortaleza", noon),
    ).toBe(false);
    const night = displaySchema.parse({ scheduleEnabled: true });
    for (const instant of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"])
      expect(displayIsOn(night, "America/New_York", new Date(instant))).toBe(false);
    expect(
      displaySchema.safeParse({ scheduleEnabled: true, offAt: "07:00", onAt: "07:00" }).success,
    ).toBe(false);
    expect(displaySchema.safeParse({ offAt: "25:00" }).success).toBe(false);
  });
});
