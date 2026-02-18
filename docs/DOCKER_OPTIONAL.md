# Docker is Optional - PostgreSQL Installation Guide

## Why Docker is NOT Required

**Docker is completely optional** for running Nia Universal. The project only requires:

1. **PostgreSQL database** running on `localhost:5432`
2. **Node.js** for the frontend/backend apps
3. **Python** for the Pipecat bot and Chorus TTS

Docker was previously used as a convenience for PostgreSQL setup, but it's **not a requirement**. You can install PostgreSQL directly on your system, which is actually **recommended** for better performance and simpler setup.

## Why Docker Was Used (Historical Context)

Docker was used because:
- **Cross-platform convenience**: One command to get PostgreSQL running without dealing with platform-specific installation
- **Isolation**: Keeps PostgreSQL separate from system packages
- **Easy cleanup**: Can remove PostgreSQL by deleting a container

However, Docker has downsides:
- **Extra dependency**: Requires Docker Desktop/service running
- **Performance overhead**: Containerization adds slight overhead
- **Platform issues**: Docker Desktop on Linux uses different socket paths than native Docker
- **Complexity**: Adds another layer to debug when things go wrong

## Recommended: Direct PostgreSQL Installation

### Ubuntu/Debian Linux

```bash
# Install PostgreSQL
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql  # Start on boot

# Set password for postgres user
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'password';"

# Create database
createdb -U postgres testdb
```

### macOS

```bash
# Install PostgreSQL via Homebrew
brew install postgresql@15

# Start PostgreSQL service
brew services start postgresql@15

# Set password and create database
psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'password';"
createdb -U postgres testdb
```

### Windows

1. **Download PostgreSQL installer**: https://www.postgresql.org/download/windows/
2. **Run installer** and follow the setup wizard
3. **Set password** to `password` during installation (or change later)
4. **Create database** using pgAdmin or command line:
   ```powershell
   createdb -U postgres testdb
   ```

Or use winget:
```powershell
winget install PostgreSQL.PostgreSQL
```

## Using Docker (Optional Fallback)

If you prefer Docker, the setup scripts will detect it and use it as a fallback. However, you must ensure:

1. **Docker Desktop is running** (Windows/macOS) or **Docker service is running** (Linux)
2. **Docker daemon is accessible** (check with `docker info`)

### Linux Docker Note

On Linux, if you see errors like:
```
failed to connect to the docker API at unix:///home/user/.docker/desktop/docker.sock
```

This means Docker Desktop is trying to use a different socket. You have two options:

1. **Use native Docker** (not Docker Desktop):
   ```bash
   # Install Docker Engine (not Desktop)
   sudo apt install docker.io
   sudo systemctl start docker
   sudo usermod -aG docker $USER  # Log out and back in
   ```

2. **Install PostgreSQL directly** (recommended):
   ```bash
   sudo apt install postgresql postgresql-contrib
   ```

## Setup Script Behavior

The setup scripts (`setup.sh`, `setup.ps1`, `setup.js`) now:

1. **Prefer direct PostgreSQL** if `psql` command is found
2. **Fall back to Docker** only if PostgreSQL is not installed
3. **Provide clear instructions** for installing PostgreSQL on your platform

## Verification

After installation, verify PostgreSQL is working:

```bash
# Test connection
psql -h localhost -U postgres -d testdb -c "SELECT 1;"

# Or with password
PGPASSWORD=password psql -h localhost -U postgres -d testdb -c "SELECT 1;"
```

## Summary

- ✅ **PostgreSQL is required** - Install directly (recommended) or use Docker (optional)
- ❌ **Docker is NOT required** - Only used as a convenience fallback
- 🎯 **Direct installation is better** - Simpler, faster, fewer moving parts

The project will work perfectly fine without Docker. Just ensure PostgreSQL is running on `localhost:5432` with:
- User: `postgres`
- Password: `password`
- Database: `testdb`

