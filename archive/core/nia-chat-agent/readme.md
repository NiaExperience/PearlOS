```
structure

├── core/ # Core assistant and conversation handling
│ ├── assistant.py # Base assistant implementation
│ ├── nia_assistant.py # Main assistant class
│ └── conversation.py # Conversation handler
├── functions/ # Functional modules
│ ├── file_ops.py # File operations
│ ├── system_ops.py # System monitoring
│ ├── weather_ops.py # Weather information
│ ├── currency_ops.py # Currency conversion
│ ├── note_ops.py # Note management
│ └── send_message.py # Message sending functionality
├── utils/ # Utility modules
│ ├── auth_manager.py # User authentication
│ ├── history_manager.py # Conversation history
│ ├── logger.py # Logging utilities
│ └── message_formatter.py # Message formatting
├── config/ # Configuration files
│ └── tools_config.py # Tools configuration
├── data/ # Data storage
│ └── user_list.json # User database
├── quick_notes/ # Storage for user notes
├── tests_/ # Test files
│ └── test_functions.py # Functionality tests
├── api_server.py # FastAPI server
├── run_services.py # Service runner
├── requirements.txt # Python dependencies
└── README.md # This file


```



# NIA Assistant - AI-Powered Virtual Assistant

## Overview
NIA Assistant is an AI-powered virtual assistant built using Python and FastAPI. It provides a conversational interface with various functionalities including user management, messaging, and event assistance. The assistant leverages the Groq API for natural language processing and function calling, and integrates with Twilio for SMS/WhatsApp messaging.

## Key Features
- **User Management**: Register, login, and manage user profiles
- **Messaging**: Send messages between users via SMS/WhatsApp
- **Event Assistance**: Provide event information and networking opportunities
- **Conversation History**: Persistent chat history for each user
- **API Integration**: RESTful API for integration with other systems

## Session Management (Cookies Feature)

The session management system in NIA Assistant is implemented in `utils/auth_manager.py` and provides a secure way to handle user authentication and session persistence. Here's how it works:

### Key Features:
- **In-Memory Session Storage**: User sessions are stored in memory using a singleton `AuthManager` class, ensuring only one instance exists throughout the application.
- **User Authentication**: Verifies user credentials against the `user_list` loaded from `data/user_list.json`.
- **Session Persistence**: Maintains the logged-in user's state in the `current_user` dictionary, acting as a session cookie.
- **Data Security**: User data is deep-copied to prevent reference issues and ensure data integrity.
- **Automatic Saving**: User list modifications are automatically saved to the JSON file.

### How It Works:
1. **Login**: When a user logs in, their credentials are verified, and their data is stored in the `current_user` dictionary.
2. **Session Access**: The `current_user` dictionary is used to access the logged-in user's data throughout the application.
3. **Logout**: The `current_user` dictionary is cleared, effectively ending the session.

This implementation ensures secure session management without relying on traditional browser cookies, making it suitable for both web and API-based applications.

## Project Structure

### Setup Virtual Environment

1. Make sure you have Python installed on your system (Python 3.7 or higher
   recommended)
2. Open a terminal/command prompt in your project directory
3. Create a virtual environment:
   ```bash
   python -m venv venv
   ```
4. Activate the virtual environment:
   - On Windows:
     ```bash
     venv\Scripts\activate
     ```
   - On macOS/Linux:
     ```bash
     source venv/bin/activate
     ```

### Install Necessary Dependencies

- With your virtual environment activated, install the required packages:

  ```bash
   pip install -r requirements.txt
  ```

### Setup Ngrok

1. Download and install Ngrok from
   [https://ngrok.com/download](https://ngrok.com/download)
2. Sign up for a free Ngrok account at
   [https://dashboard.ngrok.com/signup](https://dashboard.ngrok.com/signup)
3. Get your auth token from the Ngrok dashboard
4. Configure Ngrok with your auth token:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```
5. Start Ngrok to create a tunnel (this will be needed when running the
   application):

   ```bash
   ngrok http 8000
   ```

   Note: Keep this terminal window open while using the application

6. Add this ngrok URL in the Twilio Dashboard

### Run the File

- Run the main application:
  ```bash
  python run_services.py
  ```

### How to use

1. Now after completing the setup send a `Hello` on this number `+16203106947`
2. Then you will receive a reply from NIA.

## Installation
1. Clone the repository:
```bash
git clone https://github.com/yourusername/nia-assistant.git
cd nia-assistant
```

2. Create and activate a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Set up environment variables:
Create a `.env` file and add your API keys:
```
GROQ_API_KEY=your_groq_api_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
```

## Configuration
The assistant's functionality can be configured through the following files:
- `config/tools_config.py`: Configure available tools and their parameters
- `data/user_list.json`: Manage user accounts and authentication
- `quick_notes/`: Directory for storing user notes

## Running the Application
1. Start the API server:
```bash
python api_server.py
```

2. Start Ngrok to create a tunnel:
```bash
ngrok http 8000
```

3. Configure Twilio webhook to point to your Ngrok URL

## API Endpoints
- `POST /api/chat`: Main chat endpoint
- `POST /api/webhook`: Twilio webhook endpoint

## Usage
1. Send a message to the configured Twilio number
2. The assistant will respond based on the message content
3. Available commands include:
   - Register new user
   - Send messages to other users
   - Get event information
   - Manage notes

## Testing
Run the test suite to verify functionality:
```bash
python tests_/test_functions.py
```

## Dependencies
- Python 3.8+
- FastAPI (for API server)
- Groq (for AI processing)
- Twilio (for SMS/WhatsApp integration)
- Uvicorn (for ASGI server)


