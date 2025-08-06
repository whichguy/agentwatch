// Sample JavaScript code for testing AgentWatch
function calculateFibonacci(n) {
  if (n <= 1) return n;
  return calculateFibonacci(n - 1) + calculateFibonacci(n - 2);
}

function formatDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

// This function has a potential security issue
function executeUserCode(userInput) {
  // SECURITY RISK: eval() allows arbitrary code execution
  return eval(userInput);
}

const data = {
  users: [
    { id: 1, name: "Alice", email: "alice@example.com" },
    { id: 2, name: "Bob", email: "bob@example.com" }
  ]
};

console.log("Sample code ready for AgentWatch testing!");