// Clean manual test file for AgentWatch
function processUserInput(input) {
  // Potential XSS vulnerability
  document.getElementById('output').innerHTML = input;
}

function makeAPICall(endpoint, data) {
  // No authentication or validation
  return fetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' }
  });
}

// Export for clean testing
export { processUserInput, makeAPICall };