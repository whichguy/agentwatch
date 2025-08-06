#!/usr/bin/env node

/**
 * AgentWatch Core Orchestrator
 * Handles file-level agent tagging and monitoring using GitHub's native features
 */

const fs = require('fs');
const path = require('path');

async function handleAgentWatch(context, github) {
  console.log(`AgentWatch triggered by: ${context.eventName}`);
  
  if (context.eventName === 'pull_request_review_comment') {
    await handleComment(context, github);
  } else if (context.eventName === 'issue_comment') {
    // Handle PR-level comments (GitHub treats PR comments as issue comments)
    if (context.payload.issue.pull_request) {
      await handleComment(context, github);
    } else {
      console.log('Ignoring issue comment - AgentWatch only monitors pull requests');
    }
  } else if (context.eventName === 'pull_request') {
    if (context.payload.action === 'opened') {
      await handleNewPR(context, github);
    } else if (context.payload.action === 'synchronize') {
      await handleFileChanges(context, github);
    }
  }
}

async function handleComment(context, github) {
  const comment = context.payload.comment.body;
  
  if (!comment.includes('@agentwatch')) {
    console.log('No @agentwatch mention found in comment');
    return;
  }

  console.log('Processing @agentwatch command...');
  
  // Parse command: @agentwatch <agent> <file_target> <args>
  // Examples: @agentwatch echo fresh-security-test.js preview
  //          @agentwatch promptexpert * security --deep
  const agentMatch = comment.match(/@agentwatch\s+(\w+)\s+([^\s]+)\s*(.*)/);
  if (!agentMatch) {
    await postError(context, github, 'Invalid @agentwatch command format. Use: @agentwatch <agent> <file|*> <args>');
    return;
  }
  
  const [, agentName, fileTarget, argsString] = agentMatch;
  
  // Get PR number from either pull request or issue context
  const prNumber = context.payload.pull_request?.number || context.payload.issue?.number;
  
  // Get files in the PR to validate file targets
  const files = await github.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber
  });
  
  const availableFiles = files.data.map(f => f.filename);
  console.log(`Available files in PR: ${availableFiles.join(', ')}`);
  
  // Determine target files based on fileTarget parameter
  let targetFiles = [];
  if (fileTarget === '*') {
    targetFiles = availableFiles;
    console.log('Targeting ALL files in PR');
  } else {
    // Check if specified file exists in PR
    if (availableFiles.includes(fileTarget)) {
      targetFiles = [fileTarget];
      console.log(`Targeting specific file: ${fileTarget}`);
    } else {
      await postError(context, github, `File "${fileTarget}" not found in PR. Available files: ${availableFiles.join(', ')}`);
      return;
    }
  }
  
  if (targetFiles.length === 0) {
    await postError(context, github, 'No files to analyze in this PR');
    return;
  }
  
  try {
    // 1. Add label to PR
    const labelName = `agentwatch:${agentName}`;
    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      labels: [labelName]
    });
    console.log(`Added label: ${labelName}`);
    
    // 2. Launch agent for each target file
    const results = [];
    for (const targetFile of targetFiles) {
      const fileContext = {
        file_path: targetFile,
        pr_number: prNumber,
        comment_id: context.payload.comment.id,
        agent: agentName,
        args: argsString.trim(),
        repo: {
          owner: context.repo.owner,
          name: context.repo.repo
        },
        trigger: 'manual_command'
      };
      
      console.log(`Launching ${agentName} for file: ${targetFile}`);
      await launchAgent(agentName, fileContext, github);
      results.push(targetFile);
    }
    
    // 3. Confirm command execution
    const fileList = targetFiles.length === 1 ? 
      `\`${targetFiles[0]}\`` : 
      `${targetFiles.length} files: ${targetFiles.map(f => `\`${f}\``).join(', ')}`;
    
    const confirmMessage = `✅ **AgentWatch: Command Executed**

📁 **Files**: ${fileList}
🤖 **Agent**: **${agentName}**
⚙️ **Args**: \`${argsString.trim() || 'none'}\`

The agent is now monitoring these files and will run:
- ✅ **Immediately** (running now)
- 🔄 **On changes** (future pushes)

To stop watching, remove the \`${labelName}\` label from this PR.`;

    // Post response as PR comment or reply depending on context
    if (context.payload.comment.pull_request_review_id) {
      // File-level review comment - reply to it
      await github.rest.pulls.createReplyForReviewComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: prNumber,
        comment_id: context.payload.comment.id,
        body: confirmMessage
      });
    } else {
      // PR-level comment - post new PR comment
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: confirmMessage
      });
    }
    
    console.log(`AgentWatch command completed successfully for ${results.length} files`);
    
  } catch (error) {
    console.error('Error in handleComment:', error);
    await postError(context, github, `Failed to execute AgentWatch command: ${error.message}`);
  }
}

async function handleFileChanges(context, github) {
  console.log('Checking for file changes in watched PR...');
  
  // Get PR labels
  const labels = context.payload.pull_request.labels.map(l => l.name);
  const agentLabels = labels.filter(l => l.startsWith('agentwatch:'));
  
  if (agentLabels.length === 0) {
    console.log('No agentwatch labels found on this PR');
    return;
  }
  
  console.log(`Found agentwatch labels: ${agentLabels.join(', ')}`);
  
  try {
    // Get changed files in this push
    const files = await github.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number
    });
    
    const changedFiles = files.data.map(f => f.filename);
    console.log(`Changed files: ${changedFiles.join(', ')}`);
    
    // Get all review comments to find watch commands IN THIS PR
    const comments = await github.rest.pulls.listReviewComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number
    });
    
    // Only monitor files that have @agentwatch comments IN THIS PR
    const watchComments = comments.data.filter(c => 
      c.body.includes('@agentwatch') && 
      changedFiles.includes(c.path)
    );
    
    console.log(`Found ${watchComments.length} watch comments for changed files`);
    
    // Launch agents for watched files that changed
    for (const comment of watchComments) {
      const agentMatch = comment.body.match(/@agentwatch\s+(\w+)\s*(.*)/);
      if (!agentMatch) continue;
      
      const [, agentName, argsString] = agentMatch;
      
      const fileContext = {
        file_path: comment.path,
        pr_number: context.payload.pull_request.number,
        comment_id: comment.id,
        agent: agentName,
        args: argsString.trim(),
        repo: {
          owner: context.repo.owner,
          name: context.repo.repo
        },
        trigger: 'file_change'
      };
      
      console.log(`Launching ${agentName} for changed file: ${comment.path}`);
      await launchAgent(agentName, fileContext, github);
    }
    
  } catch (error) {
    console.error('Error in handleFileChanges:', error);
  }
}

async function handleNewPR(context, github) {
  console.log('New PR detected - skipping automatic analysis (manual-only mode)');
  
  // In manual-only mode, new PRs don't trigger automatic analysis
  // Users must manually add @agentwatch comments to files they want analyzed
  
  console.log('AgentWatch is ready for manual commands: @agentwatch <agent> <args>');
}

async function launchAgent(agentName, context, github) {
  console.log(`Launching agent: ${agentName}`);
  
  try {
    // Try to load agent from agents directory
    const agentPath = path.join(__dirname, 'agents', `${agentName}.js`);
    
    if (fs.existsSync(agentPath)) {
      console.log(`Loading agent from: ${agentPath}`);
      const agent = require(agentPath);
      
      if (typeof agent.runAgent === 'function') {
        await agent.runAgent(context, github);
        console.log(`Agent ${agentName} completed successfully`);
      } else {
        throw new Error(`Agent ${agentName} does not export a runAgent function`);
      }
    } else {
      throw new Error(`Agent ${agentName} not found at ${agentPath}`);
    }
    
  } catch (error) {
    console.error(`Failed to launch agent ${agentName}:`, error);
    
    // Post error as reply to original comment
    const errorMessage = `❌ **AgentWatch Error**

Failed to run agent **${agentName}**: ${error.message}

**Available agents**: Check \`.github/scripts/agents/\` directory`;

    try {
      if (context.comment_id) {
        // Reply to specific comment
        await github.rest.pulls.createReplyForReviewComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: context.pr_number,
          comment_id: context.comment_id,
          body: errorMessage
        });
      } else {
        // Post general PR comment for auto mode
        await github.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.pr_number,
          body: `**${context.file_path}**: ${errorMessage}`
        });
      }
    } catch (replyError) {
      console.error('Failed to post error reply:', replyError);
    }
  }
}

async function postError(context, github, message) {
  const errorMessage = `❌ **AgentWatch Error**

${message}

**Usage**: \`@agentwatch <agent> <file|*> <args>\`
**Examples**:
- \`@agentwatch echo fresh-security-test.js preview\` - analyze specific file
- \`@agentwatch promptexpert * security --deep\` - analyze all files in PR
- \`@agentwatch lint src/utils.js\` - lint specific file`;

  try {
    const prNumber = context.payload.pull_request?.number || context.payload.issue?.number;
    
    if (context.payload.comment.pull_request_review_id) {
      // File-level review comment - reply to it
      await github.rest.pulls.createReplyForReviewComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: prNumber,
        comment_id: context.payload.comment.id,
        body: errorMessage
      });
    } else {
      // PR-level comment - post new PR comment
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: errorMessage
      });
    }
  } catch (error) {
    console.error('Failed to post error message:', error);
  }
}

// Export for GitHub Actions
module.exports = {
  handleAgentWatch,
  handleComment,
  handleFileChanges,
  handleNewPR,
  launchAgent
};