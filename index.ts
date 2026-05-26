import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "twilio-sms",
  name: "Twilio SMS",
  description: "Twilio Programmable SMS channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "twilioSmsPlugin",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setTwilioSmsRuntime",
  },
});
