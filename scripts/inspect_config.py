import subprocess
import json
import hashlib
import sys

NAMESPACES = [
    "interface-stg",
    "kokoro-tts-stg",
    "dashboard-stg",
    "mesh-stg",
    "pipecat-daily-bot-stg",
    "redis-stg"
]

def run_kubectl(args):
    try:
        result = subprocess.run(
            ["kubectl"] + args,
            capture_output=True,
            text=True,
            check=True
        )
        return json.loads(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Error running kubectl {' '.join(args)}: {e.stderr}", file=sys.stderr)
        return None

def get_resource_data(ns, kind):
    # Returns {resource_name: {key: value_hash}}
    # We use hashes to compare values without revealing them
    items = run_kubectl(["get", kind, "-n", ns, "-o", "json"])
    if not items:
        return {}
    
    data_map = {}
    for item in items.get("items", []):
        name = item["metadata"]["name"]
        data = item.get("data", {})
        # ConfigMaps might use 'binaryData' too, but usually 'data'
        # Secrets are in 'data' (base64)
        
        item_data = {}
        if data:
            for k, v in data.items():
                # For Secrets, v is base64, but for equality check, the raw base64 string is fine.
                # For ConfigMaps, v is the string.
                # We just want a hash to see if they are unique/same across the board.
                v_hash = hashlib.sha256(str(v).encode('utf-8')).hexdigest()[:8]
                item_data[k] = v_hash
        data_map[name] = item_data
    return data_map

def inspect_deployments(ns):
    deps = run_kubectl(["get", "deployments", "-n", ns, "-o", "json"])
    if not deps:
        return []
    
    usage = []
    for dep in deps.get("items", []):
        dep_name = dep["metadata"]["name"]
        pod_spec = dep["spec"]["template"]["spec"]
        
        for container in pod_spec.get("containers", []):
            # ENV variables
            for env in container.get("env", []):
                if "valueFrom" in env:
                    vf = env["valueFrom"]
                    if "configMapKeyRef" in vf:
                        ref = vf["configMapKeyRef"]
                        usage.append({
                            "deployment": dep_name,
                            "type": "ConfigMap",
                            "resource": ref["name"],
                            "key": ref["key"],
                            "usage_type": "env_explicit"
                        })
                    elif "secretKeyRef" in vf:
                        ref = vf["secretKeyRef"]
                        usage.append({
                            "deployment": dep_name,
                            "type": "Secret",
                            "resource": ref["name"],
                            "key": ref["key"],
                            "usage_type": "env_explicit"
                        })
            
            # ENV FROM
            for env_from in container.get("envFrom", []):
                if "configMapRef" in env_from:
                    usage.append({
                        "deployment": dep_name,
                        "type": "ConfigMap",
                        "resource": env_from["configMapRef"]["name"],
                        "key": "*",
                        "usage_type": "env_from"
                    })
                elif "secretRef" in env_from:
                    usage.append({
                        "deployment": dep_name,
                        "type": "Secret",
                        "resource": env_from["secretRef"]["name"],
                        "key": "*",
                        "usage_type": "env_from"
                    })
        
        # VOLUMES
        for vol in pod_spec.get("volumes", []):
            if "configMap" in vol:
                usage.append({
                    "deployment": dep_name,
                    "type": "ConfigMap",
                    "resource": vol["configMap"]["name"],
                    "key": "MOUNTED_VOLUME",
                    "usage_type": "volume"
                })
            elif "secret" in vol:
                usage.append({
                    "deployment": dep_name,
                    "type": "Secret",
                    "resource": vol["secret"]["secretName"],
                    "key": "MOUNTED_VOLUME",
                    "usage_type": "volume"
                })

    return usage

def main():
    print("Accounting of Secrets and ConfigMaps Usage")
    print("==========================================")

    for ns in NAMESPACES:
        print(f"\nNamespace: {ns}")
        print("-" * (len(ns) + 12))
        
        secrets = get_resource_data(ns, "secrets")
        configmaps = get_resource_data(ns, "configmaps")
        
        usages = inspect_deployments(ns)
        
        # Organize by Resource
        # { (Type, Name): [ {key, deployment, usage_type} ] }
        resource_usage_map = {}
        
        for u in usages:
            key = (u["type"], u["resource"])
            if key not in resource_usage_map:
                resource_usage_map[key] = []
            resource_usage_map[key].append(u)
            
        # Print Secrets
        # We filter out Helm secrets usually as they are internal, but let's list them if used (unlikely by deployments directly)
        
        all_resources = []
        for name in secrets:
            all_resources.append(("Secret", name, secrets[name]))
        for name in configmaps:
            all_resources.append(("ConfigMap", name, configmaps[name]))
            
        # Sort for cleaner output
        all_resources.sort()
        
        for r_type, r_name, r_data in all_resources:
            # Skip helm release secrets for clarity unless requested? 
            # User asked for "accounting ... used by deployments". 
            # Helm secrets are rarely used by deployments directly.
            if r_type == "Secret" and r_name.startswith("sh.helm.release"):
                continue
            if r_name == "kube-root-ca.crt": # noisy default
                continue
                
            print(f"\n{r_type}: {r_name}")
            
            # Check usage
            u_list = resource_usage_map.get((r_type, r_name), [])
            
            if not u_list:
                print("  [UNUSED BY DEPLOYMENTS]")
            else:
                # Aggregate usage by Deployment
                deps_using = set()
                for u in u_list:
                    deps_using.add(f"{u['deployment']} ({u['usage_type']})")
                print(f"  Used by: {', '.join(sorted(deps_using))}")
            
            # List Keys and their hashes
            if not r_data:
                print("  (No data keys)")
            else:
                print("  Keys:")
                for k, v_hash in sorted(r_data.items()):
                    # Check if this specific key is used explicitly
                    is_key_used = False
                    used_by_deployments = []
                    
                    for u in u_list:
                        if u["key"] == k or u["key"] == "*":
                            is_key_used = True
                            used_by_deployments.append(u["deployment"])
                    
                    # If volume, it uses the whole thing usually
                    if any(u["key"] == "MOUNTED_VOLUME" for u in u_list):
                         is_key_used = True
                         used_by_deployments.append("(Volume)")

                    usage_marker = f" -> {', '.join(set(used_by_deployments))}" if is_key_used else " (Available, not explicitly referenced individually)"
                    print(f"    - {k:<30} [Hash: {v_hash}] {usage_marker}")

if __name__ == "__main__":
    main()
