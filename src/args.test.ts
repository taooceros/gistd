import { expect, test } from "vitest";
import { MIN_REFRESH_INTERVAL, parseRefreshInterval } from "./args";

test("g-refresh parsing", () => {
  expect(parseRefreshInterval(null)).toBeUndefined();
  expect(parseRefreshInterval("")).toBe(MIN_REFRESH_INTERVAL);
  expect(parseRefreshInterval("true")).toBe(MIN_REFRESH_INTERVAL);
  expect(parseRefreshInterval("30")).toBe(30);
  expect(parseRefreshInterval("2")).toBe(MIN_REFRESH_INTERVAL);
  expect(parseRefreshInterval("0")).toBeUndefined();
  expect(parseRefreshInterval("false")).toBeUndefined();
  expect(parseRefreshInterval("-5")).toBeUndefined();
  expect(parseRefreshInterval("abc")).toBeUndefined();
});
