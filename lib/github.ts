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

// Pinned to the PR's current head: diffs base...head by SHA, so later pushes cannot change what was reviewed.
export async function fetchGitHubPrDiff(prUrl: string): Promise<{ diff: string; headSha: string }> {
  const pr = parsePrUrl(prUrl)
  if (!pr) throw new Error(`Invalid GitHub pull request URL: ${prUrl}`)
  const repo = `https://api.github.com/repos/${pr.owner}/${pr.repo}`
  const meta = JSON.parse(await fetchDiff(`${repo}/pulls/${pr.number}`, 'application/vnd.github+json')) as {
    base?: { sha?: string }; head?: { sha?: string }
  }
  const baseSha = meta.base?.sha
  const headSha = meta.head?.sha
  if (!baseSha || !headSha) throw new Error(`GitHub returned no base/head SHA for ${prUrl}`)
  return { diff: await fetchDiff(`${repo}/compare/${baseSha}...${headSha}`), headSha }
}

async function fetchDiff(apiUrl: string, accept = 'application/vnd.github.diff'): Promise<string> {
  const pat = process.env.GITHUB_PAT
  if (!pat) throw new Error('GITHUB_PAT not configured')
  const res = await fetch(
    apiUrl,
    {
      headers: {
        Accept: accept,
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
