import "@logseq/libs";

// settings.ts
export const settingsSchema = [
  {
    key: "timestampFormat",
    type: "enum",
    enumChoices: ["0h 0m ago", "YY-MM-DD-HH:mm"],
    default: "0h 0m ago",
    title: "timestamp format",
    description: "select the format for displaying timestamps",
  },
  {
    key: "hideTimestampInDefaultView",
    type: "boolean",
    default: false,
    title: "hide timestamp in default view",
    description: "hold ctrl+shift+q to view timestamp",
  },
] satisfies Parameters<typeof logseq.useSettingsSchema>[0];