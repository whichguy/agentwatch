// Fresh manual test for AgentWatch manual-only mode
function authenticateUser(credentials) {
  // Security issue: hardcoded admin credentials
  if (credentials.username === "admin" && credentials.password === "admin123") {
    return { authenticated: true, role: "admin" };
  }
  
  // Weak password validation
  if (credentials.password.length < 6) {
    throw new Error("Password too short");
  }
  
  return { authenticated: false };
}

function sanitizeInput(userInput) {
  // XSS vulnerability - no actual sanitization
  return userInput.replace(/<script>/gi, "");
}

function logUserAction(action, userId) {
  // Potential information disclosure
  console.log(`User ${userId} performed action: ${action} at ${new Date()}`);
}

// Export functions for testing
module.exports = {
  authenticateUser,
  sanitizeInput,
  logUserAction
};