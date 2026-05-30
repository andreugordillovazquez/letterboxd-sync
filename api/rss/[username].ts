const LETTERBOXD_ORIGIN = "https://letterboxd.com"
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const REQUEST_TIMEOUT_MS = 10_000

interface VercelRequest {
    method?: string
    query: Record<string, string | string[] | undefined>
}

interface VercelResponse {
    setHeader(name: string, value: string): void
    status(code: number): VercelResponse
    json(body: unknown): void
    send(body: string): void
    end(): void
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
    setCorsHeaders(response)

    if (request.method === "OPTIONS") {
        response.status(204).end()
        return
    }

    if (request.method !== "GET") {
        response.setHeader("Allow", "GET, OPTIONS")
        response.status(405).json({ error: "Method not allowed" })
        return
    }

    const username = getUsername(request)
    if (!username) {
        response.status(400).json({ error: "Invalid Letterboxd username" })
        return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
        const rssResponse = await fetch(`${LETTERBOXD_ORIGIN}/${encodeURIComponent(username)}/rss/`, {
            headers: {
                Accept: "application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
                "User-Agent": "Letterboxd Sync Framer Plugin",
            },
            signal: controller.signal,
        })

        const body = await rssResponse.text()

        response.status(rssResponse.status)
        response.setHeader(
            "Content-Type",
            rssResponse.headers.get("content-type") ?? "application/rss+xml; charset=utf-8"
        )
        response.setHeader(
            "Cache-Control",
            rssResponse.ok ? "public, max-age=60, s-maxage=300, stale-while-revalidate=600" : "no-store"
        )
        response.send(body)
    } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError"
        response.status(isAbort ? 504 : 502).json({
            error: isAbort ? "Letterboxd RSS request timed out" : "Could not fetch Letterboxd RSS",
        })
    } finally {
        clearTimeout(timeout)
    }
}

function setCorsHeaders(response: VercelResponse) {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type")
    response.setHeader("Access-Control-Max-Age", "86400")
}

function getUsername(request: VercelRequest): string | undefined {
    const value = request.query.username
    const username = (Array.isArray(value) ? value[0] : value)?.trim().replace(/^@+/, "")

    if (!username || !USERNAME_PATTERN.test(username)) return undefined
    return username
}
