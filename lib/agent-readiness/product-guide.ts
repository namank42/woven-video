import { SITE_URL, DOWNLOAD_URL } from "@/lib/seo/constants";

export const productGuideVersion = "0.1.85";
export const productGuideChecked = "September 8, 2026";
export const productGuideIntro = "Woven is a native Mac video editor with an AI agent and a visual timeline. Work with your own footage, generate new media, study references, and combine video, images, text, captions, music, and sound effects in a local project. It is focused on short-form video, including Reels, TikToks, Shorts, product demos, and ads.";

export const productGuideSections = [
  {
    id: "getting-started", title: "Get started on Mac",
    paragraphs: ["Woven requires macOS 15 or later. Download the app, sign in to your Woven account, and complete trial or subscription setup. Choose how to access chat models, then open a folder as your workspace. You can continue onboarding without adding a video and import footage later.", "Start with a concrete request such as: ‘Turn these clips into a 30-second vertical product demo with captions.’ You can ask for a script or shot list first, bring existing media, or generate assets before assembling the edit."],
  },
  {
    id: "workspaces", title: "Projects, files, and versions",
    paragraphs: ["A workspace is a folder on your Mac. It can hold footage, images, audio, scripts, brand references, notes, and multiple reels. Browse and preview files in the sidebar, and open reel documents in the editor.", "Reels are saved as .reel.json documents that refer to their media files. New reels created without an explicit path go in the workspace’s reels folder. Keep the referenced assets with your reel when copying or backing up a project; the reel document does not embed every source file. Separate reel documents can reuse the same assets for different cuts."],
  },
  {
    id: "chat-and-timeline", title: "Edit by chat and by hand",
    paragraphs: ["Ask Woven to assemble or revise the reel open in the editor, then refine it using the timeline and canvas. The agent can read the current editor state, including unsaved edits, and apply validated reel changes. You can continue editing visually after an agent edit.", "Arrange, trim, split, duplicate, delete, and move clips. Select multiple clips with Command-click, a marquee, or Command-A; use undo and redo to revise changes. Drag media from the sidebar or Finder onto the timeline. Imported files are copied into the reel workspace. Stack picture layers for backgrounds, overlays, and picture-in-picture, and position or resize elements on the canvas."],
  },
  {
    id: "picture", title: "Video, images, and framing",
    paragraphs: ["Import video (MP4, MOV, M4V, WebM), images (PNG, JPG/JPEG, WebP, GIF), and audio (MP3, WAV, M4A, AAC, FLAC). Decoding still depends on the file’s actual codec and validity. Combine source video with still images, logos, and overlays. Adjust clip position, size, rotation, timing, and video speed. Choose a vertical, horizontal, or square canvas for the intended destination. Picture controls include Fit or Fill, crop and zoom, rounded corners, shadows, and entrance animations.", "Use the Framing inspector for zoom effects: inspect the thumbnail, adjust zoom, reset framing, and drag the focal point on the canvas. Review the result during playback before exporting."],
  },
  {
    id: "effects", title: "Native effects and transitions",
    paragraphs: ["Woven includes 12 native visual effects that can be added in the editor or requested in chat: Push-in, Pull-out, Punch, Drift, Shake, Focus Zoom, Whip Zoom, Glitch, Flash, Blur Pulse, Whip Pan, and Glass Break. Effects have timing controls so they can land on a reveal, beat, or transition. Overlapping effects do not stack: the active effect with the latest start time takes precedence.", "Add transitions between adjacent video clips, including fades, slides, wipes, whoosh, flash, zoom blur, pull-in/out, smear, and glitch treatments. Transition duration is limited to 0.05 to 2 seconds, and each adjacent clip needs at least two rendered frames. The preview and export use the native renderer. An effect changes the composition; changing a clip’s playback speed is a separate edit."],
  },
  {
    id: "captions", title: "Captions and text",
    paragraphs: ["Generate captions from speech, then edit caption text, timing, and appearance. Apply a style to all captions or customize an individual caption, with a way to revert an individual override. Add separate text overlays for titles, hooks, and callouts.", "Caption modes are Highlight, Subtitle, Word by word, and Progressive reveal. Controls include font, size, case, alignment, width, color, stroke, and entrance animation. Move the playhead onto a caption to edit its text. Word by word captions show one active word at a time. Progressive reveal accumulates words as they are spoken. Review generated transcription and timings before publishing, especially names and specialist terms. Caption generation shows progress and failure details in the editor. Updating existing captions replaces the transcript and resets per-caption styling and positions; the editor asks you to confirm replacement. Generate the transcript before investing in individual caption styling."],
  },
  {
    id: "audio", title: "Voice, music, and sound effects",
    paragraphs: ["Mix source-video audio, narration, music, and sound effects. Trim or split audio at the playhead, adjust volume, and use fades. The reel audio model also supports looping, volume ducking, and swells for changes such as lowering music beneath narration.", "Browse the built-in SFX library for sounds such as whooshes, clicks, and impacts. You can also import your own audio. Voice and other generated audio depend on the media provider or hosted model selected for the request."],
  },
  {
    id: "media-generation", title: "Generate images, video, and audio",
    paragraphs: ["Use Woven Credits to access the available hosted media models, or choose Connected Providers to use your configured provider integrations. Generation runs as a background job; Woven can check its status and bring completed outputs into the workspace for editing.", "Supported inputs, durations, resolutions, and prices depend on the selected model. Some models accept reference images or other local assets; relevant inputs are uploaded when required by the service. Check the available model options and current pricing instead of assuming every model supports the same controls."],
  },
  {
    id: "reference-analysis", title: "Study a reference video",
    paragraphs: ["Ask Woven to analyze a local video or a supported public video URL. The reference workflow can download the video, extract frames and audio, transcribe speech with word timings, and attempt song identification with Shazam. It then helps explain the hook, pacing, shot structure, and sound design.", "Use the analysis as a starting point for a new script or edit. Download availability depends on the source site and access restrictions; song identification can return no match. The workflow is not limited to short-form source videos."],
  },
  {
    id: "brand", title: "Work from a website’s brand",
    paragraphs: ["Give Woven a public company website and ask it to extract the brand for a video. The bundled brand workflow uses a browser to inspect the site and collect a logo, colors, font information, and a reusable brand document in your workspace.", "Review the extracted assets before using them. Website structure and available brand materials affect what can be recovered. Once saved, the brand reference can inform follow-up requests for intros, ads, and other edits."],
  },
  {
    id: "skills-and-memory", title: "Reuse skills and project memory",
    paragraphs: ["Woven includes reference-video analysis and brand-extraction skills. It also discovers user skills from supported .woven, .agents, .claude, and .codex skill folders at project and user level. Enable discovered user skills in Settings; bundled skills are available by default.", "Use skills for repeatable workflows and project memory for context you want to retain. Woven provides memory read, save, and forget operations, and optional workspace memory sharing with Claude Code when it is available. Review the enabled skills and memory settings for each workspace."],
  },
  {
    id: "models-and-connections", title: "Models and integrations",
    paragraphs: ["For chat, choose Woven-hosted models using credits, bring your own Anthropic or OpenAI API key, or sign in with ChatGPT for supported Codex access. Available models and account limits depend on the selected connection. The Woven subscription, chat-model access, and media-generation charges are separate considerations.", "Connect additional tools through local or remote MCP servers in Settings. Woven supports importing MCP configuration, managing server enablement, and disabling individual tools. Featured connections include fal and ElevenLabs using your own provider credentials. Configuring a server makes its tools available to Woven’s agent; it does not turn the Mac editor into a public web API."],
  },
  {
    id: "export", title: "Preview and export",
    paragraphs: ["Play and scrub the reel in the native preview, then export an H.264 MP4 through the native renderer with 1080p or 1440p output options. Choose 24, 25, 30, 50, 60, or 120 fps. Empty reels default to 30 fps. A reel created from a video uses its source frame rate, adjusted to a supported value; importing another clip later does not change the project frame rate. Choose the canvas shape for the destination rather than assuming every reel must be vertical.", "Exports go to the active workspace’s exports folder with timestamped filenames so previous exports are not replaced. Track export progress or cancel it in the editor. Only one reel render runs at a time. Review the finished file for picture, captions, and audio before uploading it to your chosen platform. Woven’s editor workflow produces a video file; direct social publishing is not part of this guide."],
  },
  {
    id: "local-and-online", title: "Local work and online services",
    paragraphs: ["Workspace files, reel documents, native preview, and rendering live on your Mac. That does not mean every feature is offline: account access, AI chat, hosted generation, connected providers, web research, and downloads use network services.", "Content needed for a model or tool request may be sent to the selected service, including media inputs where required. Settings include file-path and network access controls. Review requested permissions and the relevant provider terms; a local project is not a promise that its contents never leave the device."],
  },
  {
    id: "troubleshooting", title: "Updates and troubleshooting",
    paragraphs: ["Available app updates appear in the top bar with download and installation progress. Follow restart prompts and save work; Woven checks for active exports before restarting.", "For missing media, check that the files still exist at the paths referenced by the reel. For a failed generation, inspect its status, provider connection, and balance. For export errors, check the reported clip and source duration. If access is paused, check the account and billing recovery message. Send feedback or contact support with the error and steps that reproduce it."],
  },
];

export const productGuideLinks = [
  { title: "Download Woven for Mac", url: DOWNLOAD_URL },
  { title: "Current pricing and trial terms", url: `${SITE_URL}/pricing` },
  { title: "Release notes", url: `${SITE_URL}/changelog` },
  { title: "Woven SFX documentation", url: `${SITE_URL}/docs` },
  { title: "Privacy policy", url: `${SITE_URL}/privacy` },
  { title: "Contact Woven", url: `${SITE_URL}/contact` },
];

export const productGuideMarkdown = `# Woven product guide\n\n${productGuideIntro}\n\nCovers Woven ${productGuideVersion}. Checked ${productGuideChecked}.\n\n${productGuideSections.map(section => `## ${section.title}\n\n${section.paragraphs.join("\n\n")}`).join("\n\n")}\n\n## Product resources\n\n${productGuideLinks.map(link => `- [${link.title}](${link.url})`).join("\n")}\n`;
