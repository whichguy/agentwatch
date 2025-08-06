#!/usr/bin/env node

/**
 * Lint Agent - Simple code quality checker for AgentWatch
 * Provides basic linting feedback on code files
 */

const {
  getFileContent,
  parseArgs,
  postReply,
  formatSuccessMessage,
  formatErrorMessage
} = require('../agent-helpers.js');

async function runAgent(context, github) {
  console.log('Lint agent started');
  
  try {
    const { positional, flags } = parseArgs(context.args);
    
    // Get file content
    const fileContent = await getFileContent(
      context.file_path, 
      context.pr_number, 
      github, 
      context.repo
    );
    
    // Run basic linting checks
    const issues = performBasicLinting(fileContent, context.file_path, flags);
    
    let message;
    if (issues.length === 0) {
      message = formatSuccessMessage(
        'Lint Agent',
        `✅ **${context.file_path}** - No linting issues found!`,
        `**Lines checked**: ${fileContent.split('\n').length}
**Bytes**: ${fileContent.length}
**Checks performed**: Basic syntax, style, common issues`
      );
    } else {
      const issueList = issues.map(issue => 
        `- **Line ${issue.line}**: ${issue.message} ${issue.severity === 'error' ? '❌' : '⚠️'}`
      ).join('\n');
      
      const summary = `Found **${issues.length}** linting issue${issues.length > 1 ? 's' : ''}`;
      const details = `**File**: \`${context.file_path}\`
**Issues Found**:

${issueList}

${flags.fix ? '**Note**: Use `--fix` flag to see suggested fixes' : '**Tip**: Add `--fix` flag for suggested fixes'}`;
      
      message = formatSuccessMessage('Lint Agent', summary, details);
    }
    
    await postReply(context, github, message);
    console.log('Lint agent completed successfully');
    
  } catch (error) {
    console.error('Lint agent error:', error);
    await postReply(context, github, formatErrorMessage('Lint Agent', error.message));
  }
}

function performBasicLinting(content, filePath, flags) {
  const issues = [];
  const lines = content.split('\n');
  const fileExt = filePath.split('.').pop()?.toLowerCase();
  
  // Basic checks for common file types
  if (['js', 'ts', 'jsx', 'tsx'].includes(fileExt)) {
    checkJavaScript(lines, issues);
  } else if (['py'].includes(fileExt)) {
    checkPython(lines, issues);
  } else if (['md'].includes(fileExt)) {
    checkMarkdown(lines, issues);
  }
  
  // Universal checks
  checkUniversal(lines, issues);
  
  return issues;
}

function checkJavaScript(lines, issues) {
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // Check for console.log (should be Logger.log or removed)
    if (line.includes('console.log') && !line.trim().startsWith('//')) {
      issues.push({
        line: lineNum,
        message: 'Consider using Logger.log() instead of console.log()',
        severity: 'warning'
      });
    }
    
    // Check for TODO comments
    if (line.includes('TODO') || line.includes('FIXME')) {
      issues.push({
        line: lineNum,
        message: 'TODO/FIXME comment found',
        severity: 'info'
      });
    }
    
    // Check for var usage (prefer const/let)
    if (line.trim().startsWith('var ')) {
      issues.push({
        line: lineNum,
        message: 'Use const or let instead of var',
        severity: 'warning'
      });
    }
    
    // Check for == instead of ===
    if (line.includes('==') && !line.includes('===') && !line.includes('!=')) {
      issues.push({
        line: lineNum,
        message: 'Use === instead of == for strict equality',
        severity: 'warning'
      });
    }
  });
}

function checkPython(lines, issues) {
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // Check for print statements (should maybe be logging)
    if (line.trim().startsWith('print(') && !line.trim().startsWith('#')) {
      issues.push({
        line: lineNum,
        message: 'Consider using logging instead of print() for production code',
        severity: 'info'
      });
    }
  });
}

function checkMarkdown(lines, issues) {
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // Check for broken links (basic check)
    const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/g);
    if (linkMatch) {
      linkMatch.forEach(link => {
        if (link.includes('](http://')) {
          issues.push({
            line: lineNum,
            message: 'Consider using HTTPS instead of HTTP for links',
            severity: 'info'
          });
        }
      });
    }
  });
}

function checkUniversal(lines, issues) {
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // Check for trailing whitespace
    if (line.endsWith(' ') || line.endsWith('\t')) {
      issues.push({
        line: lineNum,
        message: 'Trailing whitespace found',
        severity: 'info'
      });
    }
    
    // Check for very long lines
    if (line.length > 120) {
      issues.push({
        line: lineNum,
        message: `Line too long (${line.length} characters, max 120)`,
        severity: 'warning'
      });
    }
    
    // Check for potential secrets (very basic)
    const secretPatterns = [
      /api[_-]?key.*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/i,
      /password.*[=:]\s*['"][^'"]{8,}['"]/i,
      /secret.*[=:]\s*['"][a-zA-Z0-9]{15,}['"]/i
    ];
    
    secretPatterns.forEach(pattern => {
      if (pattern.test(line)) {
        issues.push({
          line: lineNum,
          message: 'Potential secret or credential found - please review',
          severity: 'error'
        });
      }
    });
  });
}

module.exports = {
  runAgent
};