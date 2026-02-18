# HtmlGeneration Embedded App Architecture

## Overview

The HtmlGeneration feature creates fully functional web applications embedded as HTML content within Prism records. This document analyzes the Dog Feeding Tracker demo app to explain how these embedded applications function within browser/iframe environments and interact with the Prism Mesh API.

## App Size & Structure

- **Total Script Size**: 27.3 KB
- **Embedded HTML App Size**: ~22.7 KB (83% of total)
- **HTML Structure**: Complete standalone web application with embedded CSS and JavaScript
- **Framework**: Vanilla HTML/CSS/JavaScript (no external dependencies)

## Application Architecture

### 1. Container Environment

The embedded app is designed to run within an iframe or container provided by the HtmlGeneration interface:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🐕 Dog Feeding Tracker</title>
    <!-- Embedded CSS styles follow -->
</head>
<body>
    <!-- App UI structure -->
    <!-- Embedded JavaScript follows -->
</body>
</html>
```

### 2. Self-Contained Design

**No External Dependencies**: The app includes all necessary styles and JavaScript inline, ensuring it works without external resources.

**Responsive Design**: Mobile-first CSS with responsive breakpoints:

```css
@media (max-width: 768px) {
    body { padding: 10px; }
    .container { border-radius: 15px; }
    .header { padding: 20px; }
    .header h1 { font-size: 2em; }
    .content { padding: 20px; }
    .form-section { padding: 20px; }
}
```

**Modern CSS Features**:
- CSS Grid for layout
- Flexbox for component alignment
- CSS gradients and shadows
- Smooth transitions and hover effects

## API Integration Architecture

### 1. Applet API Communication

The embedded app communicates with the parent system through the **Applet API** (`/api/applet-api`):

```javascript
// API configuration
const API_BASE = '/api/applet-api';
const CONTENT_TYPE = 'dog-feeding-entries';
```

### 2. Content Definition Management

**Automatic Definition Creation**: The app ensures its content type exists before operating:

```javascript
async function ensureDefinitionExists() {
    const logger = window.logger ?? { error: () => {} };
    try {
        const response = await fetch(`${API_BASE}?operation=getDefinition&type=${CONTENT_TYPE}`);
        
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
```

**Dynamic Schema Definition**: The app creates its own content schema:

```javascript
const definition = {
    name: 'dog-feeding-entries',
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
                // ... more fields
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
```

### 3. CRUD Operations

**Create Records**: POST requests to create new feeding entries:

```javascript
const response = await fetch(`${API_BASE}?operation=create&type=${CONTENT_TYPE}`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: feedingData })
});
```

**Query Records**: GET requests with filtering for today's entries:

```javascript
const today = new Date();
const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

const whereClause = {
    timestamp: {
        gte: startOfDay,
        lte: endOfDay
    }
};

const response = await fetch(`${API_BASE}?operation=list&type=${CONTENT_TYPE}&where=${encodeURIComponent(JSON.stringify(whereClause))}`);
```

## Application Lifecycle

### 1. Initialization Sequence

```javascript
async function initializeApp() {
    const logger = window.logger ?? { error: () => {}, info: () => {} };
    try {
        updateStatus('Checking content definition...', 'loading');
        await ensureDefinitionExists();
        
        updateStatus('Loading today\'s feeding history...', 'loading');
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
```

### 2. Event Handling

**Form Submission**: Handles user input with validation and feedback:

```javascript
async function handleFormSubmit(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    
    try {
        submitButton.disabled = true;
        submitButton.textContent = 'Logging...';
        
        const feedingData = {
            type: document.getElementById('type').value,
            description: document.getElementById('description').value,
            amount: document.getElementById('amount').value || '',
            notes: document.getElementById('notes').value || '',
            timestamp: now,
            createdBy: 'current-user', // In real app, this would be from session
            createdAt: now
        };
        
        // API call and response handling
        
    } catch (error) {
        const logger = window.logger ?? { error: () => {} };
        logger.error('Error logging feeding', { error });
        updateStatus('Failed to log feeding event. Please try again.', 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
    }
}
```

### 3. Real-Time UI Updates

**Local State Management**: The app maintains local state and updates the UI immediately:

```javascript
// Application state
let feedingEntries = [];
let definitionExists = false;

// Update feeding display
function updateFeedingDisplay() {
    const feedingList = document.getElementById('feedingList');
    
    if (feedingEntries.length === 0) {
        feedingList.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 3em;">🐕</div>
                <p>No feeding events logged today.<br>Start by logging your dog's first meal!</p>
            </div>
        `;
        document.getElementById('summary').style.display = 'none';
        return;
    }
    
    // Sort by timestamp (newest first)
    const sortedEntries = [...feedingEntries].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    feedingList.innerHTML = sortedEntries.map(entry => {
        // Generate HTML for each entry
    }).join('');
    
    document.getElementById('summary').style.display = 'block';
}
```

## Security & Isolation

### 1. iframe Isolation

When rendered in an iframe, the embedded app benefits from:
- **Origin isolation**: Prevents access to parent window
- **Sandboxing**: Restricts dangerous operations
- **Resource containment**: CSS and JavaScript don't affect parent page

### 2. API Security

- **Server-side validation**: All API calls go through Applet API for validation
- **Tenant isolation**: Content is automatically scoped to the current tenant
- **User authentication**: API endpoints require proper authentication
- **Input sanitization**: Form data is validated before storage

## User Experience Features

### 1. Progressive Enhancement

```javascript
// Status updates guide the user through the initialization process
updateStatus('Checking content definition...', 'loading');
updateStatus('Loading today\'s feeding history...', 'loading');
updateStatus('Ready! You can now log feeding events.', 'success');
```

### 2. Error Handling

```javascript
// Graceful error handling with user feedback
catch (error) {
    const logger = window.logger ?? { error: () => {} };
    logger.error('Initialization error', { error });
    updateStatus('Failed to initialize app. Please refresh and try again.', 'error');
}
```

### 3. Real-Time Feedback

- **Loading states**: Buttons show "Logging..." during API calls
- **Success confirmations**: Status messages confirm successful operations
- **Visual feedback**: Hover effects and transitions provide immediate response
- **Statistics**: Live summary updates as new entries are added

## Data Flow Architecture

```
User Input → Form Validation → API Call → Server Processing → Database Storage
     ↑                                                              ↓
UI Update ← Local State Update ← Response Processing ← API Response ←
```

### 1. Input Flow

1. User fills out feeding form
2. JavaScript validates input client-side
3. Form submission triggers API call to `/api/applet-api`
4. Applet API validates and processes request
5. Data is stored via Prism Mesh API
6. Success response triggers UI update

### 2. Display Flow

1. App loads today's data on initialization
2. Data is filtered by date range
3. Local state is updated with fetched entries
4. UI components re-render based on state
5. Summary statistics are calculated and displayed

## Performance Considerations

### 1. Optimizations

- **Single file approach**: No external HTTP requests for resources
- **Efficient DOM updates**: Targeted updates rather than full re-renders
- **Local state caching**: Avoids unnecessary API calls
- **Debounced operations**: Form validation and API calls are optimized

### 2. Size Efficiency

- **Vanilla JavaScript**: No framework overhead (~22.7KB total)
- **Inline styles**: Eliminates external CSS requests
- **Minimal dependencies**: Only uses native browser APIs

## Extension Patterns

### 1. Adding New Features

To extend the app, developers can:
- Add new form fields to the schema definition
- Implement additional API operations (update, delete)
- Create new UI components following the existing patterns
- Add data visualization components

### 2. Reusable Components

The app demonstrates reusable patterns:
- **Status management**: `updateStatus()` function for user feedback
- **API abstraction**: Centralized API configuration and error handling
- **Form handling**: Generic form submission pattern
- **State management**: Simple but effective local state pattern

## Conclusion

The Dog Feeding Tracker demonstrates a sophisticated embedded application architecture that:

1. **Operates independently** within iframe containers
2. **Integrates seamlessly** with Prism Mesh API
3. **Manages its own data schema** and lifecycle
4. **Provides rich user experience** with real-time updates
5. **Maintains security** through API abstraction and validation
6. **Scales efficiently** with minimal resource overhead

This architecture serves as a template for creating powerful, self-contained applications within the HtmlGeneration system, showing how AI-generated apps can integrate deeply with the Prism ecosystem while maintaining simplicity and performance.
