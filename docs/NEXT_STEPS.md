# Your Next Steps - Quick Checklist

## ✅ What's Done
- ✅ Kubernetes infrastructure archived (simplified setup)
- ✅ Kokoro set as default TTS provider (local, free)
- ✅ Chorus TTS submodule initialized
- ✅ Model files downloaded (kokoro-v1.0.onnx + voices-v1.0.bin)

## 🎯 What You Need to Do Now

### 1. Install `uv` (Python package manager)
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Or: pip install uv
```

### 2. Set Up Environment
```bash
cp config/env.minimal.example .env.local
# Edit .env.local and generate secrets:
openssl rand -base64 32  # For NEXTAUTH_SECRET
openssl rand -base64 32  # For MESH_SHARED_SECRET  
openssl rand -base64 32  # For TOKEN_ENCRYPTION_KEY
```

### 3. Start PostgreSQL
```bash
docker run -d --name nia-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:15
```

### 4. Sync Chorus Python Dependencies
```bash
npm run chorus:uv-sync
```

### 5. Start Chorus TTS Server (Terminal 1)
```bash
npm run chorus:start
# Keep this running - server on ws://127.0.0.1:8000
```

### 6. Start Platform (Terminal 2)
```bash
npm run start:all
# Interface: http://localhost:3000
# Dashboard: http://localhost:4000
# Mesh: http://localhost:2000/graphql
```

## 🎉 That's It!

Pearl will use Kokoro (local, free) for voice by default. No cloud TTS needed unless you set `USE_ELEVENLABS=true`.

