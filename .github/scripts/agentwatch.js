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
  
  if (!comment.includes('@agent-')) {
    console.log('No @agent- command found in comment');
    return;
  }

  console.log('Processing @agent- command...');
  
  // Check for @agent-unwatch command
  if (comment.includes('@agent-unwatch')) {
    return handleUnwatch(context, github);
  }
  
  // Check for @agent-list command
  if (comment.includes('@agent-list')) {
    return handleWatchList(context, github);
  }
  
  // Parse standard watch command: @agent-watch <file_target> <agent> <args>
  // Examples: @agent-watch fresh-security-test.js echo preview
  //          @agent-watch * promptexpert security --deep
  const agentMatch = comment.match(/@agent-watch\s+([^\s]+)\s+(\w+)\s*(.*)/);
  if (!agentMatch) {
    await postError(context, github, 'Invalid @agent-watch command format. Use: @agent-watch <file|*> <agent> <args>');
    return;
  }
  
  const [, fileTarget, agentName, argsString] = agentMatch;
  
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
    // Launch agent for each target file (labels handled inside launchAgent)
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
    
    // 4. Confirm command execution
    const fileList = targetFiles.length === 1 ? 
      `\`${targetFiles[0]}\`` : 
      `${targetFiles.length} files: ${targetFiles.map(f => `\`${f}\``).join(', ')}`;
    
    const agentLabel = `agentwatch:${agentName}`;
    const confirmMessage = `✅ **AgentWatch: Command Executed**

📁 **Files**: ${fileList}
🤖 **Agent**: **${agentName}**
⚙️ **Args**: \`${argsString.trim() || 'none'}\`

The agent is now monitoring these files and will run:
- ✅ **Immediately** (running now)
- 🔄 **On changes** (future pushes)

To stop watching in this PR, remove the \`${agentLabel}\` label.
To stop watching in future PRs, use \`@agent-unwatch ${targetFiles.length === 1 ? targetFiles[0] : '*'}\`.`;

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

async function handleWatchList(context, github) {
  console.log('Processing @agent-list command...');
  const prNumber = context.payload.pull_request?.number || context.payload.issue?.number;
  
  try {
    // Scan all PRs to build current watch list
    const [openPRs, closedPRs] = await Promise.all([
      github.rest.pulls.list({
        owner: context.repo.owner,
        repo: context.repo.repo,
        state: 'open',
        per_page: 50
      }),
      github.rest.pulls.list({
        owner: context.repo.owner,
        repo: context.repo.repo,
        state: 'closed',
        per_page: 50
      })
    ]);
    
    const allPRs = [...openPRs.data, ...closedPRs.data];
    const watchPatterns = new Map(); // file -> { agent, args, sourcePR, timestamp }
    const unwatchPatterns = new Set(); // files that have been unwatched
    
    // Scan all PRs for @agentwatch patterns
    for (const pr of allPRs) {
      try {
        // Get all comments (both PR and review comments)
        const [issueComments, reviewComments] = await Promise.all([
          github.rest.issues.listComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: pr.number
          }),
          github.rest.pulls.listReviewComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: pr.number
          })
        ]);
        
        const allComments = [
          ...issueComments.data.map(c => ({ ...c, type: 'issue' })),
          ...reviewComments.data.map(c => ({ ...c, type: 'review' }))
        ];
        
        // Process comments chronologically
        allComments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        for (const comment of allComments) {
          const body = comment.body;
          
          // Check for unwatch command
          const unwatchMatch = body.match(/@agent-unwatch\s+([^\s]+)/);
          if (unwatchMatch) {
            const fileToUnwatch = unwatchMatch[1];
            if (fileToUnwatch === '*') {
              watchPatterns.clear();
            } else {
              watchPatterns.delete(fileToUnwatch);
              unwatchPatterns.add(fileToUnwatch);
            }
            continue;
          }
          
          // Check for watch command
          const watchMatch = body.match(/@agent-watch\s+([^\s]+)\s+(\w+)\s*(.*)/);
          if (watchMatch) {
            const [, fileTarget, agentName, argsString] = watchMatch;
            
            // Skip if this file was unwatched
            if (unwatchPatterns.has(fileTarget)) continue;
            
            // Store the pattern (most recent pattern wins)
            watchPatterns.set(fileTarget, {
              agent: agentName,
              args: argsString.trim(),
              sourcePR: pr.number,
              timestamp: comment.created_at,
              author: comment.user.login
            });
          }
        }
      } catch (err) {
        console.log(`Skipping PR #${pr.number} due to error: ${err.message}`);
        continue;
      }
    }
    
    // Format the watch list
    let listMessage = '📋 **AgentWatch List**\n\n';
    
    if (watchPatterns.size === 0) {
      listMessage += '🔍 No files are currently being watched.\n\n';
      listMessage += 'To start watching files, use:\n';
      listMessage += '`@agent-watch <file|*> <agent> <args>`';
    } else {
      listMessage += `Currently watching **${watchPatterns.size} file(s)**:\n\n`;
      listMessage += '| File | Agent | Args | Source | Set By | When |\n';
      listMessage += '|------|-------|------|--------|--------|------|\n';
      
      // Sort by file name for consistent display
      const sortedEntries = Array.from(watchPatterns.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      
      for (const [file, pattern] of sortedEntries) {
        const timestamp = new Date(pattern.timestamp).toISOString().split('T')[0];
        listMessage += `| \`${file}\` | **${pattern.agent}** | \`${pattern.args || 'none'}\` | PR #${pattern.sourcePR} | @${pattern.author} | ${timestamp} |\n`;
      }
      
      listMessage += '\n**Commands:**\n';
      listMessage += '- `@agent-unwatch <file>` - Stop watching a specific file\n';
      listMessage += '- `@agent-unwatch *` - Stop watching all files\n';
      listMessage += '- `@agent-watch <file|*> <agent> <args>` - Start watching file(s)';
    }
    
    // Post the list
    if (context.payload.comment.pull_request_review_id) {
      await github.rest.pulls.createReplyForReviewComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: prNumber,
        comment_id: context.payload.comment.id,
        body: listMessage
      });
    } else {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: listMessage
      });
    }
    
    console.log(`Listed ${watchPatterns.size} watched files`);
    
  } catch (error) {
    console.error('Error in handleWatchList:', error);
    await postError(context, github, `Failed to generate watch list: ${error.message}`);
  }
}

async function handleUnwatch(context, github) {
  const comment = context.payload.comment.body;
  console.log('Processing @agent-unwatch command...');
  
  // Parse unwatch command: @agent-unwatch <file>
  const unwatchMatch = comment.match(/@agent-unwatch\s+([^\s]+)/);
  if (!unwatchMatch) {
    await postError(context, github, 'Invalid @agent-unwatch command format. Use: @agent-unwatch <file|*>');
    return;
  }
  
  const fileToUnwatch = unwatchMatch[1];
  const prNumber = context.payload.pull_request?.number || context.payload.issue?.number;
  
  let confirmMessage;
  if (fileToUnwatch === '*') {
    confirmMessage = `✅ **AgentWatch: All Files Unwatched**

🚫 **Cleared all watch patterns** - No files will be automatically monitored in future PRs.

**Note**: This only affects future PRs. To stop monitoring in the current PR, remove the agentwatch labels.`;
  } else {
    confirmMessage = `✅ **AgentWatch: File Unwatched**

📁 **File**: \`${fileToUnwatch}\`

This file will no longer be automatically monitored in future PRs.

**Note**: This only affects future PRs. To stop monitoring in the current PR, remove the agentwatch labels.`;
  }

  // Post confirmation
  if (context.payload.comment.pull_request_review_id) {
    await github.rest.pulls.createReplyForReviewComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
      comment_id: context.payload.comment.id,
      body: confirmMessage
    });
  } else {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: confirmMessage
    });
  }
  
  console.log(`Unwatched file: ${fileToUnwatch}`);
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
    
    // Only monitor files that have @agent-watch comments IN THIS PR
    const watchComments = comments.data.filter(c => 
      c.body.includes('@agent-watch') && 
      changedFiles.includes(c.path)
    );
    
    console.log(`Found ${watchComments.length} watch comments for changed files`);
    
    // Launch agents for watched files that changed
    for (const comment of watchComments) {
      const agentMatch = comment.body.match(/@agent-watch\s+([^\s]+)\s+(\w+)\s*(.*)/);
      if (!agentMatch) continue;
      
      const [, fileTarget, agentName, argsString] = agentMatch;
      
      // Skip if file doesn't match the target
      if (fileTarget !== '*' && fileTarget !== comment.path) continue;
      
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
  console.log('New PR detected - checking for existing AgentWatch patterns...');
  
  try {
    // Get files in the new PR
    const prFiles = await github.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number
    });
    
    const filesInPR = prFiles.data.map(f => f.filename);
    console.log(`Files in new PR: ${filesInPR.join(', ')}`);
    
    // Look for existing @agentwatch patterns in ALL previous PRs
    const [openPRs, closedPRs] = await Promise.all([
      github.rest.pulls.list({
        owner: context.repo.owner,
        repo: context.repo.repo,
        state: 'open',
        per_page: 50
      }),
      github.rest.pulls.list({
        owner: context.repo.owner,
        repo: context.repo.repo,
        state: 'closed',
        per_page: 50
      })
    ]);
    
    const allPRs = [...openPRs.data, ...closedPRs.data];
    const watchPatterns = new Map(); // file -> { agent, args }
    const unwatchPatterns = new Set(); // files that have been unwatched
    
    // Scan all PRs for @agentwatch patterns
    for (const pr of allPRs) {
      if (pr.number === context.payload.pull_request.number) continue; // Skip current PR
      
      try {
        // Get all comments (both PR and review comments)
        const [issueComments, reviewComments] = await Promise.all([
          github.rest.issues.listComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: pr.number
          }),
          github.rest.pulls.listReviewComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: pr.number
          })
        ]);
        
        const allComments = [
          ...issueComments.data.map(c => ({ ...c, type: 'issue' })),
          ...reviewComments.data.map(c => ({ ...c, type: 'review' }))
        ];
        
        // Process comments chronologically
        allComments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        for (const comment of allComments) {
          const body = comment.body;
          
          // Check for unwatch command: @agent-unwatch <file>
          const unwatchMatch = body.match(/@agent-unwatch\s+([^\s]+)/);
          if (unwatchMatch) {
            const fileToUnwatch = unwatchMatch[1];
            if (fileToUnwatch === '*') {
              // Unwatch all files
              watchPatterns.clear();
              console.log(`PR #${pr.number}: Unwatched all files`);
            } else {
              // Unwatch specific file
              watchPatterns.delete(fileToUnwatch);
              unwatchPatterns.add(fileToUnwatch);
              console.log(`PR #${pr.number}: Unwatched ${fileToUnwatch}`);
            }
            continue;
          }
          
          // Check for watch command: @agent-watch <file> <agent> <args>
          const watchMatch = body.match(/@agent-watch\s+([^\s]+)\s+(\w+)\s*(.*)/);
          if (watchMatch) {
            const [, fileTarget, agentName, argsString] = watchMatch;
            
            // Skip if this file was unwatched
            if (unwatchPatterns.has(fileTarget)) continue;
            
            // Store the pattern (most recent pattern wins)
            watchPatterns.set(fileTarget, {
              agent: agentName,
              args: argsString.trim(),
              sourcePR: pr.number
            });
            console.log(`PR #${pr.number}: Found pattern for ${fileTarget} -> ${agentName}`);
          }
        }
      } catch (err) {
        console.log(`Skipping PR #${pr.number} due to error: ${err.message}`);
        continue;
      }
    }
    
    if (watchPatterns.size === 0) {
      console.log('No active watch patterns found');
      console.log('AgentWatch is ready for manual commands: @agent-watch <file|*> <agent> <args>');
      return;
    }
    
    console.log(`Found ${watchPatterns.size} active watch patterns`);
    
    // Apply patterns to files in the new PR
    let matchedFiles = 0;
    const executionSummary = [];
    
    for (const file of filesInPR) {
      if (watchPatterns.has(file)) {
        const pattern = watchPatterns.get(file);
        matchedFiles++;
        
        const fileContext = {
          file_path: file,
          pr_number: context.payload.pull_request.number,
          comment_id: null,
          agent: pattern.agent,
          args: pattern.args,
          repo: {
            owner: context.repo.owner,
            name: context.repo.repo
          },
          trigger: 'auto_pattern_match'
        };
        
        console.log(`Auto-launching ${pattern.agent} for ${file} (pattern from PR #${pattern.sourcePR})`);
        
        // Labels are handled inside launchAgent for consistency
        await launchAgent(pattern.agent, fileContext, github);
        
        executionSummary.push(`- \`${file}\` → **${pattern.agent}** ${pattern.args} (from PR #${pattern.sourcePR})`)
      }
    }
    
    if (matchedFiles > 0) {
      // Post summary comment
      const summaryMessage = `🤖 **AgentWatch: Automatic Pattern Detection**

Found and applied ${matchedFiles} watch pattern(s) from previous PRs:

${executionSummary.join('\n')}

**To stop watching a file**, comment:
- \`@agent-unwatch <filename>\` - Stop watching specific file
- \`@agent-unwatch *\` - Stop watching all files

**To add new watches**, comment:
- \`@agent-watch <file|*> <agent> <args>\` - Watch file(s) with agent`;

      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
        body: summaryMessage
      });
    } else {
      console.log('No matching files found for existing patterns');
      console.log('AgentWatch is ready for manual commands: @agent-watch <file|*> <agent> <args>');
    }
    
  } catch (error) {
    console.error('Error in handleNewPR:', error);
    
    // Post error comment
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.payload.pull_request.number,
      body: `❌ **AgentWatch Error**

Failed to check patterns: ${error.message}

You can still use manual commands: \`@agent-watch <file|*> <agent> <args>\``
    });
  }
}

async function launchAgent(agentName, context, github) {
  console.log(`Launching agent: ${agentName}`);
  
  // Add running label at the start
  const runningLabel = 'agentwatch:running';
  const errorLabel = 'agentwatch:error';
  const agentLabel = `agentwatch:${agentName}`;
  
  // Add running and agent labels
  try {
    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.pr_number,
      labels: [agentLabel, runningLabel]
    });
    console.log(`Added labels: ${agentLabel}, ${runningLabel}`);
  } catch (labelError) {
    console.log(`Could not add labels: ${labelError.message}`);
  }
  
  let agentError = null;
  
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
    agentError = error;
    console.error(`Failed to launch agent ${agentName}:`, error);
    
    // Post error as reply to original comment
    const errorMessage = `❌ **AgentWatch Error**

Failed to run agent **${agentName}**: ${agentError.message}

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
  } finally {
    // Always remove running label and add error label if needed
    try {
      await github.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.pr_number,
        name: runningLabel
      });
      console.log(`Removed running label`);
    } catch (labelError) {
      console.log(`Could not remove running label: ${labelError.message}`);
    }
    
    // Add error label if there was an error
    if (agentError) {
      try {
        await github.rest.issues.addLabels({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.pr_number,
          labels: [errorLabel]
        });
        console.log(`Added error label due to: ${agentError.message}`);
      } catch (labelError) {
        console.log(`Could not add error label: ${labelError.message}`);
      }
    }
  }
}

async function postError(context, github, message) {
  const errorMessage = `❌ **AgentWatch Error**

${message}

**Usage**: \`@agent-watch <file|*> <agent> <args>\` or \`@agent-unwatch <file|*>\` or \`@agent-list\`
**Examples**:
- \`@agent-watch fresh-security-test.js echo preview\` - analyze specific file
- \`@agent-watch * promptexpert security --deep\` - analyze all files in PR
- \`@agent-unwatch pattern-test-file.js\` - stop watching specific file
- \`@agent-unwatch *\` - stop watching all files
- \`@agent-list\` - list all currently watched files`;

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
  handleWatchList,
  handleUnwatch,
  handleFileChanges,
  handleNewPR,
  launchAgent
};