import type {
    FieldDataEntryInput,
    FieldDataInput,
    ManagedCollection,
    ManagedCollectionItemInput,
    ProtectedMethod,
} from "framer-plugin"
import { createDefaultFieldConfigs, FIELD_IDS, type FilmFieldConfig } from "./fields"
import { parseDiaryEntries, uniqueSlugs } from "./rss"
import type {
    Fetcher,
    LetterboxdDiaryEntry,
    LetterboxdErrorCode,
    PluginDataStore,
    SlugStrategy,
    SyncResult,
} from "./types"

export const PLUGIN_DATA_KEYS = {
    username: "username",
    lastSyncAt: "lastSyncAt",
    fieldConfigs: "fieldConfigs",
    slugStrategy: "slugStrategy",
} as const

export const SYNC_PROTECTED_METHODS = [
    "ManagedCollection.setFields",
    "ManagedCollection.addItems",
    "ManagedCollection.setPluginData",
] as const satisfies ProtectedMethod[]

export class LetterboxdSyncError extends Error {
    readonly code: LetterboxdErrorCode

    constructor(code: LetterboxdErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = "LetterboxdSyncError"
        this.code = code
    }
}

export interface SyncOptions {
    fetcher?: Fetcher
    pluginDataStore?: PluginDataStore
    fieldConfigs?: readonly FilmFieldConfig[]
    slugStrategy?: SlugStrategy
}

export function normalizeUsername(value: string): string {
    let username = value.trim()

    if (!username) return ""

    try {
        const url = new URL(username.startsWith("http") ? username : `https://${username}`)
        if (url.hostname === "letterboxd.com" || url.hostname.endsWith(".letterboxd.com")) {
            username = url.pathname.split("/").filter(Boolean)[0] ?? ""
        }
    } catch {
        username = username.replace(/^https?:\/\/(?:www\.)?letterboxd\.com\//i, "")
    }

    username = username
        .replace(/^@+/, "")
        .replace(/\/rss\/?$/i, "")
        .replace(/\/+$/g, "")
        .trim()

    return username
}

export async function fetchDiaryEntries(
    usernameInput: string,
    fetcher: Fetcher = fetch
): Promise<LetterboxdDiaryEntry[]> {
    const username = normalizeUsername(usernameInput)
    if (!username) {
        throw new LetterboxdSyncError("invalid_username", "Enter a Letterboxd username.")
    }

    const response = await fetchRss(username, fetcher)
    const xml = await response.text()

    if (!xml.trim()) {
        throw new LetterboxdSyncError("private_profile", "This profile's diary isn't public.")
    }

    let entries: LetterboxdDiaryEntry[]
    try {
        entries = parseDiaryEntries(xml)
    } catch (error) {
        console.error("Failed to parse Letterboxd RSS:", error)
        throw new LetterboxdSyncError("malformed_xml", "Letterboxd returned a feed this plugin couldn't parse.")
    }

    if (entries.length === 0) {
        throw new LetterboxdSyncError("no_diary_entries", "No diary entries found yet.")
    }

    return entries
}

export async function syncLetterboxdDiary(
    collection: ManagedCollection,
    username: string,
    options: SyncOptions = {}
): Promise<SyncResult> {
    const entries = await fetchDiaryEntries(username, options.fetcher)
    return syncDiaryEntries(collection, entries, options.pluginDataStore, options.fieldConfigs, options.slugStrategy)
}

export async function syncDiaryEntries(
    collection: ManagedCollection,
    entries: readonly LetterboxdDiaryEntry[],
    pluginDataStore?: PluginDataStore,
    fieldConfigs: readonly FilmFieldConfig[] = createDefaultFieldConfigs(),
    slugStrategy: SlugStrategy = "title-watched-date"
): Promise<SyncResult> {
    const items = buildManagedCollectionItems(entries, fieldConfigs, slugStrategy)

    try {
        await collection.addItems(items)
    } catch (error) {
        console.error("Failed to upsert managed collection items:", error)
        throw new LetterboxdSyncError("sync_failed", "Framer couldn't update the Films collection.", {
            cause: error,
        })
    }

    await pluginDataStore?.setPluginData(PLUGIN_DATA_KEYS.lastSyncAt, new Date().toISOString())

    return {
        count: items.length,
        items,
    }
}

export function buildManagedCollectionItems(
    entries: readonly LetterboxdDiaryEntry[],
    fieldConfigs: readonly FilmFieldConfig[] = createDefaultFieldConfigs(),
    slugStrategy: SlugStrategy = "title-watched-date"
): ManagedCollectionItemInput[] {
    const slugs = uniqueSlugs(entries, slugStrategy)

    return entries.map(entry => {
        const fieldData = buildFieldData(entry, fieldConfigs)
        const slug = slugs.get(entry.id)
        if (!slug) {
            throw new LetterboxdSyncError("sync_failed", `Could not create a slug for ${entry.title}.`)
        }

        return {
            id: entry.id,
            slug,
            draft: false,
            fieldData,
        }
    })
}

export function getFriendlyErrorMessage(error: unknown): string {
    if (error instanceof LetterboxdSyncError) return error.message

    if (error instanceof TypeError) {
        return "Couldn't reach Letterboxd. Check your connection. If this is a published plugin, Letterboxd may be blocking Framer's plugin origin."
    }

    return "Couldn't sync this diary. Please try again."
}

function buildFieldData(entry: LetterboxdDiaryEntry, fieldConfigs: readonly FilmFieldConfig[]): FieldDataInput {
    const fieldData: FieldDataInput = {}

    for (const config of fieldConfigs) {
        if (!config.enabled) continue

        const fieldEntry = buildFieldDataEntry(entry, config)
        if (!fieldEntry) continue

        fieldData[config.id] = fieldEntry
    }

    return fieldData
}

function buildFieldDataEntry(entry: LetterboxdDiaryEntry, config: FilmFieldConfig): FieldDataEntryInput | undefined {
    const value = getCanonicalValue(entry, config.id)
    if (value === undefined) return undefined

    switch (config.type) {
        case "boolean":
            if (typeof value !== "boolean") return undefined
            return { type: "boolean", value }
        case "date":
            if (typeof value !== "string") return undefined
            return { type: "date", value }
        case "formattedText":
            return { type: "formattedText", value: stringifyValue(value), contentType: "html" }
        case "image":
            return { type: "image", value: stringifyValue(value), alt: `${entry.title} poster` }
        case "link":
            return { type: "link", value: stringifyValue(value) }
        case "number": {
            const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value))
            if (!Number.isFinite(numberValue)) return undefined
            return { type: "number", value: numberValue }
        }
        case "string":
            return { type: "string", value: stringifyValue(value) }
    }
}

function getCanonicalValue(
    entry: LetterboxdDiaryEntry,
    fieldId: FilmFieldConfig["id"]
): string | number | boolean | undefined {
    switch (fieldId) {
        case FIELD_IDS.title:
            return entry.title
        case FIELD_IDS.year:
            return entry.year
        case FIELD_IDS.rating:
            return entry.rating
        case FIELD_IDS.review:
            return entry.reviewHtml
        case FIELD_IDS.watchedDate:
            return entry.watchedDate
        case FIELD_IDS.isRewatch:
            return entry.isRewatch
        case FIELD_IDS.containsSpoilers:
            return entry.containsSpoilers
        case FIELD_IDS.poster:
            return entry.posterUrl
        case FIELD_IDS.letterboxdUrl:
            return entry.letterboxdUrl
        case FIELD_IDS.tmdbId:
            return entry.tmdbId
    }
}

function stringifyValue(value: string | number | boolean): string {
    if (typeof value === "boolean") return value ? "Yes" : "No"
    return String(value)
}

async function fetchRss(username: string, fetcher: Fetcher): Promise<Response> {
    const url = getRssUrl(username)

    let response: Response
    try {
        response = await fetcher(url, {
            headers: {
                Accept: "application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
            },
        })
    } catch (error) {
        throw new LetterboxdSyncError(
            "network",
            "Couldn't reach Letterboxd. Check your connection. If this is a published plugin, Letterboxd may be blocking Framer's plugin origin.",
            { cause: error }
        )
    }

    if (response.status === 404) {
        throw new LetterboxdSyncError("profile_not_found", "Couldn't find that Letterboxd profile.")
    }

    if (response.status === 403) {
        throw new LetterboxdSyncError("private_profile", "This profile's diary isn't public.")
    }

    if (!response.ok) {
        throw new LetterboxdSyncError("network", "Letterboxd didn't return a readable RSS feed.")
    }

    return response
}

function getRssUrl(username: string): string {
    const path = `/${encodeURIComponent(username)}/rss/`

    if (import.meta.env.DEV) {
        return `/letterboxd-rss${path}`
    }

    const proxyUrl = normalizeProxyUrl(import.meta.env.VITE_LETTERBOXD_PROXY_URL)
    if (!proxyUrl) {
        throw new LetterboxdSyncError("network", "This published plugin needs a Letterboxd RSS proxy URL configured.")
    }

    return `${proxyUrl}/rss/${encodeURIComponent(username)}`
}

function normalizeProxyUrl(value: string | undefined): string | undefined {
    const trimmedValue = value?.trim()
    if (!trimmedValue) return undefined

    try {
        const url = new URL(trimmedValue)
        if (url.protocol !== "https:") return undefined
        return url.origin
    } catch {
        return undefined
    }
}
