#!/bin/zsh

# Script to test the Keyword FastAPI server endpoint

API_SERVER_URL="http://localhost:8000" # FastAPI server URL
ASSISTANT_NAME="seatrade-jdx"
KEYWORD_TO_TEST="Shuttle"

echo "API Server URL: $API_SERVER_URL"
echo "Assistant Name: $ASSISTANT_NAME"
echo "Keyword to Test: $KEYWORD_TO_TEST"
echo "----------------------------------------------------"

# Call the /keywordMemoryLookup endpoint
echo "Sending request to /keywordMemoryLookup endpoint..."
RESPONSE_FILE_KEYWORD_LOOKUP=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\",
  \"keyword\": \"$KEYWORD_TO_TEST\"
}" \
"$API_SERVER_URL/keywordMemoryLookup" > "$RESPONSE_FILE_KEYWORD_LOOKUP"

echo "API Response for /keywordMemoryLookup:"
cat "$RESPONSE_FILE_KEYWORD_LOOKUP"
echo "\n----------------------------------------------------"

# Clean up temporary file
rm "$RESPONSE_FILE_KEYWORD_LOOKUP"

echo "Script finished."


echo "\n----------------------------------------------------"
echo "Testing /IframeKeyword endpoint..."
KEYWORD_FOR_IFRAME="MAP" # Example keyword for iframe
echo "Keyword for Iframe: $KEYWORD_FOR_IFRAME"
RESPONSE_FILE_IFRAME_KEYWORD=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\",
  \"keyword\": \"$KEYWORD_FOR_IFRAME\"
}" \
"$API_SERVER_URL/IframeKeyword" > "$RESPONSE_FILE_IFRAME_KEYWORD"

echo "API Response for /IframeKeyword:"
cat "$RESPONSE_FILE_IFRAME_KEYWORD"
echo "\n----------------------------------------------------"

# Clean up temporary file
rm "$RESPONSE_FILE_IFRAME_KEYWORD"

echo "IframeKeyword test finished."
