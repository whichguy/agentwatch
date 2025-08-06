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
    if (context.payload.action === 'opened') {
      await handleNewPR(context, github);
    } else if (context.payload.action === 'synchronize') {
      await handleFileChanges(context, github);
    }
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

async function handleNewPR(context, github) {
  console.log('New PR detected - checking for existing AgentWatch configurations...');
  
  try {
    // Get all existing PRs that are closed and look for @agentwatch comments
    // to see what agents were previously used on similar files
    const prs = await github.rest.pulls.list({
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'closed',
      per_page: 50
    });
    
    const watchConfigs = [];
    
    // Look through recent closed PRs for @agentwatch patterns
    for (const pr of prs.data.slice(0, 10)) { // Check last 10 PRs
      try {
        const comments = await github.rest.pulls.listReviewComments({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: pr.number
        });
        
        for (const comment of comments.data) {
          const agentMatch = comment.body.match(/@agentwatch\s+(\w+)\s*(.*)/);
          if (agentMatch) {
            watchConfigs.push({
              file_pattern: comment.path,
              agent: agentMatch[1],
              args: agentMatch[2].trim()
            });
          }
        }
      } catch (err) {
        // Skip errors from individual PRs
        continue;
      }
    }
    
    if (watchConfigs.length === 0) {
      console.log('No previous AgentWatch configurations found - skipping auto mode');
      return;
    }
    
    console.log(`Found ${watchConfigs.length} previous AgentWatch configurations`);
    
    // Get files in the new PR
    const files = await github.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number
    });
    
    let matchedFiles = 0;
    
    // Apply previous configurations to matching files
    for (const file of files.data) {
      for (const config of watchConfigs) {
        // Check if file matches the pattern (exact match or extension match)
        const fileMatches = file.filename === config.file_pattern || 
                           file.filename.endsWith(path.extname(config.file_pattern));
        
        if (fileMatches) {
          matchedFiles++;
          
          const fileContext = {
            file_path: file.filename,
            pr_number: context.payload.pull_request.number,
            comment_id: null, // No specific comment for auto mode
            agent: config.agent,
            args: config.args,
            repo: {
              owner: context.repo.owner,
              name: context.repo.repo
            },
            trigger: 'auto_new_pr'
          };
          
          console.log(`Auto-launching ${config.agent} for: ${file.filename} (matched pattern: ${config.file_pattern})`);
          await launchAgent(config.agent, fileContext, github);
          
          // Add corresponding label
          await github.rest.issues.addLabels({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: context.payload.pull_request.number,
            labels: [`agentwatch:${config.agent}`]
          });
          
          break; // Only apply first matching config per file
        }
      }
    }
    
    if (matchedFiles > 0) {
      // Post summary comment on the PR
      const summary = `🤖 **AgentWatch: Auto-Analysis Based on Previous Configurations**

📊 **Files Analyzed**: ${matchedFiles}
🔍 **Configurations Applied**: Found patterns from previous PRs
🏷️ **Monitoring**: Active (agents will re-run on changes)

These agents were automatically applied based on previous \`@agentwatch\` usage patterns in this repository.

**Manual Commands Available**: Comment \`@agentwatch <agent> <args>\` on any file for custom analysis.`;

      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
        body: summary
      });
    }
    
    console.log(`Automatic PR analysis completed - matched ${matchedFiles} files`);
    
  } catch (error) {
    console.error('Error in handleNewPR:', error);
    
    // Post error comment only if it's a significant error
    if (error.status !== 404) {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
        body: `❌ **AgentWatch Auto-Analysis Error**

Failed to run automatic analysis: ${error.message}

You can still use manual commands: \`@agentwatch <agent> <args>\` on specific files.`
      });
    }
  }
}

async function launchAgent(agentName, context, github) {
  console.log(`Launching agent: ${agentName}`);
  
  try {
    // Try to load agent from agents directory
    const agentPath = `./.github/scripts/agents/${agentName}.js`;
    
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
  handleNewPR,
  launchAgent
};