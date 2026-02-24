import { execSync } from 'child_process';
import { HighlightSegment, EngineResult } from '../types';

interface YtDlpMetadata {
  title?: string;
  description?: string;
  duration?: number;
  chapters?: { start_time: number; end_time: number; title: string }[];
}

function fetchVideoMetadata(videoId: string, log: string[]): YtDlpMetadata | null {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    log.push(`Calling yt-dlp --dump-json to fetch video metadata...`);
    const startTime = Date.now();
    
    const output = execSync(
      `yt-dlp --dump-json --skip-download "${url}"`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const jsonStr = output.toString();
    log.push(`yt-dlp responded in ${elapsed}s (${(jsonStr.length / 1024).toFixed(1)} KB of metadata)`);

    const metadata = JSON.parse(jsonStr) as YtDlpMetadata;
    
    if (metadata.title) log.push(`Video title: "${metadata.title}"`);
    if (metadata.duration) log.push(`Video duration: ${metadata.duration}s`);
    if (metadata.description) {
      const descPreview = metadata.description.slice(0, 200).replace(/\n/g, ' ');
      log.push(`Description preview: "${descPreview}${metadata.description.length > 200 ? '...' : ''}"`);
    }
    
    return metadata;
  } catch (err: any) {
    log.push(`ERROR: yt-dlp metadata fetch failed: ${err.message}`);
    return null;
  }
}

export async function runAgent4Curation(videoId: string, duration: number): Promise<EngineResult> {
  const log: string[] = [];
  
  try {
    log.push(`Starting Curation Engine for video ${videoId} (${duration}s)`);
    const metadata = fetchVideoMetadata(videoId, log);
    let highlights: HighlightSegment[] = [];

    if (metadata) {
      const chapters = metadata.chapters || [];

      if (chapters.length > 0) {
        log.push(`Found ${chapters.length} native chapters via yt-dlp:`);
        for (const chap of chapters) {
          const chapDuration = chap.end_time - chap.start_time;
          log.push(`  "${chap.title}" — ${chap.start_time.toFixed(0)}s to ${chap.end_time.toFixed(0)}s (${chapDuration.toFixed(0)}s)`);
          
          highlights.push({
            start: chap.start_time,
            end: Math.min(chap.start_time + 10, duration),
            score: 0.9,
            source: 'curation',
            reasoning: `Chapter marker: "${chap.title}" (${chapDuration}s chapter, sampling first 10s)`
          });
        }
        log.push(`Produced ${highlights.length} highlight segments from chapters`);
      } else {
        log.push(`No native chapters found`);
        
        // Try to parse timestamps from description
        const desc = metadata.description || '';
        const chapterRegex = /(?:^|\n)(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/g;
        let match;
        const parsedChapters: { timeSec: number; title: string }[] = [];

        while ((match = chapterRegex.exec(desc)) !== null) {
          const timeStr = match[1];
          const title = match[2];
          const parts = timeStr.split(':').map(Number);
          let sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
          parsedChapters.push({ timeSec: sec, title });
        }

        if (parsedChapters.length > 0) {
          log.push(`Parsed ${parsedChapters.length} timestamp markers from description:`);
          for (const chap of parsedChapters) {
            log.push(`  "${chap.title}" @ ${chap.timeSec}s`);
            highlights.push({
              start: chap.timeSec,
              end: Math.min(chap.timeSec + 10, duration),
              score: 0.85,
              source: 'curation',
              reasoning: `Description timestamp: "${chap.title}"`
            });
          }
          log.push(`Produced ${highlights.length} highlight segments from description`);
        } else {
          log.push(`No timestamps found in description either — using structural fallback`);
          highlights.push({
            start: Math.floor(duration * 0.1),
            end: Math.floor(duration * 0.1) + 10,
            score: 0.7,
            source: 'curation',
            reasoning: "No chapters or description timestamps found. Structural default."
          });
        }
      }
    } else {
      log.push(`Metadata unavailable — using structural fallback`);
      highlights.push({
        start: Math.floor(duration * 0.1),
        end: Math.floor(duration * 0.1) + 10,
        score: 0.5,
        source: 'curation',
        reasoning: "Video metadata could not be retrieved. Structural default."
      });
    }

    return { engineName: 'Curation', highlights, processingLog: log };

  } catch (error: any) {
    log.push(`FATAL ERROR: ${error.message}`);
    return { engineName: 'Curation', highlights: [], error: error.message, processingLog: log };
  }
}
