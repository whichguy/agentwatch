# Manual test file for AgentWatch
import os
import subprocess

def execute_command(user_command):
    # SECURITY ISSUE: Command injection vulnerability
    result = subprocess.run(user_command, shell=True, capture_output=True, text=True)
    return result.stdout

def process_file(filename):
    # SECURITY ISSUE: Path traversal vulnerability
    file_path = "/tmp/" + filename
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        return content
    except FileNotFoundError:
        return "File not found"

def authenticate_user(username, password):
    # SECURITY ISSUE: Hardcoded credentials
    admin_users = {
        "admin": "password123",
        "root": "admin"
    }
    
    if username in admin_users and admin_users[username] == password:
        return {"authenticated": True, "role": "admin"}
    
    return {"authenticated": False, "role": "guest"}

# Main execution
if __name__ == "__main__":
    print("Manual test file ready for AgentWatch analysis!")
    
    # Test functions
    result = execute_command("echo 'Hello World'")
    print(f"Command result: {result}")