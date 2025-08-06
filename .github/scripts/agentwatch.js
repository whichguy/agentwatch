#!/usr/bin/env node

/**
 * AgentWatch Core Orchestrator
 * Handles file-level agent tagging and monitoring using GitHub's native features
 */

const fs = require('fs');
const path = require('path');

/**
 * Simple glob pattern matcher (zsh-style)
 * Supports: *, **, ?, [abc], [a-z], {a,b,c}
 */
function matchPattern(pattern, filepath) {
  // If pattern is just *, match everything
  if (pattern === '*') return true;
  
  // Direct file match
  if (pattern === filepath) return true;
  
  // Convert glob pattern to regex
  let regexStr = pattern
    // Escape regex special chars except our glob chars
    .replace(/[.+^${}()|\\]/g, '\\$&')
    // ** matches any number of directories
    .replace(/\*\*/g, '.*')
    // * matches anything except /
    .replace(/\*/g, '[^/]*')
    // ? matches single character
    .replace(/\?/g, '.')
    // [abc] character classes
    .replace(/\[([^\]]+)\]/g, '[$1]')
    // {a,b,c} alternatives
    .replace(/\{([^}]+)\}/g, (match, group) => {
      const options = group.split(',');
      return '(' + options.join('|') + ')';
    });
  
  // Add anchors for full match
  regexStr = '^' + regexStr + '$';
  
  try {
    const regex = new RegExp(regexStr);
    return regex.test(filepath);
  } catch (e) {
    console.log(`Invalid pattern: ${pattern}`);
    return false;
  }
}

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
  
  // Parse standard watch command: @agent-watch [watch-args] <file_pattern> <agent> [@ <agent-args>]
  // Examples: @agent-watch *.js echo @ preview
  //          @agent-watch --persist src/**/*.ts promptexpert @ security --deep
  //          @agent-watch test-*.js lint
  const fullCommand = comment.match(/@agent-watch\s+(.+)/)?.[1] || '';
  
  // Split by @ to separate agentwatch args from agent args
  let watchPart, agentArgs = '';
  if (fullCommand.includes(' @ ')) {
    [watchPart, agentArgs] = fullCommand.split(' @ ', 2);
  } else {
    watchPart = fullCommand;
  }
  
  // Parse the watch part: [options] <pattern> <agent>
  const watchParts = watchPart.trim().split(/\s+/);
  if (watchParts.length < 2) {
    await postError(context, github, 'Invalid @agent-watch command format. Use: @agent-watch [options] <pattern> <agent> [@ <agent-args>]');
    return;
  }
  
  // Extract options, pattern, and agent name
  let watchOptions = '';
  let fileTarget, agentName;
  
  if (watchParts[0].startsWith('--')) {
    watchOptions = watchParts[0];
    fileTarget = watchParts[1];
    agentName = watchParts[2];
  } else {
    fileTarget = watchParts[0];
    agentName = watchParts[1];
    // If no @, remaining parts are agent args
    if (!fullCommand.includes(' @ ') && watchParts.length > 2) {
      agentArgs = watchParts.slice(2).join(' ');
    }
  }
  
  const argsString = agentArgs.trim();
  
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
  
  // Match files against pattern
  let targetFiles = availableFiles.filter(file => matchPattern(fileTarget, file));
  
  if (targetFiles.length > 0) {
    console.log(`Pattern '${fileTarget}' matched ${targetFiles.length} file(s): ${targetFiles.join(', ')}`);
  } else {
    // If no match, check if it might be a future file pattern to watch
    console.log(`Pattern '${fileTarget}' matched no current files, will monitor for future matches`);
    // Still proceed to store the pattern for future PRs
    targetFiles = []; // Will store pattern but not execute now
  }
  
  // Remove check for empty targetFiles - we want to store patterns even if no current matches
  
  try {
    // Launch agent for each target file (labels handled inside launchAgent)
    const results = [];
    if (targetFiles.length > 0) {
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
    }
    
    // 4. Confirm command execution
    let confirmMessage;
    
    if (targetFiles.length > 0) {
      const fileList = targetFiles.length === 1 ? 
        `\`${targetFiles[0]}\`` : 
        `${targetFiles.length} files: ${targetFiles.map(f => `\`${f}\``).join(', ')}`;
      
      confirmMessage = `✅ **AgentWatch: Pattern Registered & Executed**

🎯 **Pattern**: \`${fileTarget}\`
📁 **Matched Files**: ${fileList}
🤖 **Agent**: **${agentName}**
⚙️ **Args**: \`${argsString || 'none'}\`

The agent:
- ✅ **Ran now** on matched files
- 🔄 **Will run** on future files matching this pattern
- 📝 **Will trigger** in future PRs with matching files

**Labels**:
- 🎯 **Running**: \`agentwatch:running\` (while executing)
- ✅ **Completed**: \`agent:seen:${agentName}\` (after success)
- ❌ **Error**: \`agentwatch:error\` (if failed)

To stop watching this pattern, use \`@agent-unwatch ${fileTarget}\`.`;
    } else {
      confirmMessage = `✅ **AgentWatch: Pattern Registered**

🎯 **Pattern**: \`${fileTarget}\`
📁 **Matched Files**: None in this PR
🤖 **Agent**: **${agentName}**
⚙️ **Args**: \`${argsString || 'none'}\`

⚠️ No files currently match this pattern, but the pattern is saved for:
- 🔄 **Future pushes** to this PR that add matching files
- 📝 **Future PRs** with matching files

**Labels** (when triggered):
- 🎯 **Running**: \`agentwatch:running\` (while executing)
- ✅ **Completed**: \`agent:seen:${agentName}\` (after success)
- ❌ **Error**: \`agentwatch:error\` (if failed)

To stop watching this pattern, use \`@agent-unwatch ${fileTarget}\`.`;
    }

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
    const watchPatterns = new Map(); // pattern -> { agent, args, sourcePR, timestamp }
    const unwatchPatterns = new Map(); // agent -> Set of exclude patterns
    
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
          
          // Check for unwatch command: @agent-unwatch <agent> <pattern>
          const unwatchMatch = body.match(/@agent-unwatch\s+(\w+)\s+([^\s]+)/);
          if (unwatchMatch) {
            const [, agentName, pattern] = unwatchMatch;
            
            // Initialize exclude set for this agent if needed
            if (!unwatchPatterns.has(agentName)) {
              unwatchPatterns.set(agentName, new Set());
            }
            
            // Add pattern to agent's exclude list
            unwatchPatterns.get(agentName).add(pattern);
            continue;
          }
          
          // Check for watch command
          const watchMatch = body.match(/@agent-watch\s+([^\s]+)\s+(\w+)\s*(.*)/);
          if (watchMatch) {
            const [, fileTarget, agentName, argsString] = watchMatch;
            
            // Note: Don't skip here - exclusions are checked at execution time
            
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
  
  // Parse unwatch command: @agent-unwatch <pattern>
  const unwatchMatch = comment.match(/@agent-unwatch\s+([^\s]+)/);
  if (!unwatchMatch) {
    await postError(context, github, 'Invalid @agent-unwatch command format. Use: @agent-unwatch <pattern>');
    return;
  }
  
  const fileToUnwatch = unwatchMatch[1];
  const prNumber = context.payload.pull_request?.number || context.payload.issue?.number;
  
  let confirmMessage;
  if (fileToUnwatch === '*') {
    confirmMessage = `✅ **AgentWatch: All Patterns Cleared**

🚫 **Cleared all watch patterns** - No files will be automatically monitored in future PRs.

**Note**: This only affects future PRs. To stop monitoring in the current PR, remove the agentwatch labels.`;
  } else {
    confirmMessage = `✅ **AgentWatch: Pattern Unwatched**

🎯 **Pattern**: \`${fileToUnwatch}\`

Files matching this pattern will no longer be automatically monitored in future PRs.

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
      
      // Skip if file doesn't match the pattern
      if (!matchPattern(fileTarget, comment.path)) continue;
      
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
    const watchPatterns = new Map(); // pattern -> { agent, args }
    const unwatchPatterns = new Map(); // agent -> Set of exclude patterns
    
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
          
          // Check for unwatch command: @agent-unwatch <agent> <pattern>
          const unwatchMatch = body.match(/@agent-unwatch\s+(\w+)\s+([^\s]+)/);
          if (unwatchMatch) {
            const [, agentName, pattern] = unwatchMatch;
            
            // Initialize exclude set for this agent if needed
            if (!unwatchPatterns.has(agentName)) {
              unwatchPatterns.set(agentName, new Set());
            }
            
            // Add pattern to agent's exclude list
            unwatchPatterns.get(agentName).add(pattern);
            console.log(`PR #${pr.number}: Added exclude pattern for ${agentName}: ${pattern}`);
            continue;
          }
          
          // Check for watch command: @agent-watch <file> <agent> <args>
          const watchMatch = body.match(/@agent-watch\s+([^\s]+)\s+(\w+)\s*(.*)/);
          if (watchMatch) {
            const [, fileTarget, agentName, argsString] = watchMatch;
            
            // Note: Don't skip here - exclusions are checked at execution time
            
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
    const processedPatterns = new Set(); // Track which patterns we've processed
    
    // Check each pattern against all files
    for (const [patternStr, pattern] of watchPatterns) {
      const matchingFiles = filesInPR.filter(file => {
        // Check if file matches the include pattern
        if (!matchPattern(patternStr, file)) return false;
        
        // Check if file is excluded for this agent
        if (unwatchPatterns.has(pattern.agent)) {
          const excludePatterns = unwatchPatterns.get(pattern.agent);
          for (const excludePattern of excludePatterns) {
            if (matchPattern(excludePattern, file)) {
              console.log(`File ${file} excluded from ${pattern.agent} by pattern ${excludePattern}`);
              return false;
            }
          }
        }
        
        return true;
      });
      
      for (const file of matchingFiles) {
        // Avoid duplicate processing
        const key = `${file}:${pattern.agent}`;
        if (processedPatterns.has(key)) continue;
        processedPatterns.add(key);
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
        
        executionSummary.push(`- \`${file}\` (pattern: \`${patternStr}\`) → **${pattern.agent}** ${pattern.args} (from PR #${pattern.sourcePR})`)
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
  
  // Label definitions
  const runningLabel = 'agentwatch:running';
  const failedLabel = 'agent:failed';
  const seenLabel = `agent:seen:${agentName}`;
  
  // Add running label at the start
  const targetNumber = context.pr_number || context.issue_number;
  if (targetNumber) {
    try {
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: targetNumber,
        labels: [runningLabel]
      });
      console.log(`Added running label: ${runningLabel}`);
    } catch (labelError) {
      console.log(`Could not add running label: ${labelError.message}`);
    }
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
    
    // Add appropriate completion label
    if (targetNumber) {
      if (agentError) {
        // Add failed label on failure
        try {
          await github.rest.issues.addLabels({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: targetNumber,
            labels: [failedLabel]
          });
          console.log(`Added failed label due to: ${agentError.message}`);
          
          // Post error details as PR comment
          const errorComment = `❌ **Agent Failed: ${agentName}**

**Error**: ${agentError.message}

**Context**:
- File: ${context.file_path || 'N/A'}
- Trigger: ${context.trigger || 'unknown'}

Please check the agent implementation or arguments.`;
          
          await github.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: targetNumber,
            body: errorComment
          });
        } catch (labelError) {
          console.log(`Could not add failed label: ${labelError.message}`);
        }
      } else {
        // Add seen label on success
        try {
          await github.rest.issues.addLabels({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: targetNumber,
            labels: [seenLabel]
          });
          console.log(`Added seen label: ${seenLabel}`);
        } catch (labelError) {
          console.log(`Could not add seen label: ${labelError.message}`);
        }
      }
    }
  }
}

async function postError(context, github, message) {
  const errorMessage = `❌ **AgentWatch Error**

${message}

**Usage**: 
- \`@agent-watch [options] <pattern> <agent> [@ <agent-args>]\`
- \`@agent-unwatch <agent> <pattern>\`
- \`@agent-list\`
- \`@agent-run <agent> [@ <args>]\` (in issues)

**Pattern Examples**:
- \`@agent-watch *.js echo @ lint\` - all .js files with agent args
- \`@agent-watch src/**/*.ts typescript @ check --strict\` - TypeScript files  
- \`@agent-watch test-*.js test\` - files matching test-*.js, no agent args
- \`@agent-watch --persist {app,lib}/*.js lint @ strict\` - with watch options

**Commands**:
- \`@agent-unwatch echo *.js\` - stop echo agent from watching *.js
- \`@agent-unwatch security *\` - exclude all files from security agent
- \`@agent-list\` - list all active patterns and exclusions`;

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

async function handleIssueComment(context, github) {
  console.log('Processing issue comment...');
  const comment = context.payload.comment.body;
  
  // Check for @agent-run command in issues
  if (!comment.includes('@agent-run')) {
    console.log('No @agent-run command found in issue comment');
    return;
  }
  
  // Support @ separator for agent args
  const fullCommand = comment.match(/@agent-run\s+(.+)/)?.[1] || '';
  let agentName, argsString = '';
  
  if (fullCommand.includes(' @ ')) {
    const parts = fullCommand.split(' @ ', 2);
    agentName = parts[0].trim();
    argsString = parts[1].trim();
  } else {
    const match = fullCommand.match(/^(\w+)\s*(.*)/);
    if (!match) {
      await postError(context, github, 'Invalid @agent-run command format. Use: @agent-run <agent> [@ <args>]');
      return;
    }
    [, agentName, argsString] = match;
  }
  
  const issueContext = {
    issue_number: context.payload.issue.number,
    comment_id: context.payload.comment.id,
    agent: agentName,
    args: argsString.trim(),
    repo: {
      owner: context.repo.owner,
      name: context.repo.repo
    },
    trigger: 'issue_command'
  };
  
  console.log(`Launching ${agentName} for issue #${context.payload.issue.number}`);
  await launchAgent(agentName, issueContext, github);
}

async function handleNewIssue(context, github) {
  console.log('New issue detected');
  // Could add auto-agent detection for issues here if needed
}

// Export for GitHub Actions
module.exports = {
  handleAgentWatch,
  handleComment,
  handleWatchList,
  handleUnwatch,
  handleFileChanges,
  handleNewPR,
  handleIssueComment,
  handleNewIssue,
  launchAgent
};