#!/bin/bash
# Migrate definition files from apps/interface/src/features to packages/features/src/definitions

set -e

REPO_ROOT="/Users/klugj/src/nia/nia-universal"
SOURCE_DIR="$REPO_ROOT/apps/interface/src/features"
TARGET_DIR="$REPO_ROOT/packages/features/src/definitions"

echo "🚀 Migrating definition files..."
echo "  Source: $SOURCE_DIR"
echo "  Target: $TARGET_DIR"
echo ""

# Create target directory
mkdir -p "$TARGET_DIR"

# Find and move definition files
DEFINITIONS=$(find "$SOURCE_DIR" -name "definition*.ts" -type f)

for def_file in $DEFINITIONS; do
    # Extract feature name from path (e.g., /path/to/Notes/definition.ts -> Notes)
    feature_name=$(basename $(dirname "$def_file"))
    
    # Create kebab-case filename (e.g., Notes -> notes-definition.ts)
    target_filename=$(echo "$feature_name" | sed 's/\([A-Z]\)/-\1/g' | sed 's/^-//' | tr '[:upper:]' '[:lower:]')-definition.ts
    
    target_path="$TARGET_DIR/$target_filename"
    
    echo "📦 Moving $feature_name definition..."
    echo "   From: $(basename $(dirname "$def_file"))/definition.ts"
    echo "   To:   definitions/$target_filename"
    
    # Copy file (not move, so we can verify before deleting)
    cp "$def_file" "$target_path"
    
    echo "   ✅ Copied"
    echo ""
done

echo "✅ All definition files migrated!"
echo ""
echo "📝 Files created in $TARGET_DIR:"
ls -1 "$TARGET_DIR"
