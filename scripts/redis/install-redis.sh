#!/usr/bin/env bash
set -euo pipefail

# Redis installation script for development environments
# Supports macOS (Homebrew), Linux (apt/yum), and Docker fallback

echo "🚀 Installing Redis for development..."

# Check if Redis is already installed
if command -v redis-server >/dev/null 2>&1; then
  echo "✅ Redis already installed"
  redis-server --version
  exit 0
fi

# Detect operating system and install Redis
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "📱 macOS detected - installing via Homebrew"
  
  if ! command -v brew >/dev/null 2>&1; then
    echo "❌ Homebrew not found. Please install Homebrew first:"
    echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    exit 1
  fi
  
  brew install redis
  echo "✅ Redis installed via Homebrew"
  
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  echo "🐧 Linux detected - detecting package manager"
  
  if command -v apt >/dev/null 2>&1; then
    echo "📦 Using apt package manager"
    sudo apt update
    sudo apt install -y redis-server
    
    # Start Redis service
    sudo systemctl start redis-server
    sudo systemctl enable redis-server
    
  elif command -v yum >/dev/null 2>&1; then
    echo "📦 Using yum package manager"
    sudo yum install -y epel-release
    sudo yum install -y redis
    
    # Start Redis service
    sudo systemctl start redis
    sudo systemctl enable redis
    
  elif command -v dnf >/dev/null 2>&1; then
    echo "📦 Using dnf package manager"
    sudo dnf install -y redis
    
    # Start Redis service
    sudo systemctl start redis
    sudo systemctl enable redis
    
  else
    echo "⚠️  No supported package manager found (apt/yum/dnf)"
    echo "🐳 Falling back to Docker installation"
    USE_DOCKER=true
  fi
  
else
  echo "⚠️  Unsupported operating system: $OSTYPE"
  echo "🐳 Falling back to Docker installation"
  USE_DOCKER=true
fi

# Docker fallback installation
if [[ "${USE_DOCKER:-}" == "true" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "❌ Docker not found. Please install Docker first."
    exit 1
  fi
  
  echo "🐳 Setting up Redis via Docker"
  
  # Create Redis Docker container
  docker run -d \
    --name redis-dev \
    --restart unless-stopped \
    -p 6379:6379 \
    redis:7-alpine redis-server --save "" --appendonly no
  
  echo "✅ Redis Docker container created"
  echo "📝 Container name: redis-dev"
  echo "🔌 Port: 6379"
fi

# Verify installation
echo "🔍 Verifying Redis installation..."
sleep 2

if redis-cli ping >/dev/null 2>&1; then
  echo "✅ Redis is running and responding to ping"
  redis-server --version
else
  echo "❌ Redis installation verification failed"
  echo "💡 Try running: redis-server --daemonize yes"
  exit 1
fi

echo "🎉 Redis installation complete!"
echo ""
echo "🔧 Useful commands:"
echo "   Start Redis:     redis-server"
echo "   Connect to CLI:  redis-cli"
echo "   Stop Redis:      redis-cli shutdown"
echo "   Check status:    redis-cli ping"

if [[ "${USE_DOCKER:-}" == "true" ]]; then
  echo ""
  echo "🐳 Docker commands:"
  echo "   Stop container:  docker stop redis-dev"
  echo "   Start container: docker start redis-dev"
  echo "   Remove container: docker rm -f redis-dev"
fi