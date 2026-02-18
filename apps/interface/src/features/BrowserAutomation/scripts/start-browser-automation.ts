#!/usr/bin/env node

/**
 * Browser Automation Service Startup Script
 * 
 * This script initializes the browser automation service with Puppeteer
 * and starts a WebSocket server for real-time communication with the AI agent.
 * 
 * Usage:
 * npm run start-browser-automation
 * or
 * node apps/interface/src/scripts/start-browser-automation.js
 */

import { browserAutomationService } from '../services/index';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('BrowserAutomation');

async function startBrowserAutomation() {
  try {
    log.info('Starting Browser Automation Service');
    
    // Check if Puppeteer is available
    try {
      const puppeteer = require('puppeteer');
      log.info('Puppeteer is available');
      
      // Make puppeteer globally available for the service
      (global as any).puppeteer = puppeteer;
    } catch (error) {
      log.error('Puppeteer not found. Please install it: npm install puppeteer');
      process.exit(1);
    }

    // Check if WebSocket is available
    try {
      const WebSocket = require('ws');
      log.info('WebSocket (ws) is available');
      
      // Make WebSocket globally available for the service
      (global as any).WebSocket = WebSocket;
    } catch (error) {
      log.error('WebSocket (ws) not found. Please install it: npm install ws');
      process.exit(1);
    }

    // Initialize WebSocket server
    const wsPort = process.env.BROWSER_WS_PORT ? parseInt(process.env.BROWSER_WS_PORT) : 8080;
    
    log.info('Starting WebSocket server', { port: wsPort });
    browserAutomationService.initializeWebSocketServer(wsPort);
    
    log.info('Browser Automation Service is ready', { port: wsPort });
    log.info('WebSocket server running', { url: `ws://localhost:${wsPort}` });
    log.info('AI agents can control browsers via API', { endpoint: '/api/browser-control' });
    
    // Keep the process alive
    process.on('SIGINT', () => {
      log.info('Shutting down Browser Automation Service');
      process.exit(0);
    });

    // Log service status every 30 seconds
    setInterval(() => {
      log.info('Browser Automation Service is running');
    }, 30000);

  } catch (error) {
    log.error('Failed to start Browser Automation Service', { error: error instanceof Error ? error.message : error });
    process.exit(1);
  }
}

// Start the service if this script is run directly
if (require.main === module) {
  startBrowserAutomation();
}

export { startBrowserAutomation };