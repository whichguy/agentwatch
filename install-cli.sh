#!/bin/bash

# AgentWatch CLI Installation Script
# This script installs the gh-agentwatch CLI extension

set -e

echo "🚀 Installing AgentWatch CLI Extension..."

# Check if gh is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub CLI."
    echo "Run: gh auth login"
    exit 1
fi

# Method 1: Install as official extension (if published)
install_as_extension() {
    echo "Installing as GitHub CLI extension..."
    gh extension install whichguy/gh-agentwatch 2>/dev/null || {
        echo "Extension not yet published. Installing locally..."
        return 1
    }
    echo "✅ Installed as extension: gh agentwatch"
    return 0
}

# Method 2: Install locally
install_locally() {
    echo "Installing locally..."
    
    # Create gh extensions directory
    local ext_dir="$HOME/.local/share/gh/extensions/gh-agentwatch"
    mkdir -p "$ext_dir"
    
    # Copy the extension script from cli directory
    cp cli/gh-agentwatch "$ext_dir/gh-agentwatch"
    chmod +x "$ext_dir/gh-agentwatch"
    
    # Create symlink for gh to find it
    local gh_config_dir="${GH_CONFIG_DIR:-$HOME/.config/gh}"
    mkdir -p "$gh_config_dir/extensions"
    ln -sf "$ext_dir" "$gh_config_dir/extensions/gh-agentwatch" 2>/dev/null || true
    
    echo "✅ Installed locally: gh agentwatch"
}

# Try official installation first, fall back to local
if ! install_as_extension; then
    install_locally
fi

echo ""
echo "✅ AgentWatch CLI successfully installed!"
echo ""
echo "📖 Quick Start Guide:"
echo "─────────────────────"
echo ""
echo "1️⃣  Enable AgentWatch in any repo:"
echo "    cd <your-repo>"
echo "    gh agentwatch enable"
echo ""
echo "2️⃣  Start watching files:"
echo "    gh agentwatch watch '*.js' eslint"
echo "    gh agentwatch watch '*.py' ruff"
echo "    gh agentwatch watch 'src/**/*.ts' typescript-check"
echo ""
echo "3️⃣  Manage watchers:"
echo "    gh agentwatch list              # List active watchers"
echo "    gh agentwatch unwatch eslint '*.js'  # Stop watching"
echo ""
echo "4️⃣  Available agent commands:"
echo "    • agent-watch    - Watch files matching patterns"
echo "    • agent-unwatch  - Stop watching files"
echo "    • agent-list     - List all active watchers"
echo "    • agent-run      - Run agent in issue context"
echo "    • agent-review   - Trigger code review"
echo "    • agent-test     - Run tests on changed files"
echo "    • agent-format   - Format code automatically"
echo ""
echo "5️⃣  Get help:"
echo "    gh agentwatch help"
echo ""
echo "🎉 Happy watching!"