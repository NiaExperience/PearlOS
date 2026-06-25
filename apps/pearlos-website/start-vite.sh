#!/bin/bash
cd /workspace/nia-universal/apps/pearlos-website
export NODE_ENV=development
exec ./node_modules/.bin/vite --host 0.0.0.0 --port 5173
