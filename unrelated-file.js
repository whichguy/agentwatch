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
}

export default DataProcessor;