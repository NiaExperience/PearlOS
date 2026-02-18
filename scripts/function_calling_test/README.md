# Function Calling Test for GPT-4o-mini

This project tests the efficacy of function calling with GPT-4o-mini using a simple `showList` function.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set your OpenAI API key:
```bash
export OPENAI_API_KEY="your-api-key-here"
```

## Function Definitions

### showList Function
The `showList` function takes:
- A required `type` parameter with three possible values:
  - `"agenda"` - Shows today's agenda
  - `"exhibit"` - Shows available exhibits  
  - `"speaker"` - Shows the list of speakers
- An optional `query` parameter to filter results (e.g., "from Norway", "tech talks", "AI-related")

### showIndividual Function
The `showIndividual` function takes:
- A required `type` parameter with three possible values:
  - `"agenda"` - Shows details about a specific agenda item
  - `"exhibit"` - Shows details about a specific exhibit
  - `"speaker"` - Shows details about a specific speaker
- A required `name` parameter specifying the exact name of the item (e.g., "Joyce Landry", "Chance Rides, LLC")

## Test Sentences

The script includes 45 test sentences designed to trigger the functions:

### showList Function Tests:

#### Basic Requests (no query):
##### Agenda-related:
- "Please show me today's agenda"
- "Show me the agenda for today"
- "Tell me about the agenda"
- "What's on the agenda today?"
- "Show me the agenda items"

##### Speaker-related:
- "Who are the speakers?"
- "What speakers are presenting?"
- "Who is speaking at the event?"
- "Show the speaker list"
- "List the speakers"
- "Who are the presenters?"

##### Exhibit-related:
- "Can you display the exhibit list?"
- "I'd like to see the exhibits"
- "Display the exhibits"
- "What exhibits are available?"

#### Requests with Queries:
##### Speaker queries:
- "What speakers are from Norway?"
- "Who are the keynote speakers?"
- "Who are the expert speakers?"
- "Who are the international speakers?"
- "Who are the technical speakers?"

##### Agenda queries:
- "Show me tech talks on the agenda"
- "Show me workshops in the agenda"
- "Show me morning sessions on the agenda"
- "Show me afternoon talks on the agenda"
- "Show me networking events on the agenda"

##### Exhibit queries:
- "What AI-related exhibits are there?"
- "What startup exhibits are available?"
- "What innovation exhibits are there?"
- "What demo exhibits are available?"
- "What interactive exhibits are there?"

### showIndividual Function Tests:

#### Speaker-specific requests:
- "Tell me about speaker Joyce Landry"
- "Who is Dr. Jane Smith?"
- "Show me information about John Doe"
- "Who is Sarah Johnson?"

#### Exhibit-specific requests:
- "What can you tell me about exhibit Chance Rides, LLC?"
- "Tell me about the Tech Demo Area exhibit"
- "Tell me about the Innovation Showcase"
- "Show me details for the Startup Corner exhibit"

#### Agenda-specific requests:
- "Show me details for the Keynote session"
- "What's the Workshop session about?"
- "What can you tell me about the Networking event?"
- "Tell me about the AI Expert presentation"
- "What's the Tech Lead session about?"
- "Show me information about the Designer talk"
- "Tell me about the Main Auditorium session"

## Running the Test

```bash
python function_calling_test.py
```

## Expected Output

The script will:
1. Test the `showList` function locally
2. Run each test sentence through GPT-4o-mini
3. Check if the function was called correctly
4. Provide a summary of successful vs failed function calls

## Analysis

This test helps evaluate:
- How well GPT-4o-mini understands natural language requests
- Whether it correctly maps user intent to the appropriate function
- The accuracy of parameter extraction
- Overall function calling reliability

## Customization

You can modify the test sentences in the `test_sentences` list to test different phrasings or add new scenarios. 