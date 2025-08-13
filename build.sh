#!/bin/bash

clear

# --- Configuration ---
# Ensure your GOOGLE_API_KEY is set as an environment variable.
# Run this in your terminal: export GOOGLE_API_KEY="YOUR_API_KEY_HERE"
#
if [ -z "$GOOGLE_API_KEY" ]; then
    echo "❌ Error: GOOGLE_API_KEY environment variable is not set."
    echo "Please export your Google API key before running this script:"
    echo "export GOOGLE_API_KEY=\"YOUR_API_KEY_HERE\""
    exit 1
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

echo "🤖 Asking the AI to generate a commit message..."

# Create a summary of changes for the AI, excluding version-only changes
CHANGED_FILES=$(git diff --cached --name-only | tr '\n' ', ' | sed 's/,$//')

# Get diff excluding package files to focus on meaningful changes
MEANINGFUL_DIFF=$(git diff --staged -- ':!package.json' ':!package-lock.json' | head -n 150)
VERSION_DIFF=$(git diff --staged -- 'package.json' 'package-lock.json' | head -n 50)

# Check if we have meaningful changes beyond version bumps
if [ -n "$MEANINGFUL_DIFF" ]; then
  CHANGES_SUMMARY="Files changed: $CHANGED_FILES\n\nMeaningful code changes (excluding version files):\n$MEANINGFUL_DIFF\n\nVersion/package changes:\n$VERSION_DIFF\n\nDiff stats:\n$STAGED_DIFF"
  PRIORITY_INSTRUCTION="IMPORTANT: Focus on the meaningful code changes (new features, bug fixes, API changes, improvements) rather than version number updates. The version changes are secondary."
else
  CHANGES_SUMMARY="Files changed: $CHANGED_FILES\n\nChanges (mainly version/package updates):\n$STAGED_DIFF_SAMPLE\n\nDiff stats:\n$STAGED_DIFF"
  PRIORITY_INSTRUCTION="This appears to be primarily a version/package update with no significant code changes."
fi

# Create the JSON payload for the Gemini API.
JSON_PAYLOAD=$(jq -n --arg changes "$CHANGES_SUMMARY" --arg priority "$PRIORITY_INSTRUCTION" \
  '{
    "contents": [
      {
        "parts": [
          {
            "text": "Based on the following git changes summary, suggest a concise commit message in the conventional commit format (e.g., feat: summary, fix: summary, chore: summary).\n\n\($priority)\n\nThe message should have a subject line and an optional, brief body if needed. Prioritize the most important functional changes over version number updates.\n\n\($changes)"
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
    echo "❌ Error: Failed to generate AI commit message."
    echo "API Response: $API_RESPONSE"
    exit 1
fi

echo -e "📄 Generated Commit Message:\n---\n$COMMIT_MESSAGE\n---"

# --- Git Operations ---

# Ensure all package files are included (in case they were modified after initial git add)
echo "📦 Ensuring all package files are staged for commit..."
git add package.json package-lock.json

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