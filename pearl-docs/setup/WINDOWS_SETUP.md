# Windows Development Setup

For Windows development, we **strongly recommend** using the Windows Subsystem for Linux 2 (WSL2).  
WSL2 provides a native Linux kernel and full compatibility with our development toolchain (Bash scripts, Node.js, Python, Docker, k3d, Tilt).

---

# Prerequisites

## 1. Install WSL2

Install WSL2 with an Ubuntu distribution:

```powershell
wsl --install
```

Restart if prompted.

## 2. Install Docker Desktop

Download and install Docker Desktop:

https://docs.docker.com/desktop/install/windows-install/

In Docker Desktop:

*   General → Use the WSL 2 based engine ✓
*   Resources → WSL Integration → Enable integration for Ubuntu ✓

## 3. Install Windows Terminal

Use Windows Terminal (not PowerShell) to open your WSL Ubuntu environment.

# Installation Steps (Inside WSL2)

Everything below must be run inside your WSL2 Linux shell, not in PowerShell.

## 1. Install Required Tools

### Option A: Homebrew (Recommended)

Install Homebrew for Linux:
https://brew.sh/

Then run:

```bash
brew install tilt kubectl k3d
```

### Option B: Manual Installation

```bash
# Tilt
curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash

# kubectl
# https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/

# k3d
wget -q -O - https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
```

## 2. Create a Local Registry (REQUIRED)

Unlike macOS/Colima, Windows + k3d cannot see your local Docker images directly.
Tilt must push images to a local registry, and the cluster must be configured to pull from it.

This section sets up a registry reachable by both:

1.  the host/WSL (for pushing images), and
2.  the k3d cluster (for pulling images).

### 2.1 Create a k3d-managed registry

```bash
k3d registry create registry.localhost --port 2844
```

This launches a registry:2 container mapped to:

*   `registry.localhost:2844` (from WSL)
*   `k3d-registry.localhost:2844` (inside the cluster)

### 2.2 Configure host resolution for the registry

Add this entry to `/etc/hosts` inside WSL:

```bash
echo '127.0.0.1 registry.localhost' | sudo tee -a /etc/hosts
```

This allows Tilt and Docker to reach the registry using the same hostname the cluster will use.

## 3. Create the k3d Cluster

Create a cluster wired to the registry:

```bash
k3d cluster create nia-dev \
  --api-port 6443 \
  --registry-use k3d-registry.localhost:2844 \
  -p "8080:80@loadbalancer" \
  -p "3000:3000@loadbalancer" \
  -p "4000:4000@loadbalancer" \
  -p "2000:2000@loadbalancer" \
  -p "4444:4444@loadbalancer" \
  --agents 1
```

k3d automatically:

*   configures containerd to trust `registry.localhost:5000` as an insecure HTTP registry
*   injects mirror configuration into all nodes
*   ensures pods can pull images successfully

## 4. Configure Tilt to Use the Local Registry

In your WSL terminal:

```bash
export TILT_DEFAULT_REGISTRY=registry.localhost:2844
```

Tilt will now build and push images like:

*   `registry.localhost:5000/nia-mesh:tilt-<hash>`
*   `registry.localhost:5000/nia-pipecat-bot:tilt-<hash>`

Your Tiltfile already picks up the environment variable automatically.

## 5. Initialize the Database

Requires AWS credentials:

```bash
npm run pg:db-clone-aws
```

## 6. Start the Development Environment

```bash
tilt up
```

Press `Space` to open the Tilt UI.

# Verifying It Works

### 1. Registry contains your images

```bash
curl http://registry.localhost:2844/v2/_catalog
```

Expected:

```json
{"repositories":["nia-mesh","nia-pipecat-bot","nia-interface", ...]}
```

### 2. Pods reference the registry

```bash
kubectl describe pod <pod> | grep -i Image:
```

Should show:

`Image: registry.localhost:2844/nia-mesh:tilt-<hash>`

### 3. Pods are pulling successfully

```bash
kubectl describe pod <pod> | egrep "Pulling|Pulled"
```

Should show successful pull messages.

### 4. Node can reach the registry

```bash
kubectl debug -it <node-name> --image=alpine -- sh
# inside the debug pod:
apk add curl
curl http://registry.localhost:2844/v2/_catalog
```

# Troubleshooting

### ❌ Pod pull errors (connection refused, HTTPS errors)

Check:

*   Cluster was created with:
    `--registry-use k3d-registry.localhost:2844`

*   `/etc/hosts` contains:
    `127.0.0.1 registry.localhost`

*   Environment variable is set:
    `echo $TILT_DEFAULT_REGISTRY`

### ❌ _catalog is empty

Tilt may not be pushing.

Run:

```bash
tilt doctor
```

and confirm your registry is detected.

### ❌ Services not reachable on localhost

Ensure cluster was created with the correct port mappings:

```bash
-p "3000:3000@loadbalancer"
-p "4444:4444@loadbalancer"
...
```

Everything is now set up for a fully functional, reproducible Windows + WSL2 + k3d development workflow that mirrors our macOS/k3d environment exactly.

---

If you'd like, I can also prepare a matching **MAC_SETUP.md** that standardizes k3d+registry on macOS as well, so all developers run identical environments.