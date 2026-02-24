import { execSync } from 'child_process';
import { HighlightSegment, EngineResult } from '../types';

export async function runAgent2Heatmap(videoId: string, duration: number): Promise<EngineResult> {
  const log: string[] = [];
  
  try {
    log.push(`Starting Heatmap Engine for video ${videoId} (${duration}s)`);
    log.push(`Fetching heatmap data using yt-dlp...`);
    
    const startTime = Date.now();
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Execute yt-dlp synchronously - we only dump json and don't download
    const stdout = execSync(
      `yt-dlp --dump-json --skip-download --no-warnings --no-playlist "${url}"`,
      { maxBuffer: 1024 * 1024 * 50, timeout: 30000 } // 50MB buffer
    );
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`yt-dlp completed in ${elapsed}s`);
    
    const data = JSON.parse(stdout.toString());
    
    if (!data.heatmap || data.heatmap.length === 0) {
      log.push(`No heatmap data available in yt-dlp dump for this video`);
      log.push(`This can happen for: new videos, private videos, or videos with low view counts`);
      throw new Error("No heatmap data available.");
    }

    const markers = data.heatmap;
    log.push(`Received ${markers.length} heat markers spanning the video`);
    
    // Show intensity distribution
    const intensities = markers.map((m: any) => m.value || 0);
    const avgIntensity = intensities.reduce((a: number, b: number) => a + b, 0) / intensities.length;
    const maxIntensity = Math.max(...intensities);
    const minIntensity = Math.min(...intensities);
    log.push(`Intensity range: ${minIntensity.toFixed(3)} to ${maxIntensity.toFixed(3)} (avg: ${avgIntensity.toFixed(3)})`);
    
    // Sort by intensity score
    const sorted = [...markers].sort((a: any, b: any) => (b.value || 0) - (a.value || 0));

    // Take top 10 most intense segments
    const topMarkers = sorted.slice(0, 10);
    log.push(`Selected top ${topMarkers.length} segments by audience replay intensity:`);
    
    const highlights: HighlightSegment[] = topMarkers.map((m: any, i: number) => {
      const startSec = m.start_time;
      const endSec = m.end_time;
      const intensity = m.value || 0;
      
      const peakPercentage = maxIntensity > 0 ? (intensity / maxIntensity) * 100 : 0;
      log.push(`  #${i+1}: ${startSec.toFixed(1)}s → ${endSec.toFixed(1)}s (intensity: ${intensity.toFixed(3)}, ${peakPercentage.toFixed(1)}% of peak)`);
      
      const normalizedScore = maxIntensity > 0 ? (intensity / maxIntensity) : intensity;
      
      return {
        start: startSec,
        end: endSec,
        score: Math.min(normalizedScore, 1.0), // Cap at 1.0
        source: 'heatmap' as const,
        reasoning: `High audience engagement — ${(peakPercentage).toFixed(0)}% replay intensity relative to peak (viewers frequently rewatch this section)`
      }
    });

    log.push(`Produced ${highlights.length} highlight segments`);
    return { engineName: 'Heatmap', highlights, processingLog: log };

  } catch (error: any) {
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
        log.push(`ERROR: yt-dlp timed out getting heatmap data.`);
    } else {
        log.push(`ERROR: ${error.message}`);
    }
    return { engineName: 'Heatmap', highlights: [], error: error.message, processingLog: log };
  }
}
