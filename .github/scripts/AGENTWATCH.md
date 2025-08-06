# AgentWatch Documentation

AgentWatch is a simple, file-level agent monitoring system for GitHub PRs. Tag specific files to be watched by AI agents through review comments.

## Quick Start

### 1. Tag a File for Watching
1. Open any Pull Request
2. Click on a specific file you want to monitor
3. Add a review comment: `@agentwatch <agent> <args>`

### 2. Examples

```bash
# Basic echo test
@agentwatch echo

# Echo with preview
@agentwatch echo preview

# PromptExpert security analysis
@agentwatch promptexpert security

# PromptExpert with deep analysis
@agentwatch promptexpert security --deep

# PromptExpert with custom suggestions
@agentwatch promptexpert general --suggest "improve error handling"
```

### 3. What Happens

1. **Immediate Run**: Agent runs immediately on the tagged file
2. **Label Added**: PR gets labeled `agentwatch:<agent>` 
3. **Persistent Watching**: Agent re-runs when the file changes in future pushes
4. **Threaded Replies**: Results appear as replies to your original comment

## Available Agents

### Echo Agent
**Usage**: `@agentwatch echo [args]`
- Simple test agent that echoes back context information
- Use `preview` argument to see file content preview
- Perfect for testing AgentWatch functionality

### PromptExpert Agent  
**Usage**: `@agentwatch promptexpert <domain> [flags]`
- AI-powered prompt and code analysis
- **Domains**: `security`, `general`, `financial`, `programming`, `data-analysis`
- **Flags**:
  - `--deep`: Perform deep analysis including edge cases
  - `--suggest "text"`: Provide specific suggestions

## How It Works

### File-Level Precision
- Each `@agentwatch` comment tags **only that specific file**
- Agents run only when **that file** changes
- Multiple agents can watch different files in the same PR

### State Management
- **GitHub Labels**: Show which agents are active (`agentwatch:promptexpert`)
- **Review Comments**: Store the watch configuration and arguments
- **No External Storage**: Everything uses GitHub's native features

### Lifecycle
- **Start Watching**: Add `@agentwatch` comment to file
- **Stop Watching**: Remove the `agentwatch:*` label from PR
- **View Status**: Check PR labels to see active agents

## Creating New Agents

Agents are simple JavaScript modules in `.github/scripts/agents/`:

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
  const result = `Analyzed ${context.file_path}: ${fileContent.length} bytes`;
  
  // Post result
  await postReply(context, github, result);
}

module.exports = { runAgent };
```

### Helper Functions
Available in `agent-helpers.js`:
- `getFileContent()` - Get file content from PR
- `getPRContext()` - Get full PR information  
- `parseArgs()` - Parse command-line style arguments
- `postReply()` - Reply to the original comment
- `postPRComment()` - Post general PR comment
- `formatSuccessMessage()` - Standard success formatting
- `formatErrorMessage()` - Standard error formatting

## Architecture

```
.github/
├── workflows/
│   └── agentwatch.yml          # Single workflow for all events
├── scripts/
│   ├── agentwatch.js          # Core orchestrator
│   ├── agent-helpers.js       # Utilities for agent development  
│   └── agents/               # Agent directory
│       ├── echo.js          # Test agent
│       ├── promptexpert.js  # PromptExpert adapter
│       └── myagent.js       # Your custom agents
```

## Workflow Events

- **File Tagging**: `pull_request_review_comment.created`
- **Change Monitoring**: `pull_request.synchronize`

## Troubleshooting

### Agent Not Found
- Check that your agent file exists in `.github/scripts/agents/`
- Ensure it exports a `runAgent` function
- Check the workflow logs in GitHub Actions

### No Response
- Verify `ANTHROPIC_API_KEY` is set for PromptExpert
- Check that PR has the correct `agentwatch:*` label
- Look at GitHub Actions logs for errors

### Permission Issues
- Ensure the repository has necessary permissions for Actions
- Check that the workflow has `pull-requests: write` permission

## Best Practices

1. **Start with Echo**: Test with `@agentwatch echo` first
2. **One Agent Per File**: Keep agents focused on specific files
3. **Clear Arguments**: Use descriptive flags and arguments
4. **Monitor Labels**: Use PR labels to track what's being watched
5. **Agent Naming**: Use lowercase, descriptive agent names

## Examples in Practice

### Security Review Workflow
```bash
# Tag sensitive files for security review
@agentwatch promptexpert security --deep     # auth.js
@agentwatch promptexpert security            # api.js  
@agentwatch echo preview                     # config.js (just monitoring)
```

### Code Quality Workflow  
```bash
# Different agents for different concerns
@agentwatch promptexpert programming --suggest "improve performance"  # core.js
@agentwatch promptexpert general                                     # utils.js
```

This creates a surgical, file-specific monitoring system that scales with your needs.