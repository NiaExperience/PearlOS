#!/bin/bash

# Update Kubernetes deployments in-situ for interface, dashboard, and mesh apps
# This script:
# 1. Backfills deployment folders with current live configurations  
# 2. Adds health check probes for standardized /health endpoints
# 3. Updates ALB ingress annotations for consistent health checking
# 4. Applies changes to live Kubernetes clusters

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Color output functions
log() { echo "$(date +'%H:%M:%S') ℹ️  $*"; }
success() { echo "$(date +'%H:%M:%S') ✅ $*"; }
error() { echo "$(date +'%H:%M:%S') ❌ $*" >&2; }
warn() { echo "$(date +'%H:%M:%S') ⚠️  $*"; }

# Apps to update
APPS=("interface" "dashboard" "mesh")

# Check prerequisites
check_prereqs() {
    log "Checking prerequisites..."
    
    if ! command -v kubectl &> /dev/null; then
        error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    if ! kubectl cluster-info &> /dev/null; then
        error "kubectl is not connected to a cluster"
        exit 1
    fi
    
    success "Prerequisites check passed"
}

# Backup current live configurations
backup_live_configs() {
    log "Backing up current live configurations..."
    
    local backup_dir="$REPO_ROOT/temp/deployment-backups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    
    for app in "${APPS[@]}"; do
        local namespace="${app}-stg"
        
        log "Backing up $app configurations..."
        kubectl get deployment "$namespace" -n "$namespace" -o yaml > "$backup_dir/${app}-deployment-backup.yaml" 2>/dev/null || warn "No deployment found for $app"
        kubectl get service "$namespace" -n "$namespace" -o yaml > "$backup_dir/${app}-service-backup.yaml" 2>/dev/null || warn "No service found for $app"
        kubectl get ingress "$namespace" -n "$namespace" -o yaml > "$backup_dir/${app}-ingress-backup.yaml" 2>/dev/null || warn "No ingress found for $app"
    done
    
    success "Backup completed in $backup_dir"
    echo "$backup_dir" > "$REPO_ROOT/temp/last-backup-path.txt"
}

# Update interface deployment with health probes and correct configuration
update_interface_deployment() {
    log "Updating interface deployment..."
    
    local deployment_file="$REPO_ROOT/apps/interface/deployment/staging/01-deployment.yaml"
    
    cat > "$deployment_file" << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: interface-stg
  namespace: interface-stg
  labels:
    app: interface-stg
spec:
  replicas: 1
  selector:
    matchLabels:
      app: interface-stg
  template:
    metadata:
      labels:
        app: interface-stg
    spec:
      containers:
      - name: auth-proxy
        image: nginx:1.27-alpine
        ports:
        - containerPort: 8080
          protocol: TCP
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            memory: 128Mi
        volumeMounts:
        - name: nginx-conf
          mountPath: /etc/nginx/nginx.conf
          subPath: nginx.conf
        - name: basic-auth
          mountPath: /etc/nginx/auth
      - name: web
        image: 577124901432.dkr.ecr.us-east-2.amazonaws.com/interface:latest
        ports:
        - containerPort: 3000
          protocol: TCP
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 2
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            memory: 512Mi
        envFrom:
        - secretRef:
            name: interface-stg-secret
        - configMapRef:
            name: interface-stg-config
      volumes:
      - name: nginx-conf
        configMap:
          name: interface-stg-nginx-conf
      - name: basic-auth
        secret:
          secretName: interface-stg-basic-auth
EOF

    success "Interface deployment updated"
}

# Update dashboard deployment with health probes
update_dashboard_deployment() {
    log "Updating dashboard deployment..."
    
    local deployment_file="$REPO_ROOT/apps/dashboard/deployment/staging/01-deployment.yaml"
    mkdir -p "$(dirname "$deployment_file")"
    
    cat > "$deployment_file" << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dashboard-stg
  namespace: dashboard-stg
  labels:
    app: dashboard-stg
spec:
  replicas: 1
  selector:
    matchLabels:
      app: dashboard-stg
  template:
    metadata:
      labels:
        app: dashboard-stg
    spec:
      containers:
      - name: web
        image: 577124901432.dkr.ecr.us-east-2.amazonaws.com/dashboard:latest
        ports:
        - containerPort: 4000
          protocol: TCP
        livenessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 2
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            memory: 512Mi
        envFrom:
        - secretRef:
            name: dashboard-stg-secret
        - configMapRef:
            name: dashboard-stg-config
EOF

    success "Dashboard deployment updated"
}

# Update mesh deployment with health probes  
update_mesh_deployment() {
    log "Updating mesh deployment..."
    
    local deployment_file="$REPO_ROOT/apps/mesh/deployment/staging/01-deployment.yaml"
    mkdir -p "$(dirname "$deployment_file")"
    
    cat > "$deployment_file" << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mesh-stg
  namespace: mesh-stg
  labels:
    app: mesh-stg
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mesh-stg
  template:
    metadata:
      labels:
        app: mesh-stg
    spec:
      containers:
      - name: web
        image: 577124901432.dkr.ecr.us-east-2.amazonaws.com/mesh:latest
        ports:
        - containerPort: 2000
          protocol: TCP
        livenessProbe:
          httpGet:
            path: /health
            port: 2000
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health
            port: 2000
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 2
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            memory: 512Mi
        envFrom:
        - secretRef:
            name: mesh-stg-secret
        - configMapRef:
            name: mesh-stg-config
EOF

    success "Mesh deployment updated"
}

# Update service files
update_services() {
    log "Updating service configurations..."
    
    # Interface service
    cat > "$REPO_ROOT/apps/interface/deployment/staging/02-service.yaml" << 'EOF'
apiVersion: v1
kind: Service
metadata:
  name: interface-stg
  namespace: interface-stg
  labels:
    app: interface-stg
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 8080
    protocol: TCP
    name: http
  selector:
    app: interface-stg
EOF

    # Dashboard service
    mkdir -p "$REPO_ROOT/apps/dashboard/deployment/staging"
    cat > "$REPO_ROOT/apps/dashboard/deployment/staging/02-service.yaml" << 'EOF'
apiVersion: v1
kind: Service
metadata:
  name: dashboard-stg
  namespace: dashboard-stg
  labels:
    app: dashboard-stg
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 4000
    protocol: TCP
    name: http
  selector:
    app: dashboard-stg
EOF

    # Mesh service
    cat > "$REPO_ROOT/apps/mesh/deployment/staging/02-service.yaml" << 'EOF'
apiVersion: v1
kind: Service
metadata:
  name: mesh-stg
  namespace: mesh-stg
  labels:
    app: mesh-stg
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 2000
    protocol: TCP
    name: http
  selector:
    app: mesh-stg
EOF

    success "Service configurations updated"
}

# Update ingress files with health check annotations
update_ingresses() {
    log "Updating ingress configurations..."
    
    # Interface ingress
    cat > "$REPO_ROOT/apps/interface/deployment/staging/03-ingress.yaml" << 'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: interface-stg
  namespace: interface-stg
  labels:
    app: interface-stg
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-2:577124901432:certificate/bc1d8af0-e73d-4158-b93b-6c7b72f4b0db
    alb.ingress.kubernetes.io/healthcheck-path: /health
    external-dns.alpha.kubernetes.io/hostname: interface.stg.nxops.net
spec:
  ingressClassName: alb
  rules:
  - host: interface.stg.nxops.net
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: interface-stg
            port:
              number: 80
EOF

    # Dashboard ingress
    cat > "$REPO_ROOT/apps/dashboard/deployment/staging/03-ingress.yaml" << 'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dashboard-stg
  namespace: dashboard-stg
  labels:
    app: dashboard-stg
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-2:577124901432:certificate/bc1d8af0-e73d-4158-b93b-6c7b72f4b0db
    alb.ingress.kubernetes.io/healthcheck-path: /health
    external-dns.alpha.kubernetes.io/hostname: dashboard.stg.nxops.net
spec:
  ingressClassName: alb
  rules:
  - host: dashboard.stg.nxops.net
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: dashboard-stg
            port:
              number: 80
EOF

    # Mesh ingress
    cat > "$REPO_ROOT/apps/mesh/deployment/staging/03-ingress.yaml" << 'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mesh-stg
  namespace: mesh-stg
  labels:
    app: mesh-stg
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-2:577124901432:certificate/bc1d8af0-e73d-4158-b93b-6c7b72f4b0db
    alb.ingress.kubernetes.io/healthcheck-path: /health
    external-dns.alpha.kubernetes.io/hostname: mesh.stg.nxops.net
spec:
  ingressClassName: alb
  rules:
  - host: mesh.stg.nxops.net
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: mesh-stg
            port:
              number: 80
EOF

    success "Ingress configurations updated"
}

# Apply updates to Kubernetes cluster
apply_updates() {
    local dry_run=${1:-false}
    
    if [[ "$dry_run" == "true" ]]; then
        log "Running in dry-run mode..."
        local dry_run_flag="--dry-run=client"
    else
        log "Applying updates to Kubernetes cluster..."
        local dry_run_flag=""
    fi
    
    for app in "${APPS[@]}"; do
        local app_dir="$REPO_ROOT/apps/$app/deployment/staging"
        
        if [[ -d "$app_dir" ]]; then
            log "Applying $app configurations..."
            
            if [[ -f "$app_dir/01-deployment.yaml" ]]; then
                kubectl apply -f "$app_dir/01-deployment.yaml" $dry_run_flag
            fi
            
            if [[ -f "$app_dir/02-service.yaml" ]]; then
                kubectl apply -f "$app_dir/02-service.yaml" $dry_run_flag
            fi
            
            if [[ -f "$app_dir/03-ingress.yaml" ]]; then
                kubectl apply -f "$app_dir/03-ingress.yaml" $dry_run_flag
            fi
            
            success "$app configurations applied"
        else
            warn "No deployment directory found for $app"
        fi
    done
}

# Verify deployments are healthy
verify_deployments() {
    log "Verifying deployments are healthy..."
    
    for app in "${APPS[@]}"; do
        local namespace="${app}-stg"
        
        log "Checking $app deployment status..."
        if kubectl rollout status deployment/"$namespace" -n "$namespace" --timeout=300s; then
            success "$app deployment is healthy"
        else
            error "$app deployment failed to roll out"
            return 1
        fi
    done
    
    success "All deployments are healthy"
}

# Main execution
main() {
    local dry_run=false
    local skip_apply=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                dry_run=true
                shift
                ;;
            --skip-apply)
                skip_apply=true
                shift
                ;;
            --help)
                cat << EOF
Usage: $0 [OPTIONS]

Update Kubernetes deployments for interface, dashboard, and mesh apps with health checks.

OPTIONS:
    --dry-run       Show what would be applied without making changes
    --skip-apply    Update files but don't apply to cluster
    --help          Show this help message

EXAMPLES:
    $0                    # Update files and apply to cluster
    $0 --dry-run          # Show what would be applied
    $0 --skip-apply       # Update files only
EOF
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    log "Starting Kubernetes deployment update..."
    
    check_prereqs
    backup_live_configs
    
    # Update deployment files
    update_interface_deployment
    update_dashboard_deployment  
    update_mesh_deployment
    update_services
    update_ingresses
    
    if [[ "$skip_apply" == "false" ]]; then
        apply_updates "$dry_run"
        
        if [[ "$dry_run" == "false" ]]; then
            verify_deployments
        fi
    else
        log "Skipping cluster application (--skip-apply specified)"
    fi
    
    success "Deployment update completed!"
    log "Updated deployment files are in apps/*/deployment/staging/"
    
    if [[ -f "$REPO_ROOT/temp/last-backup-path.txt" ]]; then
        local backup_path=$(cat "$REPO_ROOT/temp/last-backup-path.txt")
        log "Backup of original configs: $backup_path"
    fi
}

# Run main function
main "$@"