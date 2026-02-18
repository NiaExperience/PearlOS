#!/usr/bin/env bash
set -euo pipefail

# add-pipecat-bot-route53.sh
#
# Create/UPSERT DNS records for pipecat-daily-bot.stg.nxops.net in Route53.
#
# Supports:
#   1) ALB/NLB alias (recommended)      -> --alias-dns-name and --alias-zone-id
#   2) CNAME to another hostname       -> --cname target.example.com
#   3) A record with one or more IPs   -> --a-ips "1.2.3.4,5.6.7.8"
#
# Required:
#   -z|--zone-id         Hosted Zone ID (e.g. Z123ABC456)
#
# One of (mutually exclusive):
#   --alias-dns-name <ALB_DNS_NAME> --alias-zone-id <ALB_ZONE_ID>
#   --cname <TARGET_HOSTNAME>
#   --a-ips <CSV_IPS>
#
# Optional:
#   -n|--name            FQDN (default: pipecat-daily-bot.stg.nxops.net.)
#   -t|--ttl             TTL for non-alias (default: 60)
#   --dry-run            Show change batch and exit
#
# Examples:
#   ALB alias:
#     ./add-pipecat-bot-route53.sh -z ZONEID --alias-dns-name internal-bot-alb-123.us-east-1.elb.amazonaws.com \
#       --alias-zone-id Z35SXDOTRQ7X7K
#
#   CNAME:
#     ./add-pipecat-bot-route53.sh -z ZONEID --cname bot-service.internal.example.com
#
#   A record (static IPs):
#     ./add-pipecat-bot-route53.sh -z ZONEID --a-ips "1.2.3.4,5.6.7.8"

ZONE_ID=""
FQDN="pipecat-daily-bot.stg.nxops.net."
TTL=60
ALIAS_DNS=""
ALIAS_ZONE=""
CNAME_TARGET=""
A_IPS=""
DRY_RUN=0

err() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || err "Missing required command: $1"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -z|--zone-id) ZONE_ID="$2"; shift 2 ;;
    -n|--name) FQDN="$2"; shift 2 ;;
    -t|--ttl) TTL="$2"; shift 2 ;;
    --alias-dns-name) ALIAS_DNS="$2"; shift 2 ;;
    --alias-zone-id) ALIAS_ZONE="$2"; shift 2 ;;
    --cname) CNAME_TARGET="$2"; shift 2 ;;
    --a-ips) A_IPS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
    *) err "Unknown arg: $1" ;;
  esac
done

need aws
[[ -z "$ZONE_ID" ]] && err "--zone-id is required"

# Validate exclusivity
set_count=0
[[ -n "$ALIAS_DNS" || -n "$ALIAS_ZONE" ]] && set_count=$((set_count+1))
[[ -n "$CNAME_TARGET" ]] && set_count=$((set_count+1))
[[ -n "$A_IPS" ]] && set_count=$((set_count+1))
[[ $set_count -ne 1 ]] && err "Specify exactly ONE of (alias, cname, a-ips)."

# Normalize trailing dot
[[ "$FQDN" != *"." ]] && FQDN="${FQDN}."

change_batch=""
if [[ -n "$ALIAS_DNS" ]]; then
  [[ -z "$ALIAS_ZONE" ]] && err "--alias-zone-id required with --alias-dns-name"
  change_batch=$(cat <<JSON
{
  "Comment": "UPSERT alias for $FQDN",
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "$FQDN",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "$ALIAS_ZONE",
        "DNSName": "$ALIAS_DNS",
        "EvaluateTargetHealth": false
      }
    }
  }]
}
JSON
)
elif [[ -n "$CNAME_TARGET" ]]; then
  [[ "$CNAME_TARGET" != *"." ]] && CNAME_TARGET="${CNAME_TARGET}."
  change_batch=$(cat <<JSON
{
  "Comment": "UPSERT CNAME for $FQDN",
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "$FQDN",
      "Type": "CNAME",
      "TTL": $TTL,
      "ResourceRecords": [{ "Value": "$CNAME_TARGET" }]
    }
  }]
}
JSON
)
elif [[ -n "$A_IPS" ]]; then
  # Build JSON array of IPs
  IFS=',' read -r -a ip_arr <<< "$A_IPS"
  rr_json=$(printf ',{"Value":"%s"}' "${ip_arr[@]}")
  rr_json="[${rr_json:1}]"
  change_batch=$(cat <<JSON
{
  "Comment": "UPSERT A record(s) for $FQDN",
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "$FQDN",
      "Type": "A",
      "TTL": $TTL,
      "ResourceRecords": $rr_json
    }
  }]
}
JSON
)
fi

echo "Prepared change batch:"
echo "$change_batch" | sed 's/^/  /'

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[DRY RUN] Not calling Route53."
  exit 0
fi

aws route53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID" \
  --change-batch "$change_batch"

echo "Submitted Route53 UPSERT. Use 'aws route53 get-change <change-id>' to track status."