import os
import requests
from google import genai

# 1. Load Environment Variables
repo_name = os.environ["REPO_NAME"]
pr_number = os.environ["PR_NUMBER"]
github_token = os.environ["GITHUB_TOKEN"]
gemini_api_key = os.environ["GEMINI_API_KEY"]

client = genai.Client(api_key=gemini_api_key)

gh_headers = {
    "Authorization": f"Bearer {github_token}",
    "Accept": "application/vnd.github.v3+json"
}

# 2. Fetch PR diff
diff_response = requests.get(
    f"https://api.github.com/repos/{repo_name}/pulls/{pr_number}",
    headers={**gh_headers, "Accept": "application/vnd.github.v3.diff"}
)
pr_diff = diff_response.text

# 3. Fetch full contents of changed files (for context)
files_response = requests.get(
    f"https://api.github.com/repos/{repo_name}/pulls/{pr_number}/files",
    headers=gh_headers
)
changed_files = files_response.json()

file_contents = []
for f in changed_files:
    filename = f["filename"]
    status = f["status"]
    if status == "removed":
        continue
    raw_url = f.get("raw_url")
    if not raw_url:
        continue
    content = requests.get(raw_url, headers=gh_headers).text
    file_contents.append(f"=== {filename} ===\n{content}")

full_file_context = "\n\n".join(file_contents)

# 4. Fetch existing PR conversation (reviews + comments)
reviews_response = requests.get(
    f"https://api.github.com/repos/{repo_name}/pulls/{pr_number}/reviews",
    headers=gh_headers
)
reviews = reviews_response.json()

comments_response = requests.get(
    f"https://api.github.com/repos/{repo_name}/issues/{pr_number}/comments",
    headers=gh_headers
)
comments = comments_response.json()

conversation = []
for r in reviews:
    user = r["user"]["login"]
    body = r.get("body", "")
    state = r.get("state", "")
    if body:
        conversation.append(f"[Review by {user} — {state}]\n{body}")

for c in comments:
    user = c["user"]["login"]
    body = c.get("body", "")
    if body:
        conversation.append(f"[Comment by {user}]\n{body}")

conversation_context = "\n\n---\n\n".join(conversation) if conversation else "No previous reviews or comments."

# 5. Fetch repo file tree for project structure context
tree_response = requests.get(
    f"https://api.github.com/repos/{repo_name}/git/trees/main?recursive=1",
    headers=gh_headers
)
tree_data = tree_response.json()
file_tree = "\n".join(
    item["path"] for item in tree_data.get("tree", [])
    if item["type"] == "blob" and not item["path"].startswith("node_modules/")
)

# 6. Prompt Gemini
prompt = f"""You are a code reviewer for a TypeScript project. Review the pull request below.

IMPORTANT RULES:
- Read the FULL FILE CONTENTS to understand context, not just the diff.
- Read the PRIOR CONVERSATION. If a previous concern was addressed or deliberately declined
  with good reasoning, do not raise it again.
- Focus on bugs, security issues, and correctness. Do not suggest over-engineering
  (e.g., adding unsubscribe methods to test mocks, try/catch around test callbacks).
- This is a small hobby project for 2 players. Keep suggestions proportional.

Your response MUST start with exactly one of these two words on the first line:
APPROVE
REQUEST_CHANGES

Then provide concise feedback.

PROJECT FILE TREE:
{file_tree}

FULL CONTENTS OF CHANGED FILES:
{full_file_context}

GIT DIFF:
{pr_diff}

PRIOR CONVERSATION ON THIS PR:
{conversation_context}
"""

ai_response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=prompt,
).text

# 7. Parse the AI's Decision
lines = ai_response.strip().split('\n')
decision = lines[0].strip()
feedback = '\n'.join(lines[1:]).strip()

if decision not in ["APPROVE", "REQUEST_CHANGES"]:
    decision = "REQUEST_CHANGES"
    feedback = f"Error: AI returned invalid decision format. Raw output:\n\n{ai_response}"

# 8. Submit the Review to GitHub
review_url = f"https://api.github.com/repos/{repo_name}/pulls/{pr_number}/reviews"
review_data = {
    "event": decision,
    "body": f"### Gemini Code Review\n\n{feedback}"
}

requests.post(review_url, headers=gh_headers, json=review_data)
print(f"Submitted {decision} review to PR #{pr_number}")
