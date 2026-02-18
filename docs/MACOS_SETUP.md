# macOS Development Setup

This guide will help you set up a local Kubernetes development environment for Nia Universal on macOS. You can choose between **Colima** (simplest) or **k3d** (closest parity with Windows/Linux).

## Prerequisites

1. **Homebrew**: If you don't have Homebrew installed, [install it first](https://brew.sh/).

## Installation Steps

### 1. Install Tools

Install the required command-line tools using Homebrew:

```bash
brew install colima tilt kubectl k3d
```

* **colima**: Container runtime and Kubernetes provider (Option A).
* **k3d**: Lightweight wrapper to run k3s in Docker (Option B).
* **tilt**: Orchestrates your development environment.
* **kubectl**: Command-line tool for Kubernetes.

### 2. Setup Cluster

Choose **Option A** or **Option B** below.

#### Option A: Colima (Recommended for Simplicity)

Start a Colima instance with Kubernetes enabled. We recommend allocating sufficient resources (4 CPUs, 8GB RAM).

```bash
colima start nia-dev --cpu 4 --memory 8 --kubernetes
```

This command creates a profile named `nia-dev` and configures your `kubectl` context automatically. No local registry is required as Colima shares the Docker socket directly.

#### Option B: k3d (Recommended for Parity)

If you want to mirror the Windows/Linux setup exactly (e.g. debugging registry issues), use k3d with a local registry.

**1. Create a Local Registry**
```bash
k3d registry create registry.localhost --port 2844
```

**2. Configure Host Resolution**
Add the registry to your `/etc/hosts` so your Mac can resolve it:
```bash
sudo sh -c 'echo "127.0.0.1 registry.localhost" >> /etc/hosts'
```

**3. Create Cluster**
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

### 3. Initialize the Database

To ensure your local environment has the necessary data schema and seed data, clone the development database structure:

```bash
npm run pg:db-clone-aws
```

> **Note**: This requires valid AWS credentials configured in your environment to pull the database dump.

### 4. Start Development Environment

**For Colima (Option A):**
```bash
tilt up
```

**For k3d (Option B):**
You must tell Tilt where the registry is:
```bash
export TILT_DEFAULT_REGISTRY=registry.localhost:2844
tilt up
```

Press `Space` to open the Tilt UI in your browser. From there, you can monitor the status of all services, view logs, and trigger rebuilds.

## Troubleshooting

* **Context issues**: If Tilt complains about the context, ensure you are using the correct one:
    * Colima: `kubectl config use-context colima-nia-dev`
    * k3d: `kubectl config use-context k3d-nia-dev`

* **Resource limits**: If pods are crashing due to OOM:
    * **Colima**: Increase memory in the start command (e.g., `--memory 12`).
    * **k3d**: Ensure your Docker Desktop resource limits are sufficient (k3d runs inside Docker).
