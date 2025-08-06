// Fresh test file for AgentWatch automatic functionality
function validateInput(input) {
  // No input validation - security issue!
  return eval(input);
}

function processUserData(userData) {
  if (userData.role === "admin") {
    // Hardcoded admin check - not secure
    return { access: "full", permissions: "all" };
  }
  return { access: "limited", permissions: "read" };
}

// Export for testing
module.exports = { validateInput, processUserData };