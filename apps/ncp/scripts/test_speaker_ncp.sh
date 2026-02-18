#!/bin/zsh

# Script to test the Speaker FastAPI server endpoints

API_SERVER_URL="http://localhost:8000" # FastAPI server URL
ASSISTANT_NAME="seatrade-jdx" # Or any other assistant name you want to test with
SPEAKER_QUERY_TOPIC="technology" # Example query topic, change as needed

echo "API Server URL: $API_SERVER_URL"
echo "Assistant Name: $ASSISTANT_NAME"
echo "Speaker Query Topic: $SPEAKER_QUERY_TOPIC"
echo "----------------------------------------------------"

# Call the /speakers/showSpeakers endpoint without a query
echo "Sending request to /speakers/showSpeakers endpoint (no query)..."
RESPONSE_FILE_ALL_SPEAKERS=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\"
}" \
"$API_SERVER_URL/showSpeakers" > "$RESPONSE_FILE_ALL_SPEAKERS"

echo "API Response for /showSpeakers (no query):"
cat "$RESPONSE_FILE_ALL_SPEAKERS"
echo "\n----------------------------------------------------"

# Call the /speakers/showSpeakers endpoint with a query
echo "Sending request to /speakers/showSpeakers endpoint (with query: $SPEAKER_QUERY_TOPIC)..."
RESPONSE_FILE_SPEAKERS_WITH_QUERY=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\",
  \"query\": [\"$SPEAKER_QUERY_TOPIC\"]
}" \
"$API_SERVER_URL/showSpeakers" > "$RESPONSE_FILE_SPEAKERS_WITH_QUERY"

echo "API Response for /showSpeakers (with query: $SPEAKER_QUERY_TOPIC):"
cat "$RESPONSE_FILE_SPEAKERS_WITH_QUERY"
echo "\n----------------------------------------------------"

# Clean up temporary files
rm "$RESPONSE_FILE_ALL_SPEAKERS"
rm "$RESPONSE_FILE_SPEAKERS_WITH_QUERY"

echo "----------------------------------------------------"
# Call the /showIndividualSpeaker endpoint
SPEAKER_NAME_TO_TEST="Josh Weinstein" # Example speaker name, change as needed
echo "Sending request to /showIndividualSpeaker endpoint (speaker: $SPEAKER_NAME_TO_TEST)..."
RESPONSE_FILE_INDIVIDUAL_SPEAKER=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\",
  \"speakerName\": \"$SPEAKER_NAME_TO_TEST\"
}" \
"$API_SERVER_URL/showIndividualSpeaker" > "$RESPONSE_FILE_INDIVIDUAL_SPEAKER"

echo "API Response for /showIndividualSpeaker (speaker: $SPEAKER_NAME_TO_TEST):"
cat "$RESPONSE_FILE_INDIVIDUAL_SPEAKER"
echo "\n----------------------------------------------------"

# Clean up temporary files
rm "$RESPONSE_FILE_INDIVIDUAL_SPEAKER"

echo "Script finished."
