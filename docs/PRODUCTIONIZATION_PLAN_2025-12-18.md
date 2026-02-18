# 🚀 Kubernetes Productionization Plan: Pearl (Production)
**Date:** December 18, 2025
**Status:** DRAFT / PROPOSAL

## 1. Executive Summary

**Overall Status:** 🔴 **Not Production Ready**

The `pearl` environment is currently operating in a fragile state suitable for development or staging, but **not for critical production traffic**. The primary risks are single points of failure (SPOFs) across all services, lack of automated scaling, and loose security postures.

**Top 3 Production Risks:**
1.  **Single Points of Failure:** All critical services (`interface`, `mesh`, `redis`) run as single replicas. A single node loss will cause downtime.
2.  **Manual/Imperative Drift:** Deployments show evidence of `kubectl set image`, meaning the running state has drifted from Helm Charts. Rollbacks via Helm may fail or revert to old versions.
3.  **No Scaling or Safety Nets:** No Horizontal Pod Autoscalers (HPA) or Pod Disruption Budgets (PDB) are configured. Traffic spikes or maintenance events will cause outages.

**Strategy:**
Shift from "managed manually" to "defined declaratively." We will enforce HA (High Availability) via Helm, implement autoscaling, and lock down security contexts.

---

## 2. Current State Snapshot (Observed)

**Cluster:** EKS (Bottlerocket Nodes) v1.32.9
**Ingress:** AWS Load Balancer Controller (ALB)
**Workloads:**
- **`interface-pearl`**: 1 replica. Probes configured. Resources: 100m/256Mi.
- **`mesh-pearl`**: 1 replica. Probes configured. Resources: 100m/192Mi.
- **`dashboard-pearl`**: 1 replica.
- **`redis-pearl`**: Standalone Deployment (not StatefulSet/HA). 1 replica.
- **`pipecat-daily-bot-pearl`**: 1 replica.

**Key Observations:**
- **Drift:** `kubectl set image` is being used for deployments, bypassing Helm values.
- **Config:** Secrets managed via ExternalSecrets (Good).
- **Networking:** TLS termination at ALB (`pearlos.org`).

---

## 3. Gap Analysis

| Area | Current State | Desired Production State | Risk | Required Helm Changes |
| :--- | :--- | :--- | :--- | :--- |
| **Availability** | Single Replicas (1) | High Availability (3+) | 🔴 Critical | Set `replicaCount: 3` or `autoscaling.minReplicas: 3`. |
| **Scaling** | None (Static) | HPA (CPU/Memory based) | 🔴 Critical | Enable `autoscaling`, set targets (e.g., 80% CPU). |
| **Resilience** | No PDBs | PDB (minAvailable: 1) | 🟠 High | Add `podDisruptionBudget` block. |
| **Redis** | Single Deployment | HA Cluster / Managed | 🔴 Critical | Migration to AWS ElastiCache OR HA Redis Chart. |
| **Security** | Run as Root (Default) | Non-root, Read-only FS | 🟠 High | Set `securityContext` (runAsNonRoot: true). |
| **Process** | Imperative (`kubectl set`) | Declarative (Helm Values) | 🟠 High | Update CI/CD to `helm upgrade --set image.tag=...`. |

---

## 4. Productionization Plan (Prioritized Backlog)

### Phase 1: Stability & Availability (Immediate)

#### 1.1 Enable High Availability & Disruption Safety
- **Goal:** Survive a single node failure without downtime.
- **Why:** Current setup goes down if the node hosting the pod dies.
- **Changes (values.yaml - for `interface`, `mesh`, `dashboard`):**
  ```yaml
  replicaCount: 3
  podDisruptionBudget:
    enabled: true
    minAvailable: 1
  affinity:
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchExpressions:
                - key: app.kubernetes.io/name
                  operator: In
                  values:
                    - interface # (or mesh/dashboard)
            topologyKey: kubernetes.io/hostname
  ```
- **Verification:** `kubectl get po -n <ns> -o wide` (ensure pods are on different nodes).
- **Rollback:** `helm rollback <release> <revision>`

#### 1.2 Enable Horizontal Autoscaling (HPA)
- **Goal:** Automatically handle traffic spikes.
- **Why:** Static replica counts cannot handle "thundering herd" events.
- **Changes (values.yaml):**
  ```yaml
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 80
    targetMemoryUtilizationPercentage: 80
  ```
- **Verification:** `kubectl get hpa -n <ns>`

### Phase 2: Security Hardening

#### 2.1 Enforce Non-Root Execution
- **Goal:** Prevent container breakout attacks.
- **Why:** Default pods run as root, increasing attack surface.
- **Changes (values.yaml):**
  ```yaml
  podSecurityContext:
    fsGroup: 2000
  securityContext:
    capabilities:
      drop:
      - ALL
    readOnlyRootFilesystem: true
    runAsNonRoot: true
    runAsUser: 1000
  ```
- **Verification:** `kubectl exec -it <pod> -- id` (should not be 0).

### Phase 3: Data Reliability (Redis)

#### 3.1 Redis Production Strategy
- **Goal:** Prevent data loss.
- **Why:** Current Redis is a single ephemeral pod. Restart = cache clear (or data loss if persistent).
- **Recommendation:** **Migrate to Amazon ElastiCache (Redis)** since you are on AWS/EKS.
- **Alternative (In-Cluster):** Switch `redis-pearl` Helm chart to HA Redis with Sentinel.

### Phase 4: Bot Operator Scaling
- **Goal:** Ensure bot operator is highly available.
- **Status:** Validated code safety for HA.
- **Findings:**
    - Operator uses atomic Redis `BLPOP`, safe for multiple replicas.
    - Gateway is stateless, safe for multiple replicas.
    - **Note:** Gateway has a pre-existing race condition (check-then-set) on `/join` that is not atomic. Recommend fixing via `SETNX` in application code, but this does not block infra scaling.
- **Action:** Scale `pipecat-daily-bot` (gateway & operator) to 3 replicas.

---

## 5. Release & Rollout Strategy

**Deployment Mode:** Rolling Update (Standard)
- **Settings:**
  - `maxUnavailable: 0` (Ensure capacity never drops below desired during deploy)
  - `maxSurge: 25%` (Spin up new pods before killing old ones)

**Failure Detection:**
- Rely on existing `livenessProbe` and `readinessProbe`.
- If `readinessProbe` fails, the RollingUpdate will pause.

**Rollback:**
- **Command:** `helm rollback <release_name> <revision> -n <namespace>`
- **Trigger:** If `kubectl rollout status` times out (default 10m).

---

## 6. Definition of Done (DoD)

- [x] All stateless services (`interface`, `mesh`, `dashboard`) have min 3 replicas.
- [x] `pipecat-daily-bot` scaled to 3 replicas (Gateway + Operator).
- [x] HPA is active and targeting 80% CPU/Mem.
- [x] PDBs ensure at least 1 replica is always up.
- [ ] Pods are running as non-root user (id 1000+).
- [ ] Redis is either managed (ElastiCache) or HA (Sentinel).
- [ ] CI/CD pipeline uses `helm upgrade` instead of `kubectl set image`.
- [ ] No manual drift exists (`helm diff` returns clean).
