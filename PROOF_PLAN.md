# Twilio SMS Live Proof Plan

This checklist is for producing a redacted proof bundle for OpenClaw Twilio SMS
behavior. Do not publish raw logs, screenshots, phone numbers, Twilio tokens, or
full Twilio identifiers.

## Goals

The proof bundle should demonstrate:

- Twilio can deliver an inbound SMS webhook to OpenClaw.
- `X-Twilio-Signature` validation succeeds.
- unknown or unapproved senders are gated by pairing or allowlist policy.
- an approved sender can trigger an OpenClaw agent turn.
- the final assistant response is delivered back through Twilio SMS.
- outbound sends return a Twilio Message SID/status.
- all private identifiers are redacted.

## Redaction Rules

- Never show Twilio auth tokens, API credentials, full Account SIDs, full
  Message SIDs, raw config, or webhook secrets.
- Mask phone numbers as `+1******1234` or show only the last 2-4 digits.
- Mask Account SIDs as `AC...abcd`.
- Mask Message SIDs as `SM...abcd`.
- Use boring approved test text, such as `OpenClaw SMS proof ping`.
- Run a redaction scan before attaching or posting artifacts.

## Suggested Evidence

- OpenClaw version/branch and plugin package version.
- sanitized channel config status showing enabled Twilio SMS without secrets.
- webhook route registration.
- signed inbound webhook accepted.
- replay duplicate rejected or ignored, if easy to show.
- sender pairing/allowlist decision.
- outbound SMS API result with redacted Message SID/status.
- final delivered/queued Twilio status.
- focused test output.

## Local Verification

```bash
npm run build
npm test
npm audit --omit=dev
npm pack --dry-run
```

Before publishing proof artifacts, scan them:

```bash
rg -n "AC[a-zA-Z0-9]{32}|SM[a-zA-Z0-9]{32}|\\+[0-9]{7,15}|authToken|TWILIO_AUTH_TOKEN" proof/
```

## Public Proof Comment Template

```markdown
Added redacted live Twilio proof from an A2P-verified setup.

Behavior addressed: Twilio SMS can receive a signed inbound webhook and send a final assistant reply through Twilio SMS.
Environment tested: OpenClaw Twilio SMS against Twilio Programmable Messaging using an A2P-verified sender number.
Evidence after fix: signed inbound webhook accepted; sender gated by pairing/allowlist; final reply sent through Twilio; Message SID/status observed with identifiers redacted.
Observed result: inbound SMS produced an OpenClaw agent turn and visible SMS reply to the originating phone number.
Not tested: MMS/media, multi-account failover, high-volume replay cache behavior.
```

