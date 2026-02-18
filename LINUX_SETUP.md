# Linux Development Setup

This guide describes how to set up the Nia Universal development environment on Linux.

While macOS users typically use **Colima** to provide a Docker/Kubernetes runtime, Linux users have native Docker support. For Kubernetes, we recommend **k3d** (k3s in Docker) as it is lightweight, fast, and matches the k3s environment used by Colima.

## Prerequisites

1.  **Docker Engine**: Ensure Docker is installed and running.
    *   [Install Docker Engine on Linux](https://docs.docker.com/engine/install/)
    *   Ensure your user is in the `docker` group: `sudo usermod -aG docker $USER` (requires logout/login).

2.  **Tilt**: Install Tilt for orchestrating the dev environment.
    *   `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash`

3.  **kubectl**: Install the Kubernetes command-line tool.
    *   [Install kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/)

4.  **k3d**: Install k3d to run the local cluster.
    *   `wget -q -O - https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash`

## Cluster Setup (k3d)

Create a cluster named `nia-dev` that matches the configuration expected by the Tiltfile.

```bash
# Create the cluster with port mapping for the ingress/services
k3d cluster create nia-dev \
    --api-port 6443 \
    -p "8080:80@loadbalancer" \
    -p "3000:3000@loadbalancer" \
    -p "4000:4000@loadbalancer" \
    -p "2000:2000@loadbalancer" \
    -p "4444:4444@loadbalancer" \
    --agents 1
```

*Note: The port mappings (`-p`) ensure that services exposed via LoadBalancer in the cluster are accessible on localhost, similar to how Colima handles networking.*

## Initialize the Database

To ensure your local environment has the necessary data schema and seed data, clone the development database structure:

```bash
npm run pg:db-clone-aws
```

> **Note**: This requires valid AWS credentials configured in your environment to pull the database dump.

## Running the Environment

1.  **Switch Context**: Ensure kubectl is pointing to the new cluster.
```bash
    kubectl config use-context k3d-nia-dev
```

2.  **Start Tilt**:
```bash
    tilt up
```

## Alternative: Minikube

If you prefer Minikube:

1.  Install Minikube: [Minikube Start](https://minikube.sigs.k8s.io/docs/start/)
2.  Start Minikube:
```bash
    minikube start --profile nia-dev --driver=docker
```
3.  Enable the ingress addon (optional, depending on service type):
```bash
    minikube profile nia-dev
    minikube addons enable ingress
```
4.  **Tunneling**: Minikube requires a tunnel to expose LoadBalancer services to localhost.
```bash
    minikube tunnel --profile nia-dev
```
    *Keep this running in a separate terminal.*

5.  Run Tilt:
```bash
    tilt up
```

## Troubleshooting

*   **"Context not allowed"**: If Tilt complains about the context, ensure your context name is in the `allow_k8s_contexts` list in `Tiltfile`. We currently allow: `k3d-nia-dev`, `minikube`, `kind-nia-dev`, `microk8s`, `docker-desktop`.
*   **Resource Limits**: Unlike macOS/Colima, Docker on Linux uses host resources directly. Ensure your machine has enough free RAM (at least 8GB, preferably 16GB+).
