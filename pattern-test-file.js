// Pattern test file for AgentWatch historical detection
// Step 1: Establish @agentwatch pattern
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
}

export default PaymentProcessor;