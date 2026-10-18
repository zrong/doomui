# DoomUI root command interface.
# Install just with: brew install just

set shell := ["bash", "-euo", "pipefail", "-c"]

[private]
default:
    #!/usr/bin/env bash
    just --list

# Install locked dependencies for both plugin projects
install:
    npm --prefix figma-sync ci
    npm --prefix cocos-sync ci

# Build both plugins
build: cocos-build figma-build

# Run all automated tests
test: cocos-test

# Run version validation, builds, type checks and tests
check: version-check sandbox-check cocos-check figma-check

# Validate the public sandbox asset graph and metadata
sandbox-check:
    node scripts/check-sandbox.mjs

# Build the Cocos Creator extension
cocos-build:
    npm --prefix figma-sync run build

# Run Cocos extension tests
cocos-test:
    npm --prefix figma-sync test

# Build and test the Cocos extension
cocos-check:
    npm --prefix figma-sync run check

# Watch the Cocos extension TypeScript sources
cocos-watch:
    npm --prefix figma-sync run watch

# Build the Figma Desktop companion plugin
figma-build:
    npm --prefix cocos-sync run build

# Type-check and build the Figma Desktop companion plugin
figma-check:
    npm --prefix cocos-sync run check

# Watch and rebuild the Figma Desktop companion plugin
figma-watch:
    npm --prefix cocos-sync run watch

# Create the sandbox extension symlink without replacing an unrelated path
sandbox-link:
    #!/usr/bin/env bash
    link="sandbox/extensions/figma-sync"
    mkdir -p "$(dirname "$link")"
    if [ -L "$link" ]; then
        target=$(readlink "$link")
        if [ "$target" != "../../figma-sync" ]; then
            echo "错误: $link 已指向 $target" >&2
            exit 1
        fi
        echo "$link 已正确指向 ../../figma-sync"
    elif [ -e "$link" ]; then
        echo "错误: $link 已存在且不是软链接" >&2
        exit 1
    else
        ln -s ../../figma-sync "$link"
        echo "已创建 $link"
    fi

# Validate VERSION, package versions and any CalVer tag on HEAD
version-check:
    node scripts/check-version.mjs

# Update VERSION and all package/lock versions; VERSION must come from git-commit calver.py
set-version VERSION:
    node scripts/set-version.mjs "{{VERSION}}"

# Run the full check and require HEAD to carry the same CalVer tag
release-check: check
    node scripts/check-version.mjs --require-tag
