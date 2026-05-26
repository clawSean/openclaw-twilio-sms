import {
  buildChannelConfigSchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-schema";
import { requireChannelOpenAllowFrom } from "openclaw/plugin-sdk/extension-shared";
import { z } from "zod";
import { TWILIO_SMS_CHANNEL_ID, TWILIO_SMS_MAX_TEXT_CHUNK_LIMIT } from "./constants.js";

const DmPolicySchema = z.enum(["open", "allowlist", "pairing", "disabled"]);

const TwilioSmsCommonConfigSchemaBase = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  accountSid: z.string().optional(),
  authToken: z.string().optional(),
  accountSidFile: z.string().optional(),
  authTokenFile: z.string().optional(),
  fromNumber: z.union([z.string(), z.number()]).optional(),
  messagingServiceSid: z.string().optional(),
  defaultTo: z.union([z.string(), z.number()]).optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  webhookPath: z.string().optional(),
  publicUrl: z.string().optional(),
  textChunkLimit: z.number().int().positive().max(TWILIO_SMS_MAX_TEXT_CHUNK_LIMIT).optional(),
});

const TwilioSmsAccountConfigSchema = TwilioSmsCommonConfigSchemaBase.strict().superRefine(
  (value, ctx) => {
    requireChannelOpenAllowFrom({
      channel: TWILIO_SMS_CHANNEL_ID,
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      requireOpenAllowFrom,
    });
  },
);

export const TwilioSmsConfigSchema = TwilioSmsCommonConfigSchemaBase.extend({
  accounts: z.record(z.string(), TwilioSmsAccountConfigSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    requireChannelOpenAllowFrom({
      channel: TWILIO_SMS_CHANNEL_ID,
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      requireOpenAllowFrom,
    });
  });

export const TwilioSmsChannelConfigSchema = buildChannelConfigSchema(TwilioSmsConfigSchema);

export type TwilioSmsConfigSchemaType = z.infer<typeof TwilioSmsConfigSchema>;
