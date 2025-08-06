#!/usr/bin/env node

/**
 * PromptExpert Agent - AgentWatch adapter for PromptExpert
 * Wraps the existing PromptExpert functionality for file-level analysis
 */

const fs = require('fs');
const {
  getFileContent,
  getPRContext,
  parseArgs,
  postReply,
  formatSuccessMessage,
  formatErrorMessage
} = require('../agent-helpers.js');

async function runAgent(context, github) {
  console.log('PromptExpert agent started');
  
  try {
    // Parse arguments
    const { positional, flags } = parseArgs(context.args);
    const domain = positional[0] || 'general';
    
    console.log(`PromptExpert domain: ${domain}, flags:`, flags);
    
    // Get file content
    const fileContent = await getFileContent(
      context.file_path, 
      context.pr_number, 
      github, 
      context.repo
    );
    
    // Get PR context for additional analysis
    const prContext = await getPRContext(context.pr_number, github, context.repo);
    
    // Run PromptExpert analysis
    const result = await runPromptExpertAnalysis(fileContent, domain, flags, prContext, context);
    
    // Format and post response
    let message;
    if (result.success) {
      message = formatSuccessMessage(
        'PromptExpert',
        result.summary,
        result.details
      );
    } else {
      message = formatErrorMessage('PromptExpert', result.error);
    }
    
    await postReply(context, github, message);
    
    console.log('PromptExpert agent completed successfully');
    
  } catch (error) {
    console.error('PromptExpert agent error:', error);
    
    const errorMessage = formatErrorMessage(
      'PromptExpert', 
      `Analysis failed: ${error.message}`
    );
    
    await postReply(context, github, errorMessage);
  }
}

async function runPromptExpertAnalysis(fileContent, domain, flags, prContext, context) {
  try {
    // Use dynamic imports for ES modules (matching existing pattern)
    const { Anthropic } = await import('@anthropic-ai/sdk');
    
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    
    // Load expert definition (matching existing promptexpert pattern)
    let expertContent;
    try {
      const expertUrl = `https://raw.githubusercontent.com/whichguy/prompt-expert-bank/main/expert-definitions/${domain}-expert.md`;
      const expertResponse = await fetch(expertUrl);
      
      if (expertResponse.ok) {
        expertContent = await expertResponse.text();
        console.log(`Successfully loaded ${domain} expert definition`);
      } else {
        console.log(`Could not fetch expert definition from ${expertUrl}, using fallback`);
        expertContent = `You are a ${domain} expert providing analysis and guidance.`;
      }
    } catch (err) {
      console.log(`Error fetching expert definition: ${err.message}, using fallback`);
      expertContent = `You are a ${domain} expert providing analysis and guidance.`;
    }
    
    // Build analysis prompt
    const analysisPrompt = `${expertContent}

You are analyzing a specific file in a Pull Request through AgentWatch. Please provide a focused analysis of this file.

**File Context:**
- File: ${context.file_path}
- PR: #${context.pr_number} - ${prContext.pr.title}
- Repository: ${context.repo.owner}/${context.repo.name}

**File Content:**
\`\`\`
${fileContent}
\`\`\`

**Analysis Request:**
${flags.suggest ? `Please provide suggestions: ${flags.suggest}` : `Please analyze this file for ${domain} concerns.`}

**Instructions:**
1. Focus specifically on this file (not the entire PR)
2. Provide actionable feedback
3. Highlight specific issues with line references where applicable
4. Keep your response concise but thorough
${flags.deep ? '5. Perform deep analysis including edge cases and security implications' : ''}

Please provide your analysis in a clear, structured format.`;

    console.log('Sending request to Anthropic...');
    
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: analysisPrompt
      }]
    });
    
    const analysis = response.content[0].text;
    
    // Format response for GitHub
    const summary = `File analysis completed for **${domain}** domain`;
    const details = `**File**: \`${context.file_path}\`
**Domain**: ${domain}
${flags.deep ? '**Analysis Mode**: Deep\n' : ''}
${Object.keys(flags).length > 0 ? `**Flags**: ${Object.keys(flags).map(f => `--${f}`).join(', ')}\n` : ''}

---

${analysis}`;
    
    return {
      success: true,
      summary,
      details
    };
    
  } catch (error) {
    console.error('PromptExpert analysis failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  runAgent
};