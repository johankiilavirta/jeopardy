import os
import requests
import google.generativeai as genai

# 1. Load Environment Variables
repo_name = os.environ["REPO_NAME"]
pr_number = os.environ["PR_NUMBER"]
github_token = os.environ["GITHUB_TOKEN"]
gemini_api_key = os.environ["GEMINI_API_KEY"]

genai.configure(api_key=gemini_api_key)

# 2. Fetch the Pull Request Diff (the changed code) from GitHub
headers = {
    "Authorization": f"Bearer {github_token}",
    "Accept": "application/vnd.github.v3.diff"
}
diff_url = f"https://api.github.com/repos/{repo_name}/pulls/{pr_number}"
response = requests.get(diff_url, headers=headers)
pr_diff = response.text

# 3. Prompt Gemini
prompt = f"""
You are a strict code reviewer. Review the following git diff.
If there are bugs, security flaws, or bad practices, you must reject it.
If the code looks good and safe, you must approve it.

Your response MUST start with exactly one of these two words on the first line:
APPROVE
REQUEST_CHANGES

On the following lines, provide your detailed feedback.

Here is the code diff:
{pr_diff}
"""

model = genai.GenerativeModel('gemini-1.5-pro')
ai_response = model.generate_content(prompt).text

# 4. Parse the AI's Decision
lines = ai_response.strip().split('\n')
decision = lines[0].strip()
feedback = '\n'.join(lines[1:]).strip()

# Default to requesting changes if the AI hallucinates the format
if decision not in ["APPROVE", "REQUEST_CHANGES"]:
    decision = "REQUEST_CHANGES"
    feedback = f"Error: AI returned invalid decision format. Raw output:\n\n{ai_response}"

# 5. Submit the Formal Review to GitHub
review_url = f"https://api.github.com/repos/{repo_name}/pulls/{pr_number}/reviews"
review_data = {
    "event": decision,
    "body": f"### Gemini Code Review\n\n{feedback}"
}
review_headers = {
    "Authorization": f"Bearer {github_token}",
    "Accept": "application/vnd.github.v3+json"
}

requests.post(review_url, headers=review_headers, json=review_data)
print(f"Submitted {decision} review to PR #{pr_number}")
