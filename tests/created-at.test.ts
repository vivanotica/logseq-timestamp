import { describe, expect, it, vi } from "vitest";
import {
  CREATED_AT_QUERY,
  dedupeUuids,
  fetchCreatedAtForUuids,
  parseCreatedAtRows,
} from "../src/created-at";

describe("created-at queries", () => {
  it("compares DB UUID values with DOM blockid strings", () => {
    expect(CREATED_AT_QUERY).toContain("[(str ?uuid) ?uuid-string]");
    expect(CREATED_AT_QUERY).toContain(":in $ [?uuid-string ...]");
  });

  it("deduplicates UUIDs while preserving input order", () => {
    expect(dedupeUuids(["a", "b", "a", "c", "b"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("converts only valid rows into a timestamp map", () => {
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

  it("deduplicates UUIDs and queries them in fixed-size batches", async () => {
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

  it("does not call the database when there are no UUIDs to query", async () => {
    const query = vi.fn();

    await expect(fetchCreatedAtForUuids(query, [])).resolves.toEqual(
      new Map(),
    );
    expect(query).not.toHaveBeenCalled();
  });
});
