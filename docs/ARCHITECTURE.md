# AgentWatch Architecture

## System Overview

AgentWatch is a file-level monitoring system that uses GitHub's native features (review comments + labels) for state management, with minimal custom logic for orchestration.

## Core Philosophy

**Simplicity First**: Use GitHub's existing features instead of building complex state management:
- **Review comments** = Configuration storage and triggers
- **PR labels** = Active monitoring indicators  
- **GitHub Actions** = Execution engine
- **Threaded replies** = Results delivery

## Components

### 1. Main Workflow (`agentwatch.yml`)
**Triggers**: 
- `pull_request_review_comment.created` - File tagging events
- `pull_request.synchronize` - File change monitoring

**Flow**:
1. Receive GitHub webhook event
2. Route to appropriate handler (tag vs change)
3. Execute agent via dynamic module loading
4. Post results back to GitHub

### 2. Core Orchestrator (`agentwatch.js`)
**Functions**:
- `handleAgentWatch()` - Main entry point and event routing
- `handleFileTag()` - Process new `@agentwatch` mentions  
- `handleFileChanges()` - Monitor labeled PRs for file changes
- `launchAgent()` - Dynamic agent loading and execution

**Event Processing**:
```javascript
// File tagging flow
@agentwatch echo preview
  ↓ Parse command
  ↓ Add PR label: agentwatch:echo  
  ↓ Launch echo agent immediately
  ↓ Post confirmation reply

// File monitoring flow  
PR labeled with agentwatch:*
  ↓ Check for file changes
  ↓ Find review comments on changed files
  ↓ Re-launch agents for watched files
```

### 3. Agent System

**Agent Interface**:
```javascript
async function runAgent(context, github) {
  // context: {file_path, pr_number, comment_id, agent, args, repo}
  // github: authenticated Octokit instance
}
```

**Agent Loading**:
- Dynamic `require()` from `.github/scripts/agents/<name>.js`
- Fail gracefully with error messages if agent not found
- Pass standardized context object to all agents

### 4. Helper Utilities (`agent-helpers.js`)
**Core Functions**:
- File operations: `getFileContent()`, `getChangedLines()`
- Context gathering: `getPRContext()`
- Argument parsing: `parseArgs()` (shell-like syntax)
- Response formatting: `postReply()`, `formatSuccessMessage()`

## State Management

### GitHub-Native Approach
Instead of external databases or files, AgentWatch uses:

1. **PR Labels** (`agentwatch:<agent>`):
   - Indicate which agents are monitoring the PR
   - Trigger change monitoring workflows
   - Easy to see in GitHub UI

2. **Review Comments**:
   - Store configuration: `@agentwatch promptexpert security --deep`
   - File-specific: Each comment tied to specific file path  
   - Persistent: Comments remain for PR lifetime

3. **Comment Threads**:
   - Results posted as replies to original `@agentwatch` comment
   - Creates audit trail of agent runs
   - Natural conversation flow

### Data Flow
```
User: @agentwatch echo preview
  ↓
GitHub: pull_request_review_comment event
  ↓  
AgentWatch: Parse comment, add label, launch agent
  ↓
Agent: Process file, return results
  ↓
GitHub: Post reply comment, update label
```

## Installation System

### Repository Distribution
Three installation methods, all GitHub-native:

1. **Remote Dispatch** (`setup-agentwatch-remote.yml`):
   - Source repo runs installation workflow
   - Creates PR in target repository
   - Most user-friendly

2. **Target Trigger** (`install-agentwatch-trigger.yml`):
   - Target repo triggers installation
   - Uses `repository_dispatch` events
   - Good for automation

3. **Reusable Action** (`setup-agentwatch/action.yml`):
   - Direct action usage in workflows
   - Most flexible for CI/CD integration

### File Distribution
Installation copies these files to target repository:
```
.github/
├── workflows/agentwatch.yml          # Main workflow
├── scripts/
│   ├── agentwatch.js                # Core orchestrator  
│   ├── agent-helpers.js             # Utilities
│   └── agents/                      # Agent directory
│       ├── echo.js                  # Test agent
│       ├── promptexpert.js          # AI analysis
│       └── lint.js                  # Code quality
└── agentwatch-config.yml           # Installation metadata
```

## Security Model

### Permissions
**Required**:
- `contents: read` - Read repository files
- `issues: write` - Comment on PRs
- `pull-requests: write` - Add labels, manage PR state

**Not Required**:
- No elevated permissions
- No external network access (except agent-specific APIs)
- No secret access (except agent-specific like ANTHROPIC_API_KEY)

### Agent Isolation
- Each agent runs in isolated execution context
- Agents cannot access other agents' data
- Standardized context object prevents data leakage
- Error handling prevents one agent from breaking others

## Performance Considerations

### Execution Time
- **File tagging**: ~5-15 seconds (GitHub Actions cold start)
- **Change monitoring**: ~3-8 seconds (workflow already warm)
- **Agent execution**: Varies by agent complexity

### Resource Usage
- **Storage**: No external storage, minimal GitHub API calls
- **Memory**: Node.js runtime per execution (ephemeral)  
- **Network**: Only for agent-specific APIs (Anthropic, etc.)

### Scaling
- **Per-repository**: No cross-repo dependencies
- **Agent parallelism**: Multiple agents can run simultaneously
- **Change batching**: Single workflow handles multiple file changes

## Error Handling

### Agent Failures
```javascript
try {
  await agent.runAgent(context, github);
} catch (error) {
  await postError(context, github, error.message);
}
```

### Workflow Failures
- GitHub Actions automatic retry (3 attempts)
- Error comments posted to PR for user visibility
- Graceful degradation (other agents continue)

### Invalid Commands
- Parse errors result in helpful usage messages
- Malformed `@agentwatch` commands trigger error responses
- Unknown agents suggest available alternatives

## Extension Points

### Adding New Agents
1. Create `.github/scripts/agents/myagent.js`
2. Implement `runAgent(context, github)` function
3. Use helper utilities for common operations
4. Handle errors gracefully

### Custom Installation
- Override default agent list in installation workflows
- Add custom configuration in `agentwatch-config.yml`
- Extend helper utilities for domain-specific needs

### Integration Points
- **CI/CD**: Agents can integrate with existing workflows
- **External APIs**: Agents can call any external service
- **Notifications**: Use helper functions to post to Slack, email, etc.

## Future Enhancements

### Planned Features
- **Agent marketplace**: Curated list of community agents
- **Configuration UI**: Web interface for agent management  
- **Metrics dashboard**: Usage analytics and performance tracking
- **Batch operations**: Apply agents to multiple files at once

### Architecture Evolution
- **Plugin system**: More formal agent registration
- **Event streaming**: Real-time agent execution updates
- **Caching layer**: Reduce redundant file analysis
- **Agent dependencies**: Agents that use other agents

## Design Decisions

### Why GitHub-Native State?
- **Familiar**: Developers already understand labels and comments
- **Reliable**: GitHub handles persistence, not us
- **Visible**: State is visible in GitHub UI
- **Scalable**: No external dependencies to manage

### Why File-Level Precision?
- **Relevant**: Agents run only on code that matters
- **Efficient**: No wasted cycles on unchanged files
- **Flexible**: Different agents for different files
- **Maintainable**: Clear scope and boundaries

### Why Dynamic Agent Loading?
- **Extensible**: Add agents without core changes
- **Isolated**: Agent failures don't break system
- **Simple**: Standard interface, minimal boilerplate
- **Testable**: Each agent can be tested independently