export async function fetchGitHubDiff(commitUrl: string): Promise<string> {
  const match = commitUrl.match(/github\.com\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]+)/i)
  if (!match) throw new Error(`Invalid GitHub commit URL: ${commitUrl}`)
  const [, owner, repo, sha] = match
  const pat = process.env.GITHUB_PAT
  if (!pat) throw new Error('GITHUB_PAT not configured')
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
    {
      headers: {
        Accept: 'application/vnd.github.diff',
        Authorization: `token ${pat}`,
      },
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API error ${res.status}: ${body}`)
  }
  return res.text()
}
