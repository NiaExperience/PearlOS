---
name: telegram-dm-link-code
description: "Consumes PearlOS Telegram DM verification codes from OpenClaw Telegram messages"
metadata:
  {
    "openclaw":
      {
        "events": ["message:received"],
        "hookKey": "telegram-dm-link-code",
        "requires": { "env": ["TELEGRAM_DM_LINK_SECRET"] },
      },
  }
---

# Telegram DM Link Code

Forwards Telegram DM messages that look like PearlOS verification codes to the
PearlOS interface endpoint:

`/api/telegram/dm-link/consume-code`

This hook is intentionally small and config-driven. It expects OpenClaw to expose
Telegram inbound messages to the `message:received` internal hook.

Important: OpenClaw currently runs the Telegram DM allowlist check before normal
message dispatch. With `channels.telegram.dmPolicy` set to `allowlist`, unknown
Telegram users are blocked before this hook can see their code. The hook is still
kept here so it can be enabled when OpenClaw exposes a pre-allowlist Telegram
hook, or if the policy is changed to a mode that emits inbound DM events.
