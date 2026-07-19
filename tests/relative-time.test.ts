import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../src/relative-time";

const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it.each([
    ["현재", NOW, "0d 0h"],
    ["미래 시각", NOW + MINUTE, "0d 0h"],
    ["59초", NOW - 59 * SECOND, "0d 0h"],
    ["1분", NOW - MINUTE, "0d 0h"],
    ["59분", NOW - 59 * MINUTE, "0d 0h"],
    ["1시간", NOW - HOUR, "0d 1h"],
    ["23시간", NOW - 23 * HOUR, "0d 23h"],
    ["1일", NOW - DAY, "1d 0h"],
    ["1일 1시간", NOW - DAY - HOUR, "1d 1h"],
    ["2일 23시간", NOW - 2 * DAY - 23 * HOUR, "2d 23h"],
    ["29일", NOW - 29 * DAY, "29d 0h"],
    ["30일", NOW - 30 * DAY, "30d 0h"],
    ["364일", NOW - 364 * DAY, "364d 0h"],
    ["365일", NOW - 365 * DAY, "365d 0h"],
    ["730일", NOW - 730 * DAY, "730d 0h"],
  ])("%s 경계를 표시한다", (_label, createdAt, expected) => {
    expect(formatRelativeTime(createdAt, NOW)).toBe(expected);
  });
});
