# Mobile CLI Access For Staging

Purpose: make the PearlOS Terminal usable from a phone without adding a new
login dependency for normal users, while preserving a Blair-only operator
fallback for emergency staging work.

## Product Direction

Mobile CLI means the in-app PearlOS Terminal on a mobile browser.

Rules:

- Normal users use the existing PearlOS app/session only. Do not require
  SSH, GitHub login, Cloudflare Access, code-server, or another
  device approval step just to use Terminal.
- Normal users stay in their sandbox workspace under
  `/srv/pearl-user-workspaces`.
- Advanced users may use GitHub fork workspaces only when the server-side
  entitlement resolver allows it.
- Blair may use `/workspace/nia-universal` only when the Blair-only staging
  source edits toggle is enabled server-side.
- Operator SSH access is for Blair/deploy maintenance only. It is not
  part of the product login model and must not be presented as the primary
  Terminal experience.

## Fastest Mobile Path

For normal PearlOS users:

1. Open the staging app in a mobile browser.
2. Use the existing PearlOS app session.
3. Open Terminal.
4. Work in the sandboxed PearlOS customization workspace.

Expected UX:

- Basic users should see a clean terminal, not a workspace selector.
- They should not have to choose "sandbox" or press an extra workspace apply
  control.
- Source-edit failures should explain that customization belongs in the
  sandbox instead of ending at a dead error.

For Blair:

1. Open the staging app in a mobile browser.
2. Enable the Blair-only staging source edits toggle only when direct staging
   source edits are needed.
3. Open Terminal. With the toggle active, Terminal routes to
   `/workspace/nia-universal`.
4. Turn the toggle off when protected source editing is no longer needed.

## DigitalOcean Staging Status - 2026-06-06

Verified on `pearl-staging-private-omega`:

- Tailscale has been removed from staging.
- `tailscaled` is inactive and the `tailscale` command is no longer installed.
- SSH key auth for `deploy` remains the existing operator fallback.
- `deploy` can run Codex from `/workspace/nia-universal` with:

```bash
cd /workspace/nia-universal
codex exec --sandbox workspace-write --skip-git-repo-check "Inspect staging, explain the failure, and propose the smallest safe fix. Do not edit deploy targets directly."
```

## Operator Fallback: Direct SSH

Use this only for Blair/deploy emergency staging access when the app terminal is
not enough. This path does not change normal user login.

Phone terminal clients:

- iOS: Blink Shell, Termius, or another SSH client with key support.
- Android: Termux from F-Droid or the official Termux GitHub release.

Android setup:

```bash
pkg update
pkg upgrade
pkg install openssh tmux
```

Add a Blair phone SSH key to the staging `deploy` account through the existing
authorized-key process. Do not add password login.

Saved phone command:

```bash
ssh deploy@134.209.76.227
```

Emergency Codex command after login:

```bash
cd /workspace/nia-universal
codex exec --sandbox workspace-write --skip-git-repo-check "Inspect staging, explain the failure, and propose the smallest safe fix. Do not edit deploy targets directly."
```

For an approved source edit:

```bash
cd /workspace/nia-universal
codex exec --sandbox workspace-write --skip-git-repo-check "Make the minimal source-only fix for <issue>. Follow AGENTS.md. Do not edit /home/deploy/pearlos directly."
```

Then use the staging release gate from the repo root:

```bash
PEARLOS_CODEX_VERIFIED=1 PEARLOS_BUILD_CODENAME='<codename>' scripts/deploy-staging.sh
```

## Optional Operator Fallback: Mosh

Only use this if direct SSH is already authorized and cellular reliability is
the blocker. Do not make public Mosh UDP a standing access policy unless it is
explicitly accepted.

Server:

```bash
apt-get update
apt-get install -y mosh
ufw allow 22/tcp
ufw allow 60000:61000/udp
```

Phone:

```bash
mosh deploy@134.209.76.227
```

Close UDP again when the incident is over if direct Mosh is not part of the
standing access policy.

## code-server Secondary Path

Use this only if Blair needs browser-based editing from a tablet-sized screen.
Do not rely on it as the fastest phone path, and do not expose it to normal
Terminal users.

```bash
curl -fsSL https://code-server.dev/install.sh | sh
systemctl enable --now code-server@deploy
```

Bind code-server to localhost, put it behind a protected tunnel or private
network, and protect the hostname with MFA. Do not expose code-server directly
to the public internet.

## Operational Notes

- Keep `/workspace/nia-universal` as the only source edit location.
- Never edit `/home/deploy/pearlos` source files directly.
- Keep normal-user Terminal low-friction: app session, sandbox, no workspace
  picker.
- Keep operator fallback credentials out of user-facing summaries.
- Save one short note on Blair's phone with the emergency `codex exec` command.

## References

- Mosh: https://mosh.org/
- Blink Shell: https://github.com/blinksh/blink
- Termux: https://wiki.termux.com/
- code-server iPad notes: https://coder.com/docs/code-server/ipad
- code-server install: https://coder.com/docs/code-server/install
