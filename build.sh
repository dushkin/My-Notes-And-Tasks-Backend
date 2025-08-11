#!/bin/bash

clear

# --- Configuration ---
# Ensure your GOOGLE_API_KEY is set as an environment variable.
# Run this in your terminal: export GOOGLE_API_KEY="YOUR_API_KEY_HERE"
#
if [ -z "$GOOGLE_API_KEY" ]; then
    echo "Warning: GOOGLE_API_KEY not set. Using fallback commit message."
    USE_FALLBACK=true
else
    USE_FALLBACK=false
fi

# Extract version from package.json
VERSION=$(jq -r '.version' package.json)

# --- AI Commit Message Generation ---

# Add all modified files to staging so the diff is complete.
git add .

# Get the staged diff with size limit to avoid "Argument list too long"
STAGED_DIFF=$(git diff --staged --stat)
STAGED_DIFF_SAMPLE=$(git diff --staged | head -n 200)

# If there's no diff, exit as there is nothing to commit.
if [ -z "$STAGED_DIFF" ]; then
    echo "No changes staged for commit."
    exit 0
fi

if [ "$USE_FALLBACK" = true ]; then
    echo "🤖 Generating fallback commit message..."
    # Generate a simple commit message based on file changes
    CHANGED_FILES=$(git diff --cached --name-only)
    if echo "$CHANGED_FILES" | grep -q "\.js$\|\.ts$\|\.json$"; then
        COMMIT_MESSAGE="feat: update backend functionality"
    elif echo "$CHANGED_FILES" | grep -q "test\|spec"; then
        COMMIT_MESSAGE="test: update tests"
    elif echo "$CHANGED_FILES" | grep -q "README\|doc\|\.md$"; then
        COMMIT_MESSAGE="docs: update documentation"
    elif echo "$CHANGED_FILES" | grep -q "\.sh$\|script"; then
        COMMIT_MESSAGE="build: update build scripts"
    elif echo "$CHANGED_FILES" | grep -q "package.json\|package-lock.json" && [ $(echo "$CHANGED_FILES" | wc -l) -le 2 ]; then
        COMMIT_MESSAGE="chore(release): v$VERSION"
    else
        FIRST_FILES=$(echo "$CHANGED_FILES" | head -3 | tr '\n' ', ' | sed 's/,$//')
        COMMIT_MESSAGE="chore: update $FIRST_FILES"
    fi
else
    echo "🤖 Asking the AI to generate a commit message..."

    # Create a summary of changes for the AI
    CHANGED_FILES=$(git diff --cached --name-only | tr '\n' ', ' | sed 's/,$//')
    CHANGES_SUMMARY="Files changed: $CHANGED_FILES\n\nDiff sample (first 200 lines):\n$STAGED_DIFF_SAMPLE\n\nDiff stats:\n$STAGED_DIFF"

    # Create the JSON payload for the Gemini API.
    JSON_PAYLOAD=$(jq -n --arg changes "$CHANGES_SUMMARY" \
      '{
        "contents": [
          {
            "parts": [
              {
                "text": "Based on the following git changes summary, suggest a concise commit message in the conventional commit format (e.g., feat: summary). The message should have a subject line and an optional, brief body if needed.\n\n\($changes)"
              }
            ]
          }
        ]
      }')

    # Debug: Check JSON payload size
    echo "Debug: JSON payload size: $(echo "$JSON_PAYLOAD" | wc -c) characters"

    # Call the Gemini API using the 'gemini-1.5-flash' model.
    API_RESPONSE=$(curl -s -X POST \
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$JSON_PAYLOAD")

    # Debug: Show API response
    echo "Debug: API Response: $API_RESPONSE"

    # Parse the response to get the commit message text and clean it up.
    COMMIT_MESSAGE=$(echo "$API_RESPONSE" | jq -r '.candidates[0].content.parts[0].text' 2>/dev/null | sed 's/`//g')

    # Check if the commit message was generated successfully.
    if [ "$COMMIT_MESSAGE" == "null" ] || [ -z "$COMMIT_MESSAGE" ] || echo "$API_RESPONSE" | grep -q "error"; then
        echo "Warning: Failed to generate AI commit message. Using fallback."
        echo "API Response: $API_RESPONSE"
        # Generate a simple commit message based on file changes
        CHANGED_FILES=$(git diff --cached --name-only | head -3 | tr '\n' ', ' | sed 's/,$//')
        COMMIT_MESSAGE="chore: update $CHANGED_FILES"
    fi
fi

echo -e "📄 Generated Commit Message:\n---\n$COMMIT_MESSAGE\n---"

# --- Git Operations ---

# Commit changes with the AI-generated message.
git commit -m "$COMMIT_MESSAGE"

# Get current branch name.
CURRENT_BRANCH=$(git branch --show-current)

# Push changes to the current branch.
git push origin "$CURRENT_BRANCH"

# Create and push the tag.
# The tag message is simplified as the detailed message is in the commit itself.
git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

echo "✅ Version $VERSION successfully pushed to branch '$CURRENT_BRANCH'!"