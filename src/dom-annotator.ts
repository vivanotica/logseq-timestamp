import {
  fetchCreatedAtForUuids,
  type DatascriptQuery,
} from "./created-at";
import { formatRelativeTime } from "./relative-time";

export const BADGE_CLASS = "logseq-block-created-time";
export const STYLE_ID = "logseq-block-created-time-style";

export type TimestampFormat = "0h 0m ago" | "YY-MM-DD-HH:mm";

const UUID_PATTERN =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const BLOCK_SELECTOR = ".ls-block[blockid]";
const EXCLUDED_ANCESTORS = [
  ".ls-table",
  ".ls-properties-area",
  ".property-value-inner",
  ".lsp-hook-ui-slot",
  "[data-injected-ui]",
].join(", ");
const REFRESH_INTERVAL_MS = 60_000;

const BADGE_CSS = `
.${BADGE_CLASS} {
  align-self: center;
  flex: 0 0 auto;
  margin-inline-start: 0.3rem;
  color: var(--ls-secondary-text-color, currentColor);
  font-size: 0.72em;
  font-weight: 400;
  line-height: 1;
  opacity: 0.55;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
}
`;

interface VisibleBlock {
  uuid: string;
  row: HTMLElement;
}

export interface BlockTimestampAnnotatorOptions {
  document: Document;
  query: DatascriptQuery;
  timestampFormat?: () => TimestampFormat;
  hideTimestampInDefaultView?: () => boolean;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export class BlockTimestampAnnotator {
  readonly #document: Document;
  readonly #query: DatascriptQuery;
  readonly #timestampFormat: () => TimestampFormat;
  readonly #hideTimestampInDefaultView: () => boolean;
  readonly #now: () => number;
  readonly #onError: (error: unknown) => void;
  readonly #createdAt = new Map<string, number>();
  readonly #inFlight = new Set<string>();

  #observer: MutationObserver | null = null;
  #refreshTimer: number | null = null;
  #animationFrame: number | null = null;
  #generation = 0;
  #started = false;
  #revealShortcutHeld = false;

  constructor(options: BlockTimestampAnnotatorOptions) {
    this.#document = options.document;
    this.#query = options.query;
    this.#timestampFormat =
      options.timestampFormat ?? (() => "0h 0m ago");
    this.#hideTimestampInDefaultView =
      options.hideTimestampInDefaultView ?? (() => false);
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? console.error;
  }

  start(): void {
    if (this.#started) {
      return;
    }

    const view = this.#document.defaultView;
    if (!view || !this.#document.body) {
      throw new Error("Logseq 호스트 문서를 찾을 수 없습니다.");
    }

    this.#started = true;
    this.#mountStyle();
    view.addEventListener("keydown", this.#onKeyDown, true);
    view.addEventListener("keyup", this.#onKeyUp, true);
    view.addEventListener("blur", this.#onWindowBlur);

    this.#observer = new view.MutationObserver(() => {
      this.#scheduleScan();
    });
    this.#observer.observe(this.#document.body, {
      childList: true,
      subtree: true,
    });

    this.#refreshTimer = view.setInterval(() => {
      this.refreshVisibleBadges();
      this.#scheduleScan();
    }, REFRESH_INTERVAL_MS);

    this.#scheduleScan();
  }

  async scanNow(): Promise<void> {
    const generation = this.#generation;
    const visibleBlocks = this.#getVisibleBlocks();
    this.#renderKnownBlocks(visibleBlocks);

    const missingUuids = [
      ...new Set(
        visibleBlocks
          .map(({ uuid }) => uuid)
          .filter(
            (uuid) =>
              !this.#createdAt.has(uuid) && !this.#inFlight.has(uuid),
          ),
      ),
    ];

    if (missingUuids.length === 0) {
      return;
    }

    for (const uuid of missingUuids) {
      this.#inFlight.add(uuid);
    }

    try {
      const timestamps = await fetchCreatedAtForUuids(
        this.#query,
        missingUuids,
      );

      if (generation !== this.#generation) {
        return;
      }

      for (const [uuid, createdAt] of timestamps) {
        this.#createdAt.set(uuid, createdAt);
      }

      this.#renderKnownBlocks(this.#getVisibleBlocks());
    } catch (error) {
      this.#onError(error);
    } finally {
      for (const uuid of missingUuids) {
        this.#inFlight.delete(uuid);
      }
    }
  }

  refreshVisibleBadges(): void {
    this.#renderKnownBlocks(this.#getVisibleBlocks());
  }

  reset(): void {
    this.#generation += 1;
    this.#createdAt.clear();
    this.#inFlight.clear();
    this.#removeBadges();
    this.#scheduleScan();
  }

  destroy(): void {
    this.#generation += 1;
    this.#started = false;
    this.#observer?.disconnect();
    this.#observer = null;

    const view = this.#document.defaultView;
    if (view) {
      view.removeEventListener("keydown", this.#onKeyDown, true);
      view.removeEventListener("keyup", this.#onKeyUp, true);
      view.removeEventListener("blur", this.#onWindowBlur);
    }
    if (view && this.#refreshTimer !== null) {
      view.clearInterval(this.#refreshTimer);
    }
    this.#refreshTimer = null;

    if (view && this.#animationFrame !== null) {
      view.cancelAnimationFrame(this.#animationFrame);
    }
    this.#animationFrame = null;

    this.#createdAt.clear();
    this.#inFlight.clear();
    this.#revealShortcutHeld = false;
    this.#removeBadges();
    this.#document.getElementById(STYLE_ID)?.remove();
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (
      !this.#hideTimestampInDefaultView() ||
      event.code !== "KeyT" ||
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.#setRevealShortcutHeld(true);
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (
      this.#revealShortcutHeld &&
      (event.code === "KeyT" || !event.ctrlKey || !event.shiftKey)
    ) {
      this.#setRevealShortcutHeld(false);
    }
  };

  readonly #onWindowBlur = (): void => {
    this.#setRevealShortcutHeld(false);
  };

  #setRevealShortcutHeld(held: boolean): void {
    if (this.#revealShortcutHeld === held) {
      return;
    }

    this.#revealShortcutHeld = held;
    this.refreshVisibleBadges();
  }

  #scheduleScan(): void {
    const view = this.#document.defaultView;
    if (!this.#started || !view || this.#animationFrame !== null) {
      return;
    }

    this.#animationFrame = view.requestAnimationFrame(() => {
      this.#animationFrame = null;
      void this.scanNow();
    });
  }

  #getVisibleBlocks(): VisibleBlock[] {
    const blocks: VisibleBlock[] = [];
    const elements =
      this.#document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);

    for (const element of elements) {
      const block = this.#toVisibleBlock(element);
      if (block) {
        blocks.push(block);
      }
    }

    return blocks;
  }

  #toVisibleBlock(element: HTMLElement): VisibleBlock | null {
    if (element.closest(EXCLUDED_ANCESTORS)) {
      return null;
    }

    const uuid = element.getAttribute("blockid");
    if (!uuid || !UUID_PATTERN.test(uuid)) {
      return null;
    }

    const mainContainer = [...element.children].find(
      (child): child is HTMLElement =>
        this.#isHostHTMLElement(child) &&
        child.classList.contains("block-main-container"),
    );

    if (
      !mainContainer ||
      mainContainer.classList.contains("is-page-title-row")
    ) {
      return null;
    }

    const row = mainContainer.querySelector<HTMLElement>(
      ".block-content-or-editor-inner > .block-row",
    );

    return row ? { uuid, row } : null;
  }

  #renderKnownBlocks(blocks: VisibleBlock[]): void {
    const now = this.#now();
    const timestampFormat = this.#timestampFormat();
    const hideTimestamps =
      this.#hideTimestampInDefaultView() &&
      !this.#revealShortcutHeld;

    for (const { uuid, row } of blocks) {
      const createdAt = this.#createdAt.get(uuid);
      if (createdAt === undefined) {
        continue;
      }

      let badge = [...row.children].find(
        (child): child is HTMLElement =>
          this.#isHostHTMLElement(child) &&
          child.classList.contains(BADGE_CLASS),
      );

      if (!badge) {
        badge = this.#document.createElement("span");
        badge.className = BADGE_CLASS;
        badge.setAttribute("aria-hidden", "true");
        row.append(badge);
      }

      badge.dataset.blockUuid = uuid;
      badge.hidden = hideTimestamps;

      let text: string;
      if (timestampFormat === "0h 0m ago") {
        text = formatRelativeTime(createdAt, now);
      } else {
        const date = new Date(createdAt);
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const day = date.getDate().toString().padStart(2, "0");
        const hours = date.getHours().toString().padStart(2, "0");
        const minutes = date.getMinutes().toString().padStart(2, "0");
        text = `${year}-${month}-${day}-${hours}:${minutes}`;
      }

      if (badge.textContent !== text) {
        badge.textContent = text;
      }
    }
  }

  #mountStyle(): void {
    if (this.#document.getElementById(STYLE_ID)) {
      return;
    }

    const style = this.#document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = BADGE_CSS;
    this.#document.head.append(style);
  }

  #isHostHTMLElement(element: Element): element is HTMLElement {
    const HostHTMLElement = this.#document.defaultView?.HTMLElement;
    return Boolean(HostHTMLElement && element instanceof HostHTMLElement);
  }

  #removeBadges(): void {
    this.#document
      .querySelectorAll<HTMLElement>(`.${BADGE_CLASS}`)
      .forEach((badge) => badge.remove());
  }
}
