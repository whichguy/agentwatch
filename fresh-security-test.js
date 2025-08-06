// Brand new test file for AgentWatch fresh testing
class UserManager {
  constructor() {
    this.users = new Map();
    this.adminKey = "super_secret_admin_key_123"; // Hardcoded secret
  }

  // SQL injection vulnerability
  findUser(query) {
    const sql = `SELECT * FROM users WHERE name = '${query}'`;
    return this.executeQuery(sql);
  }

  // Weak authentication
  validateUser(username, password) {
    if (username === "admin" && password === "password") {
      return { valid: true, role: "admin" };
    }
    
    // No rate limiting or brute force protection
    return { valid: false };
  }

  // XSS vulnerability
  displayUserProfile(userInput) {
    document.getElementById("profile").innerHTML = userInput;
  }

  // Insecure direct object reference
  getUserData(userId) {
    // No authorization check
    return this.users.get(userId);
  }

  executeQuery(sql) {
    console.log("Executing:", sql); // Potential log injection
    // Mock database execution
    return [];
  }
}

// Export for testing
export default UserManager;