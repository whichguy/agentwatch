# AgentWatch Design Proposal: Reusable Workflows

## Overview
Transform AgentWatch from loading JavaScript "agents" to orchestrating reusable GitHub workflows.

## Core Concept
Each "agent" becomes a reusable workflow that can be called with parameters.

## Architecture

### 1. Main Orchestrator Workflow
```yaml
# .github/workflows/agentwatch.yml
name: AgentWatch
on:
  pull_request_review_comment:
    types: [created]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize]

jobs:
  orchestrate:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.parse.outputs.matrix }}
    steps:
      - name: Parse AgentWatch Commands
        id: parse
        uses: actions/github-script@v7
        with:
          script: |
            // Parse commands and build matrix of workflows to run
            // Store pattern configurations
            
  execute-agents:
    needs: orchestrate
    if: needs.orchestrate.outputs.matrix != '[]'
    strategy:
      matrix: ${{ fromJson(needs.orchestrate.outputs.matrix) }}
    uses: ${{ matrix.workflow }}
    with:
      file_path: ${{ matrix.file_path }}
      pr_number: ${{ matrix.pr_number }}
      agent_args: ${{ matrix.agent_args }}
      repository: ${{ github.repository }}
    secrets: inherit
```

### 2. Agent Registry
```yaml
# .github/agentwatch/registry.yml
agents:
  security:
    workflow: agentwatch/agents/.github/workflows/security.yml@v1
    description: Security vulnerability scanner
    
  lint:
    workflow: agentwatch/agents/.github/workflows/lint.yml@v1
    description: Code linter
    
  test:
    workflow: ./.github/workflows/test-runner.yml
    description: Local test runner
```

### 3. Reusable Workflow Template
```yaml
# agentwatch/agents/.github/workflows/security.yml
name: Security Scanner
on:
  workflow_call:
    inputs:
      file_path:
        description: File to scan
        required: true
        type: string
      pr_number:
        description: PR number for comments
        required: true
        type: number
      agent_args:
        description: Additional arguments
        required: false
        type: string
      repository:
        description: Target repository
        required: true
        type: string

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          repository: ${{ inputs.repository }}
          
      - name: Security Scan
        id: scan
        run: |
          # Perform security scanning
          echo "Scanning ${{ inputs.file_path }}"
          
      - name: Post Results
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: ${{ inputs.pr_number }},
              body: 'Security scan complete for ${{ inputs.file_path }}'
            })
```

## Command Syntax

### @agent-watch
```bash
# Basic syntax
@agent-watch <pattern> <workflow-name> [with:<key>=<value>...] [env:<KEY>=<value>...] [secrets:<KEY>...]

# Examples:

# Simple (using registry name)
@agent-watch *.js security

# With workflow inputs (passed to 'with:' in workflow)
@agent-watch *.js security with:severity=high with:auto_fix=true with:report_format=json

# With environment variables
@agent-watch *.js lint env:NODE_ENV=production env:STRICT_MODE=true

# With secrets (references existing repo secrets)
@agent-watch *.js deploy secrets:API_KEY secrets:DEPLOY_TOKEN

# Combined
@agent-watch src/**/*.ts typecheck with:strict=true with:lib=es2022 env:CI=true

# Full workflow reference with inputs
@agent-watch *.js uses:agentwatch/agents/.github/workflows/security.yml@v1 with:scan_depth=full

# Local workflow
@agent-watch *.js uses:./.github/workflows/my-scanner.yml with:config_file=.scannerrc
```

### Argument Parsing Rules

1. **Pattern**: First argument, supports glob patterns
2. **Workflow**: Second argument, either:
   - Short name from registry (e.g., `security`)
   - Full reference (e.g., `uses:owner/repo/.github/workflows/file.yml@ref`)
   - Local reference (e.g., `uses:./.github/workflows/file.yml`)

3. **Inputs** (`with:`): Key-value pairs passed to workflow's `inputs`
   - Format: `with:key=value`
   - Multiple inputs: Space-separated
   - Complex values: Use quotes `with:config='{"deep": true}'`

4. **Environment** (`env:`): Environment variables for the workflow
   - Format: `env:KEY=value`
   - Passed to workflow's `env` context

5. **Secrets** (`secrets:`): Repository secrets to pass
   - Format: `secrets:SECRET_NAME`
   - References existing repository secrets
   - Or `secrets:inherit` to pass all secrets

### @agent-run
```bash
# Direct execution with inputs
@agent-run security with:file=src/main.js with:severity=high

# With environment variables
@agent-run test env:TEST_SUITE=integration env:PARALLEL=true

# With specific secrets
@agent-run deploy secrets:PROD_API_KEY secrets:DEPLOY_TOKEN
```

### @agent-unwatch
```bash
# Remove pattern for specific workflow
@agent-unwatch security *.js

# Remove all patterns for workflow
@agent-unwatch security *
```

### @agent-list
```bash
# List all patterns and their associated workflows
@agent-list

# Output:
# | Pattern | Workflow | Inputs | Env | Secrets | Source |
# | *.js | security | severity=high | NODE_ENV=prod | API_KEY | PR #23 |
```

## Workflow Interface Standard

All agent workflows should follow this interface:

```yaml
name: Agent Workflow Template
on:
  workflow_call:
    inputs:
      # Required standard inputs
      file_path:
        description: 'File(s) to process (comma-separated for multiple)'
        required: true
        type: string
      pr_number:
        description: 'Pull request number for posting results'
        required: true
        type: number
      repository:
        description: 'Repository to operate on (owner/repo format)'
        required: true
        type: string
      trigger_type:
        description: 'How agent was triggered (manual/auto/scheduled)'
        required: false
        type: string
        default: 'manual'
      
      # Agent-specific inputs (defined by each agent)
      severity:
        description: 'Scan severity level'
        required: false
        type: string
        default: 'medium'
      auto_fix:
        description: 'Automatically fix issues'
        required: false
        type: boolean
        default: false
    
    # Secrets can be passed explicitly or inherited
    secrets:
      api_key:
        description: 'API key for external service'
        required: false
      custom_token:
        description: 'Custom authentication token'
        required: false
```

## Storage Format

Pattern configurations stored as JSON in PR comments or artifacts:

```json
{
  "pattern": "src/**/*.js",
  "workflow": "security",
  "workflow_ref": "agentwatch/agents/.github/workflows/security.yml@v1",
  "inputs": {
    "severity": "high",
    "auto_fix": "true",
    "report_format": "json"
  },
  "env": {
    "NODE_ENV": "production",
    "STRICT_MODE": "true"
  },
  "secrets": ["API_KEY", "SCAN_TOKEN"],
  "source_pr": 23,
  "created_by": "username",
  "created_at": "2024-01-01T00:00:00Z"
}

## Benefits

1. **Native GitHub Features**
   - Reusable workflows are first-class GitHub citizens
   - Better integration with Actions ecosystem
   - Workflow runs visible in Actions tab

2. **Better Security**
   - Each workflow declares its required permissions
   - Secrets can be passed securely
   - OIDC token support for cloud providers

3. **Scalability**
   - Parallel execution of multiple agents
   - Matrix strategies for multiple files
   - Automatic job queuing and resource management

4. **Versioning & Stability**
   - Workflows can be versioned with tags
   - Rollback capability
   - A/B testing of different versions

5. **Developer Experience**
   - Familiar GitHub Actions syntax
   - Easy to create custom agents
   - Marketplace potential for sharing

6. **Cost & Performance**
   - Per-workflow billing visibility
   - Caching between workflow runs
   - Conditional execution saves resources

## Migration Path

### Phase 1: Dual Mode
- Keep existing JavaScript agent support
- Add workflow calling capability
- Registry maps names to workflows

### Phase 2: Workflow First
- Convert existing agents to workflows
- Deprecate JavaScript agents
- Full workflow-based architecture

### Phase 3: Advanced Features
- Workflow composition (agents calling agents)
- Conditional chains based on results
- Integration with GitHub Copilot

## Example Use Cases

### Security Scanning
```yaml
@agent-watch **/*.js security @ --severity=high --block-pr
```

### Auto-formatting
```yaml
@agent-watch **/*.{js,ts} prettier @ --write --commit
```

### Test Runner
```yaml
@agent-watch src/**/*.js test-runner @ --coverage --fail-fast
```

### Documentation Generator
```yaml
@agent-watch **/*.js docs @ --format=markdown --output=docs/
```

## Technical Considerations

### 1. Dynamic Workflow Calling Challenge

GitHub Actions doesn't support fully dynamic `uses:` statements. Solutions:

#### Option A: Workflow Dispatch Chain
```yaml
# agentwatch.yml triggers specific workflows via dispatch
- name: Trigger agent workflow
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.actions.createWorkflowDispatch({
        owner: context.repo.owner,
        repo: context.repo.repo,
        workflow_id: 'agent-security.yml',
        ref: context.ref,
        inputs: {
          file_path: '${{ inputs.file_path }}',
          pr_number: '${{ inputs.pr_number }}',
          severity: 'high',
          auto_fix: 'true'
        }
      })
```

#### Option B: Registry-Based Matrix
```yaml
# Pre-defined list of workflows in matrix
jobs:
  run-agents:
    strategy:
      matrix:
        include:
          - agent: security
            workflow: ./.github/workflows/agent-security.yml
            enabled: ${{ needs.parse.outputs.run_security }}
          - agent: lint
            workflow: ./.github/workflows/agent-lint.yml  
            enabled: ${{ needs.parse.outputs.run_lint }}
    if: matrix.enabled == 'true'
    uses: ${{ matrix.workflow }}
```

#### Option C: Composite Actions
```yaml
# Use composite actions that can be dynamically selected
- name: Run agent
  uses: ./.github/actions/agent-runner
  with:
    agent_name: ${{ needs.parse.outputs.agent }}
    inputs: ${{ needs.parse.outputs.inputs }}
```

### 2. Argument Parsing Implementation

```javascript
// Parser for @agent-watch commands
function parseAgentWatch(command) {
  // Example: @agent-watch *.js security with:severity=high with:auto_fix=true env:NODE_ENV=production secrets:API_KEY
  
  const parts = command.split(/\s+/);
  let pattern = parts[1];
  let workflow = parts[2];
  
  const config = {
    pattern,
    workflow,
    inputs: {},
    env: {},
    secrets: []
  };
  
  // Parse remaining arguments
  for (let i = 3; i < parts.length; i++) {
    const arg = parts[i];
    
    if (arg.startsWith('with:')) {
      const [key, value] = arg.substring(5).split('=');
      config.inputs[key] = value;
    } else if (arg.startsWith('env:')) {
      const [key, value] = arg.substring(4).split('=');
      config.env[key] = value;
    } else if (arg.startsWith('secrets:')) {
      const secret = arg.substring(8);
      if (secret === 'inherit') {
        config.secrets = 'inherit';
      } else {
        config.secrets.push(secret);
      }
    }
  }
  
  return config;
}
```

### 3. State Management

Pattern persistence using GitHub API:

```javascript
// Store as issue comment with special marker
async function storePattern(github, config) {
  const marker = '<!-- agentwatch:pattern:v2 -->';
  const data = {
    version: '2.0',
    ...config
  };
  
  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    body: `${marker}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
  });
}

// Retrieve patterns from previous PRs
async function getPatterns(github) {
  const patterns = [];
  // Scan PRs for pattern comments
  const comments = await github.rest.issues.listComments({...});
  
  for (const comment of comments) {
    if (comment.body.includes('<!-- agentwatch:pattern:v2 -->')) {
      const json = comment.body.match(/```json\n(.*?)\n```/s);
      if (json) {
        patterns.push(JSON.parse(json[1]));
      }
    }
  }
  
  return patterns;
}
```

### 4. Workflow Registry

```yaml
# .github/agentwatch/registry.yml
version: '2.0'
agents:
  security:
    workflow: agentwatch/agents/.github/workflows/security.yml@v1
    description: Security vulnerability scanner
    inputs:
      severity:
        type: choice
        options: [low, medium, high, critical]
        default: medium
      auto_fix:
        type: boolean
        default: false
    required_secrets:
      - SECURITY_API_KEY
    
  lint:
    workflow: ./.github/workflows/lint.yml
    description: Code linter and formatter
    inputs:
      fix:
        type: boolean
        default: true
      config:
        type: string
        default: .eslintrc.json
    
  test:
    workflow: ./.github/workflows/test.yml
    description: Test runner
    inputs:
      coverage:
        type: boolean
        default: true
      suite:
        type: choice
        options: [unit, integration, e2e, all]
        default: all
```

### 5. Rate Limits & Performance

- **Workflow Dispatch**: 1000 requests per hour per authenticated user
- **PR Comments**: 30 requests per minute for scanning
- **Mitigation**: 
  - Batch operations where possible
  - Cache pattern lookups
  - Use artifacts for inter-job communication

## Next Steps

1. Build proof of concept with single reusable workflow
2. Create agent registry mechanism
3. Update parser to handle workflow references
4. Migrate existing agents to workflows
5. Document workflow creation process