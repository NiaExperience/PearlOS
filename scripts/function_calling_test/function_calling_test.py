import json
import openai
from typing import Literal, Optional

# Configure OpenAI client
client = openai.OpenAI()

def showList(type: Literal["agenda", "exhibit", "speaker"], query: Optional[str] = None) -> str:
    """
    Display a list based on the specified type, optionally filtered by a query.
    
    Args:
        type: The type of list to show. Must be one of: "agenda", "exhibit", "speaker"
        query: Optional filter query to narrow down results
    
    Returns:
        A string describing what list was requested and any filtering applied
    """
    base_response = ""
    if type == "agenda":
        base_response = "Showing today's agenda: Keynote at 9 AM, Workshop at 2 PM, Networking at 5 PM"
    elif type == "exhibit":
        base_response = "Showing exhibits: Tech Demo Area, Innovation Showcase, Startup Corner"
    elif type == "speaker":
        base_response = "Showing speakers: Dr. Jane Smith (AI Expert), John Doe (Tech Lead), Sarah Johnson (Designer)"
    else:
        return f"Unknown type: {type}"
    
    if query:
        return f"{base_response} - Filtered by: '{query}'"
    else:
        return base_response

def showIndividual(type: Literal["agenda", "exhibit", "speaker"], name: str) -> str:
    """
    Display details about a specific individual item.
    
    Args:
        type: The type of item. Must be one of: "agenda", "exhibit", "speaker"
        name: The name of the specific item to show details for
    
    Returns:
        A string with details about the specific item
    """
    if type == "agenda":
        return f"Agenda item '{name}': This session focuses on {name.lower()} and will be held in the main auditorium."
    elif type == "exhibit":
        return f"Exhibit '{name}': Located in Hall A, showcasing innovative {name.lower()} technology and demonstrations."
    elif type == "speaker":
        return f"Speaker '{name}': Expert in their field with over 10 years of experience. Will present on cutting-edge topics."
    else:
        return f"Unknown type: {type}"

# Define the function schemas for OpenAI
function_schemas = [
    {
        "type": "function",
        "function": {
            "name": "showList",
            "description": "Display a list of items based on the specified type, optionally filtered by a query. Use this function when the user asks for multiple items or uses words like 'what', 'which', 'show me', 'list', 'available', 'there', 'are'. DO NOT use this function when asking about a specific named person or item - use showIndividual instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["agenda", "exhibit", "speaker"],
                        "description": "The type of list to display"
                    },
                    "query": {
                        "type": "string",
                        "description": "Optional filter query to narrow down the results. IMPORTANT: Extract any descriptive words, adjectives, or categories mentioned in the request (e.g., 'startup' from 'startup exhibits', 'tech' from 'tech talks', 'morning' from 'morning sessions')"
                    }
                },
                "required": ["type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "showIndividual",
            "description": "Display details about a specific individual item by name. Use this function when the user asks about a specific person or item using phrases like 'who is [name]', 'tell me about [name]', 'what's [name] about', 'details for [name]', or when a specific name is mentioned. DO NOT use this function for general list requests - use showList instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["agenda", "exhibit", "speaker"],
                        "description": "The type of item to show details for"
                    },
                    "name": {
                        "type": "string",
                        "description": "The name of the specific item to show details for. IMPORTANT: Extract the exact name mentioned in the request (e.g., 'Sarah Johnson' from 'who is Sarah Johnson', 'Workshop' from 'what's the Workshop session about', 'Tech Lead' from 'tell me about the Tech Lead session')"
                    }
                },
                "required": ["type", "name"]
            }
        }
    }
]

# Test sentences with expected function calls
test_cases = [
    # Basic requests (no query) - showList function
    ("Please show me today's agenda", "showList", {"type": "agenda"}),
    ("Who are the speakers?", "showList", {"type": "speaker"}),
    ("Can you display the exhibit list?", "showList", {"type": "exhibit"}),
    ("Show me the agenda for today", "showList", {"type": "agenda"}),
    ("What speakers are presenting?", "showList", {"type": "speaker"}),
    ("I'd like to see the exhibits", "showList", {"type": "exhibit"}),
    ("Tell me about the agenda", "showList", {"type": "agenda"}),
    ("Who is speaking at the event?", "showList", {"type": "speaker"}),
    ("Show the speaker list", "showList", {"type": "speaker"}),
    ("What's on the agenda today?", "showList", {"type": "agenda"}),
    ("Display the exhibits", "showList", {"type": "exhibit"}),
    ("List the speakers", "showList", {"type": "speaker"}),
    ("Show me the agenda items", "showList", {"type": "agenda"}),
    ("What exhibits are available?", "showList", {"type": "exhibit"}),
    ("Who are the presenters?", "showList", {"type": "speaker"}),
    
    # Requests with queries - showList function
    ("What speakers are from Norway?", "showList", {"type": "speaker", "query": "from Norway"}),
    ("Show me tech talks on the agenda", "showList", {"type": "agenda", "query": "tech talks"}),
    ("What AI-related exhibits are there?", "showList", {"type": "exhibit", "query": "AI-related"}),
    ("Who are the keynote speakers?", "showList", {"type": "speaker", "query": "keynote"}),
    ("Show me workshops in the agenda", "showList", {"type": "agenda", "query": "workshops"}),
    ("What startup exhibits are available?", "showList", {"type": "exhibit", "query": "startup"}),
    ("Who are the expert speakers?", "showList", {"type": "speaker", "query": "expert"}),
    ("Show me morning sessions on the agenda", "showList", {"type": "agenda", "query": "morning sessions"}),
    ("What innovation exhibits are there?", "showList", {"type": "exhibit", "query": "innovation"}),
    ("Who are the international speakers?", "showList", {"type": "speaker", "query": "international"}),
    ("Show me afternoon talks on the agenda", "showList", {"type": "agenda", "query": "afternoon talks"}),
    ("What demo exhibits are available?", "showList", {"type": "exhibit", "query": "demo"}),
    ("Who are the technical speakers?", "showList", {"type": "speaker", "query": "technical"}),
    ("Show me networking events on the agenda", "showList", {"type": "agenda", "query": "networking events"}),
    ("What interactive exhibits are there?", "showList", {"type": "exhibit", "query": "interactive"}),
    
    # Individual item requests - showIndividual function
    ("Tell me about speaker Joyce Landry", "showIndividual", {"type": "speaker", "name": "Joyce Landry"}),
    ("What can you tell me about exhibit Chance Rides, LLC?", "showIndividual", {"type": "exhibit", "name": "Chance Rides, LLC"}),
    ("Show me details for the Keynote session", "showIndividual", {"type": "agenda", "name": "Keynote"}),
    ("Who is Dr. Jane Smith?", "showIndividual", {"type": "speaker", "name": "Dr. Jane Smith"}),
    ("Tell me about the Tech Demo Area exhibit", "showIndividual", {"type": "exhibit", "name": "Tech Demo Area"}),
    ("What's the Workshop session about?", "showIndividual", {"type": "agenda", "name": "Workshop"}),
    ("Show me information about John Doe", "showIndividual", {"type": "speaker", "name": "John Doe"}),
    ("Tell me about the Innovation Showcase", "showIndividual", {"type": "exhibit", "name": "Innovation Showcase"}),
    ("What can you tell me about the Networking event?", "showIndividual", {"type": "agenda", "name": "Networking event"}),
    ("Who is Sarah Johnson?", "showIndividual", {"type": "speaker", "name": "Sarah Johnson"}),
    ("Show me details for the Startup Corner exhibit", "showIndividual", {"type": "exhibit", "name": "Startup Corner"}),
    ("Tell me about the AI Expert presentation", "showIndividual", {"type": "agenda", "name": "AI Expert presentation"}),
    ("What's the Tech Lead session about?", "showIndividual", {"type": "agenda", "name": "Tech Lead"}),
    ("Show me information about the Designer talk", "showIndividual", {"type": "agenda", "name": "Designer talk"}),
    ("Tell me about the Main Auditorium session", "showIndividual", {"type": "agenda", "name": "Main Auditorium"})
]

def test_function_calling(sentence: str, expected_function: str, expected_params: dict) -> dict:
    """
    Test function calling with a given sentence and validate against expected results.
    
    Args:
        sentence: The user input to test
        expected_function: The expected function name to be called
        expected_params: The expected parameters for the function
        
    Returns:
        Dictionary containing the test results and validation
    """
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that can show different types of lists and individual items."
                },
                {
                    "role": "user",
                    "content": sentence
                }
            ],
            tools=function_schemas,
            tool_choice="auto"
        )
        
        result = {
            "sentence": sentence,
            "expected_function": expected_function,
            "expected_params": expected_params,
            "function_called": False,
            "function_name": None,
            "parameters": None,
            "response": response.choices[0].message.content,
            "error": None,
            "correct_function": False,
            "correct_parameters": False,
            "overall_success": False
        }
        
        # Check if a function was called
        if response.choices[0].message.tool_calls:
            tool_call = response.choices[0].message.tool_calls[0]
            result["function_called"] = True
            result["function_name"] = tool_call.function.name
            result["parameters"] = json.loads(tool_call.function.arguments)
            
            # Validate function name
            result["correct_function"] = (result["function_name"] == expected_function)
            
            # Validate parameters (loose matching for query and name)
            if result["correct_function"]:
                result["correct_parameters"] = validate_parameters(
                    result["parameters"], expected_params
                )
            
            result["overall_success"] = result["correct_function"] and result["correct_parameters"]
            
        return result
        
    except Exception as e:
        return {
            "sentence": sentence,
            "expected_function": expected_function,
            "expected_params": expected_params,
            "function_called": False,
            "function_name": None,
            "parameters": None,
            "response": None,
            "error": str(e),
            "correct_function": False,
            "correct_parameters": False,
            "overall_success": False
        }

def validate_parameters(actual_params: dict, expected_params: dict) -> bool:
    """
    Validate that the actual parameters match the expected parameters.
    Uses loose matching for 'query' and 'name' parameters.
    
    Args:
        actual_params: The actual parameters returned by the model
        expected_params: The expected parameters
        
    Returns:
        True if parameters match, False otherwise
    """
    # Check that all expected parameters are present
    for key, expected_value in expected_params.items():
        if key not in actual_params:
            return False
        
        actual_value = actual_params[key]
        
        # For 'query' and 'name' parameters, use loose matching
        if key in ['query', 'name']:
            # Check if the expected value is contained in the actual value
            # or if the actual value is contained in the expected value
            if not (expected_value.lower() in actual_value.lower() or 
                   actual_value.lower() in expected_value.lower()):
                return False
        else:
            # For other parameters (like 'type'), exact matching
            if actual_value != expected_value:
                return False
    
    return True

def run_tests():
    """Run all test cases and display results with validation."""
    print("Testing Function Calling with GPT-4o-mini")
    print("=" * 50)
    
    results = []
    for i, (sentence, expected_function, expected_params) in enumerate(test_cases, 1):
        print(f"\nTest {i}: {sentence}")
        print(f"Expected: {expected_function}({expected_params})")
        
        result = test_function_calling(sentence, expected_function, expected_params)
        results.append(result)
        
        if result["error"]:
            print(f"❌ Error: {result['error']}")
        elif result["function_called"]:
            if result["overall_success"]:
                print(f"✅ SUCCESS: {result['function_name']}({result['parameters']})")
            else:
                print(f"⚠️  PARTIAL: {result['function_name']}({result['parameters']})")
                if not result["correct_function"]:
                    print(f"   ❌ Wrong function (expected {expected_function})")
                if not result["correct_parameters"]:
                    print(f"   ❌ Wrong parameters (expected {expected_params})")
            print(f"   Response: {result['response']}")
        else:
            print(f"❌ No function called")
            print(f"   Response: {result['response']}")
    
    # Summary
    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)
    
    successful_calls = [r for r in results if r["overall_success"] and not r["error"]]
    partial_calls = [r for r in results if r["function_called"] and not r["overall_success"] and not r["error"]]
    failed_calls = [r for r in results if not r["function_called"] and not r["error"]]
    errors = [r for r in results if r["error"]]
    
    print(f"Total tests: {len(results)}")
    print(f"✅ Fully successful: {len(successful_calls)}")
    print(f"⚠️  Partially successful: {len(partial_calls)}")
    print(f"❌ Failed function calls: {len(failed_calls)}")
    print(f"❌ Errors: {len(errors)}")
    
    if successful_calls:
        print(f"\n✅ Fully successful calls:")
        for result in successful_calls:
            print(f"  - '{result['sentence']}' → {result['function_name']}({result['parameters']})")
    
    if partial_calls:
        print(f"\n⚠️  Partially successful calls:")
        for result in partial_calls:
            print(f"  - '{result['sentence']}' → {result['function_name']}({result['parameters']})")
            if not result["correct_function"]:
                print(f"    Expected function: {result['expected_function']}")
            if not result["correct_parameters"]:
                print(f"    Expected parameters: {result['expected_params']}")
    
    if failed_calls:
        print(f"\n❌ Failed calls:")
        for result in failed_calls:
            print(f"  - '{result['sentence']}'")
    
    if errors:
        print(f"\n❌ Errors:")
        for result in errors:
            print(f"  - '{result['sentence']}': {result['error']}")

if __name__ == "__main__":
    # Make sure to set your OpenAI API key
    # export OPENAI_API_KEY="your-api-key-here"
    
    print("Function Calling Test for GPT-4o-mini")
    print("Make sure you have set your OPENAI_API_KEY environment variable")
    print()
    
    # Test the function locally first
    print("Testing showList function locally:")
    print(f"showList('agenda'): {showList('agenda')}")
    print(f"showList('exhibit'): {showList('exhibit')}")
    print(f"showList('speaker'): {showList('speaker')}")
    print(f"showList('speaker', 'from Norway'): {showList('speaker', 'from Norway')}")
    print(f"showList('agenda', 'tech talks'): {showList('agenda', 'tech talks')}")
    print(f"showList('exhibit', 'AI-related'): {showList('exhibit', 'AI-related')}")
    print()
    
    print("Testing showIndividual function locally:")
    print(f"showIndividual('speaker', 'Joyce Landry'): {showIndividual('speaker', 'Joyce Landry')}")
    print(f"showIndividual('exhibit', 'Chance Rides, LLC'): {showIndividual('exhibit', 'Chance Rides, LLC')}")
    print(f"showIndividual('agenda', 'Keynote'): {showIndividual('agenda', 'Keynote')}")
    print()
    
    # Run the actual tests
    run_tests() 