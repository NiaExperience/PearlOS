/* eslint-disable no-console */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Configuration
const CLUSTER_NAME = process.env.KIND_CLUSTER_NAME || 'nia-dev';
const REG_NAME = 'nia-dev-registry';
const REG_PORT = '5001';

function run(command: string, options: Record<string, unknown> = {}) {
  console.log(`> ${command}`);
  return execSync(command, { stdio: 'inherit', encoding: 'utf8', ...options });
}

function runQuiet(command: string) {
  try {
    return execSync(command, { stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch (error) {
    return '';
  }
}

function checkPrerequisites() {
  const tools = ['docker', 'kind', 'kubectl'];
  for (const tool of tools) {
    if (!runQuiet(`which ${tool}`) && !runQuiet(`where ${tool}`)) {
      console.error(`❌ Error: '${tool}' is not installed or not in PATH.`);
      process.exit(1);
    }
  }
  console.log('✅ Prerequisites checked.');
}

function setupRegistry() {
  // 1. Create registry container unless it already exists
  const running = runQuiet(`docker inspect -f '{{.State.Running}}' "${REG_NAME}"`);
  
  if (running !== 'true') {
    console.log(`Creating registry container '${REG_NAME}'...`);
    run(`docker run -d --restart=always -p "${REG_PORT}:5000" --name "${REG_NAME}" registry:2`);
  } else {
    console.log(`Registry container '${REG_NAME}' is already running.`);
  }
}

function createCluster() {
  // Check if cluster exists
  const clusters = runQuiet('kind get clusters');
  if (clusters.includes(CLUSTER_NAME)) {
    console.log(`Cluster '${CLUSTER_NAME}' already exists.`);
    return;
  }

  console.log(`Creating cluster '${CLUSTER_NAME}'...`);

  const regHost = REG_NAME;
  // We need to know the registry IP if we are on bridge network, but usually using the name is fine if they are on the same network.
  
  const config = `
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
containerdConfigPatches:
- |-
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."localhost:${REG_PORT}"]
    endpoint = ["http://${regHost}:5000"]
`;

  // Create cluster with config passed via stdin
  // We can't easily pipe in node without a file or using spawn with input.
  // Let's write a temp file.
  const configPath = path.join(os.tmpdir(), 'kind-config.yaml');
  fs.writeFileSync(configPath, config);

  try {
    run(`kind create cluster --name "${CLUSTER_NAME}" --config "${configPath}"`);
  } finally {
    fs.unlinkSync(configPath);
  }
}

function connectRegistryToNetwork() {
  // Find the network the cluster is on.
  // The control plane container is named "${CLUSTER_NAME}-control-plane"
  const controlPlaneName = `${CLUSTER_NAME}-control-plane`;
  
  // Get network name
  // docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' nia-dev-control-plane
  const networkName = runQuiet(`docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "${controlPlaneName}"`);
  
  if (!networkName) {
    console.warn('⚠️ Could not determine Kind network name. Skipping registry connection.');
    return;
  }

  console.log(`Cluster is on network: ${networkName}`);

  // Check if registry is connected
  const connectedNetworks = runQuiet(`docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "${REG_NAME}"`);
  
  if (!connectedNetworks.includes(networkName)) {
    console.log(`Connecting registry '${REG_NAME}' to network '${networkName}'...`);
    run(`docker network connect "${networkName}" "${REG_NAME}"`);
  } else {
    console.log(`Registry is already connected to network '${networkName}'.`);
  }
}

function applyConfigMap() {
  console.log('Applying ConfigMap for local registry...');
  const configMap = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "localhost:${REG_PORT}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
`;

  const configMapPath = path.join(os.tmpdir(), 'kind-configmap.yaml');
  fs.writeFileSync(configMapPath, configMap);

  try {
    run(`kubectl apply -f "${configMapPath}"`);
  } finally {
    fs.unlinkSync(configMapPath);
  }
}

async function main() {
  console.log(`🚀 Setting up Kind cluster '${CLUSTER_NAME}' with local registry...`);
  
  checkPrerequisites();
  setupRegistry();
  createCluster();
  connectRegistryToNetwork();
  applyConfigMap();

  console.log('\n✅ Cluster setup complete!');
  console.log(`\nTo use this cluster with Tilt, run:\n  tilt up`);
}

main().catch(err => {
  console.error('\n❌ Setup failed:', err);
  process.exit(1);
});
