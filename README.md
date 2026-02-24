# ShortTube

**Watch the best moments — skip the rest.**

ShortTube is an AI-powered YouTube video summariser that automatically identifies and plays only the most important ~10% of any YouTube video. Paste a URL, and the app analyses the video using three independent "engines" that run in parallel, then merges their results through a consensus algorithm to produce a seamless highlight reel that plays directly in the browser.

---

## How It Works

ShortTube uses a **multi-engine architecture** where three specialised analysis engines run concurrently against the same video, each using a different signal to identify important moments. A consensus layer then merges, deduplicates, and quota-trims their outputs into a final highlight set.

### Analysis Engines

| Engine | Signal Source | How It Works |
|---|---|---|
| **Text** | Transcript + Gemini LLM | Extracts auto-generated subtitles via `yt-dlp`, numbers each segment, and sends the transcript to **Gemini 2.5 Flash Lite** with a prompt asking it to select the most narratively important ~10%. Falls back to heuristic chunking if no API key is set. |
| **Heatmap** | YouTube replay heatmap | Fetches the audience engagement heatmap (the "most replayed" data) via `yt-dlp --dump-json` and selects the segments with the highest replay intensity — sections that viewers rewatch most often. |
| **Curation** | Chapters & metadata | Reads native YouTube chapters or parses timestamp markers from the video description. Samples the start of each chapter as a highlight. Falls back to structural defaults if no chapters exist. |

### Consensus Algorithm

1. All engine results are pooled and sorted chronologically.
2. Overlapping or near-adjacent segments (within 3 seconds) are merged, with scores boosted for overlaps.
3. Merged segments are ranked by score and selected greedily until the **10% duration quota** is met (soft limit — segments are never truncated mid-sentence).
4. A maximum jump count is enforced (10 jumps per minute of summary) to keep the viewing experience coherent.

### Streaming Architecture

Analysis progress is streamed to the frontend in real time via **Server-Sent Events (SSE)**. As each engine completes, its results appear immediately in the UI — you don't have to wait for all three to finish before seeing progress.

---

## Project Structure

```
short-tube/
├── index.html                  # Vite entry point
├── package.json                # Root package — runs both client & server
├── vite.config.ts              # Vite config with /api proxy to backend
├── server/                     # Express backend (port 3001)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # Express app — REST + SSE endpoints
│       ├── types.ts            # Shared types (HighlightSegment, EngineResult, etc.)
│       ├── ConsensusEngine.ts  # Orchestrator — runs engines, merges, enforces quotas
│       └── engines/
│           ├── Agent1_Text.ts      # Transcript + Gemini LLM engine
│           ├── Agent2_Heatmap.ts   # YouTube replay heatmap engine
│           └── Agent4_Curation.ts  # Chapters / description timestamp engine
└── src/                        # React frontend (Vite + TypeScript)
    ├── main.tsx                # React DOM entry
    ├── App.tsx                 # Main UI — search bar, video player, timeline, debug logs
    ├── App.css                 # All styling
    ├── index.css               # Base/reset styles
    ├── components/
    │   └── YouTubePlayer.tsx   # YouTube embed + highlight playback controller
    └── utils/
        ├── youtube.ts          # YouTube URL parser
        └── engine.ts           # SSE client, types, legacy batch fallback
```

---

## Prerequisites

Before running ShortTube, make sure you have the following installed:

| Requirement | Version | Purpose |
|---|---|---|
| **Node.js** | v18+ | Runtime for both client and server |
| **npm** | v9+ | Package management (comes with Node.js) |
| **yt-dlp** | Latest | Fetches subtitles, heatmap data, and metadata from YouTube |

### Installing yt-dlp

```bash
# macOS (Homebrew)
brew install yt-dlp

# Linux
sudo apt install yt-dlp
# or
pip install yt-dlp

# Windows
winget install yt-dlp
```

### Gemini API Key (Required)

The Text engine uses Google's **Gemini 2.5 Flash Lite** model to perform semantic analysis of the video transcript. You need a Gemini API key for this to work.

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) and create an API key.
2. Create a `.env` file in the `server/` directory:

```bash
echo "GEMINI_API_KEY=your_api_key_here" > server/.env
```

> **Note:** Without a Gemini API key, the Text engine will fall back to a basic heuristic that groups transcript segments into blocks — the results will be significantly less accurate. The Heatmap and Curation engines do not require an API key.

---

## Getting Started

### 1. Install dependencies

```bash
# Install root (client) dependencies
npm install

# Install server dependencies
npm install --prefix server
```

### 2. Set up your API key

```bash
# Create the server .env file with your Gemini key
echo "GEMINI_API_KEY=your_api_key_here" > server/.env
```

### 3. Run the app

```bash
npm start
```

This starts both the **Vite dev server** (frontend, default port 5173) and the **Express backend** (port 3001) concurrently. The Vite config proxies all `/api` requests to the backend automatically.

Open [http://localhost:5173](http://localhost:5173) in your browser, paste a YouTube URL, and hit **Summarize**.

### Other Commands

| Command | Description |
|---|---|
| `npm run dev` | Start only the frontend dev server |
| `npm run server` | Start only the backend server |
| `npm start` | Start both frontend and backend concurrently |
| `npm run build` | Production build (TypeScript check + Vite bundle) |
| `npm run lint` | Run ESLint |
| `npm run clean` | Remove `dist/` build artifacts |
| `npm run reset` | Full reset — removes `node_modules`, lock files, and build artifacts |

---

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, react-youtube, Lucide Icons  
**Backend:** Express 5, TypeScript, Google GenAI SDK (`@google/genai`), yt-dlp (via `child_process`)  
**AI Model:** Gemini 2.5 Flash Lite  

---

## License

MIT — see [LICENSE](./LICENSE) for details.
