import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { twilioSmsPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(twilioSmsPlugin);
