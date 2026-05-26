# Existing Twilio SMS / OpenClaw Work

Last checked: 2026-05-26.

## Public OpenClaw Signals

- openclaw/openclaw#85857: RFC for an official Twilio SMS text channel. Closed as core `not_planned`; ClawSweeper routed service-specific optional channels to ClawHub/external plugins unless a missing generic SDK seam is proven.
- openclaw/openclaw#46625: prior Twilio SMS channel extension PR by mitchellgordon95. Closed unmerged for the same ClawHub/external-plugin scope reason. Review notes called out fail-open webhook behavior when `authToken` is missing, leading spaces in split chunks, and an unused in-flight limiter.
- openclaw/openclaw#50809 / #50808: Android/device SMS channel work. Adjacent but different scope; this plugin is provider-hosted Twilio SMS and does not claim generic `sms:` ownership.
- openclaw/openclaw#56502 / #73822: SecretRef handling for phone-number/PII config. This plugin keeps phone-number handling isolated and should align with upstream SecretRef support when available.
- openclaw/openclaw#56283: plain-text Markdown stripping behavior for SMS-like channels. This plugin strips Markdown before sending plain SMS.

## ClawHub Search

- `twilio`: generic Twilio API skill, not a first-class OpenClaw channel plugin.
- `sms`: generic SMS/template skills, not Twilio/OpenClaw channel parity.
- `gstack-openclaw-sms`: unrelated search hit; not a Twilio SMS channel plugin.

No ClawHub-listed first-class OpenClaw Twilio SMS channel plugin was found in the checked search results.

## GitHub Search

- `mitchellgordon95/openclaw-twilio-sms`: standalone extraction of #46625. Good prior art, but it came from a core-style PR and retains older design choices such as PIN auth and MMS scope.
- `tspen/openclaw-twilio-sms-bridge`: working early bridge with live Twilio proof and async replies. Its README still lists replay protection and abuse controls as future work.
- `danmestas/openclaw-twilio-sms`: two-way plugin attempt with Jest tests and OpenClaw channel metadata. It uses `sms` as an alias, which this plugin avoids to prevent collision with existing OpenClaw `sms:` meanings.
- `swoleengineer/openclaw-twilio-sms`: channel plugin attempt with Twilio SDK dependency and `sms`/`twilio` aliases. This plugin keeps provider grammar explicit as `twilio:`.
- `seif9116/openclaw-twilio-sms`: MCP server for sending/searching/watching SMS, not a first-class OpenClaw channel plugin.

## Differentiation Target

This package should be judged as a ClawHub/external plugin that:

- uses OpenClaw's shared channel/message/turn SDK path instead of a private `twilio_sms` tool or embedded agent loop
- defaults to pairing-first sender admission
- validates Twilio signatures fail-closed
- rejects replayed webhook deliveries
- wires in-flight webhook limiting instead of leaving it unused
- strips Markdown and chunks plain SMS through OpenClaw's shared text chunking helper
- keeps `twilio-sms` and `twilio:+E164` provider-specific instead of claiming generic `sms:`
