#!/usr/bin/env bash
set -euo pipefail

############################
# FILL THESE VALUES FIRST  #
############################
AWS_PROFILE="${AWS_PROFILE:-default}"          # or set explicitly
AWS_REGION="us-east-2"
DOMAIN="niaxp.com"
SENDER_EMAIL="admin@niaxp.com"                 # Must be within verified domain
IAM_USER_NAME="ses-sender-app"
# If you want a custom MAIL FROM subdomain like mail.niaxp.com (must add MX + SPF record)
MAIL_FROM_SUBDOMAIN=""                     # leave blank to skip MAIL FROM setup
# Tagging (optional)
TAG_KEY="PearlOS"
TAG_VALUE="NiaEmail"

echo "Using profile=$AWS_PROFILE region=$AWS_REGION domain=$DOMAIN sender=$SENDER_EMAIL"

aws() { command aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"; }

echo "1) Verify (or create) SES domain identity"
if aws sesv2 get-email-identity --email-identity "$DOMAIN" >/dev/null 2>&1; then
  echo " - Domain identity already exists"
else
  aws sesv2 create-email-identity \
    --email-identity "$DOMAIN" \
    --dkim-signing-attributes SigningEnabled=true >/dev/null
  echo " - Requested domain identity; fetch DNS records next"
fi

echo "2) Fetch DNS (SPF/DKIM) records (informational)"
aws sesv2 get-email-identity --email-identity "$DOMAIN" \
  --query '{Dkim: DkimAttributes.Tokens}' || true
echo "Add TXT (v=spf1 include:amazonses.com -all) if not present, and the 3 DKIM CNAMEs: <token>._domainkey.$DOMAIN -> <token>.dkim.amazonses.com."

if [[ -n "${MAIL_FROM_SUBDOMAIN}" ]]; then
  MAIL_FROM_DOMAIN="${MAIL_FROM_SUBDOMAIN}.${DOMAIN}"
  echo "3) (Optional) Configure MAIL FROM domain: $MAIL_FROM_DOMAIN"
  if aws sesv2 get-email-identity --email-identity "$DOMAIN" \
      --query 'MailFromAttributes.MailFromDomain' 2>/dev/null | grep -q "$MAIL_FROM_DOMAIN"; then
    echo " - MAIL FROM already set"
  else
    aws sesv2 put-email-identity-mail-from-attributes \
      --email-identity "$DOMAIN" \
      --mail-from-domain "$MAIL_FROM_DOMAIN" \
      --behavior-on-mx-failure REJECT || true
    echo " - Set MAIL FROM attributes. Add DNS:"
    echo "   MX ${MAIL_FROM_DOMAIN} 10 feedback-smtp.${AWS_REGION}.amazonses.com"
    echo "   TXT ${MAIL_FROM_DOMAIN} v=spf1 include:amazonses.com -all"
  fi
fi

echo "4) (Optional) Verify specific sender email (not required once domain verified, but harmless)"
if aws sesv2 get-email-identity --email-identity "$SENDER_EMAIL" >/dev/null 2>&1; then
  echo " - Sender email identity already exists"
else
  aws sesv2 create-email-identity --email-identity "$SENDER_EMAIL" >/dev/null || true
  echo " - Verification email sent (only needed if domain DNS not fully verified yet)"
fi

echo "5) Create IAM user (if missing)"
if aws iam get-user --user-name "$IAM_USER_NAME" >/dev/null 2>&1; then
  echo " - IAM user exists"
else
  aws iam create-user --user-name "$IAM_USER_NAME" >/dev/null
  aws iam tag-user --user-name "$IAM_USER_NAME" --tags Key="$TAG_KEY",Value="$TAG_VALUE" >/dev/null
  echo " - Created IAM user"
fi

echo "6) Attach minimal SES send policy"
POLICY_NAME="SesSendEmailOnly"
POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ses:SendEmail","ses:SendRawEmail"],
    "Resource": "*",
    "Condition": {
      "StringEquals": { "aws:RequestedRegion": "${AWS_REGION}" }
    }
  }]
}
EOF
)

if aws iam list-policies --scope Local --query "Policies[?PolicyName=='${POLICY_NAME}'].Arn" --output text | grep -q arn; then
  POLICY_ARN=$(aws iam list-policies --scope Local --query "Policies[?PolicyName=='${POLICY_NAME}'].Arn" --output text)
  echo " - Policy exists"
else
  POLICY_ARN=$(aws iam create-policy --policy-name "$POLICY_NAME" --policy-document "$POLICY_DOC" --query 'Policy.Arn' --output text)
  echo " - Created policy $POLICY_NAME"
fi

if aws iam list-attached-user-policies --user-name "$IAM_USER_NAME" --query "AttachedPolicies[?PolicyName=='${POLICY_NAME}']" --output text | grep -q "$POLICY_NAME"; then
  echo " - Policy already attached"
else
  aws iam attach-user-policy --user-name "$IAM_USER_NAME" --policy-arn "$POLICY_ARN"
  echo " - Attached policy"
fi

echo "7) Create access keys (ONE-TIME). Store securely."
if aws iam list-access-keys --user-name "$IAM_USER_NAME" --query 'AccessKeyMetadata' --output text | grep -q AKIA; then
  echo " - Access key already exists (NOT regenerating)."
else
  aws iam create-access-key --user-name "$IAM_USER_NAME" --query 'AccessKey' --output json > access-key-${IAM_USER_NAME}.json
  echo " - Created access key. Saved to access-key-${IAM_USER_NAME}.json (secure this file)."
fi

echo "8) DMARC (informational)"
echo "Add/Update: _dmarc.${DOMAIN} TXT \"v=DMARC1; p=none; rua=mailto:dmarc@${DOMAIN}; pct=100\""
echo "Later raise to p=quarantine or p=reject after monitoring."

echo "9) Check SES identity status"
aws sesv2 get-email-identity --email-identity "$DOMAIN" --query '{IdentityType:IdentityType,DKIM:VerifiedForSendingStatus,Status:VerificationStatus}' || true

echo "Done. After DNS propagates (can take minutes to hours), SES will show Verified."