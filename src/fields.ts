import type { ManagedCollection, ManagedCollectionFieldInput } from "framer-plugin"

export const FILM_COLLECTION_NAME = "Films"

export const FIELD_IDS = {
    title: "title",
    year: "year",
    rating: "rating",
    review: "review",
    watchedDate: "watched_date",
    isRewatch: "is_rewatch",
    containsSpoilers: "contains_spoilers",
    poster: "poster",
    letterboxdUrl: "letterboxd_url",
    tmdbId: "tmdb_id",
} as const

export type FilmFieldId = (typeof FIELD_IDS)[keyof typeof FIELD_IDS]

export type ConfigurableFieldType = "boolean" | "date" | "formattedText" | "image" | "link" | "number" | "string"

export interface FilmFieldConfig {
    id: FilmFieldId
    sourceName: string
    name: string
    type: ConfigurableFieldType
    enabled: boolean
    userEditable?: boolean
    typeOptions: readonly ConfigurableFieldType[]
}

export const DEFAULT_FIELD_CONFIGS = [
    {
        id: FIELD_IDS.title,
        sourceName: "Title",
        name: "Title",
        type: "string",
        enabled: true,
        typeOptions: ["string"],
    },
    {
        id: FIELD_IDS.year,
        sourceName: "Year",
        name: "Year",
        type: "number",
        enabled: true,
        userEditable: false,
        typeOptions: ["number", "string"],
    },
    {
        id: FIELD_IDS.rating,
        sourceName: "Rating",
        name: "Rating",
        type: "number",
        enabled: true,
        userEditable: false,
        typeOptions: ["number", "string"],
    },
    {
        id: FIELD_IDS.review,
        sourceName: "Review",
        name: "Review",
        type: "formattedText",
        enabled: true,
        userEditable: false,
        typeOptions: ["formattedText", "string"],
    },
    {
        id: FIELD_IDS.watchedDate,
        sourceName: "Watched",
        name: "Watched",
        type: "date",
        enabled: true,
        userEditable: false,
        typeOptions: ["date", "string"],
    },
    {
        id: FIELD_IDS.isRewatch,
        sourceName: "Rewatch",
        name: "Rewatch",
        type: "boolean",
        enabled: true,
        userEditable: false,
        typeOptions: ["boolean", "string"],
    },
    {
        id: FIELD_IDS.containsSpoilers,
        sourceName: "Spoilers",
        name: "Spoilers",
        type: "boolean",
        enabled: true,
        userEditable: false,
        typeOptions: ["boolean", "string"],
    },
    {
        id: FIELD_IDS.poster,
        sourceName: "Poster",
        name: "Poster",
        type: "image",
        enabled: true,
        userEditable: false,
        typeOptions: ["image", "link", "string"],
    },
    {
        id: FIELD_IDS.letterboxdUrl,
        sourceName: "Letterboxd URL",
        name: "Letterboxd URL",
        type: "link",
        enabled: true,
        userEditable: false,
        typeOptions: ["link", "string"],
    },
    {
        id: FIELD_IDS.tmdbId,
        sourceName: "TMDB ID",
        name: "TMDB ID",
        type: "string",
        enabled: true,
        userEditable: false,
        typeOptions: ["string", "number"],
    },
] satisfies FilmFieldConfig[]

export function createDefaultFieldConfigs(): FilmFieldConfig[] {
    return DEFAULT_FIELD_CONFIGS.map(field => ({ ...field }))
}

export function toManagedCollectionFields(configs: readonly FilmFieldConfig[]): ManagedCollectionFieldInput[] {
    return configs
        .filter(config => config.enabled)
        .map(config => {
            const field = {
                id: config.id,
                name: config.name.trim() || config.sourceName,
                type: config.type,
                userEditable: config.id === FIELD_IDS.title ? undefined : config.userEditable,
            }

            if (config.type === "date") {
                return {
                    ...field,
                    displayTime: false,
                }
            }

            return field
        })
}

export function serializeFieldConfigs(configs: readonly FilmFieldConfig[]): string {
    return JSON.stringify({
        version: 1,
        fields: configs.map(config => [config.id, config.name, config.type, config.enabled ? 1 : 0]),
    })
}

export function parseFieldConfigs(value: string | null): FilmFieldConfig[] {
    const defaults = createDefaultFieldConfigs()
    if (!value) return defaults

    try {
        const parsed = JSON.parse(value) as unknown
        if (!isStoredFieldConfig(parsed)) return defaults

        const savedFields = new Map(parsed.fields.map(field => [field[0], field]))

        return defaults.map(defaultConfig => {
            const savedField = savedFields.get(defaultConfig.id)
            if (!savedField) return defaultConfig

            const [, name, , enabled] = savedField

            return {
                ...defaultConfig,
                name: name.trim() || defaultConfig.name,
                enabled: defaultConfig.id === FIELD_IDS.title ? true : enabled === 1,
            }
        })
    } catch {
        return defaults
    }
}

export async function configureFilmsCollection(
    collection: ManagedCollection,
    configs: readonly FilmFieldConfig[] = createDefaultFieldConfigs()
) {
    await collection.setFields(toManagedCollectionFields(configs))
}

type StoredFieldTuple = [FilmFieldId, string, ConfigurableFieldType, 0 | 1]

interface StoredFieldConfig {
    version: 1
    fields: StoredFieldTuple[]
}

function isStoredFieldConfig(value: unknown): value is StoredFieldConfig {
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.fields)) return false

    return value.fields.every(field => {
        if (!Array.isArray(field) || field.length !== 4) return false

        const [id, name, type, enabled] = field
        return (
            isFilmFieldId(id) &&
            typeof name === "string" &&
            isConfigurableFieldType(type) &&
            (enabled === 0 || enabled === 1)
        )
    })
}

function isFilmFieldId(value: unknown): value is FilmFieldId {
    return typeof value === "string" && Object.values(FIELD_IDS).includes(value as FilmFieldId)
}

function isConfigurableFieldType(value: unknown): value is ConfigurableFieldType {
    return (
        value === "boolean" ||
        value === "date" ||
        value === "formattedText" ||
        value === "image" ||
        value === "link" ||
        value === "number" ||
        value === "string"
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}
