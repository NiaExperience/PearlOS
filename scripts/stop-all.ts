#!/usr/bin/env ts-node

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function stopAllProcesses(): Promise<void> {
  console.log('🛑 Stopping all development processes...');
  
  try {
    // Kill processes on common development ports
    const ports = [2000, 3000, 3333, 4000];
    
    for (const port of ports) {
      try {
        const { stdout } = await execAsync(`lsof -ti:${port}`);
        if (stdout.trim()) {
          await execAsync(`lsof -ti:${port} | xargs kill -9`);
          console.log(`✅ Stopped processes on port ${port}`);
        }
      } catch (error) {
        // This is expected if no processes are running on the port
        console.log(`No processes found on port ${port}`);
      }
    }
    
    // Kill any remaining node processes related to the project
    try {
      await execAsync(`pkill -f "turbo run dev" || true`);
      await execAsync(`pkill -f "ts-node-dev" || true`);
      await execAsync(`pkill -f "next dev" || true`);
      await execAsync(`pkill -f "ts-node.*server" || true`);
      console.log('✅ Killed remaining development processes');
    } catch (error) {
      console.log('No additional processes to kill');
    }
    
    // Clean up any leftover dump files
    try {
      await execAsync(`rm -f /tmp/db_dump_*.sql`);
      console.log('✅ Cleaned up temporary dump files');
    } catch (error) {
      console.log('No dump files to clean up');
    }
    
    console.log('🎉 All processes stopped and cleanup completed');
    
  } catch (error) {
    console.error('Error stopping processes:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  stopAllProcesses().catch(error => {
    console.error('Error in stop script:', error);
    process.exit(1);
  });
}

export { stopAllProcesses };
