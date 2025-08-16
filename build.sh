#!/bin/bash

clear

# --- Auto-increment version in package.json ---
echo "📈 Auto-incrementing version in package.json"
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "   Current version: $CURRENT_VERSION"

# Increment patch version (x.y.z -> x.y.z+1)
NEW_VERSION=$(node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  pkg.version = \`\${major}.\${minor}.\${patch + 1}\`;
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log(pkg.version);
")
echo "   New version: $NEW_VERSION"

# Extract the new version for later use
VERSION=$NEW_VERSION

# --- AI Commit Message Generation ---

# Check if there are any changes to commit (without staging yet)
if git diff --quiet && git diff --cached --quiet; then
    echo "ℹ️  No changes to commit."
    exit 0
fi

# Check for GOOGLE_API_KEY
if [ -z "$GOOGLE_API_KEY" ]; then
    echo "❌ Error: GOOGLE_API_KEY environment variable is not set."
    echo "Please export your Google API key before running this script:"
    echo "export GOOGLE_API_KEY=\"YOUR_API_KEY_HERE\""
    echo "⚠️  Falling back to simple commit message generation..."
    
    # Fallback to simple commit message generation
    git add .
    STAGED_DIFF=$(git diff --staged --stat)
    
    if [ -z "$STAGED_DIFF" ]; then
        echo "No changes staged for commit."
        exit 0
    fi
    
    COMMIT_MSG="feat: backend improvements v${VERSION}

- Backend functionality improvements and fixes
- Version bump to ${VERSION}

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
    
    echo -e "📄 Fallback Commit Message:\n---\n$COMMIT_MSG\n---"
    git commit -m "$COMMIT_MSG"
else
    # Get the diff that WOULD BE staged (but don't stage yet)
    STAGED_DIFF=$(git diff --stat)
    STAGED_DIFF_SAMPLE=$(git diff | head -n 200)

    echo "🤖 Asking Gemini AI to generate a commit message..."

    # Create a summary of changes for the AI, excluding version-only changes
    CHANGED_FILES=$(git diff --name-only | tr '\n' ', ' | sed 's/,$//')
    
    # Get diff excluding version/build files to focus on meaningful changes  
    MEANINGFUL_DIFF=$(git diff -- ':!package.json' ':!package-lock.json' | head -n 150)
    VERSION_DIFF=$(git diff -- 'package.json' | head -n 50)
    
    # Check if we have meaningful changes beyond version bumps
    if [ -n "$MEANINGFUL_DIFF" ]; then
        CHANGES_SUMMARY="Backend files changed: $CHANGED_FILES\n\nMeaningful code changes (excluding version files):\n$MEANINGFUL_DIFF\n\nVersion changes:\n$VERSION_DIFF\n\nDiff stats:\n$STAGED_DIFF"
        PRIORITY_INSTRUCTION="IMPORTANT: Focus on the meaningful backend code changes (new features, API updates, bug fixes, database changes, etc.) rather than version number updates. This is a Node.js/Express backend."
    else
        CHANGES_SUMMARY="Backend files changed: $CHANGED_FILES\n\nChanges (mainly version updates):\n$STAGED_DIFF_SAMPLE\n\nDiff stats:\n$STAGED_DIFF"
        PRIORITY_INSTRUCTION="This appears to be primarily a backend version update with no significant code changes."
    fi

    # Create the JSON payload for the Gemini API with retry logic
    JSON_PAYLOAD=$(jq -n --arg changes "$CHANGES_SUMMARY" --arg priority "$PRIORITY_INSTRUCTION" \
        '{
          "contents": [
            {
              "parts": [
                {
                  "text": "Based on the following git changes summary for a Node.js/Express backend, suggest a concise commit message in the conventional commit format (e.g., feat: summary, fix: summary, chore: summary).\n\n\($priority)\n\nThe message should have a subject line and an optional, brief body if needed. Prioritize the most important functional changes over version number updates.\n\n\($changes)"
                }
              ]
            }
          ]
        }')

    # Retry logic for Gemini API calls
    MAX_RETRIES=3
    RETRY_COUNT=0
    COMMIT_MSG=""

    while [ $RETRY_COUNT -lt $MAX_RETRIES ] && [ -z "$COMMIT_MSG" ]; do
        if [ $RETRY_COUNT -gt 0 ]; then
            echo "🔄 Retry attempt $RETRY_COUNT of $MAX_RETRIES..."
            sleep 2
        fi

        # Call the Gemini API using the 'gemini-1.5-flash' model
        API_RESPONSE=$(curl -s -X POST \
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "$JSON_PAYLOAD")

        # Parse the response to get the commit message text and clean it up
        COMMIT_MSG=$(echo "$API_RESPONSE" | jq -r '.candidates[0].content.parts[0].text' 2>/dev/null | sed 's/`//g')

        # Check if the commit message was generated successfully
        API_ERROR=$(echo "$API_RESPONSE" | jq -r '.error.message' 2>/dev/null)
        if [ "$COMMIT_MSG" != "null" ] && [ -n "$COMMIT_MSG" ] && [ "$API_ERROR" == "null" ]; then
            break
        fi

        echo "⚠️  API call failed (attempt $((RETRY_COUNT + 1)))"
        if [ "$API_ERROR" != "null" ]; then
            echo "API Error: $API_ERROR"
        fi
        
        RETRY_COUNT=$((RETRY_COUNT + 1))
        COMMIT_MSG=""
    done

    # Check if all retries failed
    if [ -z "$COMMIT_MSG" ] || [ "$COMMIT_MSG" == "null" ]; then
        echo "❌ Error: Failed to generate AI commit message after $MAX_RETRIES attempts."
        echo "⚠️  Falling back to simple commit message..."
        
        COMMIT_MSG="feat: backend improvements v${VERSION}

- Backend functionality improvements and fixes  
- Version bump to ${VERSION}

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
    else
        # Add Claude Code attribution to AI-generated message
        COMMIT_MSG="${COMMIT_MSG}

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
    fi

    echo -e "📄 Generated Commit Message:\n---\n$COMMIT_MSG\n---"

    # NOW stage the files since commit message generation succeeded
    echo "📦 Staging all changes for commit..."
    git add . 2>/dev/null || true

    git commit -m "$COMMIT_MSG"
fi

# Get current branch name  
CURRENT_BRANCH=$(git branch --show-current)

echo "⬆️  Pushing to origin $CURRENT_BRANCH"
git push origin "$CURRENT_BRANCH"

# Create and push the tag
echo "🏷️  Creating and pushing tag v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION" || echo "⚠️  Tag v$VERSION might already exist"
git push origin "v$VERSION" || echo "⚠️  Failed to push tag v$VERSION"

echo "✅ Commit and push completed successfully."