import json
import os
import random

from termcolor import colored

from core.assistant import Assistant
from utils.logger import logger

class ConversationHandler:
    """Handles the conversation flow between user and AI assistant, including tool/function calls.
    This is the base class for all conversation handlers."""

    # The generic errors to use when the AI cannot be processed at all
    _error_messages = ["Oops, something went wrong. Please try again.", 
                      "Sorry, that didn't seem to work. Can you try again?", 
                      "Hmm, that didn't work. Please try again.",
                      "Something's not working right now. Please try again later.",
                      "Something went wrong. Could you try again?",
                      "There seems to be an issue. Please try again.",]

    def __init__(self, phone_number=None, user_data=None):
        """Initialize with an assistant model and optional phone number."""
        
        # Initialize assistant from model
        self.assistant_model = user_data.get("assistant_model")
        self.assistant = Assistant(self.assistant_model)
        self.phone_number = phone_number

        if user_data and "messages" in user_data:
            self.assistant.set_history(user_data["messages"])

    def add_to_history(self, message):
        """Add a message to the conversation history."""
        self.assistant.add_to_history(message)

    def handle_conversation(self, user_prompt: str):
        """Process user input and get AI responses."""

        # Add user message to history
        self.add_to_history({
            "role": "user",
            "content": user_prompt
        })

        try:
            response = self._process_conversation()
            return response
        except Exception as e:
            logger.error(f"ERROR: {str(e)}")
            return f"Error occurred: {str(e)}"

    def _process_conversation(self):
        """Process the conversation using current history."""
        # Get messages from assistant's history
        current_messages = self.assistant.get_current_messages()

        system_message = {"role": "system", "content": self.assistant.system_message}
        try:
            response = self.assistant.client.chat.completions.create(
                model=self.assistant.model,
                messages=[system_message] + current_messages,
                tools=self.assistant.get_all_tools(),
                tool_choice="auto",
                max_tokens=4096
            )
            response_message = response.choices[0].message
            tool_calls = response_message.tool_calls

            if tool_calls:
                return self._handle_tool_calls(response_message, tool_calls)
            else:
                self.add_to_history({
                    "role": "assistant",
                    "content": response_message.content
                })
                logger.info(f"AI RESPONSE: {response_message.content}")
                return response_message.content
        except Exception as e:
            logger.error(f"ERROR: {str(e)}")
            return random.choice(self._error_messages)


    def _handle_tool_calls(self, response_message, tool_calls):
        """
        Handles the execution of tool calls requested by the AI.

        1. Adds the AI's tool call request to conversation history
        2. Executes each requested tool/function with provided arguments
        3. Adds tool responses to conversation history
        4. Gets final AI response after tool execution

        Args:
            response_message: The initial AI response containing tool calls
            tool_calls: List of tools/functions to be executed

        Returns:
            Final AI response after processing tool results
        """

        self.add_to_history({
            "role": "assistant",
            "content": response_message.content if response_message.content else "",
            "tool_calls": [{
                "type": "function",
                "id": tool_call.id,
                "function": {
                    "name": tool_call.function.name,
                    "arguments": tool_call.function.arguments
                }
            } for tool_call in tool_calls]
        })

        for tool_call in tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)

            logger.info(f"TOOL CALLED: {function_name}")
            logger.info(f"WITH PARAMETERS: {json.dumps(function_args, indent=2)}")

            function_to_call = self.assistant.available_functions[function_name]
            function_response = function_to_call(**function_args)

            response_data = json.loads(function_response)
            logger.info(f"FUNCTION RESPONSE: {response_data['message']}")

            self.add_to_history({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "name": function_name,
                "content": function_response
            })

        system_message = {"role": "system", "content": self.assistant.system_message}
        final_response = self.assistant.client.chat.completions.create(
            model=self.assistant.model,
            messages=[system_message] + self.assistant.get_current_messages()
        )

        ai_response = final_response.choices[0].message.content

        self.add_to_history({
            "role": "assistant",
            "content": ai_response
        })

        logger.info(f"AI RESPONSE: {ai_response}")
        return ai_response
    
    def construct_user_data(self):
        """Construct user data from the conversation history."""
        # Get all messages from the conversation history
        all_messages = self.assistant.get_current_messages()
        
        # Truncate the log to keep roughly the last four assistant-user exchanges        
        exchanges = []
        current_exchange = []
        
        for msg in all_messages:
            if msg["role"] == "system":
                continue  # Skip system message, we'll add it separately
                
            if msg["role"] == "user":
                if current_exchange:
                    exchanges.append(current_exchange)
                current_exchange = [msg]
            elif msg["role"] == "assistant" or msg["role"] == "tool":
                current_exchange.append(msg)
        
        if current_exchange:
            exchanges.append(current_exchange)
        
        last_exchanges = exchanges[-4:] if len(exchanges) > 4 else exchanges
        
        filtered_messages = []
            
        for exchange in last_exchanges:
            filtered_messages.extend(exchange)
        
        return {
            "assistant_model": self.assistant_model,
            "messages": filtered_messages[-10:]
        }
    
