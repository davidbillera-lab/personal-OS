export async function fetchGitHubDiff(commitUrl: string): Promise<string> {
  const match = commitUrl.match(/github\.com\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]+)/i)
  if (!match) throw new Error(`Invalid GitHub commit URL: ${commitUrl}`)
  const [, owner, repo, sha] = match
  return fetchDiff(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`)
}

export function parsePrUrl(prUrl: string): { owner: string; repo: string; number: number } | null {
  const match = prUrl.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/)
  return match ? { owner: match[1], repo: match[2], number: Number(match[3]) } : null
}

export async function fetchGitHubPrDiff(prUrl: string): Promise<string> {
  const pr = parsePrUrl(prUrl)
  if (!pr) throw new Error(`Invalid GitHub pull request URL: ${prUrl}`)
  return fetchDiff(`https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`)
}

async function fetchDiff(apiUrl: string): Promise<string> {
  const pat = process.env.GITHUB_PAT
  if (!pat) throw new Error('GITHUB_PAT not configured')
  const res = await fetch(
    apiUrl,
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
