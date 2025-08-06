// Brand new test file for AgentWatch fresh testing
// Added LDAP injection and session management vulnerabilities
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

  // LDAP injection vulnerability
  findUserInLDAP(username) {
    const ldapQuery = `(uid=${username})`; // LDAP injection
    return this.executeLDAPQuery(ldapQuery);
  }

  // Session fixation vulnerability
  createSession(userId) {
    const sessionId = "session_" + userId; // Predictable session ID
    global.sessions = global.sessions || {};
    global.sessions[sessionId] = { userId, created: Date.now() };
    return sessionId; // No secure random generation
  }

  executeQuery(sql) {
    console.log("Executing:", sql); // Potential log injection
    // Mock database execution
    return [];
  }

  executeLDAPQuery(query) {
    console.log("LDAP Query:", query); // Log exposure
    return []; // Mock LDAP results
  }
}

// Export for testing
export default UserManager;