import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  BADGE_CLASS,
  BlockTimestampAnnotator,
  STYLE_ID,
} from "../src/dom-annotator";

const UUID_A = "123e4567-e89b-42d3-a456-426614174000";
const UUID_B = "123e4567-e89b-42d3-a456-426614174001";
const LOGSEQ_DB_UUID = "00000001-2026-0719-0000-000000000000";
const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);

function blockMarkup(
  uuid: string,
  options: { pageTitle?: boolean; wrapper?: string } = {},
): string {
  const mainClass = options.pageTitle
    ? "block-main-container is-page-title-row"
    : "block-main-container";
  const markup = `
    <div class="ls-block" blockid="${uuid}">
      <div class="${mainClass}">
        <div class="block-content-or-editor-inner">
          <div class="block-row">
            <div class="block-content-or-editor-wrap">블록 본문</div>
          </div>
        </div>
      </div>
    </div>
  `;

  return options.wrapper
    ? `<div class="${options.wrapper}">${markup}</div>`
    : markup;
}

function createAnnotator(
  query: (query: string, uuids: readonly string[]) => Promise<unknown>,
) {
  return new BlockTimestampAnnotator({
    document,
    query,
    now: () => NOW,
  });
}

afterEach(() => {
  document.body.replaceChildren();
  document.getElementById(STYLE_ID)?.remove();
  vi.restoreAllMocks();
});

describe("BlockTimestampAnnotator", () => {
  it("보이는 블록에 배지를 붙이고 반복 스캔해도 중복하지 않는다", async () => {
    document.body.innerHTML = blockMarkup(UUID_A);
    const query = vi.fn(async () => [[UUID_A, NOW - 3 * 60_000]]);
    const annotator = createAnnotator(query);

    annotator.start();
    await annotator.scanNow();
    await annotator.scanNow();

    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toBe("0d 0h");
    expect(query).toHaveBeenCalledTimes(1);

    annotator.destroy();
  });

  it("동일 UUID의 여러 렌더링 인스턴스를 한 번 조회한다", async () => {
    document.body.innerHTML =
      blockMarkup(UUID_A) + blockMarkup(UUID_A) + blockMarkup(UUID_B);
    const query = vi.fn(async (_query, uuids) =>
      uuids.map((uuid: string) => [uuid, NOW - 60_000]),
    );
    const annotator = createAnnotator(query);

    await annotator.scanNow();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([UUID_A, UUID_B]);
    expect(document.querySelectorAll(`.${BADGE_CLASS}`)).toHaveLength(3);
  });

  it("version 및 variant 비트가 없는 Logseq DB 블록 식별자를 처리한다", async () => {
    document.body.innerHTML = blockMarkup(LOGSEQ_DB_UUID);
    const query = vi.fn(async () => [[LOGSEQ_DB_UUID, NOW]]);
    const annotator = createAnnotator(query);

    await annotator.scanNow();

    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      [LOGSEQ_DB_UUID],
    );
    expect(document.querySelector(`.${BADGE_CLASS}`)?.textContent).toBe(
      "0d 0h",
    );
  });

  it("페이지 제목과 테이블 및 속성 영역은 제외한다", async () => {
    document.body.innerHTML = [
      blockMarkup(UUID_A, { pageTitle: true }),
      blockMarkup(UUID_A, { wrapper: "ls-table" }),
      blockMarkup(UUID_A, { wrapper: "ls-properties-area" }),
    ].join("");
    const query = vi.fn(async () => [[UUID_A, NOW]]);
    const annotator = createAnnotator(query);

    await annotator.scanNow();

    expect(query).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`.${BADGE_CLASS}`)).toHaveLength(0);
  });

  it("새로 나타난 블록을 조회하고 제거 후 재등장하면 캐시를 재사용한다", async () => {
    document.body.innerHTML = blockMarkup(UUID_A);
    const query = vi.fn(async (_query, uuids) =>
      uuids.map((uuid: string) => [uuid, NOW - 60_000]),
    );
    const annotator = createAnnotator(query);

    await annotator.scanNow();
    document.body.replaceChildren();
    document.body.innerHTML = blockMarkup(UUID_A);
    await annotator.scanNow();

    expect(query).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`.${BADGE_CLASS}`)?.textContent).toBe(
      "0d 0h",
    );
  });

  it("reset 시 캐시와 배지를 비우고 다시 조회한다", async () => {
    document.body.innerHTML = blockMarkup(UUID_A);
    const query = vi.fn(async () => [[UUID_A, NOW]]);
    const annotator = createAnnotator(query);

    await annotator.scanNow();
    annotator.reset();
    await annotator.scanNow();

    expect(query).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll(`.${BADGE_CLASS}`)).toHaveLength(1);
  });

  it("destroy 시 observer 산출물과 스타일을 모두 정리한다", async () => {
    document.body.innerHTML = blockMarkup(UUID_A);
    const annotator = createAnnotator(async () => [[UUID_A, NOW]]);

    annotator.start();
    await annotator.scanNow();
    annotator.destroy();

    expect(document.querySelector(`.${BADGE_CLASS}`)).toBeNull();
    expect(document.getElementById(STYLE_ID)).toBeNull();

    document.body.insertAdjacentHTML("beforeend", blockMarkup(UUID_B));
    await Promise.resolve();
    expect(document.querySelector(`.${BADGE_CLASS}`)).toBeNull();
  });

  it("플러그인 iframe과 다른 DOM 영역의 호스트 요소도 처리한다", async () => {
    const host = new JSDOM(
      `<!doctype html><html><head></head><body>${blockMarkup(UUID_A)}</body></html>`,
      { pretendToBeVisual: true },
    );
    const hostDocument = host.window.document;
    const annotator = new BlockTimestampAnnotator({
      document: hostDocument,
      query: async () => [[UUID_A, NOW - 60_000]],
      now: () => NOW,
    });

    await annotator.scanNow();

    expect(hostDocument.querySelector(`.${BADGE_CLASS}`)?.textContent).toBe(
      "0d 0h",
    );

    annotator.destroy();
    host.window.close();
  });
});
