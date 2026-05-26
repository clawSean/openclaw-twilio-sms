import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { twilioSmsPlugin } from "./src/channel.js";
import { setTwilioSmsRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "twilio-sms",
  name: "Twilio SMS",
  description: "Twilio Programmable SMS channel plugin",
  plugin: twilioSmsPlugin,
  setRuntime: setTwilioSmsRuntime,
});
