// Pattern test file for AgentWatch historical detection
// Step 2: Test automatic pattern detection
class PaymentProcessor {
  constructor() {
    this.apiKey = "sk-test-12345"; // Hardcoded API key
  }

  // Credit card processing without validation
  processPayment(cardNumber, amount) {
    // No input validation
    const payment = {
      card: cardNumber, // PCI DSS violation - storing card data
      amount: amount,
      processed: true
    };
    
    console.log("Payment processed:", payment); // Logging sensitive data
    return payment;
  }

  // Insecure transaction logging
  logTransaction(transaction) {
    const logEntry = `Transaction: ${JSON.stringify(transaction)}`; // Data exposure
    console.log(logEntry);
  }

  // NEW: Additional vulnerability - password storage
  storeUserPassword(userId, password) {
    // Storing plaintext password - major security issue
    this.users = this.users || {};
    this.users[userId] = { password: password }; // Plaintext storage
    console.log(`Stored password for user ${userId}`); // Password logging
  }
}

export default PaymentProcessor;