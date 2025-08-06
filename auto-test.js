// Auto-test JavaScript file for AgentWatch
function userLogin(username, password) {
  // Potential security issue - plain text password handling
  if (username === "admin" && password === "password123") {
    return { success: true, token: generateToken() };
  }
  return { success: false, message: "Invalid credentials" };
}

function generateToken() {
  // Insecure random generation
  return Math.random().toString(36).substr(2, 9);
}

// Another test function
function processData(input) {
  if (!input) return null;
  return input.toUpperCase();
}

console.log("Auto-test file ready!");