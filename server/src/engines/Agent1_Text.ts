import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HighlightSegment, EngineResult, TranscriptItem } from '../types';
import { GoogleGenAI } from '@google/genai';

/**
 * Parse yt-dlp's json3 subtitle format into a flat list of transcript items.
 */
function parseJson3(json3Data: any): TranscriptItem[] {
  const events = json3Data.events || [];
  const items: TranscriptItem[] = [];

  for (const event of events) {
    if (!event.segs || event.aAppend) continue;
    
    const text = event.segs
      .map((s: any) => s.utf8 || '')
      .join('')
      .trim();
    
    if (!text || text === '\n') continue;

    items.push({
      text,
      offset: event.tStartMs || 0,
      duration: event.dDurationMs || 0
    });
  }

  return items;
}

/**
 * Fetch transcript using yt-dlp's subtitle extraction.
 */
function fetchTranscriptViaYtDlp(videoId: string, log: string[]): TranscriptItem[] | null {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-sub-'));
  const outputTemplate = path.join(tmpDir, '%(id)s');
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    log.push(`Calling yt-dlp to extract English auto-subtitles (json3 format)...`);
    const startTime = Date.now();
    
    execSync(
      `yt-dlp --write-auto-sub --sub-lang en --sub-format json3 --skip-download -o "${outputTemplate}" "${url}"`,
      { stdio: 'pipe', timeout: 30000 }
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`yt-dlp completed in ${elapsed}s`);

    const subtitleFile = path.join(tmpDir, `${videoId}.en.json3`);
    if (fs.existsSync(subtitleFile)) {
      const raw = fs.readFileSync(subtitleFile, 'utf-8');
      const fileSize = (raw.length / 1024).toFixed(1);
      log.push(`Subtitle file found: ${fileSize} KB`);
      
      const json3 = JSON.parse(raw);
      const totalEvents = (json3.events || []).length;
      log.push(`Raw json3 events: ${totalEvents}`);
      
      const items = parseJson3(json3);
      log.push(`Parsed into ${items.length} transcript segments (filtered out metadata/empty)`);
      
      if (items.length > 0) {
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        log.push(`Transcript covers ${(firstItem.offset / 1000).toFixed(1)}s to ${((lastItem.offset + lastItem.duration) / 1000).toFixed(1)}s`);
        
        // Show a sample of the transcript
        const sample = items.slice(0, 3).map(t => `  "${t.text}" @ ${(t.offset/1000).toFixed(1)}s`).join('\n');
        log.push(`First 3 segments:\n${sample}`);
      }
      
      return items;
    }

    log.push(`WARNING: yt-dlp ran but no subtitle file was created`);
    return null;
  } catch (err: any) {
    log.push(`ERROR: yt-dlp subtitle extraction failed: ${err.message}`);
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

export async function runAgent1Text(videoId: string, duration: number): Promise<EngineResult> {
  const log: string[] = [];
  
  try {
    log.push(`Starting Text Engine for video ${videoId} (${duration}s)`);
    const transcript = fetchTranscriptViaYtDlp(videoId, log);

    if (transcript && transcript.length > 0) {
      const numberedText = transcript.map((t, i) => `[ID:${i}] [${(t.offset / 1000).toFixed(1)}s] ${t.text}`).join('\n');
      log.push(`Built numbered transcript: ${numberedText.length} characters`);

      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey && numberedText.length > 50) {
        log.push(`Gemini API key found — running LLM semantic analysis...`);
        const ai = new GoogleGenAI({ apiKey: geminiKey });

        const promptChars = Math.min(numberedText.length, 80000);
        log.push(`Sending ${promptChars} chars of transcript to Gemini 2.5 Flash Lite`);

        const prompt = `
          You are an expert video editor. Analyze this YouTube transcript.
          The video is ${duration} seconds long. I need the most important 10% of the video's narrative arcs.
          Prioritize the video's conclusion and final thoughts, ensuring they are included fully.
          Explicitly ignore the initial intro, host introductions, sponsorships, and secondary speakers. Focus solely on the primary speaker's core message.
          Select complete thoughts and sentences so the audio doesn't cut off abruptly.
          Return ONLY a JSON array of objects representing the best highlight segments. 
          Format: [{"start_id": <ID>, "end_id": <ID>, "score": <0.0 to 1.0>, "reasoning": "<Why you chose this part>"}]
          Do not return markdown formatting, just the raw JSON.
          
          Transcript snippet:
          ${numberedText.slice(0, 80000)}
        `;

        try {
          const startTime = Date.now();
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: prompt,
          });
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          log.push(`Gemini responded in ${elapsed}s`);

          const rawJson = response.text || "[]";
          const cleaned = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
          log.push(`LLM response: ${cleaned.length} chars`);
          
          const parsed = JSON.parse(cleaned) as any[];
          log.push(`LLM selected ${parsed.length} highlight segments`);

          const highlights = parsed.map(p => {
            const startIndex = Number(p.start_id);
            const endIndex = Number(p.end_id);
            const startItem = transcript[startIndex];
            const endItem = transcript[endIndex] || transcript[startIndex];
            const nextItem = transcript[endIndex + 1];

            if (!startItem) return null;

            const endMs = nextItem 
              ? Math.min(endItem.offset + endItem.duration, nextItem.offset)
              : endItem.offset + endItem.duration;

            return {
              start: startItem.offset / 1000,
              end: endMs / 1000,
              score: Number(p.score) || 0.9,
              source: 'text' as const,
              reasoning: p.reasoning || "Selected by LLM semantic analysis.",
              startIndex,
              endIndex
            };
          }).filter(Boolean) as HighlightSegment[];

          log.push(`Mapped to ${highlights.length} valid highlight segments`);
          highlights.forEach((h, i) => {
            log.push(`  Segment ${i+1}: ${h.start.toFixed(1)}s → ${h.end.toFixed(1)}s (score: ${h.score?.toFixed(2)}) — ${h.reasoning}`);
          });

          return { engineName: 'Text', highlights, processingLog: log, transcript };
        } catch (e: any) {
          log.push(`WARNING: LLM failed: ${e.message}. Falling back to heuristics.`);
        }
      } else {
        log.push(`No Gemini API key set — using heuristic fallback`);
      }

      // Heuristic Fallback
      log.push(`Running heuristic: grouping transcript into blocks of 5 segments, taking first 5 blocks`);
      const highlights: HighlightSegment[] = [];

      for (let i = 0; i < transcript.length; i += 5) {
        if (highlights.length >= 5) break;

        const chunk = transcript.slice(i, i + 5);
        const start = chunk[0].offset / 1000;
        const end = (chunk[chunk.length - 1].offset + chunk[chunk.length - 1].duration) / 1000;

        highlights.push({
          start, end,
          score: 0.8,
          source: 'text',
          reasoning: "Heuristic: Found dense continuous speech block."
        });
      }

      log.push(`Heuristic produced ${highlights.length} segments`);
      return { engineName: 'Text', highlights, processingLog: log, transcript };
    }

    // No transcript
    log.push(`No transcript available — returning structural fallback (10% and 60% marks)`);
    const highlights: HighlightSegment[] = [
      {
        start: Math.floor(duration * 0.1),
        end: Math.floor(duration * 0.1) + 12,
        score: 0.6, source: 'text',
        reasoning: "No subtitles available. Structural default (10% mark)."
      },
      {
        start: Math.floor(duration * 0.6),
        end: Math.floor(duration * 0.6) + 10,
        score: 0.65, source: 'text',
        reasoning: "No subtitles available. Structural default (60% mark)."
      }
    ];

    return { engineName: 'Text', highlights, processingLog: log };

  } catch (error: any) {
    log.push(`FATAL ERROR: ${error.message}`);
    return { engineName: 'Text', highlights: [], error: error.message, processingLog: log };
  }
}
