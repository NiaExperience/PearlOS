#!/bin/zsh

# Script to test the Agenda FastAPI server

API_SERVER_URL="http://localhost:8000" # FastAPI server URL
ASSISTANT_NAME="seatrade-jdx" # Or any other assistant name you want to test with

echo "API Server URL: $API_SERVER_URL"
echo "Assistant Name: $ASSISTANT_NAME"
AGENDA_TITLE_TO_TEST="State of the Global Cruise Industry Keynote" # Example title, change as needed
echo "Agenda Title to Test: $AGENDA_TITLE_TO_TEST"
echo "----------------------------------------------------"

# Call the /showAgenda endpoint
echo "Sending request to /showAgenda endpoint..."
RESPONSE_FILE_ALL_AGENDAS=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\"
}" \
"$API_SERVER_URL/showAgenda" > "$RESPONSE_FILE_ALL_AGENDAS"

echo "API Response for /showAgenda:"
cat "$RESPONSE_FILE_ALL_AGENDAS"
echo "\n----------------------------------------------------"

# Call the /showIndividualAgenda endpoint
echo "Sending request to /showIndividualAgenda endpoint..."
RESPONSE_FILE_INDIVIDUAL_AGENDA=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\",
  \"agendaTitle\": \"$AGENDA_TITLE_TO_TEST\"
}" \
"$API_SERVER_URL/showIndividualAgenda" > "$RESPONSE_FILE_INDIVIDUAL_AGENDA"

echo "API Response for /showIndividualAgenda:"
cat "$RESPONSE_FILE_INDIVIDUAL_AGENDA"
echo "\n----------------------------------------------------"


# Clean up temporary files
rm "$RESPONSE_FILE_ALL_AGENDAS"
rm "$RESPONSE_FILE_INDIVIDUAL_AGENDA"

echo "Script finished."
