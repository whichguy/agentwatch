// Unrelated file for control test - should NOT trigger AgentWatch
// This file has never been mentioned with @agentwatch
class DataProcessor {
  constructor() {
    this.data = [];
  }

  // Simple data processing - no security issues
  processData(input) {
    if (!input) return null;
    
    return {
      processed: true,
      timestamp: Date.now(),
      data: input.toString().toUpperCase()
    };
  }

  // Basic logging
  log(message) {
    console.log(`DataProcessor: ${message}`);
  }
  
  // CONTROL TEST: This file should NOT trigger AgentWatch
  testMethod() {
    return "This is a control test - should not trigger any agents";
  }
}

export default DataProcessor;