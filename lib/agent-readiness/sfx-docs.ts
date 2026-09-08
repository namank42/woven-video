import { SITE_URL } from "@/lib/seo/constants";

export const sfxIntro = "Find a sound, download its WAV file, and use it in your video, animation, or app. Woven SFX is an open-source sound-effects library with a browsable catalog, an agent skill, and a local MCP server. You do not need the Woven Mac app or a Woven account.";

export const sfxSections = [
  {
    title: "1. Install the agent skill",
    body: "Install Node.js and npm, then run this command from your project. Choose your agent in the installer. The add-sfx skill teaches the search-and-download workflow; installing it does not configure the MCP server.",
    code: "npx skills add woven-video/skills --skill add-sfx",
    language: "sh",
  },
  {
    title: "2. Connect the MCP server",
    body: "Configure your MCP client to launch npx with arguments -y and woven-sfx-mcp. This is a local stdio server, not a hosted HTTP endpoint. For clients using mcpServers JSON (such as Cursor or Claude Code), merge the entry below into your existing configuration. Replace the example library path with an absolute directory for your project. Other clients may use a different configuration format. Restart or reload the client and confirm all three sfx tools appear. No Woven API key is required; network access is needed to fetch the package, catalog, and audio.",
    code: JSON.stringify({ mcpServers: { "woven-sfx": { command: "npx", args: ["-y", "woven-sfx-mcp"], env: { WOVEN_SFX_LIBRARY: "/absolute/path/to/your-project/sounds/sfx" } } } }, null, 2),
    language: "json",
  },
  {
    title: "3. Search, download, and use a sound",
    body: "Ask your agent to find a short camera shutter, download it, and use the returned localPath in your edit. The calls below are MCP tool calls, not shell commands. sfx_search accepts optional query, tag, and limit (1–50); with no arguments it lists the catalog. Choose an actual result ID before calling sfx_pull. sfx_pull downloads the WAV into your local library and returns its path. sfx_list_installed lists local WAV files. Import that file into your editor or rendering pipeline and adjust timing and volume for the mix.",
    code: 'sfx_search({ query: "camera shutter", limit: 5 })\nsfx_pull({ id: "camera-shutter-release" })\nsfx_list_installed({})',
    language: "js",
  },
  {
    title: "Where files are saved",
    body: "The server resolves the library from WOVEN_SFX_LIBRARY first, then sfx-library in the nearest .claude/project.md, then ./sounds/sfx/ under its working directory. An absolute WOVEN_SFX_LIBRARY path is useful when a desktop client starts the server outside your project. Downloads write to that directory; use the localPath returned by sfx_pull rather than guessing a filename. The tools retrieve existing sound effects; they do not generate sounds, edit your timeline, or provide music and voiceover.",
  },
  {
    title: "Use the catalog without MCP",
    body: "Fetch the public catalog JSON and select an entry from sounds. Each entry includes id, duration_ms, tags, default_volume, file, url, and peaks_url. Download the WAV from its url; peaks_url points to waveform preview data. duration_ms is the sound length in milliseconds, and default_volume is a suggested starting gain. You can use this catalog from your own script without installing a skill or MCP server. No authentication is required.",
    code: `curl -fsSL ${SITE_URL}/sfx/catalog.json\n# Example WAV from the catalog:\ncurl -fL https://assets.sfx.woven.video/sfx/camera-shutter-release.wav -o camera-shutter-release.wav`,
    language: "sh",
  },
  {
    title: "Licensing",
    body: "The Woven SFX repository publishes its sound files under CC0 1.0 and its code under MIT. The sound license permits copying, modifying, distributing, and using the sounds for commercial or non-commercial purposes without asking permission. Read the linked sound license and code license for the full terms.",
  },
  {
    title: "Troubleshooting",
    body: "If the tools are missing, check MCP configuration separately from skill installation, confirm npx is available to the client, and restart it. If a search is empty, try concrete words such as whoosh, beep, camera, or glitch. If an ID is unknown, search again and use a returned ID. If a download fails, check network access to assets.sfx.woven.video and write access to your library directory. If files appear in the wrong project, set an absolute WOVEN_SFX_LIBRARY path and restart the server.",
  },
];

export const sfxLinks = [
  { title: "Browse and preview Woven SFX", url: `${SITE_URL}/sfx` },
  { title: "Sound catalog (JSON)", url: `${SITE_URL}/sfx/catalog.json` },
  { title: "Woven SFX source and setup instructions", url: "https://github.com/woven-video/woven-sfx" },
  { title: "MCP client setup reference", url: "https://github.com/woven-video/woven-sfx/blob/main/skills/add-sfx/references/mcp-setup.md" },
  { title: "Sound license (CC0 1.0)", url: "https://github.com/woven-video/woven-sfx/blob/main/SOUNDS_LICENSE" },
  { title: "Code license (MIT)", url: "https://github.com/woven-video/woven-sfx/blob/main/LICENSE" },
];

export const sfxDocsMarkdown = `# Woven SFX documentation\n\n${sfxIntro}\n\n${sfxSections.map(section => `## ${section.title}\n\n${section.body}${"code" in section ? `\n\n\`\`\`${section.language}\n${section.code}\n\`\`\`` : ""}`).join("\n\n")}\n\n## Resources\n\n${sfxLinks.map(link => `- [${link.title}](${link.url})`).join("\n")}\n`;
