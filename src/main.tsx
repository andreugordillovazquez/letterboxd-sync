import "framer-plugin/framer.css"

import { FramerPluginClosedError, framer, type ManagedCollection } from "framer-plugin"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { configureFilmsCollection, parseFieldConfigs, type FilmFieldConfig } from "./fields"
import { getFriendlyErrorMessage, PLUGIN_DATA_KEYS, syncLetterboxdDiary, SYNC_PROTECTED_METHODS } from "./sync"
import type { SlugStrategy } from "./types"

const activeCollection = await framer.getActiveManagedCollection()
const previousUsername = await getStoredPluginData(activeCollection, PLUGIN_DATA_KEYS.username)
const previousFieldConfigs = parseFieldConfigs(
    await getStoredPluginData(activeCollection, PLUGIN_DATA_KEYS.fieldConfigs)
)
const previousSlugStrategy = parseSlugStrategy(
    await getStoredPluginData(activeCollection, PLUGIN_DATA_KEYS.slugStrategy)
)

if (framer.mode === "syncManagedCollection") {
    await runBackgroundSync(activeCollection, previousUsername, previousFieldConfigs, previousSlugStrategy)
} else {
    const root = document.getElementById("root")
    if (!root) throw new Error("Root element not found")

    createRoot(root).render(
        <StrictMode>
            <App
                collection={activeCollection}
                initialUsername={previousUsername}
                initialFieldConfigs={previousFieldConfigs}
                initialSlugStrategy={previousSlugStrategy}
            />
        </StrictMode>
    )
}

async function runBackgroundSync(
    collection: ManagedCollection,
    username: string | null,
    fieldConfigs: readonly FilmFieldConfig[],
    slugStrategy: SlugStrategy
) {
    if (!username) {
        framer.closePlugin("Configure first", { variant: "warning" })
        return
    }

    if (!framer.isAllowedTo(...SYNC_PROTECTED_METHODS)) {
        framer.closePlugin("Insufficient CMS permissions", { variant: "error" })
        return
    }

    try {
        await framer.setBackgroundMessage("Fetching diary...")
        await configureFilmsCollection(collection, fieldConfigs)
        const result = await syncLetterboxdDiary(collection, username, {
            pluginDataStore: collection,
            fieldConfigs,
            slugStrategy,
        })
        framer.closePlugin(`Synced ${result.count} films`, { variant: "success" })
    } catch (error) {
        if (error instanceof FramerPluginClosedError) return

        console.error(error)
        framer.closePlugin(getFriendlyErrorMessage(error), { variant: "error" })
    }
}

async function getStoredPluginData(collection: ManagedCollection, key: string): Promise<string | null> {
    const collectionValue = await collection.getPluginData(key)
    if (collectionValue !== null) return collectionValue

    // Migration fallback for older development builds that used project-level plugin data.
    return framer.getPluginData(key)
}

function parseSlugStrategy(value: string | null): SlugStrategy {
    switch (value) {
        case "title":
        case "title-year":
        case "title-watched-date":
        case "letterboxd-id":
            return value
        default:
            return "title-watched-date"
    }
}
