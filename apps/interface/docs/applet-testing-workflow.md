# HTML Generation Applet Testing Workflow

This document provides a comprehensive workflow for testing HTML generation applets that utilize the integrated API endpoints for data storage, retrieval, and management.

## Overview

The HTML generation feature now includes API integration that allows generated applets to:

- Store and retrieve data using REST endpoints
- Manage persistent data scoped to the current tenant
- Perform full CRUD operations with proper authentication
- Handle complex data structures and real-time updates

## Suggested Test Prompts

### 1. **Initial Prompt for Data-Driven Applet**

```text
Create a task management applet that can store, update, and retrieve tasks. 

Requirements:
- A form to add new tasks with title, description, priority (high/medium/low), and due date
- A list view showing all existing tasks with their details
- Ability to mark tasks as complete/incomplete by clicking on them
- Ability to edit task details inline
- Ability to delete tasks with confirmation
- A filter to show only incomplete tasks, completed tasks, or all tasks
- Use color coding: red for high priority, yellow for medium, green for low
- Automatically save all changes to the server
- Show loading indicators during API operations
- Display success/error messages for user feedback

The applet should manage its own persistent data storage and work offline-capable with proper error handling.
```

### 2. **Follow-up Prompts for Testing Different Scenarios**

#### **Data Persistence Testing:**

```text
Modify the task manager to also track:
- When each task was created and last modified
- Who created each task (user information)
- Add a statistics section showing total tasks, completed vs incomplete
- Add the ability to export all tasks as JSON
- Add bulk operations: mark all as complete, delete all completed tasks
```

#### **Advanced Data Management:**

```text
Enhance the task manager with:
- Categories/tags for tasks (stored as arrays)
- Subtasks (nested task structure)
- File attachments for tasks (store file metadata)
- Task history/audit trail (track all changes made to each task)
- Search functionality across all task fields
- Sorting by different criteria (date, priority, title)
```

#### **Error Handling & Edge Cases:**

```text
Make the task manager robust by adding:
- Handling of network failures with retry logic
- Offline mode that queues changes when disconnected
- Conflict resolution when multiple users edit the same task
- Data validation (required fields, date formats, etc.)
- Graceful handling of corrupted or missing data
- Import functionality to restore from exported JSON
```

## Alternative Test Scenarios

### Personal Finance Tracker

```text
Create a personal expense tracker that can:
- Add expenses with amount, category, date, and description
- Track income sources and amounts
- Calculate running balance and monthly summaries
- Generate simple charts showing spending by category
- Export financial data for external analysis
- Set budget limits and show warnings when exceeded
```

### Note-Taking System

```text
Build a hierarchical note-taking system with:
- Folders and subfolders for organization
- Rich text notes with formatting
- Tagging system for cross-referencing
- Search across all notes and folders
- Recent notes history
- Ability to link notes together
- Export notes in various formats
```

### Contact Management

```text
Create a contact manager that handles:
- Personal and business contacts
- Multiple phone numbers and email addresses per contact
- Contact groups and categories
- Birthday and anniversary tracking
- Notes and interaction history per contact
- Import/export functionality
- Search and filtering capabilities
```

## Testing Workflow

### Phase 1: Basic CRUD Operations

1. **Create**: Add 3-5 tasks with different priorities and due dates
2. **Read**: Refresh the page and verify all tasks appear correctly
3. **Update**: Edit task titles, change priorities, mark tasks complete
4. **Delete**: Remove completed tasks and verify they're gone

### Phase 2: Complex Data Operations

1. **Bulk Operations**: Create 10+ tasks, then use bulk mark complete
2. **Search/Filter**: Test filtering and search across various fields
3. **Data Export**: Export tasks and verify JSON structure is correct
4. **Data Import**: Clear all tasks, then import from the exported JSON

### Phase 3: Edge Cases & Error Handling

1. **Network Issues**: Disconnect network while making changes
2. **Invalid Data**: Try submitting empty required fields
3. **Large Datasets**: Create 50+ tasks and test performance
4. **Concurrent Access**: Open multiple browser tabs and test conflicts

## What to Verify During Testing

### 1. **API Integration Verification**

- [ ] Creates new content using `POST /api/applet-api`
- [ ] Lists existing content using `GET /api/applet-api?operation=list`
- [ ] Updates content using `PUT /api/applet-api`
- [ ] Deletes content using `DELETE /api/applet-api`
- [ ] Proper tenant isolation (only shows data for current tenant)
- [ ] Correct content type generation and usage

### 2. **Data Structure Testing**

- [ ] Complex data structures are stored correctly (nested objects, arrays)
- [ ] Data types are preserved (strings, numbers, booleans, dates)
- [ ] Special characters and Unicode text handled properly
- [ ] Large text fields stored without truncation
- [ ] Null and undefined values handled gracefully

### 3. **User Experience Validation**

- [ ] Shows loading states during API operations
- [ ] Displays clear success/error messages
- [ ] Handles concurrent operations gracefully
- [ ] Works smoothly with real-time data updates
- [ ] Proper form validation before API calls
- [ ] Intuitive error recovery options

### 4. **Security & Access Control**

- [ ] Data is properly scoped to current tenant
- [ ] Unauthorized access attempts are blocked
- [ ] Session expiration handled gracefully
- [ ] No data leakage between tenants
- [ ] Proper error messages without exposing sensitive info

### 5. **Performance Testing**

- [ ] API responses under 500ms for typical operations
- [ ] UI remains responsive with 50+ data items
- [ ] Memory usage stays reasonable during extended use
- [ ] No memory leaks when creating/deleting many items
- [ ] Efficient data loading (pagination if needed)

## Monitoring & Debugging

### Browser Developer Tools

```javascript
// Monitor API calls in browser console
window.addEventListener('beforeunload', () => {
  console.log('API calls made:', window.apiCallCount || 0);
});

// Check stored data structure
console.log('Current tasks:', await api.listContent('tasks'));

// Debug API errors
window.addEventListener('error', (event) => {
  if (event.message.includes('API')) {
    console.error('API Error:', event);
  }
});
```

### Network Tab Verification

- Monitor all `/api/applet-api` requests
- Verify proper HTTP status codes (200, 201, 204, etc.)
- Check request/response payloads match expectations
- Ensure proper Content-Type headers
- Verify authentication headers are included

### Server-Side Verification

```bash
# Check database content directly
npm run pg:debug:servers
# Then query the database to verify data persistence

# Monitor server logs for API calls
tail -f logs/interface.log | grep applet-api
```

## Expected Generated Code Features

The assistant should generate HTML that includes:

### 1. **API Helper Integration**

```javascript
// Properly initialized NiaAPI class
const api = new NiaAPI('tenant-123', 'assistant-name');

// Proper error handling
try {
  const result = await api.createContent('tasks', taskData);
  showSuccessMessage('Task created successfully');
} catch (error) {
  showErrorMessage(`Failed to create task: ${error.message}`);
}
```

### 2. **Loading State Management**

```javascript
// Visual indicators during operations
function showLoading(isLoading) {
  const loader = document.getElementById('loading-spinner');
  loader.style.display = isLoading ? 'block' : 'none';
}

window.saveData = async function(contentType, data) {
  try {
    api.showLoading(true);
    const result = await api.createContent(contentType, data);
    return result;
  } finally {
    api.showLoading(false);
  }
};
```

### 3. **Data Validation**

```javascript
function validateTaskData(task) {
  if (!task.title || task.title.trim() === '') {
    throw new Error('Task title is required');
  }
  if (task.dueDate && new Date(task.dueDate) < new Date()) {
    throw new Error('Due date cannot be in the past');
  }
  return true;
}
```

### 4. **State Management**

```javascript
let tasks = [];

async function refreshTaskList() {
  try {
    tasks = await api.listContent('tasks');
    renderTasks(tasks);
  } catch (error) {
    showErrorMessage('Failed to load tasks');
  }
}

function renderTasks(taskList) {
  const container = document.getElementById('task-list');
  container.innerHTML = taskList.map(task => createTaskHTML(task)).join('');
}
```

## Success Criteria

### ✅ **Functional Requirements**

- **Complete CRUD**: User can create, read, update, and delete data
- **Data Persistence**: All changes survive page refreshes and browser restarts
- **Error Recovery**: Graceful handling of network/server issues
- **User Feedback**: Clear indication of operation status and results

### ✅ **Technical Requirements**

- **API Integration**: Proper use of all applet-api endpoints
- **Authentication**: Requests include proper session/tenant information
- **Data Integrity**: Complex data structures preserved correctly
- **Performance**: Responsive UI even with larger datasets (50+ items)

### ✅ **User Experience**

- **Intuitive Interface**: Clear navigation and interaction patterns
- **Loading States**: Visual feedback during long operations
- **Error Messages**: Helpful, actionable error descriptions
- **Data Validation**: Prevents invalid data submission

### ✅ **Security & Reliability**

- **Tenant Isolation**: No cross-tenant data access
- **Input Sanitization**: Proper handling of special characters
- **Session Management**: Graceful handling of expired sessions
- **Concurrency**: Multiple browser tabs don't cause data corruption

## Common Issues & Solutions

### Issue: "Cannot read property of undefined"

**Cause**: API response structure doesn't match expectations  
**Solution**: Add defensive programming and null checks

### Issue: "Network request failed"

**Cause**: API endpoint unavailable or authentication issues  
**Solution**: Implement retry logic and clear error messages

### Issue: "Data not persisting"

**Cause**: API calls not completing or incorrect content type  
**Solution**: Verify API responses and check server logs

### Issue: "Performance degradation"

**Cause**: Loading too much data at once  
**Solution**: Implement pagination or data virtualization

This testing workflow ensures comprehensive validation of the HTML generation applet's data management capabilities while providing realistic use cases that demonstrate the full potential of the integrated API system.

## Diagnostics: Capturing and Investigating Failures

The HTML Generation flow now emits structured, privacy-safe diagnostics for each operation using an opId you can correlate with a saved applet. Diagnostics are now persisted in the applet's metadata at write time, so no external API or CLI is required.

- What’s captured per record:
  - phase: start | success | error
  - provider + model (e.g., openai:gpt-4o, anthropic:sonnet, gemini:flash)
  - promptLength / responseLength (chars)
  - environment snapshot (runtime flags, region, presence of provider keys)
  - error details (message, code, HTTP status) when failures occur
- Where it lives: in the saved applet record under `metadata.diagnostics` (persisted per applet)
- How to correlate: the applet’s saved content includes `metadata.opId` from the generation that created/updated it; diagnostics for that op are available at `metadata.diagnostics`

### Quick start (viewing diagnostics)

- Open your saved applet in the data browser or via the GET applet API, and inspect `metadata.diagnostics`.
- Each entry includes phase, provider/model, prompt/response lengths, environment snapshot, and any error details.

### Common diagnostics scenarios to test

- Missing provider keys: verify `environment.keys` show which keys are present (✓/×) and failures are captured with a helpful error
- Invalid model name: expect error records including provider/model and an HTTP status or provider code when available
- Network timeouts: simulate connectivity issues; confirm error phase with timeout messaging
- Large prompts: ensure `promptLength` grows and success/error are recorded consistently
- Cross-instance caveat: diagnostics are in-memory per instance; multi-instance staging may show only partial history

### Finding the opId

- After generation, open your applet’s stored content JSON; look for `metadata.opId`. Use this to correlate logs if needed.

## Next Steps: Testing Enhancements and Follow-up Work

To finish the previously deferred testing plan, prioritize the following:

1. Persistence for diagnostics

- Diagnostics are now stored inline in applet metadata at write time. Optional future work: centralize into a shared collection with pagination if cross-applet aggregation is needed.

1. UI affordance in Interface

- Add a “View Diagnostics” action in HtmlContentViewer that reveals `metadata.diagnostics` for the selected applet; display phase timeline, environment snapshot, and error details

1. Automated tests

- Unit tests for diagnostics utilities (start/success/error flows, redaction, env snapshot)
- Integration tests that stub provider failures and assert a corresponding error record exists
- Cypress E2E: generate an applet, force a failure (e.g., bad model), then verify diagnostics render in the UI

1. Observability improvements

- Propagate a correlation id (opId) through server logs; add a log filter by opId
- Optional: include minimal request identifiers (no PII) to link user/session timing without exposing secrets

1. CLI upgrades (optional)

- Add `--watch` (poll) mode for live tailing in staging
- Add export to file with timestamped naming for incident bundles

1. Negative-path UX

- Ensure the UI presents actionable remediation when generation fails (e.g., “switch provider,” “check keys,” “retry with smaller prompt”)

Deliverable definition of done:

- Diagnostics persisted per applet and queryable via content fetch
- UI link from applet → diagnostics by opId
- Tests: unit + integration + one E2E covering an error path and diagnostics display
- Docs updated here with any new commands, flags, or URLs introduced
