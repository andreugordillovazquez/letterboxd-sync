import type { FieldDataInput, ManagedCollectionItemInput } from "framer-plugin"

export interface LetterboxdDiaryEntry {
    id: string
    title: string
    year?: number
    rating?: number
    reviewHtml: string
    watchedDate: string
    isRewatch: boolean
    containsSpoilers: boolean
    posterUrl?: string
    letterboxdUrl?: string
    tmdbId?: string
}

export interface SyncResult {
    count: number
    items: ManagedCollectionItemInput[]
}

export interface PluginDataStore {
    setPluginData(key: string, value: string | null): Promise<void>
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type LetterboxdErrorCode =
    | "invalid_username"
    | "profile_not_found"
    | "private_profile"
    | "network"
    | "malformed_xml"
    | "no_diary_entries"
    | "sync_failed"

export interface FieldDataBuilderResult {
    id: string
    slug: string
    fieldData: FieldDataInput
}

export type SlugStrategy = "title" | "title-year" | "title-watched-date" | "letterboxd-id"
