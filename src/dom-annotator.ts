import {
  fetchCreatedAtForUuids,
  type DatascriptQuery,
} from "./created-at";

export const BADGE_CLASS = "logseq-block-created-time";
export const STYLE_ID = "logseq-block-created-time-style";
const LEFT_LAYER_CLASS = "logseq-block-created-time-left-layer";

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
const BADGE_CSS = `
.${BADGE_CLASS} {
  position: absolute;
  top: var(--logseq-block-created-time-top);
  inset-inline-end: calc(100% + 0.75rem);
  z-index: 1;
  color: var(--ls-secondary-text-color, currentColor);
  font-size: 0.72em;
  font-weight: 400;
  line-height: 1;
  opacity: 0.55;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  margin: 0;
  transform: translateY(-50%);
}

.${LEFT_LAYER_CLASS} {
  position: relative;
}
`;

interface VisibleBlock {
  uuid: string;
  row: HTMLElement;
}

export interface BlockTimestampAnnotatorOptions {
  document: Document;
  query: DatascriptQuery;
  onError?: (error: unknown) => void;
}

export class BlockTimestampAnnotator {
  readonly #document: Document;
  readonly #query: DatascriptQuery;
  readonly #onError: (error: unknown) => void;
  readonly #createdAt = new Map<string, number>();
  readonly #inFlight = new Set<string>();
  readonly #badgesByRow = new WeakMap<HTMLElement, HTMLElement>();

  #observer: MutationObserver | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #animationFrame: number | null = null;
  #generation = 0;
  #started = false;
  #badgesVisible = true;

  constructor(options: BlockTimestampAnnotatorOptions) {
    this.#document = options.document;
    this.#query = options.query;
    this.#onError = options.onError ?? console.error;
  }

  start(): void {
    if (this.#started) {
      return;
    }

    const view = this.#document.defaultView;
    if (!view || !this.#document.body) {
      throw new Error("Could not find the Logseq host document.");
    }

    this.#started = true;
    this.#mountStyle();
    view.addEventListener("resize", this.#onWindowResize);

    this.#observer = new view.MutationObserver(() => {
      this.#scheduleScan();
    });
    this.#observer.observe(this.#document.body, {
      childList: true,
      subtree: true,
    });

    if (view.ResizeObserver) {
      this.#resizeObserver = new view.ResizeObserver(() => {
        this.#scheduleScan();
      });
    }

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

  toggleVisibility(): boolean {
    this.#badgesVisible = !this.#badgesVisible;
    this.refreshVisibleBadges();
    return this.#badgesVisible;
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
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;

    const view = this.#document.defaultView;
    if (view) {
      view.removeEventListener("resize", this.#onWindowResize);
    }
    if (view && this.#animationFrame !== null) {
      view.cancelAnimationFrame(this.#animationFrame);
    }
    this.#animationFrame = null;

    this.#createdAt.clear();
    this.#inFlight.clear();
    this.#badgesVisible = true;
    this.#removeBadges();
    this.#document.getElementById(STYLE_ID)?.remove();
  }

  readonly #onWindowResize = (): void => {
    this.#scheduleScan();
  };

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
    const renderedBadges = new Set<HTMLElement>();

    for (const { uuid, row } of blocks) {
      const createdAt = this.#createdAt.get(uuid);
      if (createdAt === undefined) {
        continue;
      }

      let badge = this.#badgesByRow.get(row) ?? [...row.children].find(
        (child): child is HTMLElement =>
          this.#isHostHTMLElement(child) &&
          child.classList.contains(BADGE_CLASS),
      );

      if (!badge) {
        badge = this.#document.createElement("span");
        badge.className = BADGE_CLASS;
        badge.setAttribute("aria-hidden", "true");
        this.#badgesByRow.set(row, badge);
      }

      this.#placeBadgeInLayer(row, badge);

      badge.dataset.blockUuid = uuid;
      badge.hidden = !this.#badgesVisible;

      const date = new Date(createdAt);
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      const text = `${hours}:${minutes}`;

      if (badge.textContent !== text) {
        badge.textContent = text;
      }
      renderedBadges.add(badge);
    }

    this.#removeStaleBadges(renderedBadges);
    this.#removeUnusedLayers();
  }

  #placeBadgeInLayer(row: HTMLElement, badge: HTMLElement): void {
    const block = row.closest<HTMLElement>(BLOCK_SELECTOR);
    if (!block) {
      return;
    }

    let rootBlock = block;
    let parentBlock = rootBlock.parentElement?.closest<HTMLElement>(
      BLOCK_SELECTOR,
    );
    while (parentBlock) {
      rootBlock = parentBlock;
      parentBlock = rootBlock.parentElement?.closest<HTMLElement>(
        BLOCK_SELECTOR,
      );
    }

    const layer =
      row.closest<HTMLElement>(".journal-item") ??
      rootBlock.parentElement ??
      this.#document.body;
    layer.classList.add(LEFT_LAYER_CLASS);
    this.#resizeObserver?.observe(layer);
    if (badge.parentElement !== layer) {
      layer.append(badge);
    }

    const rowRect = row.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    badge.style.setProperty(
      "--logseq-block-created-time-top",
      `${rowRect.top - layerRect.top + rowRect.height / 2}px`,
    );
  }

  #removeStaleBadges(renderedBadges: ReadonlySet<HTMLElement>): void {
    this.#document
      .querySelectorAll<HTMLElement>(`.${BADGE_CLASS}`)
      .forEach((badge) => {
        if (!renderedBadges.has(badge)) {
          badge.remove();
        }
      });
  }

  #removeUnusedLayers(): void {
    this.#document
      .querySelectorAll<HTMLElement>(`.${LEFT_LAYER_CLASS}`)
      .forEach((layer) => {
        if (!layer.querySelector(`.${BADGE_CLASS}`)) {
          this.#resizeObserver?.unobserve(layer);
          layer.classList.remove(LEFT_LAYER_CLASS);
        }
      });
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
      .querySelectorAll<HTMLElement>(`.${LEFT_LAYER_CLASS}`)
      .forEach((layer) => {
        this.#resizeObserver?.unobserve(layer);
        layer.classList.remove(LEFT_LAYER_CLASS);
      });
    this.#document
      .querySelectorAll<HTMLElement>(`.${BADGE_CLASS}`)
      .forEach((badge) => badge.remove());
  }
}
