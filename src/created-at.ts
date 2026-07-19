export type CreatedAtRow = readonly [unknown, unknown];

export type DatascriptQuery = (
  query: string,
  inputs: readonly string[],
) => Promise<unknown>;

export const CREATED_AT_QUERY = `
[:find ?uuid-string ?created-at
 :in $ [?uuid-string ...]
 :where
 [?block :block/uuid ?uuid]
 [(str ?uuid) ?uuid-string]
 [?block :block/created-at ?created-at]]
`;

const DEFAULT_CHUNK_SIZE = 100;

export function dedupeUuids(uuids: Iterable<string>): string[] {
  return [...new Set(uuids)];
}

export function parseCreatedAtRows(rows: unknown): Map<string, number> {
  const result = new Map<string, number>();

  if (!Array.isArray(rows)) {
    return result;
  }

  for (const row of rows as CreatedAtRow[]) {
    if (!Array.isArray(row) || row.length < 2) {
      continue;
    }

    const [rawUuid, rawCreatedAt] = row;
    const uuid = typeof rawUuid === "string" ? rawUuid : String(rawUuid ?? "");
    const createdAt =
      typeof rawCreatedAt === "number"
        ? rawCreatedAt
        : Number(rawCreatedAt);

    if (uuid.length > 0 && Number.isFinite(createdAt) && createdAt >= 0) {
      result.set(uuid, createdAt);
    }
  }

  return result;
}

export async function fetchCreatedAtForUuids(
  query: DatascriptQuery,
  uuids: Iterable<string>,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<Map<string, number>> {
  const uniqueUuids = dedupeUuids(uuids);
  const result = new Map<string, number>();
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));

  for (let offset = 0; offset < uniqueUuids.length; offset += safeChunkSize) {
    const chunk = uniqueUuids.slice(offset, offset + safeChunkSize);
    const rows = await query(CREATED_AT_QUERY, chunk);

    for (const [uuid, createdAt] of parseCreatedAtRows(rows)) {
      result.set(uuid, createdAt);
    }
  }

  return result;
}
