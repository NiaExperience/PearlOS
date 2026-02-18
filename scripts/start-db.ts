import { exec } from 'child_process';
import * as net from 'net';

export async function startPostgres() {
  return new Promise<void>((resolve, reject) => {
    console.log('Checking for Postgres on localhost:5432...');
    
    const socket = new net.Socket();
    const timeout = 2000; // 2 seconds

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      console.log('✅ Postgres is reachable on localhost:5432');
      socket.destroy();
      resolve();
    });

    socket.on('timeout', () => {
      console.error('❌ Connection timed out');
      socket.destroy();
      failAndInstruct();
    });

    socket.on('error', (err) => {
      console.error(`❌ Connection failed: ${err.message}`);
      failAndInstruct();
    });

    socket.connect(5432, 'localhost');

    function failAndInstruct() {
      console.error('\n⚠️  Postgres is not running or not reachable on port 5432.');
      console.error('👉 Please ensure you have started the cluster with Tilt:');
      console.error('   run: tilt up');
      console.error('   (This will start Postgres and port-forward it to localhost:5432)\n');
      reject(new Error('Postgres not reachable'));
    }
  });
};

if (require.main === module) {
  startPostgres().catch(() => process.exit(1));
}
