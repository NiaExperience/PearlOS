#! /bin/bash

# Defaults
TYPE=""
PAGE_IDS=""
TENANT_ID=""
DRY_RUN=""
MODE="local-to-staging"

# Constants
STG_ENDPOINT="https://mesh.stg.nxops.net/graphql"
PROD_ENDPOINT="https://mesh.pearlos.org/graphql"
LOCAL_ENDPOINT="http://localhost:2000/graphql"

# Parse args
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --type) TYPE="$2"; shift ;;
        --page-ids) PAGE_IDS="$2"; shift ;;
        --tenant) TENANT_ID="$2"; shift ;;
        --dry-run) DRY_RUN="--dry-run" ;;
        --staging-to-prod) MODE="staging-to-prod" ;;
        --prod-to-staging) MODE="prod-to-staging" ;;
        -*) echo "Unknown parameter passed: $1"; exit 1 ;;
        *) 
           if [ -z "$TYPE" ]; then 
               TYPE="$1"
           elif [ -z "$PAGE_IDS" ]; then 
               PAGE_IDS="$1"
           else
               echo "Unknown positional argument: $1"
               exit 1
           fi
           ;;
    esac
    shift
done

if [ -z "$TYPE" ]; then
  echo "Usage: $0 <type> [page_ids] [--tenant <tenant_id>] [--dry-run] [--staging-to-prod|--prod-to-staging]"
  echo "Example: $0 UserOrganizationRole"
  echo "Example: $0 UserOrganizationRole 'id1,id2'"
  echo "Example: $0 UserOrganizationRole 'id1,id2' --tenant 'my-tenant' --dry-run"
  exit 1
fi

# Determine Source and Target based on Mode
if [ "$MODE" == "staging-to-prod" ]; then
    SOURCE="$STG_ENDPOINT"
    TARGET="$PROD_ENDPOINT"
elif [ "$MODE" == "prod-to-staging" ]; then
    SOURCE="$PROD_ENDPOINT"
    TARGET="$STG_ENDPOINT"
else
    # Default: local-to-staging
    SOURCE="$LOCAL_ENDPOINT"
    # No source secret needed for local usually, or it uses env var
    TARGET="$STG_ENDPOINT"
fi

CMD="npx ts-node scripts/copy-content-to-aws.ts \
    --type '$TYPE' \
    --source $SOURCE \
    --target $TARGET"

if [ ! -z "$PAGE_IDS" ]; then
  CMD="$CMD --page-ids '$PAGE_IDS'"
fi

if [ ! -z "$TENANT_ID" ]; then
  CMD="$CMD --tenant '$TENANT_ID'"
fi

if [ ! -z "$DRY_RUN" ]; then
  CMD="$CMD --dry-run"
fi

echo "Running: $CMD"
eval $CMD
