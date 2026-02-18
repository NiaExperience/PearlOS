import subprocess
import sys
import time

def run_services():
    # Start API server
    api_process = subprocess.Popen([sys.executable, "api_server.py"])

    # Wait for API server to start
    time.sleep(2)

    # # Start Streamlit app
    # streamlit_process = subprocess.Popen([
    #     "streamlit", "run", "main.py"
    # ])

    try:
        api_process.wait()
        # streamlit_process.wait()
    except KeyboardInterrupt:
        print("Shutting down services...")
        api_process.terminate()
        # streamlit_process.terminate()

if __name__ == "__main__":
    run_services()
