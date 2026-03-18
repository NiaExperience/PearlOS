# Cloudflare Tunnel Setup for PearlOS

This guide walks through setting up a Cloudflare Tunnel to expose your PearlOS interface (running on `localhost:3000`) to the internet with a custom domain.

## Prerequisites

- A Cloudflare account (free tier works)
- A domain managed by Cloudflare DNS
- `cloudflared` installed (already done ✅)

## One-Time Setup

### 1. Authenticate with Cloudflare

Run this command to authenticate `cloudflared` with your Cloudflare account:

```bash
cloudflared tunnel login
```

This will:
- Open a browser window
- Ask you to log in to Cloudflare
- Select which domain to authorize
- Save credentials to `~/.cloudflared/cert.pem`

### 2. Create a Tunnel

Create a named tunnel (replace `pearlos` with your preferred name):

```bash
cloudflared tunnel create pearlos
```

This will output a **Tunnel ID** (a UUID like `abc123def-4567-8910-ghij-klmnopqrstuv`). **Save this ID!**

It also creates a credentials file at:
```
~/.cloudflared/<TUNNEL_ID>.json
```

### 3. Update Configuration File

Edit `/workspace/nia-universal/cloudflared-config.yml`:

Replace `TUNNEL_ID_PLACEHOLDER` (appears twice) with your actual Tunnel ID:

```yaml
tunnel: abc123def-4567-8910-ghij-klmnopqrstuv
credentials-file: /root/.cloudflared/abc123def-4567-8910-ghij-klmnopqrstuv.json
```

### 4. Configure DNS

Create a DNS record pointing your subdomain to the tunnel:

```bash
cloudflared tunnel route dns pearlos pearlos.yourdomain.com
```

Replace:
- `pearlos` with your tunnel name (from step 2)
- `pearlos.yourdomain.com` with your desired subdomain

This creates a CNAME record in Cloudflare DNS automatically.

## Running the Tunnel

### Start the Tunnel (foreground)

```bash
cloudflared tunnel --config /workspace/nia-universal/cloudflared-config.yml run pearlos
```

Replace `pearlos` with your tunnel name.

### Start the Tunnel (background with systemd)

Create a systemd service for automatic startup:

```bash
sudo tee /etc/systemd/system/cloudflared-pearlos.service > /dev/null <<EOF
[Unit]
Description=Cloudflare Tunnel for PearlOS
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/cloudflared tunnel --config /workspace/nia-universal/cloudflared-config.yml run pearlos
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

Then enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared-pearlos.service
sudo systemctl start cloudflared-pearlos.service
```

Check status:
```bash
sudo systemctl status cloudflared-pearlos.service
```

View logs:
```bash
journalctl -u cloudflared-pearlos.service -f
```

### Start the Tunnel (background with nohup)

Quick alternative without systemd:

```bash
nohup cloudflared tunnel --config /workspace/nia-universal/cloudflared-config.yml run pearlos > /tmp/cloudflared.log 2>&1 &
```

## Verify Setup

1. **Check tunnel status:**
   ```bash
   cloudflared tunnel list
   ```

2. **Check tunnel info:**
   ```bash
   cloudflared tunnel info pearlos
   ```

3. **Test the URL:**
   Open `https://pearlos.yourdomain.com` in your browser

   You should see your PearlOS interface!

## Troubleshooting

### Tunnel won't start

- Verify credentials file exists: `ls ~/.cloudflared/*.json`
- Check config file syntax: `cat /workspace/nia-universal/cloudflared-config.yml`
- Ensure Next.js is running: `curl http://localhost:3000`

### DNS not resolving

- Check DNS record in Cloudflare dashboard
- May take 1-2 minutes to propagate
- Try: `dig pearlos.yourdomain.com` or `nslookup pearlos.yourdomain.com`

### 502 Bad Gateway

- Confirm Next.js is running on port 3000: `lsof -i :3000`
- Check firewall isn't blocking localhost connections
- Review cloudflared logs: `journalctl -u cloudflared-pearlos.service -n 50`

### Connection refused

- Ensure `localhost:3000` is accessible: `curl -I http://localhost:3000`
- Restart Next.js: `pkill -f "next dev" && cd /workspace/nia-universal/apps/interface && npx next dev -p 3000 &`

## Security Considerations

### Cloudflare Access (Recommended)

Protect your PearlOS instance with Cloudflare Access (Zero Trust):

1. Go to Cloudflare Zero Trust dashboard
2. Access → Applications → Add an application
3. Choose "Self-hosted"
4. Set subdomain: `pearlos.yourdomain.com`
5. Configure authentication (email OTP, Google, GitHub, etc.)
6. Create access policies (e.g., only allow your email)

This adds authentication BEFORE traffic reaches your server.

### Environment Variables

Make sure sensitive env vars (API keys, secrets) are NOT exposed in:
- `next.config.mjs` client-side `env` section
- Client-side code

Only use `NEXT_PUBLIC_*` vars for truly public data.

## Advanced: Multiple Tunnels

You can run multiple services through one tunnel by editing `cloudflared-config.yml`:

```yaml
ingress:
  - hostname: pearlos.yourdomain.com
    service: http://localhost:3000
  - hostname: api.yourdomain.com
    service: http://localhost:4444
  - service: http_status:404
```

Then route DNS for each hostname:
```bash
cloudflared tunnel route dns pearlos pearlos.yourdomain.com
cloudflared tunnel route dns pearlos api.yourdomain.com
```

## Quick Reference Commands

```bash
# List tunnels
cloudflared tunnel list

# Get tunnel info
cloudflared tunnel info pearlos

# Delete a tunnel (WARNING: removes DNS routes)
cloudflared tunnel delete pearlos

# Cleanup stale connections
cloudflared tunnel cleanup pearlos

# Start tunnel (foreground)
cloudflared tunnel --config /workspace/nia-universal/cloudflared-config.yml run pearlos

# Stop systemd service
sudo systemctl stop cloudflared-pearlos.service

# View live logs
journalctl -u cloudflared-pearlos.service -f
```

## Summary

✅ `cloudflared` installed
✅ Configuration template ready
✅ Awaiting your Cloudflare login + tunnel creation
✅ Ready to route traffic to `localhost:3000`

**Next steps:** Run the authentication and tunnel creation commands above, then update the config file with your Tunnel ID.
