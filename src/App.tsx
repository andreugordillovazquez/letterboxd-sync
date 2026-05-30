import "./App.css"

import { FramerPluginClosedError, framer, type ManagedCollection, useIsAllowedTo } from "framer-plugin"
import { type FormEvent, useLayoutEffect, useRef, useState } from "react"
import { configureFilmsCollection, FIELD_IDS, serializeFieldConfigs, type FilmFieldConfig } from "./fields"
import {
    fetchDiaryEntries,
    getFriendlyErrorMessage,
    LetterboxdSyncError,
    normalizeUsername,
    PLUGIN_DATA_KEYS,
    syncDiaryEntries,
    SYNC_PROTECTED_METHODS,
} from "./sync"
import type { LetterboxdDiaryEntry, SlugStrategy } from "./types"

interface AppProps {
    collection: ManagedCollection
    initialUsername: string | null
    initialFieldConfigs: FilmFieldConfig[]
    initialSlugStrategy: SlugStrategy
}

type Step = "username" | "fields"
type Status = "idle" | "fetching" | "syncing" | "error"

const USERNAME_SCREEN_FALLBACK_HEIGHT = 287

export function App({ collection, initialUsername, initialFieldConfigs, initialSlugStrategy }: AppProps) {
    const screenRef = useRef<HTMLElement | null>(null)
    const [step, setStep] = useState<Step>("username")
    const [username, setUsername] = useState(initialUsername ?? "")
    const [entries, setEntries] = useState<LetterboxdDiaryEntry[]>([])
    const [fieldConfigs, setFieldConfigs] = useState(initialFieldConfigs)
    const [slugStrategy, setSlugStrategy] = useState<SlugStrategy>(initialSlugStrategy)
    const [status, setStatus] = useState<Status>("idle")
    const [errorMessage, setErrorMessage] = useState("")
    const isAllowedToSync = useIsAllowedTo(...SYNC_PROTECTED_METHODS)
    const isBusy = status === "fetching" || status === "syncing"
    const canSubmitUsername = normalizeUsername(username).length > 0

    useLayoutEffect(() => {
        const isFieldStep = step === "fields"
        const measuredHeight = Math.ceil(screenRef.current?.getBoundingClientRect().height ?? 0)
        const height = isFieldStep ? 425 : measuredHeight || USERNAME_SCREEN_FALLBACK_HEIGHT

        framer.showUI({
            width: isFieldStep ? 360 : 260,
            height,
            minWidth: isFieldStep ? 360 : undefined,
            minHeight: isFieldStep ? 425 : undefined,
            resizable: isFieldStep,
        })
    }, [status, step])

    const handleUsernameSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        const normalizedUsername = normalizeUsername(username)
        if (!normalizedUsername) {
            setStatus("idle")
            framer.notify("Enter a Letterboxd username.", { variant: "error" })
            return
        }

        try {
            setStatus("fetching")
            setErrorMessage("")
            setUsername(normalizedUsername)

            const fetchedEntries = await fetchDiaryEntries(normalizedUsername)
            setEntries(fetchedEntries)
            setStatus("idle")
            setStep("fields")
        } catch (error) {
            if (error instanceof FramerPluginClosedError) return

            setStatus("idle")
            framer.notify(getUsernameErrorMessage(error), { variant: "error" })
        }
    }

    const handleFieldSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        try {
            setStatus("syncing")
            setErrorMessage("")
            await framer.setCloseWarning("Letterboxd Sync is still updating your collection.")

            await configureFilmsCollection(collection, fieldConfigs)
            await collection.setPluginData(PLUGIN_DATA_KEYS.username, username)
            await collection.setPluginData(PLUGIN_DATA_KEYS.fieldConfigs, serializeFieldConfigs(fieldConfigs))
            await collection.setPluginData(PLUGIN_DATA_KEYS.slugStrategy, slugStrategy)

            const result = await syncDiaryEntries(collection, entries, collection, fieldConfigs, slugStrategy)
            await framer.setCloseWarning(false)
            framer.closePlugin(`Sync completed. Synced ${result.count} films.`, { variant: "success" })
        } catch (error) {
            if (error instanceof FramerPluginClosedError) return

            await framer.setCloseWarning(false)
            console.error(error)
            setStatus("error")
            setErrorMessage(getFriendlyErrorMessage(error))
        }
    }

    const updateFieldName = (fieldId: FilmFieldConfig["id"], name: string) => {
        setFieldConfigs(configs => configs.map(config => (config.id === fieldId ? { ...config, name } : config)))
    }

    const toggleField = (fieldId: FilmFieldConfig["id"]) => {
        if (fieldId === FIELD_IDS.title) return

        setFieldConfigs(configs =>
            configs.map(config => (config.id === fieldId ? { ...config, enabled: !config.enabled } : config))
        )
    }

    if (step === "fields") {
        return (
            <main className="field-setup framer-hide-scrollbar" ref={screenRef}>
                <form onSubmit={handleFieldSubmit}>
                    <label className="slug-field" htmlFor="slugField">
                        Slug Field
                        <select
                            id="slugField"
                            value={slugStrategy}
                            disabled={isBusy}
                            onChange={event => setSlugStrategy(event.target.value as SlugStrategy)}
                        >
                            <option value="title">Title</option>
                            <option value="title-year">Title + Year</option>
                            <option value="title-watched-date">Title + Watched Date</option>
                            <option value="letterboxd-id">Letterboxd ID</option>
                        </select>
                    </label>

                    <div className="fields">
                        <span className="fields-column">Column</span>
                        <span>Field</span>
                        {fieldConfigs.map(config => (
                            <FieldConfigRow
                                key={config.id}
                                config={config}
                                disabled={isBusy}
                                onNameChange={updateFieldName}
                                onToggle={toggleField}
                            />
                        ))}
                    </div>

                    {status === "error" ? (
                        <div className="status-panel error-panel" role="alert">
                            <span>{errorMessage}</span>
                            <button type="button" onClick={() => setStatus("idle")}>
                                Try again
                            </button>
                        </div>
                    ) : null}

                    <footer className="field-footer">
                        <hr />
                        <button
                            type="submit"
                            disabled={isBusy || !isAllowedToSync}
                            title={isAllowedToSync ? undefined : "Insufficient permissions"}
                        >
                            {status === "syncing" ? <div className="framer-spinner" /> : "Import from Letterboxd"}
                        </button>
                    </footer>
                </form>
            </main>
        )
    }

    return (
        <main className="setup" ref={screenRef}>
            <Intro />
            <form onSubmit={handleUsernameSubmit}>
                <label className="username-field" htmlFor="username">
                    <span className="visually-hidden">Letterboxd username</span>
                    <div className="username-input">
                        <span aria-hidden="true">@</span>
                        <input
                            id="username"
                            name="username"
                            type="text"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder="username"
                            value={username}
                            onChange={event => setUsername(event.target.value)}
                            disabled={isBusy}
                        />
                    </div>
                </label>

                <button type="submit" disabled={isBusy || !isAllowedToSync || !canSubmitUsername}>
                    {status === "fetching" ? <div className="framer-spinner" /> : "Next"}
                </button>
            </form>
        </main>
    )
}

interface FieldConfigRowProps {
    config: FilmFieldConfig
    disabled: boolean
    onNameChange: (fieldId: FilmFieldConfig["id"], name: string) => void
    onToggle: (fieldId: FilmFieldConfig["id"]) => void
}

function FieldConfigRow({ config, disabled, onNameChange, onToggle }: FieldConfigRowProps) {
    const canDisable = config.id !== FIELD_IDS.title

    return (
        <>
            <button
                type="button"
                className={`source-field ${config.enabled ? "" : "ignored"}`}
                onClick={() => onToggle(config.id)}
                disabled={disabled}
                aria-pressed={config.enabled}
                title={canDisable ? undefined : "Title is required"}
            >
                <span className="checkmark" aria-hidden="true">
                    {config.enabled ? "✓" : ""}
                </span>
                <span>{config.sourceName}</span>
            </button>
            <span className="map-arrow" aria-hidden="true">
                ›
            </span>
            <input
                type="text"
                disabled={disabled || !config.enabled}
                placeholder={config.sourceName}
                value={config.name}
                onChange={event => onNameChange(config.id, event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") {
                        event.preventDefault()
                    }
                }}
            />
        </>
    )
}

function Intro() {
    return (
        <header className="intro">
            <div className="logo">
                <img src="/logo.svg" width="30" height="30" alt="" />
            </div>
            <div className="content">
                <h2>Letterboxd Sync</h2>
                <p>Sync your Letterboxd diary into a CMS collection. Updates each time you run the plugin.</p>
                <a href="https://letterboxd.com" target="_blank" rel="noreferrer">
                    Powered by Letterboxd RSS
                </a>
            </div>
        </header>
    )
}

function getUsernameErrorMessage(error: unknown): string {
    if (error instanceof LetterboxdSyncError) {
        switch (error.code) {
            case "profile_not_found":
            case "no_diary_entries":
                return "No profile found under this username."
            default:
                return error.message
        }
    }

    return getFriendlyErrorMessage(error)
}
