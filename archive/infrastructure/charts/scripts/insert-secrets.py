#!/usr/bin/env python3
import argparse
import base64
import boto3
import botocore
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("Missing dependency: PyYAML. Install with: pip install pyyaml boto3", file=sys.stderr)
    sys.exit(1)


def normalize_key(key: str) -> str:
    """
    Convert K8s secret key to path segment:
      - lowercase
      - underscores to hyphens
      - collapse spaces
      - keep a-z 0-9 and hyphen
    """
    s = key.strip().lower().replace("_", "-")
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9\-]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "secret"


def load_k8s_secret_docs(path: Path):
    with path.open("r", encoding="utf-8") as f:
        for doc in yaml.safe_load_all(f):
            if not doc:
                continue
            # Accept both Secret and generic YAML that has data/stringData
            if not isinstance(doc, dict):
                continue
            yield doc


def iter_secret_kv(doc: dict):
    """
    Yield (key, value_bytes) from a K8s Secret-like document.
    - Prefer `data` (base64-encoded per K8s spec)
    - Also accept `stringData` (already plaintext)
    """
    found_any = False

    # data: base64 encoded values
    data = doc.get("data") or {}
    if isinstance(data, dict):
        for k, v in data.items():
            if v is None:
                continue
            found_any = True
            # Each value should be base64; handle bad inputs gracefully
            try:
                b = base64.b64decode(v, validate=False)
            except Exception:
                # If it is not valid base64, treat as raw string
                b = str(v).encode("utf-8")
            yield k, b

    # stringData: plaintext values
    sdata = doc.get("stringData") or {}
    if isinstance(sdata, dict):
        for k, v in sdata.items():
            if v is None:
                continue
            found_any = True
            yield k, str(v).encode("utf-8")

    if not found_any:
        # Nothing to do in this doc
        return


def ensure_trailing_slash(p: str) -> str:
    return p if p.endswith("/") else p + "/"


def upsert_secret(sm, name: str, value_bytes: bytes, kms_key_id: str | None):
    # Try to decode as utf-8 for SecretString; fall back to SecretBinary
    secret_string = None
    secret_binary = None
    try:
        secret_string = value_bytes.decode("utf-8")
        # Normalize CRLF and strip trailing newline that often sneaks in
        secret_string = secret_string.rstrip("\r\n")
    except UnicodeDecodeError:
        secret_binary = value_bytes

    try:
        sm.describe_secret(SecretId=name)
        # Secret exists, put a new version
        if secret_string is not None:
            sm.put_secret_value(SecretId=name, SecretString=secret_string)
        else:
            sm.put_secret_value(SecretId=name, SecretBinary=secret_binary)
        action = "updated"
    except botocore.exceptions.ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            # Create it
            kwargs = {"Name": name}
            if kms_key_id:
                kwargs["KmsKeyId"] = kms_key_id
            if secret_string is not None:
                kwargs["SecretString"] = secret_string
            else:
                kwargs["SecretBinary"] = secret_binary
            sm.create_secret(**kwargs)
            action = "created"
        else:
            raise
    return action


def main():
    ap = argparse.ArgumentParser(description="Push K8s Secret data to AWS Secrets Manager")
    ap.add_argument("--file", required=True, help="Path to Kubernetes Secret YAML")
    ap.add_argument("--base-path", required=True, help="Base path for secret names, e.g. /nia/mesh-pearl/")
    ap.add_argument("--region", default=None, help="AWS region, e.g. us-east-2 (optional if env/CLI config set)")
    ap.add_argument("--kms-key-id", default=None, help="Optional KMS key id or ARN for new secrets")
    args = ap.parse_args()

    base_path = ensure_trailing_slash(args.base_path)
    sm = boto3.client("secretsmanager", region_name=args.region) if args.region else boto3.client("secretsmanager")

    yaml_path = Path(args.file)
    if not yaml_path.exists():
        print(f"File not found: {yaml_path}", file=sys.stderr)
        sys.exit(2)

    total = 0
    created = 0
    updated = 0

    for doc in load_k8s_secret_docs(yaml_path):
        for k, val_bytes in iter_secret_kv(doc):
            name = base_path + normalize_key(k)
            action = upsert_secret(sm, name, val_bytes, args.kms_key_id)
            total += 1
            if action == "created":
                created += 1
                print(f"Created {name}")
            else:
                updated += 1
                print(f"Updated {name}")

    if total == 0:
        print("No secrets found in YAML data or stringData sections", file=sys.stderr)
        sys.exit(3)

    print(f"Done. {total} processed, {created} created, {updated} updated.")


if __name__ == "__main__":
    main()
