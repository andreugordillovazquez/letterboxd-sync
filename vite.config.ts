import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import framer from "vite-plugin-framer"
import mkcert from "vite-plugin-mkcert"

export default defineConfig({
    plugins: [react(), mkcert(), framer()],
    server: {
        proxy: {
            "/letterboxd-rss": {
                target: "https://letterboxd.com",
                changeOrigin: true,
                rewrite: path => path.replace(/^\/letterboxd-rss/, ""),
            },
        },
    },
})
