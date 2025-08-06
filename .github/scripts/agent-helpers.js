#!/usr/bin/env node

/**
 * AgentWatch Helper Utilities
 * Common functions to make agent development easier
 */

/**
 * Get file content from PR
 */
async function getFileContent(filePath, prNumber, github, repo) {
  try {
    const fileResponse = await github.rest.repos.getContent({
      owner: repo.owner,
      repo: repo.name,
      path: filePath,
      ref: `refs/pull/${prNumber}/head`
    });
    
    return Buffer.from(fileResponse.data.content, 'base64').toString('utf-8');
  } catch (error) {
    throw new Error(`Unable to read file ${filePath}: ${error.message}`);
  }
}

/**
 * Get PR context information
 */
async function getPRContext(prNumber, github, repo) {
  try {
    const [pr, files, comments] = await Promise.all([
      github.rest.pulls.get({
        owner: repo.owner,
        repo: repo.name,
        pull_number: prNumber
      }),
      github.rest.pulls.listFiles({
        owner: repo.owner,
        repo: repo.name,
        pull_number: prNumber
      }),
      github.rest.issues.listComments({
        owner: repo.owner,
        repo: repo.name,
        issue_number: prNumber
      })
    ]);
    
    return {
      pr: {
        title: pr.data.title,
        body: pr.data.body,
        state: pr.data.state,
        author: pr.data.user.login,
        created_at: pr.data.created_at,
        updated_at: pr.data.updated_at,
        base_branch: pr.data.base.ref,
        head_branch: pr.data.head.ref
      },
      files: files.data.map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes
      })),
      comments: comments.data.map(c => ({
        author: c.user.login,
        body: c.body,
        created_at: c.created_at
      }))
    };
  } catch (error) {
    throw new Error(`Unable to get PR context: ${error.message}`);
  }
}

/**
 * Parse command line style arguments
 */
function parseArgs(argsString) {
  if (!argsString || !argsString.trim()) {
    return { positional: [], flags: {} };
  }
  
  const args = argsString.trim().split(/\s+/);
  const positional = [];
  const flags = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      // Long flag: --flag value or --flag
      const flagName = arg.substring(2);
      
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        // Has value
        flags[flagName] = args[i + 1];
        i++; // Skip next argument
      } else {
        // Boolean flag
        flags[flagName] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Short flag: -f value or -f
      const flagName = arg.substring(1);
      
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        // Has value
        flags[flagName] = args[i + 1];
        i++; // Skip next argument
      } else {
        // Boolean flag
        flags[flagName] = true;
      }
    } else {
      // Positional argument
      positional.push(arg);
    }
  }
  
  return { positional, flags };
}

/**
 * Post a threaded reply to the original AgentWatch comment
 */
async function postReply(context, github, message) {
  await github.rest.pulls.createReplyForReviewComment({
    owner: context.repo.owner,
    repo: context.repo.name,
    pull_number: context.pr_number,
    comment_id: context.comment_id,
    body: message
  });
}

/**
 * Post a general comment to the PR
 */
async function postPRComment(context, github, message) {
  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.name,
    issue_number: context.pr_number,
    body: message
  });
}

/**
 * Create a standardized success message
 */
function formatSuccessMessage(agentName, summary, details = null) {
  let message = `✅ **${agentName} Results**

${summary}`;

  if (details) {
    message += `

${details}`;
  }
  
  message += `

---
*Powered by AgentWatch*`;
  
  return message;
}

/**
 * Create a standardized error message
 */
function formatErrorMessage(agentName, error) {
  return `❌ **${agentName} Error**

${error}

---
*Powered by AgentWatch*`;
}

/**
 * Get changed lines for a specific file in the PR
 */
async function getChangedLines(filePath, prNumber, github, repo) {
  try {
    const files = await github.rest.pulls.listFiles({
      owner: repo.owner,
      repo: repo.name,
      pull_number: prNumber
    });
    
    const file = files.data.find(f => f.filename === filePath);
    if (!file || !file.patch) {
      return null;
    }
    
    // Parse patch to extract changed line numbers
    const changedLines = [];
    const lines = file.patch.split('\n');
    let currentLine = 0;
    
    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -1,4 +1,6 @@
        const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
        if (match) {
          currentLine = parseInt(match[1]);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        changedLines.push(currentLine);
        currentLine++;
      } else if (line.startsWith(' ')) {
        currentLine++;
      }
      // Lines starting with '-' don't increment current line
    }
    
    return changedLines;
  } catch (error) {
    console.error(`Unable to get changed lines for ${filePath}:`, error);
    return null;
  }
}

module.exports = {
  getFileContent,
  getPRContext,
  parseArgs,
  postReply,
  postPRComment,
  formatSuccessMessage,
  formatErrorMessage,
  getChangedLines
};