#!/usr/bin/env ts-node

/**
 * Script to create a Dog Feeding Tracker HtmlGeneration record using Prism Mesh API
 * 
 * This creates a complete, functional demo application that showcases:
 * - Real API integration with Prism Mesh
 * - Content definition creation and management
 * - CRUD operations on feeding entries
 * - Mobile-responsive design
 * - Error handling and user feedback
 * 
 * Usage:
 *   npx ts-node apps/interface/src/features/HtmlGeneration/examples/dogfood/create-demo.ts [--tenant-id=<id>] [--user-id=<id>]
 */

import { ContentActions } from '@nia/prism/core/actions';
import dotenv from 'dotenv';
import path from 'path';
import { createDogFeedingContentType } from './content-type';
import { getLogger } from '@interface/lib/logger';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../../../../../../../.env.local') });

// Configuration - Using real IDs from db_archive.json
const DEFAULT_TENANT_ID = '7bd902a4-9534-4fc4-b745-f23368590946'; // pearlos tenant
const DEFAULT_USER_ID = '643fdb08-672d-4272-a138-8c1e8a6b8db3'; // jeff@niaxp.com user

// Parse command line arguments
const args = process.argv.slice(2);
const tenantId = args.find(arg => arg.startsWith('--tenant-id='))?.split('=')[1] || DEFAULT_TENANT_ID;
const userId = args.find(arg => arg.startsWith('--user-id='))?.split('=')[1] || DEFAULT_USER_ID;

const logger = getLogger('DogFeedingCreateDemo');

// Create user-specific content type
const dogFeedingContentType = createDogFeedingContentType(userId);
const CONTENT_TYPE = dogFeedingContentType.name; // This will be 'dogfood-<userId>'

// HTML content for the dog feeding tracker app
function createDogFeedingTrackerHTML(contentType: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🐕 Dog Feeding Tracker</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #ff9a56 0%, #ff6b35 50%, #f7931e 100%);
            min-height: 100vh;
            padding: 20px;
            color: #333;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .header p {
            opacity: 0.9;
            font-size: 1.1em;
        }
        
        .content {
            padding: 30px;
        }
        
        .status {
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
            font-weight: 600;
        }
        
        .status.loading {
            background: #e3f2fd;
            color: #1976d2;
        }
        
        .status.success {
            background: #e8f5e8;
            color: #2e7d32;
        }
        
        .status.error {
            background: #ffebee;
            color: #c62828;
        }
        
        .form-section {
            background: #f8f9fa;
            padding: 25px;
            border-radius: 15px;
            margin-bottom: 30px;
            border: 2px solid #e9ecef;
        }
        
        .form-section h3 {
            color: #ff6b35;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #555;
        }
        
        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s ease;
        }
        
        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            outline: none;
            border-color: #ff6b35;
            box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
        }
        
        .btn {
            background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 10px;
            font-size: 1.1em;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
            width: 100%;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(255, 107, 53, 0.4);
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .feeding-history {
            margin-top: 30px;
        }
        
        .feeding-entry {
            background: white;
            border: 2px solid #e9ecef;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 15px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            transition: transform 0.2s ease;
        }
        
        .feeding-entry:hover {
            transform: translateY(-2px);
        }
        
        .feeding-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .feeding-type {
            background: #ff6b35;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: 600;
        }
        
        .feeding-time {
            color: #666;
            font-size: 0.9em;
        }
        
        .feeding-description {
            font-size: 1.1em;
            margin-bottom: 8px;
            color: #333;
        }
        
        .feeding-notes {
            color: #666;
            font-style: italic;
        }
        
        .summary {
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
            padding: 20px;
            border-radius: 15px;
            margin-bottom: 20px;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px;
            text-align: center;
        }
        
        .summary-item {
            background: white;
            padding: 15px;
            border-radius: 10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .summary-number {
            font-size: 2em;
            font-weight: bold;
            color: #1976d2;
        }
        
        .summary-label {
            font-size: 0.9em;
            color: #666;
            margin-top: 5px;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        
        .empty-state img {
            width: 80px;
            opacity: 0.5;
            margin-bottom: 20px;
        }
        
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .container {
                border-radius: 15px;
            }
            
            .header {
                padding: 20px;
            }
            
            .header h1 {
                font-size: 2em;
            }
            
            .content {
                padding: 20px;
            }
            
            .form-section {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🐕 Dog Feeding Tracker</h1>
            <p>Keep track of your furry friend's meals, treats, and water intake</p>
        </div>
        
        <div class="content">
            <div id="status" class="status loading">
                Initializing app and checking data definitions...
            </div>
            
            <div class="form-section">
                <h3>📝 Log New Feeding</h3>
                <form id="feedingForm">
                    <div class="form-group">
                        <label for="type">Feeding Type:</label>
                        <select id="type" required>
                            <option value="food">🥘 Food</option>
                            <option value="treat">🦴 Treat</option>
                            <option value="water">💧 Water</option>
                            <option value="medication">💊 Medication</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="description">Description:</label>
                        <input type="text" id="description" placeholder="e.g., Kibble - 1 cup, Chicken treat, Fresh water" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="amount">Amount:</label>
                        <input type="text" id="amount" placeholder="e.g., 1 cup, 2 treats, full bowl">
                    </div>
                    
                    <div class="form-group">
                        <label for="notes">Notes (optional):</label>
                        <textarea id="notes" rows="3" placeholder="Any additional notes about feeding or behavior..."></textarea>
                    </div>
                    
                    <button type="submit" class="btn">Log Feeding Event</button>
                </form>
            </div>
            
            <div id="summary" class="summary" style="display: none;">
                <h3>📊 Today's Summary</h3>
                <div class="summary-grid">
                    <div class="summary-item">
                        <div class="summary-number" id="totalFeedings">0</div>
                        <div class="summary-label">Total Events</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-number" id="foodCount">0</div>
                        <div class="summary-label">Meals</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-number" id="treatCount">0</div>
                        <div class="summary-label">Treats</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-number" id="waterCount">0</div>
                        <div class="summary-label">Water</div>
                    </div>
                </div>
            </div>
            
            <div class="feeding-history">
                <h3>📋 Today's Feeding History</h3>
                <div id="feedingList">
                    <div class="empty-state">
                        <div style="font-size: 3em;">🐕</div>
                        <p>No feeding events logged today.<br>Start by logging your dog's first meal!</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Application state
        let feedingEntries = [];
        let definitionExists = false;

        const logger = window.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
        
        // API configuration
        const API_BASE = '/api/applet-api';
        const CONTENT_TYPE = '${contentType}';
        
        // Initialize the application
        async function initializeApp() {
            try {
                updateStatus('Checking content definition...', 'loading');
                await ensureDefinitionExists();
                
                updateStatus('Loading today\\'s feeding history...', 'loading');
                await loadTodaysFeedings();
                
                updateStatus('Ready! You can now log feeding events.', 'success');
                setTimeout(() => {
                    document.getElementById('status').style.display = 'none';
                }, 3000);
                
            } catch (error) {
                logger.error('Initialization error', { error });
                updateStatus('Failed to initialize app. Please refresh and try again.', 'error');
            }
        }
        
        // Ensure the content definition exists
        async function ensureDefinitionExists() {
            try {
                const response = await fetch(\`\${API_BASE}?operation=getDefinition&type=\${CONTENT_TYPE}\`);
                
                if (response.ok) {
                    definitionExists = true;
                    return;
                }
                
                // Definition doesn't exist, create it
                updateStatus('Creating content definition for feeding entries...', 'loading');
                await createDefinition();
                definitionExists = true;
                
            } catch (error) {
                logger.error('Definition check/creation error', { error });
                throw new Error('Failed to ensure content definition exists');
            }
        }
        
        // Create the content definition
        async function createDefinition() {
            const definition = {
                name: '${contentType}',
                description: 'Log entries for tracking dog feeding events throughout the day',
                dataModel: {
                    block: 'DogFeedingEntry',
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            type: {
                                type: 'string',
                                enum: ['food', 'treat', 'water', 'medication'],
                                description: 'Type of feeding event',
                                default: 'food'
                            },
                            description: {
                                type: 'string',
                                description: 'What was given',
                                maxLength: 200
                            },
                            timestamp: {
                                type: 'string',
                                format: 'date-time',
                                description: 'When the feeding occurred'
                            },
                            notes: {
                                type: 'string',
                                description: 'Optional notes',
                                maxLength: 500
                            },
                            amount: {
                                type: 'string',
                                description: 'Amount given',
                                maxLength: 50
                            },
                            createdBy: {
                                type: 'string',
                                description: 'User ID who logged this event'
                            },
                            createdAt: {
                                type: 'string',
                                format: 'date-time',
                                description: 'When this record was created'
                            }
                        },
                        required: ['type', 'description', 'timestamp', 'createdBy', 'createdAt'],
                        additionalProperties: false
                    }
                },
                uiConfig: {
                    labels: {
                        type: 'Feeding Type',
                        description: 'Description',
                        timestamp: 'Time',
                        notes: 'Notes',
                        amount: 'Amount'
                    }
                },
                access: {
                    allowAnonymous: false,
                    tenantRole: undefined
                }
            };
            
            const response = await fetch(\`\${API_BASE}?operation=createDefinition\`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ definition })
            });
            
            if (!response.ok) {
                throw new Error('Failed to create content definition');
            }
        }
        
        // Load today's feeding entries
        async function loadTodaysFeedings() {
            try {
                const today = new Date();
                const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
                const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();
                
                const whereClause = {
                    timestamp: {
                        gte: startOfDay,
                        lte: endOfDay
                    }
                };
                
                const response = await fetch(\`\${API_BASE}?operation=list&type=\${CONTENT_TYPE}&where=\${encodeURIComponent(JSON.stringify(whereClause))}\`);
                
                if (response.ok) {
                    const data = await response.json();
                    feedingEntries = data.data || [];
                    updateFeedingDisplay();
                    updateSummary();
                } else {
                    logger.warn('Failed to load feeding entries', { statusText: response.statusText });
                    feedingEntries = [];
                    updateFeedingDisplay();
                }
            } catch (error) {
                logger.error('Error loading feedings', { error });
                feedingEntries = [];
                updateFeedingDisplay();
            }
        }
        
        // Handle form submission
        async function handleFormSubmit(event) {
            event.preventDefault();
            
            const form = event.target;
            const submitButton = form.querySelector('button[type="submit"]');
            const originalText = submitButton.textContent;
            
            try {
                submitButton.disabled = true;
                submitButton.textContent = 'Logging...';
                
                const formData = new FormData(form);
                const now = new Date().toISOString();
                
                const feedingData = {
                    type: document.getElementById('type').value,
                    description: document.getElementById('description').value,
                    amount: document.getElementById('amount').value || '',
                    notes: document.getElementById('notes').value || '',
                    timestamp: now,
                    createdBy: 'current-user', // In real app, this would be from session
                    createdAt: now
                };
                
                const response = await fetch(\`\${API_BASE}?operation=create&type=\${CONTENT_TYPE}\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ content: feedingData })
                });
                
                if (response.ok) {
                    // Add to local state and update display
                    feedingEntries.push(feedingData);
                    updateFeedingDisplay();
                    updateSummary();
                    
                    // Reset form
                    form.reset();
                    
                    // Show success feedback
                    updateStatus('Feeding event logged successfully!', 'success');
                    setTimeout(() => {
                        document.getElementById('status').style.display = 'none';
                    }, 3000);
                } else {
                    throw new Error('Failed to log feeding event');
                }
                
            } catch (error) {
                logger.error('Error logging feeding', { error });
                updateStatus('Failed to log feeding event. Please try again.', 'error');
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
            }
        }
        
        // Update feeding display
        function updateFeedingDisplay() {
            const feedingList = document.getElementById('feedingList');
            
            if (feedingEntries.length === 0) {
                feedingList.innerHTML = \`
                    <div class="empty-state">
                        <div style="font-size: 3em;">🐕</div>
                        <p>No feeding events logged today.<br>Start by logging your dog's first meal!</p>
                    </div>
                \`;
                document.getElementById('summary').style.display = 'none';
                return;
            }
            
            // Sort by timestamp (newest first)
            const sortedEntries = [...feedingEntries].sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );
            
            feedingList.innerHTML = sortedEntries.map(entry => {
                const time = new Date(entry.timestamp);
                const typeEmojis = {
                    food: '🥘',
                    treat: '🦴',
                    water: '💧',
                    medication: '💊'
                };
                
                return \`
                    <div class="feeding-entry">
                        <div class="feeding-meta">
                            <span class="feeding-type">\${typeEmojis[entry.type]} \${entry.type.charAt(0).toUpperCase() + entry.type.slice(1)}</span>
                            <span class="feeding-time">\${time.toLocaleTimeString()}</span>
                        </div>
                        <div class="feeding-description">\${entry.description}\${entry.amount ? \` (\${entry.amount})\` : ''}</div>
                        \${entry.notes ? \`<div class="feeding-notes">\${entry.notes}</div>\` : ''}
                    </div>
                \`;
            }).join('');
            
            document.getElementById('summary').style.display = 'block';
        }
        
        // Update summary statistics
        function updateSummary() {
            const counts = {
                total: feedingEntries.length,
                food: 0,
                treat: 0,
                water: 0,
                medication: 0
            };
            
            feedingEntries.forEach(entry => {
                if (counts.hasOwnProperty(entry.type)) {
                    counts[entry.type]++;
                }
            });
            
            document.getElementById('totalFeedings').textContent = counts.total;
            document.getElementById('foodCount').textContent = counts.food;
            document.getElementById('treatCount').textContent = counts.treat;
            document.getElementById('waterCount').textContent = counts.water;
        }
        
        // Update status display
        function updateStatus(message, type) {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = \`status \${type}\`;
            status.style.display = 'block';
        }
        
        // Event listeners
        document.addEventListener('DOMContentLoaded', () => {
            initializeApp();
            document.getElementById('feedingForm').addEventListener('submit', handleFormSubmit);
        });
    </script>
</body>
</html>`;
}

async function createHtmlGenerationRecord() {
    logger.info('Creating Dog Feeding Tracker HtmlGeneration record', { tenantId, userId });
  
  try {
    // Create the content definition first
        logger.info('Creating dog feeding entries content definition', { contentType: CONTENT_TYPE });
    const definitionResult = await ContentActions.createDefinition(
      dogFeedingContentType,
      tenantId
    );
        logger.info('Content definition created', { definitionName: definitionResult.name });
    
    // Create the HtmlGeneration record
        logger.info('Creating HtmlGeneration record');
    const htmlGenerationContent = {
      title: 'Dog Feeding Tracker',
      contentType: 'app',
      htmlContent: createDogFeedingTrackerHTML(CONTENT_TYPE),
      userRequest: 'Create a dog feeding tracker app where I can log meals, treats, water, and medications for my dog throughout the day',
      isAiGenerated: false, // This is a manually created demo
      tenantId: tenantId,
      tags: ['demo', 'pet-care', 'tracking', 'feeding'],
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const htmlResult = await ContentActions.createContent(
      'HtmlGeneration',
      htmlGenerationContent,
      tenantId
    );
    
        logger.info('HtmlGeneration record created successfully', {
            pageId: htmlResult.page_id || htmlResult._id || 'unknown',
            title: htmlGenerationContent.title,
            contentType: htmlGenerationContent.contentType,
            tags: htmlGenerationContent.tags
        });
    
        logger.info('App ready in HtmlGeneration interface');
        logger.info('App capabilities', {
            capabilities: [
                'Real-time API integration with Prism Mesh',
                'Content definition creation and management',
                'CRUD operations on feeding entries',
                'Mobile-responsive design',
                'Error handling and user feedback',
                'Daily summary statistics'
            ]
        });
    
    return {
      definitionId: definitionResult._id || 'unknown',
      htmlGenerationId: htmlResult.page_id || htmlResult._id || 'unknown',
      success: true
    };
    
    } catch (error) {
        logger.error('Error creating Dog Feeding Tracker', { error });
    throw error;
  }
}

// Run the script
if (require.main === module) {
  createHtmlGenerationRecord()
    .then((result) => {
            logger.info('Dog Feeding Tracker demo created successfully', {
                definitionId: result.definitionId,
                htmlGenerationId: result.htmlGenerationId
            });
      process.exit(0);
    })
    .catch((error) => {
            logger.error('Failed to create Dog Feeding Tracker demo', { error });
      process.exit(1);
    });
}

export { createDogFeedingTrackerHTML, createHtmlGenerationRecord };

