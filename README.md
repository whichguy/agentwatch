# 🤖 AgentWatch

**File-level AI agent monitoring for GitHub Pull Requests**

AgentWatch lets you tag specific files in PRs for AI analysis and monitoring. Simply comment `@agentwatch <agent> <args>` on any file, and agents will:
- ✅ **Run immediately** on that specific file
- 🔄 **Monitor changes** and re-run when the file is updated
- 💬 **Post results** as threaded replies to your comment

## 🚀 Quick Start

### 1. Install AgentWatch

Choose your preferred installation method:

#### Option A: GitHub Actions (Recommended)
1. Go to [Actions → Setup AgentWatch](https://github.com/whichguy/agentwatch/actions/workflows/setup-agentwatch-remote.yml)
2. Click **"Run workflow"**
3. Enter your repository: `username/repo-name`
4. ✅ Setup PR will be created in your repository!

#### Option B: Add Trigger Workflow
Add this to your repository as `.github/workflows/install-agentwatch.yml`:

```yaml
name: Install AgentWatch
on: workflow_dispatch

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            await github.rest.repos.createDispatchEvent({
              owner: 'whichguy',
              repo: 'agentwatch',
              event_type: 'setup-agentwatch',
              client_payload: {
                target_repo: context.repo.owner + '/' + context.repo.repo,
                create_pr: true
              }
            });
```

#### Option C: Use as GitHub Action
```yaml
- name: Setup AgentWatch
  uses: whichguy/agentwatch/.github/actions/setup-agentwatch@main
  with:
    create-pr: true
    agents: 'echo,promptexpert,lint'
```

### 2. Tag Files for Monitoring

1. **Open any Pull Request**
2. **Click on a specific file** you want to monitor  
3. **Add a review comment**: `@agentwatch echo preview`
4. **Watch the agent run** immediately on that file!

## 🤖 Built-in Agents

### 🔊 Echo Agent
Perfect for testing AgentWatch functionality.

```bash
@agentwatch echo                    # Basic test
@agentwatch echo preview           # Show file content  
@agentwatch echo test --verbose    # With arguments
```

### 🧠 PromptExpert Agent
AI-powered code and prompt analysis using Claude.

```bash
@agentwatch promptexpert security          # Security analysis
@agentwatch promptexpert programming       # Code review
@agentwatch promptexpert general --deep    # Deep analysis
```

**Requires**: `ANTHROPIC_API_KEY` repository secret

### 🔍 Lint Agent
Basic code quality and style checking.

```bash
@agentwatch lint                   # Basic linting
@agentwatch lint --fix            # Show suggested fixes
```

## 📋 Usage Examples

### File-Level Precision
```bash
# Tag different files with different agents:
# On auth.js:
@agentwatch promptexpert security --deep

# On utils.js: 
@agentwatch lint

# On README.md:
@agentwatch echo preview
```

### Persistent Monitoring
Once you tag a file, agents automatically re-run when:
- 🔄 You push new commits that change the file
- 📝 The file content is updated in any way
- 🏷️ The PR has the `agentwatch:<agent>` label

### Stop Monitoring
- **Remove the label**: Delete `agentwatch:<agent>` from the PR
- **Close the PR**: Monitoring stops automatically

## 🏗️ Architecture

```
agentwatch/
├── .github/
│   ├── workflows/
│   │   ├── agentwatch.yml                    # Main workflow
│   │   ├── setup-agentwatch-remote.yml       # Remote installation
│   │   └── install-agentwatch-trigger.yml    # Trigger workflow
│   ├── scripts/
│   │   ├── agentwatch.js                     # Core orchestrator
│   │   ├── agent-helpers.js                  # Utilities
│   │   └── agents/                           # Agent directory
│   │       ├── echo.js                       # Test agent
│   │       ├── promptexpert.js               # AI analysis
│   │       └── lint.js                       # Code quality
│   └── actions/
│       └── setup-agentwatch/                 # Reusable action
├── README.md                                 # This file
└── docs/                                     # Documentation
```

## 🛠️ Creating Custom Agents

Agents are simple JavaScript modules that implement the `runAgent` interface:

```javascript
// .github/scripts/agents/myagent.js
async function runAgent(context, github) {
  // context contains:
  // - file_path: "src/auth.js"
  // - pr_number: 123
  // - comment_id: 456789
  // - agent: "myagent"
  // - args: "arg1 --flag value"
  // - repo: {owner: "user", name: "repo"}
  
  const { parseArgs, getFileContent, postReply } = require('../agent-helpers.js');
  
  // Parse arguments
  const { positional, flags } = parseArgs(context.args);
  
  // Get file content
  const fileContent = await getFileContent(
    context.file_path, 
    context.pr_number, 
    github, 
    context.repo
  );
  
  // Do your agent logic...
  const result = `MyAgent analyzed ${context.file_path}: ${fileContent.length} bytes`;
  
  // Post result as reply to the original comment
  await postReply(context, github, result);
}

module.exports = { runAgent };
```

### Available Helpers
- `getFileContent(filePath, prNumber, github, repo)` - Get file content from PR
- `getPRContext(prNumber, github, repo)` - Get full PR information
- `parseArgs(argsString)` - Parse command-line style arguments  
- `postReply(context, github, message)` - Reply to original comment
- `postPRComment(context, github, message)` - Post general PR comment
- `formatSuccessMessage(agentName, summary, details)` - Standard formatting
- `formatErrorMessage(agentName, error)` - Error formatting

## ⚙️ Configuration

After installation, AgentWatch creates:

```yaml
# .github/agentwatch-config.yml
version: "1.0"
installed: 2024-08-06T12:00:00Z
source: "whichguy/agentwatch"

agents:
  echo:
    description: "Test agent for validation"
    enabled: true
  promptexpert:
    description: "AI-powered analysis"
    enabled: true
    requires_secrets: ["ANTHROPIC_API_KEY"]
  lint:
    description: "Code quality checks"
    enabled: true
```

## 🔐 Required Permissions

AgentWatch needs these repository permissions:
- ✅ **Contents**: Read files and create commits
- ✅ **Issues**: Comment on PRs 
- ✅ **Pull Requests**: Add labels and manage PR state
- ✅ **Actions**: Run GitHub Actions workflows

## 🎯 How It Works

### 1. File Tagging
- Comment `@agentwatch <agent>` on any file in a PR
- AgentWatch parses the command and extracts context
- Label `agentwatch:<agent>` is added to the PR

### 2. Immediate Execution  
- Agent runs immediately on the tagged file
- Results posted as threaded reply to your comment
- File is now "watched" for future changes

### 3. Persistent Monitoring
- On PR updates, AgentWatch checks for changed files
- If watched files changed, re-runs the appropriate agents
- Continues until PR is closed or label removed

### 4. State Management
- **GitHub Labels**: Track which agents are active
- **Review Comments**: Store watch configuration and arguments
- **No External Storage**: Everything uses GitHub's native features

## 🧪 Testing

After installation, test with these commands on any file in a PR:

```bash
# 1. Basic functionality test
@agentwatch echo

# 2. File content preview
@agentwatch echo preview  

# 3. Argument parsing test
@agentwatch echo test --verbose --format json

# 4. AI analysis (requires API key)
@agentwatch promptexpert general

# 5. Code quality check
@agentwatch lint
```

## 🐛 Troubleshooting

### AgentWatch Not Responding
1. **Check Actions tab** for workflow execution logs
2. **Verify comment format**: Must be exactly `@agentwatch echo` (no extra punctuation)
3. **Check permissions**: Repository must allow GitHub Actions to comment

### PromptExpert Agent Fails
1. **Add API key**: Settings → Secrets → New repository secret
2. **Name**: `ANTHROPIC_API_KEY`
3. **Value**: Your Anthropic API key from console.anthropic.com

### Installation Fails
1. **Check target repository exists** and is accessible
2. **Verify source repository permissions** (whichguy/agentwatch)
3. **Review installation logs** in the AgentWatch repository Actions tab

## 📚 Documentation

- **[Agent Development Guide](.github/scripts/AGENTWATCH.md)** - Detailed agent creation
- **[Architecture Overview](docs/ARCHITECTURE.md)** - System design and workflows
- **[Examples](examples/)** - Real-world usage examples

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-agent`
3. **Add your agent** to `.github/scripts/agents/`
4. **Test with echo agent** first
5. **Submit a pull request**

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🎯 Why AgentWatch?

- **🔍 Surgical Precision**: Tag specific files, not entire PRs  
- **⚡ Instant Feedback**: Agents run immediately when you tag files
- **🔄 Persistent Monitoring**: Continuous monitoring on file changes
- **🧩 Generic Framework**: Any agent plugs in easily
- **🏷️ Native GitHub**: Uses labels and comments for state management
- **📦 Zero Dependencies**: No external services or databases
- **🚀 Easy Distribution**: One-click installation for any repository

**Ready to watch your files?** [Install AgentWatch now!](https://github.com/whichguy/agentwatch/actions/workflows/setup-agentwatch-remote.yml) 🤖