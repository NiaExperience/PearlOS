#!/bin/bash

# Function to kill processes on specific ports
kill_process_on_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null)
    
    if [ ! -z "$pids" ]; then
        echo "🔄 Killing processes on port $port: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null
        sleep 1
    else
        echo "✅ No processes found on port $port"
    fi
}

# Function to kill Node.js processes that might be running our apps
kill_node_processes() {
    echo "🔄 Looking for existing Node.js processes..."
    
    # Kill processes that might be running our apps
    local node_pids=$(ps aux | grep -E "(next|node.*dev|node.*start)" | grep -v grep | awk '{print $2}')
    
    if [ ! -z "$node_pids" ]; then
        echo "🔄 Killing existing Node.js processes: $node_pids"
        echo "$node_pids" | xargs kill -9 2>/dev/null
        sleep 1
    else
        echo "✅ No existing Node.js processes found"
    fi
}

# Function to kill all processes related to our development setup
cleanup_all() {
    echo "🧹 Cleaning up all development processes..."
    
    # Kill processes on common development ports
    kill_process_on_port 1234  # Pipecat UI app
    kill_process_on_port 2000  # Mesh app
    kill_process_on_port 5001  # Mesh app (testing)
    kill_process_on_port 5002  # Mesh app (pytest integration tests)
    kill_process_on_port 3000  # Interface app
    kill_process_on_port 4000  # Dashboard app
    kill_process_on_port 4444  # Pipecat Server app
    kill_process_on_port 9229  # Debug port
    kill_process_on_port 6379  # Redis
    kill_process_on_port 6380  # Redis Test
    kill_process_on_port 8000  # Chorus TTS server
    #kill_process_on_port 5432  # PostgreSQL
    #kill_process_on_port 27017 # MongoDB (if still used)

    
    # Kill Node.js processes
    kill_node_processes
    
    
    echo "✅ Cleanup complete!"
}

# Function to show what processes are running
show_running_processes() {
    echo "📊 Currently running processes on development ports:"
    echo "Port 1234 (Pipecat UI):"
    lsof -i:1234 2>/dev/null || echo "  No processes"
    echo "Port 4444 (Pipcat Server):"
    lsof -i:4444 2>/dev/null || echo "  No processes"
    echo "Port 2000 (Mesh):"
    lsof -i:2000 2>/dev/null || echo "  No processes"
    echo "Port 5001 (Mesh Test):"
    lsof -i:5001 2>/dev/null || echo "  No processes"
    echo "Port 5002 (Mesh Pytest):"
    lsof -i:5002 2>/dev/null || echo "  No processes"
    echo "Port 3000 (Interface):"
    lsof -i:3000 2>/dev/null || echo "  No processes"
    echo "Port 4000 (Dashboard):"
    lsof -i:4000 2>/dev/null || echo "  No processes"
    echo "Port 9229 (Debug):"
    lsof -i:9229 2>/dev/null || echo "  No processes"
    echo "Port 5432 (PostgreSQL):"
    lsof -i:5432 2>/dev/null || echo "  No processes"
    echo "Port 6379 (Redis):"
    lsof -i:6379 2>/dev/null || echo "  No processes"
    echo "Port 6380 (Redis Test):"
    lsof -i:6380 2>/dev/null || echo "  No processes"
    echo "Port 8000 (Chorus TTS):"
    lsof -i:8000 2>/dev/null || echo "  No processes"
}

# Main execution
case "${1:-cleanup}" in
    "cleanup")
        cleanup_all
        ;;
    "show")
        show_running_processes
        ;;
    "ports")
        kill_process_on_port 1234
        kill_process_on_port 2000
        kill_process_on_port 5001
        kill_process_on_port 5002
        kill_process_on_port 3000
        kill_process_on_port 3333
        kill_process_on_port 4000
        kill_process_on_port 4444
        kill_process_on_port 6379
        kill_process_on_port 6380
        kill_process_on_port 8000
        ;;
    "node")
        kill_node_processes
        ;;
    *)
        echo "Usage: $0 [cleanup|show|ports|node]"
        echo "  cleanup - Kill all development processes (default)"
        echo "  show    - Show currently running processes"
        echo "  ports   - Kill processes on common development ports"
        echo "  node    - Kill Node.js processes only"
        exit 1
        ;;
esac 