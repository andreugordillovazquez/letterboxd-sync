import { XMLParser } from "fast-xml-parser"
import type { LetterboxdDiaryEntry, SlugStrategy } from "./types"

type RssRecord = Record<string, unknown>

const textNodeName = "#text"

const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    removeNSPrefix: false,
    trimValues: false,
})

export function parseDiaryEntries(xml: string): LetterboxdDiaryEntry[] {
    const parsed = parser.parse(xml) as unknown
    const items = findFeedItems(parsed)

    return items
        .filter(item => Boolean(readString(item, "letterboxd:watchedDate")))
        .map(item => toDiaryEntry(item))
        .filter(entry => entry.title.length > 0)
}

export function extractPosterUrl(descriptionHtml: string): string | undefined {
    const document = parseHtml(descriptionHtml)
    const domSrc = document?.querySelector("img")?.getAttribute("src")?.trim()
    if (domSrc) return domSrc

    const match = /<img[^>]+src=["']([^"']+)["']/i.exec(descriptionHtml)
    return match?.[1]?.trim() || undefined
}

export function extractReviewHtml(descriptionHtml: string): string {
    const document = parseHtml(descriptionHtml)
    if (document) {
        const firstImage = document.querySelector("img")
        firstImage?.closest("p")?.remove()
        firstImage?.remove()

        for (const paragraph of Array.from(document.querySelectorAll("p"))) {
            const text = paragraph.textContent?.replace(/\s+/g, " ").trim() ?? ""
            if (/^(re)?watched on\b.+\.$/i.test(text)) {
                paragraph.remove()
            }
        }

        document.querySelectorAll("script, style, iframe, object, embed").forEach(element => element.remove())
        document.querySelectorAll("*").forEach(element => {
            for (const attribute of Array.from(element.attributes)) {
                if (attribute.name.toLowerCase().startsWith("on")) {
                    element.removeAttribute(attribute.name)
                }
            }
        })

        return normalizeHtml(document.body.innerHTML)
    }

    return normalizeHtml(
        descriptionHtml
            .replace(/<p>\s*<img\b[^>]*>\s*<\/p>/i, "")
            .replace(/<img\b[^>]*>/gi, "")
            .replace(/<p>\s*(?:re)?watched on\b.*?<\/p>/gi, "")
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    )
}

export function fallbackDiaryId(link: string | undefined, watchedDate: string): string {
    return `letterboxd-${hashString(`${link ?? ""}:${watchedDate}`)}`
}

export function slugify(value: string): string {
    const slug = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

    return slug || "film"
}

export function uniqueSlugs(entries: readonly LetterboxdDiaryEntry[], strategy: SlugStrategy): Map<string, string> {
    const seen = new Map<string, number>()
    const slugs = new Map<string, string>()

    for (const entry of entries) {
        const base = getSlugBase(entry, strategy)
        const nextCount = (seen.get(base) ?? 0) + 1
        seen.set(base, nextCount)

        const suffix = nextCount === 1 ? "" : `-${nextCount}`
        slugs.set(entry.id, truncateSlug(base, suffix))
    }

    return slugs
}

export function getSlugBase(entry: LetterboxdDiaryEntry, strategy: SlugStrategy): string {
    switch (strategy) {
        case "title":
            return slugify(entry.title)
        case "title-year":
            return slugify(`${entry.title}${entry.year ? ` ${entry.year}` : ""}`)
        case "title-watched-date":
            return slugify(`${entry.title} ${entry.watchedDate}`)
        case "letterboxd-id":
            return slugify(entry.id)
    }
}

function findFeedItems(parsed: unknown): RssRecord[] {
    if (!isRecord(parsed)) return []

    const rssItems = getPath(parsed, ["rss", "channel", "item"])
    const atomEntries = getPath(parsed, ["feed", "entry"])
    return normalizeArray(rssItems ?? atomEntries).filter(isRecord)
}

function toDiaryEntry(item: RssRecord): LetterboxdDiaryEntry {
    const watchedDate = readString(item, "letterboxd:watchedDate") ?? ""
    const link = readString(item, "link")
    const description = readString(item, "description") ?? ""
    const rating = parseRating(readString(item, "letterboxd:memberRating"))
    const year = parseYear(readString(item, "letterboxd:filmYear"))
    const title = readString(item, "letterboxd:filmTitle") ?? parseTitle(readString(item, "title")) ?? ""
    const guid = readString(item, "guid")

    return {
        id: guid || fallbackDiaryId(link, watchedDate),
        title,
        year,
        rating,
        reviewHtml: extractReviewHtml(description),
        watchedDate,
        isRewatch: readString(item, "letterboxd:rewatch") === "Yes",
        containsSpoilers: readString(item, "letterboxd:containsSpoilers") === "Yes",
        posterUrl: extractPosterUrl(description),
        letterboxdUrl: link,
        tmdbId: readString(item, "tmdb:movieId"),
    }
}

function readString(record: RssRecord, key: string): string | undefined {
    return valueToString(record[key])?.trim() || undefined
}

function valueToString(value: unknown): string | undefined {
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (isRecord(value)) return valueToString(value[textNodeName])
    return undefined
}

function parseYear(value: string | undefined): number | undefined {
    if (!value) return undefined

    const year = Number.parseInt(value, 10)
    return Number.isFinite(year) ? year : undefined
}

function parseRating(value: string | undefined): number | undefined {
    if (!value) return undefined

    const rating = Number.parseFloat(value)
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) return undefined
    return rating
}

function parseTitle(value: string | undefined): string | undefined {
    if (!value) return undefined
    return value.split(",")[0]?.trim() || undefined
}

function parseHtml(html: string): Document | undefined {
    if (typeof DOMParser === "undefined") return undefined

    return new DOMParser().parseFromString(html, "text/html")
}

function normalizeHtml(html: string): string {
    const trimmed = html.trim()
    if (!trimmed) return ""

    const text = trimmed
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim()

    return text ? trimmed : ""
}

function truncateSlug(base: string, suffix: string): string {
    const maxLength = 64
    if (`${base}${suffix}`.length <= maxLength) return `${base}${suffix}`

    const allowedBaseLength = Math.max(1, maxLength - suffix.length)
    return `${base.slice(0, allowedBaseLength).replace(/-+$/g, "")}${suffix}`
}

function hashString(value: string): string {
    let hash = 2166136261

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }

    return (hash >>> 0).toString(36)
}

function getPath(record: RssRecord, path: readonly string[]): unknown {
    let current: unknown = record

    for (const key of path) {
        if (!isRecord(current)) return undefined
        current = current[key]
    }

    return current
}

function normalizeArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value
    if (value === undefined || value === null) return []
    return [value]
}

function isRecord(value: unknown): value is RssRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}
