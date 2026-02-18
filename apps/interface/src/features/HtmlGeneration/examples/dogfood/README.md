# Dog Feeding Tracker Demo Plan

**Date**: August 14, 2025  
**Purpose**: Create a showcase demo for the HtmlGeneration feature using real Prism Mesh API integration

## Overview

The Dog Feeding Tracker is a simple, functional demo application that demonstrates the full capabilities of our HtmlGeneration feature with real API integration. This demo serves as both a test case and a template for future AI-generated applications.

## Demo Application: Dog Feeding Tracker

### User Story
"I want to track what I feed my dog throughout the day, including food, treats, and water, so I can monitor their diet and health."

### Features
- **Simple Data Entry**: Quick form to log feeding events
- **Real-Time Display**: View today's feeding history
- **Basic Analytics**: Show feeding summary and timing
- **Persistent Storage**: All data saved via Prism Mesh API
- **Mobile Friendly**: Responsive design for easy mobile use

### Data Model Design Philosophy
The data model is intentionally **dead simple** to avoid imposing complex expectations on AI providers (OpenAI/Anthropic). This helps ensure successful AI generation during manual testing.

#### Content Definition: `DogFeedingEntry`
```json
{
  "name": "dog-feeding-entries",
  "description": "Log entries for dog feeding events",
  "properties": {
    "type": {
      "type": "string",
      "enum": ["food", "treat", "water", "medication"],
      "description": "Type of feeding event"
    },
    "description": {
      "type": "string", 
      "maxLength": 200,
      "description": "What was given (e.g., 'Kibble - 1 cup', 'Chicken treat')"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time", 
      "description": "When the feeding occurred"
    },
    "notes": {
      "type": "string",
      "maxLength": 500,
      "description": "Optional notes about the feeding"
    }
  },
  "required": ["type", "description", "timestamp"]
}
```

## Technical Implementation

### 1. HtmlGeneration Record Structure
- **title**: "Dog Feeding Tracker"
- **contentType**: "app" 
- **htmlContent**: Complete HTML with embedded JavaScript
- **userRequest**: "Create a dog feeding tracker app"
- **isAiGenerated**: false (manually created for demo)
- **tenantId**: Test tenant ID
- **tags**: ["demo", "pet-care", "tracking"]

### 2. API Integration Points
The generated HTML will demonstrate:

#### A. Definition Management
```javascript
// Check if definition exists, create if needed
const checkDefinition = async () => {
  const response = await fetch('/api/applet-api?operation=getDefinition&type=dog-feeding-entries');
  if (!response.ok) {
    await createDefinition();
  }
};
```

#### B. CRUD Operations
```javascript
// Create new feeding entry
const logFeeding = async (feedingData) => {
  await fetch('/api/applet-api?operation=create&type=dog-feeding-entries', {
    method: 'POST',
    body: JSON.stringify({ content: feedingData })
  });
};

// List today's feedings
const getTodaysFeedings = async () => {
  const today = new Date().toISOString().split('T')[0];
  const response = await fetch(`/api/applet-api?operation=list&type=dog-feeding-entries&where=${encodeURIComponent(JSON.stringify({
    timestamp: { gte: today + 'T00:00:00.000Z' }
  }))}`);
  return response.json();
};
```

### 3. User Experience Flow
1. **App Loads**: Checks for content definition, creates if missing
2. **Quick Entry Form**: Simple form with dropdowns and inputs
3. **Live Feed**: Real-time display of today's feeding events
4. **Summary Stats**: Basic counts and timing information
5. **Data Persistence**: All data stored via Prism Mesh API

## Demo Benefits

### For Development Team
- **Real API Testing**: Validates full API integration stack
- **Template Creation**: Provides working example for AI prompt engineering
- **Edge Case Discovery**: Identifies potential issues before AI generation
- **Performance Baseline**: Establishes expected load patterns

### For AI Prompt Engineering
- **Complexity Guidance**: Shows appropriate scope for AI-generated apps
- **API Pattern Examples**: Demonstrates proper API usage patterns  
- **Error Handling**: Shows robust error handling approaches
- **Code Structure**: Provides template for well-organized generated code

### For User Testing
- **Functional Demo**: Real working application for user feedback
- **Feature Validation**: Tests core HtmlGeneration capabilities
- **UX Patterns**: Validates interaction design approaches
- **Mobile Experience**: Tests responsive design in real scenarios

## Success Criteria

### Technical Validation
- [ ] Content definition created successfully via API
- [ ] CRUD operations work reliably
- [ ] Data persists across browser sessions
- [ ] Error handling gracefully manages API failures
- [ ] Mobile responsive design functions properly

### Demo Effectiveness  
- [ ] Non-technical users can understand the application
- [ ] Demonstrates clear value proposition of HtmlGeneration
- [ ] Shows realistic complexity level for AI generation
- [ ] Provides clear template for future AI prompts

## Future Enhancements

Once the basic demo is validated:
1. **Enhanced Analytics**: Charts and trends
2. **Multiple Pets**: Support for multiple dogs
3. **Feeding Schedules**: Reminder functionality
4. **Photo Attachments**: Visual feeding logs
5. **Veterinary Integration**: Health tracking features

## Implementation Priority

**Phase 1** (Current): Create functional demo with core features
**Phase 2**: Refine based on manual testing feedback  
**Phase 3**: Use as template for AI prompt engineering
**Phase 4**: Deploy as permanent demo showcase

---

This demo represents a realistic, achievable target for AI-generated applications while showcasing the full power of our HtmlGeneration feature with real API integration.
