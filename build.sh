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

# --- Simple Commit Message Generation ---

# Add all modified files to staging so the diff is complete.
git add .

# Get the staged diff
STAGED_DIFF=$(git diff --staged --stat)

# If there's no diff, exit as there is nothing to commit.
if [ -z "$STAGED_DIFF" ]; then
    echo "No changes staged for commit."
    exit 0
fi

echo "📝 Generating simple commit message..."

# Check what types of changes we have
CHANGED_FILES=$(git diff --staged --name-only)
HAS_CODE_CHANGES=$(echo "$CHANGED_FILES" | grep -E '\.(js|ts|jsx|tsx|json)$' | grep -v package | wc -l)
HAS_CONFIG_CHANGES=$(echo "$CHANGED_FILES" | grep -E '\.(json|yml|yaml|env)$' | wc -l)
HAS_DOCS_CHANGES=$(echo "$CHANGED_FILES" | grep -E '\.(md|txt)$' | wc -l)

# Generate appropriate commit message based on changes
if [[ "$HAS_CODE_CHANGES" -gt 0 ]]; then
    COMMIT_MSG="feat: backend improvements v${VERSION}

- Updated backend functionality
- Version bump to ${VERSION}
- Enhanced API stability"
elif [[ "$HAS_CONFIG_CHANGES" -gt 0 ]]; then
    COMMIT_MSG="config: update backend configuration v${VERSION}

- Updated configuration files
- Version bump to ${VERSION}"
elif [[ "$HAS_DOCS_CHANGES" -gt 0 ]]; then
    COMMIT_MSG="docs: update documentation v${VERSION}

- Updated documentation
- Version bump to ${VERSION}"
else
    COMMIT_MSG="chore: release v${VERSION}

- Version bump to ${VERSION}
- Maintenance updates"
fi

echo -e "📄 Commit Message:\n---\n$COMMIT_MSG\n---"

# Commit the changes
git commit -m "$COMMIT_MSG"

# Get current branch name  
CURRENT_BRANCH=$(git branch --show-current)

echo "⬆️  Pushing to origin $CURRENT_BRANCH"
git push origin "$CURRENT_BRANCH"

# Create and push the tag
echo "🏷️  Creating and pushing tag v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION" || echo "⚠️  Tag v$VERSION might already exist"
git push origin "v$VERSION" || echo "⚠️  Failed to push tag v$VERSION"

echo "✅ Commit and push completed successfully."