# Import required libraries
import streamlit as st
import requests
from datetime import datetime

class Nia:
    def __init__(self):
        print("Initializing Nia...")
        self.initialize_session()
        self.api_url = "http://localhost:8000"

    def initialize_session(self):
        # Initialize session state
        if 'messages' not in st.session_state:
            st.session_state.messages = []
        if 'error_log' not in st.session_state:
            st.session_state.error_log = []

    def start(self):
        self.run_streamlit_interface()

    def run_streamlit_interface(self):
        st.title("Nia Assistant")

        # Display all messages
        for message in st.session_state.messages:
            if message["role"] == "system":
                continue
            with st.chat_message(message["role"]):
                st.markdown(message["content"])

        # Chat input
        if prompt := st.chat_input("What would you like to know?"):
            # Add user message
            st.session_state.messages.append({"role": "user", "content": prompt})
            with st.chat_message("user"):
                st.markdown(prompt)

            # Get assistant response
            with st.chat_message("assistant"):
                with st.spinner("Thinking..."):
                    try:
                        response = self.process_command(prompt)
                        st.markdown(response)
                        message = {"role": "assistant", "content": response}
                        st.session_state.messages.append(message)
                    except Exception as e:
                        error_msg = f"Error: {str(e)}"
                        st.error(error_msg)
                        st.session_state.error_log.append({
                            'timestamp': datetime.now(),
                            'error': error_msg
                        })

    def process_command(self, command: str) -> str:
        try:
            response = requests.post(
                f"{self.api_url}/api/chat",
                json={"message": command},
                timeout=30
            )
            response.raise_for_status()
            return response.json()["response"]
        except requests.exceptions.RequestException as e:
            raise Exception(f"API request failed: {str(e)}")

# Entry point
if __name__ == "__main__":
    nia = Nia()
    nia.start()