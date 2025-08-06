#!/usr/bin/env node

/**
 * Echo Agent - Simple test agent for AgentWatch
 * Just echoes back what it saw with rich context information
 */

async function runAgent(context, github) {
  console.log('Echo agent started with context:', JSON.stringify(context, null, 2));
  
  // Get current timestamp
  const timestamp = new Date().toISOString();
  
  // Build response message
  let message = `👋 **Echo Agent Response**

🕒 **Timestamp**: ${timestamp}
📁 **File**: \`${context.file_path}\``;
  
  if (context.line) {
    message += `
📍 **Line**: ${context.line}`;
  }
  
  message += `
🤖 **Agent**: echo
⚙️ **Args**: \`${context.args || 'none'}\``;

  if (context.trigger) {
    message += `
🔄 **Trigger**: ${context.trigger}`;
  }

  // Add context details
  message += `

**Context Details**:
- PR #${context.pr_number}
- Repository: ${context.repo.owner}/${context.repo.name}`;
  
  // Try to get file content for demonstration
  try {
    const fileResponse = await github.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.name,
      path: context.file_path,
      ref: `refs/pull/${context.pr_number}/head`
    });
    
    const fileContent = Buffer.from(fileResponse.data.content, 'base64').toString('utf-8');
    const lineCount = fileContent.split('\n').length;
    
    message += `
- File size: ${fileResponse.data.size} bytes
- Lines: ${lineCount}`;
    
    // Show first few lines if args include 'preview'
    if (context.args && context.args.includes('preview')) {
      const firstLines = fileContent.split('\n').slice(0, 5).join('\n');
      message += `

**File Preview** (first 5 lines):
\`\`\`
${firstLines}
\`\`\``;
    }
    
  } catch (error) {
    message += `
- File content: Unable to read (${error.message})`;
  }
  
  // Add helpful usage examples
  message += `

**Echo Agent Test Examples**:
- \`@agentwatch echo\` - Basic echo
- \`@agentwatch echo preview\` - Show file preview
- \`@agentwatch echo test --verbose\` - Echo with args`;
  
  // Post response (reply to comment or general PR comment)
  if (context.comment_id) {
    // Reply to specific comment
    await github.rest.pulls.createReplyForReviewComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.pr_number,
      comment_id: context.comment_id,
      body: message
    });
  } else {
    // Post general PR comment for auto mode
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.pr_number,
      body: `**${context.file_path}**: ${message}`
    });
  }
  
  console.log('Echo agent completed successfully');
}

module.exports = {
  runAgent
};