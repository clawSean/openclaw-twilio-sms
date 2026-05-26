import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

type TwilioSmsRuntime = PluginRuntime & {
  channel: PluginRuntime["channel"] & {
    twilioSms?: {
      sendTwilioSmsMessage?: typeof import("./send.js").sendTwilioSmsMessage;
    };
  };
};

const {
  setRuntime: setTwilioSmsRuntime,
  clearRuntime: clearTwilioSmsRuntime,
  getRuntime: getTwilioSmsRuntime,
} = createPluginRuntimeStore<TwilioSmsRuntime>({
  pluginId: "twilio-sms",
  errorMessage: "Twilio SMS runtime not initialized - plugin not registered",
});

export { clearTwilioSmsRuntime, getTwilioSmsRuntime, setTwilioSmsRuntime };
