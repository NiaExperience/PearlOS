#!/bin/bash
# Script to create a REST API proxy for JMeter testing
# This exposes the Prism functionality through a simple HTTP API

# Default port
PORT=${1:-3099}

# Check if the MESH endpoint is accessible
MESH_ENDPOINT=${MESH_ENDPOINT:-"http://localhost:2000/graphql"}
# Extract secret and strip surrounding quotes (single or double)
MESH_SHARED_SECRET=$(grep '^MESH_SHARED_SECRET=' ../../.env.local | cut -d'=' -f2- | sed "s/^['\"]//;s/['\"]$//")
export MESH_SHARED_SECRET

echo "Checking if Mesh endpoint is accessible at $MESH_ENDPOINT..."
if ! curl -s --head --request GET "$MESH_ENDPOINT" -H "x-mesh-secret: ${MESH_SHARED_SECRET}" | grep "200\|301\|302" > /dev/null; then
    echo "ERROR: Cannot connect to Mesh endpoint at $MESH_ENDPOINT"
    echo "Please make sure the Mesh app is running before starting the load test."
    echo "You can start it with: npm run dev -w apps/mesh"
    exit 1
fi
echo "Mesh endpoint is accessible. Continuing with load test..."

# Create temporary directory for the proxy API
API_SERVER_DIR="$(pwd)/temp"
mkdir -p "$API_SERVER_DIR"

# Create a simple Express API server
cat > "$API_SERVER_DIR/api-server.js" << 'EOL'
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Prism } = require('../../../packages/prism/dist/prism');
const fs = require('fs');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

// Create log file for this server
const serverLogPath = path.resolve(__dirname, `api.log`);
// If the log file already exists, erase it
if (fs.existsSync(serverLogPath)) {
  fs.unlinkSync(serverLogPath);
}
// Create a write stream for logging
const serverLogStream = fs.createWriteStream(serverLogPath, { flags: 'a' });

// Stats tracking per worker
const stats = {};
function accumulateStats(creates, reads, updates, deletes) {
  const workerId = cluster.isWorker ? cluster.worker.id : 'master';
  if (!stats[workerId]) {
    stats[workerId] = { creates: 0, reads: 0, updates: 0, deletes: 0 };
  }
  
  stats[workerId].creates = (stats[workerId].creates || 0) + creates;
  stats[workerId].reads = (stats[workerId].reads || 0) + reads;
  stats[workerId].updates = (stats[workerId].updates || 0) + updates;
  stats[workerId].deletes = (stats[workerId].deletes || 0) + deletes;
  
  if (stats[workerId].creates % 10 === 0 && stats[workerId].creates > 0) {
    logServerMessage(`Worker ${workerId} stats: ${JSON.stringify(stats[workerId])}`);
  }
}

function logServerMessage(message) {
  const timestamp = new Date().toISOString();
  const prefix = cluster.isWorker ? `[Worker ${cluster.worker.id}] ` : '[Master] ';
  serverLogStream.write(`${timestamp} - ${prefix}${message}\n`);
}

if (cluster.isMaster) {
  logServerMessage(`Master process ${process.pid} is running`);
  
  // Fork workers
  const workerCount = Math.min(numCPUs, 4); // Limit to 4 workers to avoid overwhelming Prism/Mesh
  logServerMessage(`Starting ${workerCount} workers (out of ${numCPUs} available CPUs)`);
  
  for (let i = 0; i < workerCount; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    logServerMessage(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal})`);
    // Replace the dead worker
    logServerMessage('Starting a new worker');
    cluster.fork();
  });
  
  // Display cluster status periodically
  setInterval(() => {
    const workerCount = Object.keys(cluster.workers).length;
    logServerMessage(`Cluster status: ${workerCount} active workers`);
  }, 30000);
} else {
  // Worker process - the actual Express server
  const app = express();
  const port = process.env.PORT || 3099;

  // Middleware
  app.use(bodyParser.json());

  // Initialize Prism
  let prismInstance = null;
const serverLogStream = fs.createWriteStream(serverLogPath, { flags: 'a' });

function logServerMessage(message) {
  const timestamp = new Date().toISOString();
  serverLogStream.write(`${timestamp} - ${message}\n`);
}

async function getPrism() {
  if (!prismInstance) {
    try {
      if (!process.env.MESH_SHARED_SECRET) {
          const message = 'MESH_SHARED_SECRET environment variable is required';
          logServerMessage(message);
          throw new Error(message);
      }
      if (!process.env.MESH_ENDPOINT) {
          const message = 'MESH_ENDPOINT environment variable is required';
          logServerMessage(message);
          throw new Error(message);
      }
      
      // Fetch the mesh endpoint's /health route and check for 'ok' response
      const request = require('node-fetch');
      const HEALTH_ENDPOINT = `${process.env.MESH_ENDPOINT || 'http://localhost:2000/graphql'}`.replace('/graphql', '/health');
      const healthCheckResponse = await request(HEALTH_ENDPOINT);
      if (!healthCheckResponse.ok) {
          const message = `${HEALTH_ENDPOINT} is not healthy: ${healthCheckResponse.statusText}`;
          logServerMessage(message);
          throw new Error(message);
      }

      prismInstance = await Prism.getInstance();
      // Verify Prism connection to Mesh by performing a simple query
      const testResult = await prismInstance.query({
        contentType: 'Tenant',
        tenantId: 'any',
        limit: 1
      });
      
      const message = 'Successfully connected to Prism and verified Mesh connectivity';
      logServerMessage(message);

    } catch (error) {
      logServerMessage('Failed to initialize Prism or connect to Mesh: ' + error, '\nPlease ensure the Mesh app is running before starting the load test');
      process.exit(1);
    }
  }
  return prismInstance;
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Ensure Prism is initialized and can connect to Mesh
    await getPrism();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    logServerMessage('Health check failed: ' + error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Create a record
app.post('/api/content/:contentType', async (req, res) => {
  try {
    const { contentType } = req.params;
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    const data = req.body;
    
    if (!tenantId) {
      logServerMessage('(create) Missing tenant ID in header or query parameter');
      res.status(400).json({ error: 'Missing tenant ID. Please provide x-tenant-id header or tenantId query parameter' });
      return;
    }

    const prism = await getPrism();
    const result = await prism.create(contentType, data, tenantId);
    if (!result || result.total === 0 || !result.items || result.items.length !== result.total) {
      const message = 'Failed to create record, result: ' + JSON.stringify(result);
      logServerMessage(message);
      res.status(500).json({ error: message });
      return;
    } else {
      const recordId = result.items[0]._id;
      // Simplify the response for JMeter by adding the ID at the root level as well
      result._id = recordId;
    }
    res.json(result);
  } catch (error) {
    logServerMessage('Error creating record: ' + error);
    res.status(500).json({ error: error.message });
  }
});

// Query records
app.post('/api/content/:contentType/query', async (req, res) => {
  try {
    const { contentType } = req.params;
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    const queryParams = req.body;
    
    if (!tenantId) {
      logServerMessage('(query) Missing tenant ID in header or query parameter');
      res.status(400).json({ error: 'Missing tenant ID. Please provide x-tenant-id header or tenantId query parameter' });
      return;
    }
    
    const prism = await getPrism();
    const result = await prism.query({
      contentType,
      tenantId,
      ...queryParams
    });
    if (!result || result.total === 0 || !result.items || result.items.length !== result.total) {
      const message = 'Failed to query records, result: ' + JSON.stringify(result);
      logServerMessage(message);
      res.status(500).json({ error: message });
      return;
    }
    res.json(result);
  } catch (error) {
    logServerMessage('Error querying records: ' + error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a record
app.delete('/api/content/:contentType/:id', async (req, res) => {
  try {
    const { contentType, id } = req.params;
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    
    if (!tenantId) {
      logServerMessage('(delete) Missing tenant ID in header or query parameter');
      res.status(400).json({ error: 'Missing tenant ID. Please provide x-tenant-id header or tenantId query parameter' });
      return;
    }
    
    const prism = await getPrism();
    const result = await prism.delete(contentType, id, tenantId);
    if (!result) {
      const message = 'Failed to delete record, result: ' + JSON.stringify(result);
      logServerMessage(message);
      res.status(500).json({ error: message });
      return;
    }
    res.json(result);
  } catch (error) {
    logServerMessage('Error deleting record: ' + error);
    res.status(500).json({ error: error.message });
  }
});

// Patch (update) a record
app.patch('/api/content/:contentType/:id', async (req, res) => {
  try {
    const { contentType, id } = req.params;
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    const data = req.body;
    
    if (!tenantId) {
      logServerMessage('(patch) Missing tenant ID in header or query parameter');
      res.status(400).json({ error: 'Missing tenant ID. Please provide x-tenant-id header or tenantId query parameter' });
      return;
    }
    if (!id) {
      logServerMessage('(update) Missing record ID in URL parameter');
      res.status(400).json({ error: 'Missing record ID. Please provide the ID in the URL' });
      return;
    } else if (id.length !== 36) {
      logServerMessage('(update) Invalid record ID format: ' + id);
      res.status(400).json({ error: 'Invalid record ID format. Please provide a valid uuid' });
      return;
    }
    
    const prism = await getPrism();
    const result = await prism.update(contentType, id, data, tenantId);
    if (!result || result.total === 0 || !result.items || result.items.length !== result.total) {
      const message = 'Failed to patch record, result: ' + JSON.stringify(result);
      logServerMessage(message);
      res.status(500).json({ error: message });
      return;
    }
    res.json(result);
  } catch (error) {
    logServerMessage('Error patching record: ' + error);
    res.status(500).json({ error: error.message });
  }
});

// Start server for worker processes only
if (cluster.isWorker) {
  app.listen(port, () => {
    logServerMessage(`Worker ${cluster.worker.id} (PID: ${process.pid}) running on port ${port}`);
  });
}

} // End of "else" block (worker process)
EOL

# Create a package.json for the API server
cat > "$API_SERVER_DIR/package.json" << 'EOL'
{
  "name": "jmeter-test-api",
  "version": "1.0.0",
  "description": "Temporary API server for JMeter testing",
  "main": "api-server.js",
  "scripts": {
    "start": "node api-server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "body-parser": "^1.20.2",
    "uuid": "^9.0.0"
  }
}
EOL

# Create a script to start the API server
cat > "$(pwd)/start-api-server.sh" << EOL
#!/bin/bash
# Start the API server for JMeter testing

PORT=\${1:-3099}
API_SERVER_DIR="$(pwd)/temp"

# Check if the MESH endpoint is accessible
MESH_ENDPOINT=\${MESH_ENDPOINT:-"http://localhost:2000/graphql"}
echo "Checking if Mesh endpoint is accessible at \$MESH_ENDPOINT..."
if ! curl -s --head --request GET \$MESH_ENDPOINT  -H "x-mesh-secret: \${MESH_SHARED_SECRET}" | grep "200\\|301\\|302" > /dev/null; then
    echo "ERROR: Cannot connect to Mesh endpoint at \$MESH_ENDPOINT"
    echo "Please make sure the Mesh app is running before starting the load test."
    echo "You can start it with: npm run dev -w apps/mesh"
    exit 1
fi
echo "Mesh endpoint is accessible. Starting API server..."

echo "Starting JMeter test API server with clustering on port \$PORT..."
cd "\$API_SERVER_DIR"
npm install
NODE_ENV=development PORT=\$PORT node api-server.js
EOL

# Make scripts executable
chmod +x "$(pwd)/start-api-server.sh"

echo "API server with clustering setup complete!"
