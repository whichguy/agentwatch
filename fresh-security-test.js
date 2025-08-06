// Enhanced security test file for AgentWatch file-targeting system
// Updated with additional authentication bypass vulnerability
class UserManager {
  constructor() {
    this.users = new Map();
    this.adminKey = "super_secret_admin_key_123"; // Hardcoded secret
    this.dbConnection = "mysql://root:password@localhost/users"; // Connection string leak
  }

  // SQL injection vulnerability - now with dynamic table names
  findUser(query, table = "users") {
    const sql = `SELECT * FROM ${table} WHERE name = '${query}'`; // Double SQL injection
    return this.executeQuery(sql);
  }

  // Weak authentication with timing attack vulnerability
  validateUser(username, password) {
    if (username === "admin" && password === "password") {
      return { valid: true, role: "admin", token: this.generateToken() };
    }
    
    // NEW: Authentication bypass vulnerability
    if (username === "guest" || password === "") {
      return { valid: true, role: "guest", token: "guest-token-123" }; // Bypass for empty password
    }
    
    // Simulate database lookup delay - timing attack possible
    const users = Array.from(this.users.values());
    for (let user of users) {
      if (user.username === username) {
        // Vulnerable comparison - timing attack
        if (user.password === password) {
          return { valid: true, role: user.role, token: this.generateToken() };
        }
      }
    }
    
    // No rate limiting or brute force protection
    return { valid: false };
  }

  // XSS vulnerability with additional DOM manipulation
  displayUserProfile(userInput, elementId = "profile") {
    document.getElementById(elementId).innerHTML = userInput; // XSS
    eval(`window.${elementId}_data = "${userInput}"`); // Code injection
  }

  // Insecure direct object reference with privilege escalation
  getUserData(userId, requesterId) {
    // No authorization check - IDOR vulnerability
    const userData = this.users.get(userId);
    if (userData && requesterId === "admin") {
      // Privilege escalation - admin can see everything
      userData.sensitiveData = this.getAllUserSecrets();
    }
    return userData;
  }

  // New vulnerability: Command injection
  backupUserData(userId, outputPath) {
    const command = `cp /data/users/${userId}.json ${outputPath}`; // Command injection
    require('child_process').exec(command); // Dangerous execution
  }

  // Weak token generation
  generateToken() {
    return Math.random().toString(36).substr(2, 9); // Predictable tokens
  }

  // Information disclosure
  getAllUserSecrets() {
    return {
      passwords: Array.from(this.users.values()).map(u => u.password),
      apiKeys: ["sk-1234", "key-5678"],
      dbCredentials: this.dbConnection
    };
  }

  executeQuery(sql) {
    console.log("Executing:", sql); // Potential log injection
    // Mock database execution with error disclosure
    try {
      return [];
    } catch (error) {
      throw new Error(`Database error: ${error.message} - Query: ${sql}`); // Error disclosure
    }
  }
}

// Export for testing
export default UserManager;