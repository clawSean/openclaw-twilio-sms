import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  danger,
  logVerbose,
  waitForAbortSignal,
  type RuntimeEnv,
} from "openclaw/plugin-sdk/runtime-env";
import {
  isRequestBodyLimitError,
  normalizePluginHttpPath,
  registerWebhookTargetWithPluginRoute,
  requestBodyErrorToText,
} from "openclaw/plugin-sdk/webhook-ingress";
import {
  beginWebhookRequestPipelineOrReject,
  createWebhookInFlightLimiter,
} from "openclaw/plugin-sdk/webhook-request-guards";
import {
  DEFAULT_ACCOUNT_ID,
  listTwilioSmsAccountIds,
  resolveTwilioSmsAccount,
} from "./accounts.js";
import { TWILIO_SMS_CHANNEL_ID, TWILIO_SMS_DEFAULT_WEBHOOK_PATH } from "./constants.js";
import { handleTwilioSmsWebhookEvent } from "./inbound.js";
import type { ResolvedTwilioSmsAccount } from "./types.js";
import {
  createTwilioSmsNodeWebhookHandler,
  readTwilioSmsWebhookRequestBody,
  type TwilioSmsWebhookTarget,
} from "./webhook.js";

type TwilioSmsGatewayAdapter = NonNullable<ChannelPlugin<ResolvedTwilioSmsAccount>["gateway"]>;

const twilioSmsWebhookTargets = new Map<string, TwilioSmsWebhookTarget[]>();
const twilioSmsWebhookInFlightLimiter = createWebhookInFlightLimiter();
const TWILIO_SMS_WEBHOOK_PREAUTH_MAX_BODY_BYTES = 64 * 1024;
const TWILIO_SMS_WEBHOOK_PREAUTH_BODY_TIMEOUT_MS = 5_000;

export function listTwilioSmsGatewayAuthBypassPaths(params: { cfg: OpenClawConfig }): string[] {
  return listTwilioSmsAccountIds(params.cfg)
    .map((accountId) => resolveTwilioSmsAccount({ cfg: params.cfg, accountId }))
    .filter((account) => account.enabled && account.configured)
    .map(
      (account) =>
        normalizePluginHttpPath(account.config.webhookPath, TWILIO_SMS_DEFAULT_WEBHOOK_PATH) ??
        TWILIO_SMS_DEFAULT_WEBHOOK_PATH,
    );
}

function createScopedTwilioSmsWebhookHandler(target: TwilioSmsWebhookTarget) {
  return createTwilioSmsNodeWebhookHandler({
    path: target.path,
    targets: () => [target],
    runtime: target.runtime,
  });
}

async function dispatchSharedTwilioSmsWebhook(params: {
  req: Parameters<ReturnType<typeof createScopedTwilioSmsWebhookHandler>>[0];
  res: Parameters<ReturnType<typeof createScopedTwilioSmsWebhookHandler>>[1];
  path: string;
  targets: TwilioSmsWebhookTarget[];
  runtime: RuntimeEnv;
}): Promise<void> {
  const firstTarget = params.targets[0];
  if (params.req.method !== "POST") {
    if (!firstTarget) {
      params.res.statusCode = 404;
      params.res.end("Not Found");
      return;
    }
    await createScopedTwilioSmsWebhookHandler(firstTarget)(params.req, params.res);
    return;
  }

  const requestLifecycle = beginWebhookRequestPipelineOrReject({
    req: params.req,
    res: params.res,
    inFlightLimiter: twilioSmsWebhookInFlightLimiter,
    inFlightKey: TWILIO_SMS_CHANNEL_ID + ":" + params.path,
  });
  if (!requestLifecycle.ok) {
    return;
  }

  try {
    const rawBody = await readTwilioSmsWebhookRequestBody(
      params.req,
      TWILIO_SMS_WEBHOOK_PREAUTH_MAX_BODY_BYTES,
      TWILIO_SMS_WEBHOOK_PREAUTH_BODY_TIMEOUT_MS,
    );
    const handler = createTwilioSmsNodeWebhookHandler({
      path: params.path,
      targets: () => params.targets,
      runtime: params.runtime,
      readBody: async () => rawBody,
    });
    await handler(params.req, params.res);
  } catch (err) {
    if (isRequestBodyLimitError(err, "PAYLOAD_TOO_LARGE")) {
      params.res.statusCode = 413;
      params.res.setHeader("Content-Type", "application/json");
      params.res.end(JSON.stringify({ error: "Payload too large" }));
      return;
    }
    if (isRequestBodyLimitError(err, "REQUEST_BODY_TIMEOUT")) {
      params.res.statusCode = 408;
      params.res.setHeader("Content-Type", "application/json");
      params.res.end(JSON.stringify({ error: requestBodyErrorToText("REQUEST_BODY_TIMEOUT") }));
      return;
    }
    params.runtime.error?.(danger("twilio-sms webhook error: " + String(err)));
    if (!params.res.headersSent) {
      params.res.statusCode = 500;
      params.res.setHeader("Content-Type", "application/json");
      params.res.end(JSON.stringify({ error: "Internal server error" }));
    }
  } finally {
    requestLifecycle.release();
  }
}

export const twilioSmsGatewayAdapter: TwilioSmsGatewayAdapter = {
  resolveGatewayAuthBypassPaths: listTwilioSmsGatewayAuthBypassPaths,
  startAccount: async ({ cfg, account, accountId, runtime, abortSignal }) => {
    const resolvedAccountId = accountId || account.accountId || DEFAULT_ACCOUNT_ID;
    if (!account.enabled || !account.configured) {
      logVerbose("twilio-sms: skipping unconfigured account " + resolvedAccountId);
      return {
        account,
        stop: () => {},
      };
    }

    const normalizedPath =
      normalizePluginHttpPath(account.config.webhookPath, TWILIO_SMS_DEFAULT_WEBHOOK_PATH) ??
      TWILIO_SMS_DEFAULT_WEBHOOK_PATH;
    const target: TwilioSmsWebhookTarget = {
      accountId: resolvedAccountId,
      account,
      cfg,
      path: normalizedPath,
      runtime,
      handleEvent: async (event) => {
        await handleTwilioSmsWebhookEvent({
          cfg,
          account,
          event,
          runtime,
        });
      },
    };
    const { unregister } = registerWebhookTargetWithPluginRoute({
      targetsByPath: twilioSmsWebhookTargets,
      target,
      route: {
        auth: "plugin",
        pluginId: TWILIO_SMS_CHANNEL_ID,
        accountId: resolvedAccountId,
        log: (msg) => logVerbose(msg),
        handler: async (req, res) => {
          const targets = twilioSmsWebhookTargets.get(normalizedPath) ?? [];
          await dispatchSharedTwilioSmsWebhook({
            req,
            res,
            path: normalizedPath,
            targets,
            runtime,
          });
        },
      },
    });

    logVerbose("twilio-sms: registered webhook handler at " + normalizedPath);

    let stopped = false;
    const stop = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      unregister();
      logVerbose("twilio-sms: stopped provider for account " + resolvedAccountId);
    };

    if (abortSignal.aborted) {
      stop();
    } else {
      abortSignal.addEventListener("abort", stop, { once: true });
      await waitForAbortSignal(abortSignal);
    }

    return {
      account,
      stop: () => {
        stop();
        abortSignal.removeEventListener("abort", stop);
      },
    };
  },
};
