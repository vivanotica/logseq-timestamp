import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  BADGE_CLASS,
  BlockTimestampAnnotator,
  STYLE_ID,
} from "../src/dom-annotator";

const UUID_A = "123e4567-e89b-42d3-a456-426614174000";
const UUID_B = "123e4567-e89b-42d3-a456-426614174001";
const UUID_C = "123e4567-e89b-42d3-a456-426614174002";
const LOGSEQ_DB_UUID = "00000001-2026-0719-0000-000000000000";
const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);

function timeText(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

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
            <div class="block-content-or-editor-wrap">Block content</div>
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
  });
}

afterEach(() => {
  document.body.replaceChildren();
  document.getElementById(STYLE_ID)?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BlockTimestampAnnotator", () => {
  it("adds one badge per visible block without duplicating it on repeated scans", async () => {
    document.body.innerHTML = blockMarkup(UUID_A);
    const query = vi.fn(async () => [[UUID_A, NOW - 3 * 60_000]]);
    const annotator = createAnnotator(query);

    annotator.start();
    await annotator.scanNow();
    await annotator.scanNow();

    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toBe(timeText(NOW - 3 * 60_000));
    expect(query).toHaveBeenCalledTimes(1);

    annotator.destroy();
  });

  it("does not create an observer loop when rendering unchanged badge text", async () => {
    document.body.innerHTML = blockMarkup(UUID_A);
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      callbacks.delete(id);
    });
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const annotator = createAnnotator(async () => [[UUID_A, NOW]]);

    annotator.start();
    expect(callbacks.size).toBe(1);

    const runNextFrame = async () => {
      const entry = callbacks.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      expect(entry).toBeDefined();
      const [id, callback] = entry!;
      callbacks.delete(id);
      callback(NOW);
      await Promise.resolve();
      await Promise.resolve();
    };

    await runNextFrame();
    expect(callbacks.size).toBe(1);

    await runNextFrame();
    expect(callbacks.size).toBe(0);
    expect(observe).toHaveBeenCalled();

    resizeCallback?.([], {} as ResizeObserver);
    expect(callbacks.size).toBe(1);

    await runNextFrame();
    expect(callbacks.size).toBe(0);

    window.dispatchEvent(new Event("resize"));
    expect(callbacks.size).toBe(1);

    await runNextFrame();
    expect(callbacks.size).toBe(0);

    expect(annotator.toggleVisibility()).toBe(false);
    window.dispatchEvent(new Event("resize"));
    document.body.append(document.createElement("div"));
    await Promise.resolve();
    expect(callbacks.size).toBe(0);

    expect(annotator.toggleVisibility()).toBe(true);
    expect(callbacks.size).toBe(1);

    await runNextFrame();
    expect(callbacks.size).toBe(0);

    annotator.destroy();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("queries multiple rendered instances of the same UUID only once", async () => {
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

  it("places badges in a fixed left column regardless of indentation", async () => {
    const createdAt = new Date(2026, 6, 19, 9, 5).getTime();
    document.body.innerHTML = `<div class="journal-item">${blockMarkup(
      LOGSEQ_DB_UUID,
      { pageTitle: true },
    )}${blockMarkup(UUID_A).replace(
      '<div class="block-content-or-editor-wrap">Block content</div>',
      `${blockMarkup(UUID_B)}<div class="block-content-or-editor-wrap">Block content</div>`,
    )}${blockMarkup(UUID_C)}</div>`;
    const annotator = new BlockTimestampAnnotator({
      document,
      query: async (_query, uuids) =>
        uuids.map((uuid) => [uuid, createdAt]),
    });
    annotator.start();

    const rows = [
      ...document.querySelectorAll<HTMLElement>(".block-row"),
    ].slice(1);
    const [rootRow, nestedRow, secondRootRow] = rows;
    const journal = document.querySelector<HTMLElement>(".journal-item")!;
    vi.spyOn(journal, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 20,
      right: 600,
    } as DOMRect);
    vi.spyOn(rootRow!, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 40,
      height: 20,
    } as DOMRect);
    vi.spyOn(nestedRow!, "getBoundingClientRect").mockReturnValue({
      left: 140,
      top: 70,
      height: 20,
    } as DOMRect);
    vi.spyOn(secondRootRow!, "getBoundingClientRect").mockReturnValue({
      left: 112,
      top: 100,
      height: 20,
    } as DOMRect);

    await annotator.scanNow();
    const [rootBadge, nestedBadge, secondRootBadge] =
      journal.querySelectorAll<HTMLElement>(
        `:scope > .${BADGE_CLASS}`,
      );
    expect(rootBadge!.style.getPropertyValue(
      "--logseq-block-created-time-top",
    )).toBe("30px");
    expect(nestedBadge!.style.getPropertyValue(
      "--logseq-block-created-time-top",
    )).toBe("60px");
    expect(rootBadge!.textContent).toBe("09:05");
    expect(nestedBadge!.textContent).toBe("09:05");
    expect(secondRootBadge!.textContent).toBe("09:05");

    expect(document.getElementById(STYLE_ID)?.textContent).toContain(
      "inset-inline-end: calc(100% + 0.75rem)",
    );
    annotator.destroy();
  });

  it("toggles badge visibility", async () => {
    document.body.innerHTML = blockMarkup(UUID_A);
    const annotator = new BlockTimestampAnnotator({
      document,
      query: async () => [[UUID_A, NOW]],
    });

    await annotator.scanNow();

    const badge = document.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
    expect(badge?.hidden).toBe(false);

    expect(annotator.toggleVisibility()).toBe(false);
    expect(badge?.hidden).toBe(true);

    expect(annotator.toggleVisibility()).toBe(true);
    expect(badge?.hidden).toBe(false);
  });

  it("accepts Logseq DB block identifiers without version and variant bits", async () => {
    document.body.innerHTML = blockMarkup(LOGSEQ_DB_UUID);
    const query = vi.fn(async () => [[LOGSEQ_DB_UUID, NOW]]);
    const annotator = createAnnotator(query);

    await annotator.scanNow();

    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      [LOGSEQ_DB_UUID],
    );
    expect(document.querySelector(`.${BADGE_CLASS}`)?.textContent).toBe(
      timeText(NOW),
    );
  });

  it("excludes page titles, tables, and property areas", async () => {
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

  it("queries new blocks and reuses cached timestamps when they reappear", async () => {
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
      timeText(NOW - 60_000),
    );
  });

  it("clears the cache and badges on reset before querying again", async () => {
    document.body.innerHTML = blockMarkup(UUID_A);
    const query = vi.fn(async () => [[UUID_A, NOW]]);
    const annotator = createAnnotator(query);

    await annotator.scanNow();
    annotator.reset();
    await annotator.scanNow();

    expect(query).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll(`.${BADGE_CLASS}`)).toHaveLength(1);
  });

  it("removes observer output and styles on destroy", async () => {
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

  it("handles host elements from a DOM realm outside the plugin iframe", async () => {
    const host = new JSDOM(
      `<!doctype html><html><head></head><body>${blockMarkup(UUID_A)}</body></html>`,
      { pretendToBeVisual: true },
    );
    const hostDocument = host.window.document;
    const annotator = new BlockTimestampAnnotator({
      document: hostDocument,
      query: async () => [[UUID_A, NOW - 60_000]],
    });

    await annotator.scanNow();

    expect(hostDocument.querySelector(`.${BADGE_CLASS}`)?.textContent).toBe(
      timeText(NOW - 60_000),
    );

    annotator.destroy();
    host.window.close();
  });
});
