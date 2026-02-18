#!/bin/sh
set -o errexit

# Configuration
CLUSTER_NAME="nia-dev"
REG_NAME="nia-dev-registry"
REG_PORT="5001"
KIND_NETWORK="kind" # Default kind network name

echo "Initializing local registry for existing cluster '${CLUSTER_NAME}'..."

# 1. Create/Start Registry Container
running="$(docker inspect -f '{{.State.Running}}' "${REG_NAME}" 2>/dev/null || true)"
if [ "${running}" != 'true' ]; then
  echo "Starting registry container '${REG_NAME}'..."
  docker run \
    -d --restart=always -p "${REG_PORT}:5000" --name "${REG_NAME}" \
    registry:2
else
  echo "Registry container '${REG_NAME}' is already running."
fi

# 2. Connect Registry to Kind Network
# Check if registry is already connected to the network
connected=$(docker inspect "${REG_NAME}" -f "{{json .NetworkSettings.Networks}}" | grep "${KIND_NETWORK}") || true
if [ -z "${connected}" ]; then
  echo "Connecting registry to network '${KIND_NETWORK}'..."
  docker network connect "${KIND_NETWORK}" "${REG_NAME}"
else
  echo "Registry is already connected to network '${KIND_NETWORK}'."
fi

# 3. Patch Containerd on Kind Nodes
nodes=$(kind get nodes --name "${CLUSTER_NAME}")
for node in $nodes; do
  echo "Checking node: $node"
  
  # Check if config already exists to avoid duplicate entries
  if docker exec "$node" grep -q "localhost:${REG_PORT}" /etc/containerd/config.toml; then
    echo "  Node $node already configured for registry."
  else
    echo "  Patching /etc/containerd/config.toml on $node..."
    docker exec "$node" sh -c "cat <<EOF >> /etc/containerd/config.toml

[plugins.\"io.containerd.grpc.v1.cri\".registry.mirrors.\"localhost:${REG_PORT}\"]
  endpoint = [\"http://${REG_NAME}:5000\"]
EOF"
    
    echo "  Restarting containerd on $node..."
    docker exec "$node" systemctl restart containerd
  fi
done

# 4. Apply ConfigMap for Node Advertisement
echo "Applying ConfigMap..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "localhost:${REG_PORT}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF

echo "✅ Local registry setup complete!"
