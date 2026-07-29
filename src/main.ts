import "@logseq/libs";
import {
  BlockTimestampAnnotator,
  type TimestampFormat,
} from "./dom-annotator";
import { settingsSchema } from "./settings";

const FILE_GRAPH_MESSAGE =
  "Block Created Time is available only in Logseq DB graphs.";
const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "0h 0m ago";

function getTimestampFormat(): TimestampFormat {
  const value = logseq.settings?.timestampFormat;
  return value === "0h 0m ago" || value === "YY-MM-DD-HH:mm"
    ? value
    : DEFAULT_TIMESTAMP_FORMAT;
}

function shouldHideTimestampInDefaultView(): boolean {
  return logseq.settings?.hideTimestampInDefaultView === true;
}

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
    timestampFormat: getTimestampFormat,
    hideTimestampInDefaultView: shouldHideTimestampInDefaultView,
    onError: (error) => {
      console.error("[Block Created Time]", error);
    },
  });

  annotator.start();

  const offGraphChanged = logseq.App.onCurrentGraphChanged(() => {
    annotator.reset();
  });
  const offSettingsChanged = logseq.onSettingsChanged(() => {
    annotator.refreshVisibleBadges();
  });

  logseq.beforeunload(async () => {
    offGraphChanged?.();
    offSettingsChanged();
    annotator.destroy();
  });
}

logseq.useSettingsSchema(settingsSchema);

logseq.ready(main).catch((error) => {
  console.error("[Block Created Time] Failed to start the plugin.", error);
});
