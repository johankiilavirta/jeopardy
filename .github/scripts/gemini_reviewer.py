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

# Extensions to skip for full content context
SKIP_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".pdf", ".lock"]
SKIP_FILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]

file_contents = []
total_context_chars = 0
MAX_CONTEXT_CHARS = 100000  # ~25k tokens roughly

for f in changed_files:
    filename = f["filename"]
    status = f["status"]
    
    if status == "removed":
        continue
        
    if any(filename.endswith(ext) for ext in SKIP_EXTENSIONS) or filename in SKIP_FILES:
        print(f"Skipping full content for {filename} (unsupported type/lockfile)")
        continue

    raw_url = f.get("raw_url")
    if not raw_url:
        continue
        
    content = requests.get(raw_url, headers=gh_headers).text
    
    # If a single file is too large, truncate it
    if len(content) > 20000:
        content = content[:20000] + "\n... [truncated due to size] ..."

    entry = f"=== {filename} ===\n{content}"
    if total_context_chars + len(entry) > MAX_CONTEXT_CHARS:
        print(f"Skipping further context, reached limit with {filename}")
        break
        
    file_contents.append(entry)
    total_context_chars += len(entry)

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

# Limit file tree to avoid massive prompts in large repos
file_tree_list = []
for item in tree_data.get("tree", []):
    path = item["path"]
    if item["type"] == "blob":
        if any(part.startswith('.') for part in path.split('/')): continue # skip hidden
        if path.startswith('node_modules/'): continue
        if path.endswith('.lock') or path == 'package-lock.json': continue
        file_tree_list.append(path)
    if len(file_tree_list) > 500: # hard limit for tree
        file_tree_list.append("... [tree truncated] ...")
        break

file_tree = "\n".join(file_tree_list)

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
# GITHUB_TOKEN can't submit APPROVE reviews (GitHub restriction for actions bot),
# so we always post as COMMENT and include the verdict in the body.
review_url = f"https://api.github.com/repos/{repo_name}/pulls/{pr_number}/reviews"
verdict = "✅ **APPROVED**" if decision == "APPROVE" else "❌ **CHANGES REQUESTED**"
review_data = {
    "event": "COMMENT",
    "body": f"### Gemini Code Review\n\n{verdict}\n\n{feedback}"
}

response = requests.post(review_url, headers=gh_headers, json=review_data)
response.raise_for_status()
print(f"Submitted review ({decision}) to PR #{pr_number}")
