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
    await handleFileTag(context, github);
  } else if (context.eventName === 'pull_request') {
    await handleFileChanges(context, github);
  }
}

async function handleFileTag(context, github) {
  const comment = context.payload.comment.body;
  
  if (!comment.includes('@agentwatch')) {
    console.log('No @agentwatch mention found in comment');
    return;
  }

  console.log('Processing @agentwatch file tag...');
  
  // Parse command: @agentwatch promptexpert security --deep
  const agentMatch = comment.match(/@agentwatch\s+(\w+)\s*(.*)/);
  if (!agentMatch) {
    await postError(context, github, 'Invalid @agentwatch command format. Use: @agentwatch <agent> <args>');
    return;
  }
  
  const [, agentName, argsString] = agentMatch;
  
  const fileContext = {
    file_path: context.payload.comment.path,
    line: context.payload.comment.line,
    pr_number: context.payload.pull_request.number,
    comment_id: context.payload.comment.id,
    agent: agentName,
    args: argsString.trim(),
    repo: {
      owner: context.repo.owner,
      name: context.repo.repo
    }
  };
  
  console.log('File context:', JSON.stringify(fileContext, null, 2));
  
  try {
    // 1. Add label to PR
    const labelName = `agentwatch:${agentName}`;
    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.payload.pull_request.number,
      labels: [labelName]
    });
    console.log(`Added label: ${labelName}`);
    
    // 2. Launch agent immediately
    await launchAgent(agentName, fileContext, github);
    
    // 3. Confirm tagging
    const confirmMessage = `✅ **AgentWatch: File Tagged**

📁 **File**: \`${fileContext.file_path}\`
🤖 **Agent**: **${agentName}**
⚙️ **Args**: \`${fileContext.args || 'none'}\`

This file is now being watched. The agent will run:
- ✅ **Immediately** (running now)
- 🔄 **On changes** (future pushes)

To stop watching, remove the \`${labelName}\` label from this PR.`;

    await github.rest.pulls.createReplyForReviewComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      comment_id: context.payload.comment.id,
      body: confirmMessage
    });
    
    console.log('File tagging completed successfully');
    
  } catch (error) {
    console.error('Error in handleFileTag:', error);
    await postError(context, github, `Failed to tag file: ${error.message}`);
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
    
    // Get all review comments to find watch commands
    const comments = await github.rest.pulls.listReviewComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number
    });
    
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
      await github.rest.pulls.createReplyForReviewComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.pr_number,
        comment_id: context.comment_id,
        body: errorMessage
      });
    } catch (replyError) {
      console.error('Failed to post error reply:', replyError);
    }
  }
}

async function postError(context, github, message) {
  const errorMessage = `❌ **AgentWatch Error**

${message}

**Usage**: \`@agentwatch <agent> <args>\`
**Examples**:
- \`@agentwatch echo hello world\`
- \`@agentwatch promptexpert security --deep\``;

  try {
    await github.rest.pulls.createReplyForReviewComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      comment_id: context.payload.comment.id,
      body: errorMessage
    });
  } catch (error) {
    console.error('Failed to post error message:', error);
  }
}

// Export for GitHub Actions
module.exports = {
  handleAgentWatch,
  handleFileTag,
  handleFileChanges,
  launchAgent
};