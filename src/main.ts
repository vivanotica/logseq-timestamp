import "@logseq/libs";
import { BlockTimestampAnnotator } from "./dom-annotator";

const FILE_GRAPH_MESSAGE =
  "Block Created Time is available only in Logseq DB graphs.";
const TOOLBAR_ITEM_KEY = "block-created-time-toggle";
const TOOLBAR_MODEL_KEY = "toggleBlockCreatedTime";

function getHostDocument(): Document {
  try {
    return window.parent?.document ?? document;
  } catch {
    return document;
  }
}

async function main(): Promise<void> {
  const appInfo = await logseq.App.getInfo();

  if (!appInfo?.supportDb) {
    logseq.UI.showMsg(FILE_GRAPH_MESSAGE, "warning");
    return;
  }

  const annotator = new BlockTimestampAnnotator({
    document: getHostDocument(),
    query: (query, uuids) => logseq.DB.datascriptQuery(query, uuids),
    onError: (error) => {
      console.error("[Block Created Time]", error);
    },
  });

  annotator.start();

  logseq.provideModel({
    [TOOLBAR_MODEL_KEY](element: HTMLElement) {
      const visible = annotator.toggleVisibility();
      element.setAttribute("aria-pressed", String(visible));
      element.setAttribute(
        "title",
        visible ? "Hide block timestamps" : "Show block timestamps",
      );
    },
  });
  logseq.App.registerUIItem("toolbar", {
    key: TOOLBAR_ITEM_KEY,
    template: `
      <a class="button" data-on-click="${TOOLBAR_MODEL_KEY}"
         title="Hide block timestamps" aria-label="Toggle block timestamps"
         aria-pressed="true">
        <i class="ti ti-clock"></i>
      </a>
    `,
  });

  const offGraphChanged = logseq.App.onCurrentGraphChanged(() => {
    annotator.reset();
  });
  logseq.beforeunload(async () => {
    offGraphChanged?.();
    annotator.destroy();
  });
}

logseq.ready(main).catch((error) => {
  console.error("[Block Created Time] Failed to start the plugin.", error);
});
