#!/bin/zsh

# Script to test the Exhibitor FastAPI server endpoints

API_SERVER_URL="http://localhost:8000" # FastAPI server URL
ASSISTANT_NAME="seatrade-jdx" # Or any other assistant name you want to test with
EXHIBITOR_QUERY_CATEGORY="technology" # Example query category, change as needed
EXHIBITOR_TITLE_TO_TEST="Chance Rides" # Example exhibitor title, change as needed

echo "API Server URL: $API_SERVER_URL"
echo "Assistant Name: $ASSISTANT_NAME"
echo "Exhibitor Query Category: $EXHIBITOR_QUERY_CATEGORY"
echo "Exhibitor Title to Test: $EXHIBITOR_TITLE_TO_TEST"
echo "----------------------------------------------------"

# Call the /showExhibitors endpoint without a query
echo "Sending request to /showExhibitors endpoint (no query)..."
RESPONSE_FILE_ALL_EXHIBITORS=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\"
}" \
"$API_SERVER_URL/showExhibitors" > "$RESPONSE_FILE_ALL_EXHIBITORS"

echo "API Response for /showExhibitors (no query):"
cat "$RESPONSE_FILE_ALL_EXHIBITORS"
echo "\n----------------------------------------------------"

# Call the /showExhibitors endpoint with a query
echo "Sending request to /showExhibitors endpoint (with query: $EXHIBITOR_QUERY_CATEGORY)..."
RESPONSE_FILE_EXHIBITORS_WITH_QUERY=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\",
  \"query\": [\"$EXHIBITOR_QUERY_CATEGORY\"]
}" \
"$API_SERVER_URL/showExhibitors" > "$RESPONSE_FILE_EXHIBITORS_WITH_QUERY"

echo "API Response for /showExhibitors (with query: $EXHIBITOR_QUERY_CATEGORY):"
cat "$RESPONSE_FILE_EXHIBITORS_WITH_QUERY"
echo "\n----------------------------------------------------"

# Call the /showIndividualExhibitor endpoint
echo "Sending request to /showIndividualExhibitor endpoint (exhibitor: $EXHIBITOR_TITLE_TO_TEST)..."
RESPONSE_FILE_INDIVIDUAL_EXHIBITOR=$(mktemp)

curl -s -X POST \
-H "Content-Type: application/json" \
-H "Accept: application/json" \
-d "{
  \"assistantName\": \"$ASSISTANT_NAME\",
  \"exhibitorTitle\": \"$EXHIBITOR_TITLE_TO_TEST\"
}" \
"$API_SERVER_URL/showIndividualExhibitor" > "$RESPONSE_FILE_INDIVIDUAL_EXHIBITOR"

echo "API Response for /showIndividualExhibitor (exhibitor: $EXHIBITOR_TITLE_TO_TEST):"
cat "$RESPONSE_FILE_INDIVIDUAL_EXHIBITOR"
echo "\n----------------------------------------------------"

# Clean up temporary files
rm "$RESPONSE_FILE_ALL_EXHIBITORS"
rm "$RESPONSE_FILE_EXHIBITORS_WITH_QUERY"
rm "$RESPONSE_FILE_INDIVIDUAL_EXHIBITOR"

echo "Script finished."
