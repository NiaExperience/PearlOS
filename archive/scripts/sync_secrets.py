import subprocess
import json
import yaml
import os
import sys

STG_APPS = {
    "interface": {
        "namespace": "interface-stg",
        "secret_name": "interface-stg-secret",
        "file": "charts/interface/secrets.stg.yaml",
        "template_keys": [] # Will populate from live
    },
    "dashboard": {
        "namespace": "dashboard-stg",
        "secret_name": "dashboard-stg-secret",
        "file": "charts/dashboard/secrets.stg.yaml",
        "template_keys": []
    },
    "mesh": {
        "namespace": "mesh-stg",
        "secret_name": "mesh-stg-secret",
        "file": "charts/mesh/secrets.stg.yaml",
        "template_keys": []
    },
    "pipecat-daily-bot": {
        "namespace": "pipecat-daily-bot-stg",
        "secret_name": "pipecat-daily-bot-stg-secret",
        "file": "charts/pipecat-daily-bot/secrets.stg.yaml",
        "template_keys": []
    },
    "redis": {
        "namespace": "redis-stg",
        "secret_name": "redis-secret",
        "file": "charts/redis/secrets.stg.yaml",
        "template_keys": []
    }
}

PEARL_APPS = {
    "interface": {
        "namespace": "interface-pearl",
        "secret_name": "interface-pearl-secret",
        "stg_ref": "interface", # Fallback to interface-stg
        "file": "charts/interface/secrets.pearl.yaml"
    },
    "dashboard": {
        "namespace": "dashboard-pearl",
        "secret_name": "dashboard-pearl-secret",
        "stg_ref": "dashboard",
        "file": "charts/dashboard/secrets.pearl.yaml"
    },
    "mesh": {
        "namespace": "mesh-pearl",
        "secret_name": "mesh-pearl-secret",
        "stg_ref": "mesh",
        "file": "charts/mesh/secrets.pearl.yaml"
    },
    "pipecat-daily-bot": {
        "namespace": "pipecat-daily-bot-pearl",
        "secret_name": "pipecat-daily-bot-pearl-secret",
        "stg_ref": "pipecat-daily-bot",
        "file": "charts/pipecat-daily-bot/secrets.pearl.yaml"
    },
    "redis": {
        "namespace": "redis-pearl",
        "secret_name": "redis-secret",
        "stg_ref": "redis",
        "file": "charts/redis/secrets.pearl.yaml"
    }
}

# Keys to exclude from Secrets (moved to ConfigMap or obsolete)
EXCLUDE_KEYS = [
    "NEXT_PUBLIC_INTERFACE_BASE_URL",
    "NEXTAUTH_URL", 
    "NEXTAUTH_DASHBOARD_URL",
    "INTERFACE_BASE_URL",
    # "AWS_REGION", # Kept in Secret for interface-stg to match live.
    "AWS_SDK_LOAD_CONFIG",
    "EMAIL_REQUIRE_SES",
    "FORCE_ENCRYPTION",
    "NODE_ENV",
    "PORT",
    "RESET_TOKEN_PERSISTENCE"
    # "NEXTAUTH_INTERFACE_URL", # Kept in Secret for interface-stg to match live.
]

def get_k8s_secret(ns, name):
    print(f"Fetching secret {name} from {ns}...")
    try:
        cmd = ["kubectl", "get", "secret", name, "-n", ns, "-o", "json"]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(res.stdout).get("data", {})
    except Exception as e:
        print(f"  Error fetching {name}: {e}")
        return {}

def encrypt_and_save(filepath, data):
    print(f"Encrypting and saving to {filepath}...")
    temp_path = filepath + ".tmp.yaml"
    # Ensure structure is correct
    yaml_structure = {"secret": {"data": data}}
    
    with open(temp_path, 'w') as f:
        yaml.dump(yaml_structure, f)
    
    cmd = ["sops", "-e", temp_path]
    with open(filepath, 'w') as outfile:
        subprocess.run(cmd, stdout=outfile, check=True)
    
    os.remove(temp_path)

def decrypt_keys(filepath):
    # Helper to get the keys we want to exist in the file
    # We read the file (decrypting if needed, though we'll just read the keys from our previously created templates mostly)
    # Actually, better to just rely on live + fallback.
    # But we want to maintain the keys defined in our template if they aren't in live.
    # So we read the file.
    try:
        cmd = ["sops", "-d", filepath]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = yaml.safe_load(res.stdout)
        # Handle the "Invalid structure" case I saw earlier by robustly finding the dict
        if "data" in data and isinstance(data["data"], str):
             # Corrupted nested string case
             inner = yaml.safe_load(data["data"])
             return inner.get("secret", {}).get("data", {}).keys()
        return data.get("secret", {}).get("data", {}).keys()
    except:
        return []

def main():
    # 1. Fix Staging
    stg_secrets_cache = {} # key: app_name -> data dict

    print("=== SYNCING STAGING SECRETS ===")
    for app_name, config in STG_APPS.items():
        live_data = get_k8s_secret(config["namespace"], config["secret_name"])
        
        
        stg_secrets_cache[app_name] = live_data
        
        # Encrypt/Save properly
        encrypt_and_save(config["file"], live_data)

    # 2. Fix Pearl
    print("\n=== SYNCING PEARL SECRETS ===")
    for app_name, config in PEARL_APPS.items():
        live_data = get_k8s_secret(config["namespace"], config["secret_name"])
        stg_data = stg_secrets_cache.get(config["stg_ref"], {})
        
        # Get target keys from the file we created earlier (to know what we WANT)
        target_keys = decrypt_keys(config["file"])
        
        final_data = {}
        
        for key in target_keys:
            if key in live_data:
                final_data[key] = live_data[key]
            elif key in stg_data:
                print(f"  [{app_name}] Copying {key} from Staging...")
                final_data[key] = stg_data[key]
            else:
                print(f"  [{app_name}] Key {key} missing in Pearl AND Staging. Leaving placeholder.")
                final_data[key] = "CHANGE_ME"
        
        encrypt_and_save(config["file"], final_data)

if __name__ == "__main__":
    main()
