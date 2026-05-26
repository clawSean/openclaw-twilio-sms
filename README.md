---
summary: "Twilio Programmable SMS channel setup, target syntax, and current MVP limits"
read_when:
  - You want to send SMS through Twilio from OpenClaw
  - You are configuring Twilio Account SID, Auth Token, and sender numbers
  - You are reviewing Twilio SMS channel limitations before enabling inbound messages
title: "Twilio SMS"
---

Twilio SMS connects OpenClaw to carrier SMS through Twilio Programmable Messaging.

Status: bundled plugin in early MVP shape. Outbound text sends use the shared
message delivery path and durable receipts. Inbound SMS webhooks verify Twilio
signatures, reject replays, use bounded request bodies, and default to
pairing-first sender authorization before model turns run.

## Configure

Minimal config:

```json5
{
  channels: {
    "twilio-sms": {
      enabled: true,
      accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      authToken: "TWILIO_AUTH_TOKEN",
      fromNumber: "+15551230000",
      publicUrl: "https://sms.example.com/twilio-sms/webhook",
      dmPolicy: "pairing",
    },
  },
}
```

Environment variables for the default account:

- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_SMS_FROM

Configure the Twilio Messaging webhook URL to:

```text
https://sms.example.com/twilio-sms/webhook
```

Set channels.twilio-sms.publicUrl to the same public URL when OpenClaw is
behind a reverse proxy. Signature verification uses publicUrl as the trusted
origin and the incoming request path/query as the signed webhook URL. Without
publicUrl, the plugin uses the direct Host header and does not trust forwarded
host headers.

You can use a Messaging Service instead of a sender number:

```json5
{
  channels: {
    "twilio-sms": {
      accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      authToken: "TWILIO_AUTH_TOKEN",
      messagingServiceSid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
  },
}
```

Multiple accounts:

```json5
{
  channels: {
    "twilio-sms": {
      defaultAccount: "alerts",
      accounts: {
        alerts: {
          accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          authToken: "TWILIO_AUTH_TOKEN",
          fromNumber: "+15551230000",
        },
      },
    },
  },
}
```

## Send messages

Use the normal message delivery surface. Targets can be bare E.164 numbers when
the channel is explicit:

```bash
openclaw message send --channel twilio-sms --target +15551230001 --message "Hello"
```

Provider-prefixed targets are also accepted:

```bash
openclaw message send --target twilio:+15551230001 --message "Hello"
```

twilio: is the provider prefix. The generic sms: prefix is not used by this
plugin because other channels use it as an internal service selector.

## Access control

Direct messages default to pairing:

```json5
{
  channels: {
    "twilio-sms": {
      dmPolicy: "pairing",
      allowFrom: ["+15551230001"],
    },
  },
}
```

Policies:

- pairing: unknown senders must be approved before they can reach an agent.
- allowlist: only allowFrom numbers can reach the agent.
- open: every sender is allowed and requires allowFrom: ["*"].
- disabled: inbound direct messages are blocked.

SMS is cost-bearing and phone numbers are personal data. Prefer pairing or
allowlist unless you intentionally want public inbound SMS.

## Message behavior

- SMS is text-only in the MVP.
- Groups, reactions, edits, polls, typing indicators, and threads are not
  supported.
- Outbound Markdown is flattened to plain text before sending.
- Long messages are chunked before delivery. The default chunk limit is 1530
  characters, and channels.twilio-sms.textChunkLimit can reduce it.
- Durable receipts include Twilio Message SIDs.

## Inbound webhook direction

Inbound Twilio webhooks are handled by the gateway route at the configured
webhook path, defaulting to /twilio-sms/webhook.

The inbound path:

- validates X-Twilio-Signature against the configured Account SID/Auth Token
- rejects replayed MessageSid/SmsSid deliveries without dispatching twice
- acknowledges valid webhooks before the agent turn runs
- gates unknown direct senders through pairing by default
- dispatches accepted inbound SMS through the shared channel turn kernel
- sends final assistant replies back through durable Twilio SMS delivery

Keep dmPolicy as pairing or allowlist unless you explicitly want public inbound
SMS. The channel remains text-only; MMS/media is deferred.
