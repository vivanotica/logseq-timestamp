import "@logseq/libs";
import { BlockTimestampAnnotator } from "./dom-annotator";

const FILE_GRAPH_MESSAGE =
  "Block Created Time is available only in Logseq DB graphs.";

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
