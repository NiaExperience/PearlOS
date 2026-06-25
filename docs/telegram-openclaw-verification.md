# Telegram Verification Through OpenClaw

## Intended Flow

1. PearlOS interface generates a short verification code for the signed-in user.
2. The user sends that code to the same Telegram bot used by OpenClaw.
3. OpenClaw forwards the Telegram DM to PearlOS through the `telegram-dm-link-code`
   internal hook.
4. PearlOS verifies the code, links the web user to the Telegram user id, and
   adds that Telegram user id to the OpenClaw Telegram allowlist.

## OpenClaw Config

Add the repo hook directory to OpenClaw hook loading and enable the hook:

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "load": {
        "extraDirs": ["/workspace/nia-universal/openclaw-hooks"]
      },
      "entries": {
        "telegram-dm-link-code": {
          "enabled": true,
          "baseUrl": "http://127.0.0.1:3000"
        }
      }
    }
  }
}
```

The OpenClaw gateway environment must also provide `TELEGRAM_DM_LINK_SECRET`.
It must match PearlOS interface `TELEGRAM_DM_LINK_SECRET` or `MESH_SHARED_SECRET`.

## Current Runtime Limitation

OpenClaw 2026.4.11 enforces `channels.telegram.dmPolicy = "allowlist"` before
normal Telegram DM dispatch. Unknown users are blocked before `message:received`
internal hooks or plugin `inbound_claim` hooks run.

That means the config above is not enough by itself while production remains on
`allowlist`. The missing OpenClaw runtime feature is a pre-allowlist Telegram DM
hook, or a native "verification callback" setting in the Telegram access gate.
