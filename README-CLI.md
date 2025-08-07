# AgentWatch CLI

A powerful GitHub CLI extension for managing AgentWatch across all your repositories.

## Installation

### Quick Install

Run the installation script from the agentwatch repo:

```bash
./install-cli.sh
```

### Manual Install

If you prefer to install manually:

```bash
# Clone the extension
git clone https://github.com/whichguy/gh-agentwatch ~/.local/share/gh/extensions/gh-agentwatch

# Make it executable
chmod +x ~/.local/share/gh/extensions/gh-agentwatch/gh-agentwatch

# Verify installation
gh agentwatch help
```

## Usage

### Enable AgentWatch in Current Repository

```bash
cd your-repo
gh agentwatch enable
```

This adds 4 workflow files:
- `agentwatch.yml` - Main watcher functionality
- `agent-review.yml` - Code review automation
- `agent-test.yml` - Test automation
- `agent-format.yml` - Code formatting

### Enable AgentWatch in ALL Repositories (⚠️ Use with caution!)

```bash
gh agentwatch enable-all
```

**WARNING**: This will:
- Affect ALL repositories under your account
- Add 4 workflow files to each repo
- Require double confirmation (repo count verification)
- Cannot be easily undone

### Agent Commands

Work directly from your terminal - no need to open GitHub!

#### Watch Files
```bash
# Start watching JavaScript files with ESLint
gh agentwatch watch '*.js' eslint

# Watch TypeScript with custom arguments
gh agentwatch watch 'src/**/*.ts' typescript-check @ --strict --noEmit

# Watch Python files with ruff
gh agentwatch watch '*.py' ruff @ check --fix
```

#### Stop Watching
```bash
gh agentwatch unwatch eslint '*.js'
```

#### List Active Watchers
```bash
gh agentwatch list
```

#### Run Agents
```bash
# Run code review
gh agentwatch review

# Run tests on specific patterns
gh agentwatch test '*.spec.js'

# Format code
gh agentwatch format '*.py'

# Run any agent
gh agentwatch run code-analyzer
```

### Check Status
```bash
# Check AgentWatch status in current repo
gh agentwatch status
```

## How It Works

1. **Context Detection**: The CLI automatically finds the most recent open PR or issue in your current repo
2. **Auto-Issue Creation**: If no PR/issue exists, it creates one for AgentWatch commands
3. **Command Posting**: Posts `@agent-*` commands as comments to trigger workflows
4. **Workflow Execution**: GitHub Actions workflows respond to the commands

## Pattern Examples

```bash
*.js                  # All JavaScript files
src/**/*.ts           # All TypeScript under src/
test-*.js             # Files matching test-*.js
{app,lib}/*.js        # JS files in app/ or lib/
**/*.{js,ts}          # All JS and TS files
```

## Available Commands in Issues/PRs

Once enabled, you can use these commands directly in GitHub issues and PRs:

- `@agent-watch <pattern> <agent>` - Start watching files
- `@agent-unwatch <agent> <pattern>` - Stop watching
- `@agent-list` - List all active watchers
- `@agent-run <agent>` - Run specific agent
- `@agent-review` - Request code review
- `@agent-test` - Run tests
- `@agent-format` - Format code

## Examples

### Complete Workflow

```bash
# 1. Enable AgentWatch in your repo
cd my-project
gh agentwatch enable

# 2. Start watching files
gh agentwatch watch '*.js' eslint
gh agentwatch watch '*.py' black

# 3. List active watchers
gh agentwatch list

# 4. Run agents as needed
gh agentwatch review        # Code review
gh agentwatch test          # Run tests
gh agentwatch format '*.py' # Format Python files

# 5. Stop watching when done
gh agentwatch unwatch eslint '*.js'
```

### Batch Enable for Organization

```bash
# Enable for all repos (requires confirmation)
gh agentwatch enable-all

# This will:
# - Show count of affected repos
# - List first 10 repos
# - Require typing "yes" to confirm
# - Require typing the repo count to double-confirm
# - Process all repos with progress indicator
```

## Troubleshooting

### Command not found
```bash
# Verify gh CLI is installed
gh --version

# Check if extension is installed
ls ~/.local/share/gh/extensions/

# Reinstall
./install-cli.sh
```

### No PR or Issue context
The CLI will automatically create an issue if none exists. You can also manually create a PR or issue first.

### Workflow not triggering
Check that workflows are enabled in your repository settings and that you have the necessary permissions.

## Uninstall

```bash
# Remove the extension
rm -rf ~/.local/share/gh/extensions/gh-agentwatch
rm -rf ~/.config/gh/extensions/gh-agentwatch
```

## Contributing

PRs welcome! The CLI is a single bash script that uses the GitHub CLI (`gh`) to interact with repositories.

## License

MIT