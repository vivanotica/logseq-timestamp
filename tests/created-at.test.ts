import { describe, expect, it, vi } from "vitest";
import {
  CREATED_AT_QUERY,
  dedupeUuids,
  fetchCreatedAtForUuids,
  parseCreatedAtRows,
} from "../src/created-at";

describe("created-at 조회", () => {
  it("DB UUID 값을 DOM blockid 문자열과 비교한다", () => {
    expect(CREATED_AT_QUERY).toContain("[(str ?uuid) ?uuid-string]");
    expect(CREATED_AT_QUERY).toContain(":in $ [?uuid-string ...]");
  });

  it("UUID를 입력 순서대로 중복 제거한다", () => {
    expect(dedupeUuids(["a", "b", "a", "c", "b"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("유효한 행만 timestamp 맵으로 변환한다", () => {
    expect(
      [...parseCreatedAtRows([
        ["a", 100],
        ["b", "200"],
        ["", 300],
        ["c", "not-a-number"],
        ["d", -1],
        null,
      ])],
    ).toEqual([
      ["a", 100],
      ["b", 200],
    ]);
  });

  it("중복 UUID를 제거하고 정해진 크기로 묶어 조회한다", async () => {
    const query = vi.fn(async (_query: string, uuids: readonly string[]) =>
      uuids.map((uuid, index) => [uuid, 1_000 + index]),
    );

    const result = await fetchCreatedAtForUuids(
      query,
      ["a", "b", "a", "c"],
      2,
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, CREATED_AT_QUERY, ["a", "b"]);
    expect(query).toHaveBeenNthCalledWith(2, CREATED_AT_QUERY, ["c"]);
    expect([...result.keys()]).toEqual(["a", "b", "c"]);
  });

  it("조회할 UUID가 없으면 DB를 호출하지 않는다", async () => {
    const query = vi.fn();

    await expect(fetchCreatedAtForUuids(query, [])).resolves.toEqual(
      new Map(),
    );
    expect(query).not.toHaveBeenCalled();
  });
});
