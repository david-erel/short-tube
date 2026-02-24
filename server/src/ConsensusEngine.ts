import { HighlightSegment, EngineResult, TranscriptItem } from './types';
import { runAgent1Text } from './engines/Agent1_Text';
import { runAgent2Heatmap } from './engines/Agent2_Heatmap';
import { runAgent4Curation } from './engines/Agent4_Curation';

export interface EngineLog {
  engineName: string;
  status: 'success' | 'partial' | 'error';
  segmentsProduced: number;
  processingLog: string[];
  segments: { 
    start: number; 
    end: number; 
    score: number; 
    reasoning: string;
    startIndex?: number;
    endIndex?: number;
  }[];
  transcript?: TranscriptItem[];
}

export interface ConsensusLog {
  step: string;
  detail: string;
}

export interface ConsensusReport {
  highlights: HighlightSegment[];
  engineLogs: EngineLog[];
  consensusLog: ConsensusLog[];
}

export interface StreamEvent {
  type: 'engine_start' | 'engine_complete' | 'consolidating' | 'complete' | 'error';
  engineName?: string;
  engineIndex?: number;
  totalEngines?: number;
  engineLog?: EngineLog;
  error?: string;
}

type ProgressCallback = (event: StreamEvent) => void;

/**
 * Run all engines, calling onProgress as each one completes.
 * The final consolidation step is also reported as a progress event.
 */
export async function computeConsensusStreaming(
  videoId: string,
  duration: number,
  onProgress: ProgressCallback
): Promise<ConsensusReport> {
  console.log(`\n=== Starting Multi-Engine Analysis for ${videoId} ===`);
  const consensusLog: ConsensusLog[] = [];

  consensusLog.push({ step: 'Start', detail: `Analyzing video ${videoId} (${duration}s / ${(duration/60).toFixed(1)} min)` });
  consensusLog.push({ step: 'Target', detail: `Summary target: ${(duration * 0.1).toFixed(1)}s (10% of ${duration}s)` });

  // Define engines
  const engines = [
    { name: 'Text', run: () => runAgent1Text(videoId, duration) },
    { name: 'Heatmap', run: () => runAgent2Heatmap(videoId, duration) },
    { name: 'Curation', run: () => runAgent4Curation(videoId, duration) },
  ];

  const totalEngines = engines.length;
  consensusLog.push({ step: 'Engines', detail: `Running ${totalEngines} engines: ${engines.map(e => e.name).join(', ')}` });

  // Notify all engines starting
  for (let i = 0; i < engines.length; i++) {
    onProgress({ type: 'engine_start', engineName: engines[i].name, engineIndex: i, totalEngines });
  }

  // Run all engines in parallel, but report each as it completes
  const engineLogs: EngineLog[] = [];
  const results: EngineResult[] = [];

  const enginePromises = engines.map((engine, index) => {
    return engine.run().then(result => {
      results.push(result);

      const status = result.error ? 'error' : (result.highlights.length === 0 ? 'partial' : 'success');
      const log: EngineLog = {
        engineName: result.engineName,
        status,
        segmentsProduced: result.highlights.length,
        processingLog: result.processingLog || [],
        segments: result.highlights.map(h => ({
          start: h.start,
          end: h.end,
          score: h.score || 0,
          reasoning: h.reasoning || 'No reasoning provided.',
          startIndex: h.startIndex,
          endIndex: h.endIndex
        })),
        transcript: result.transcript
      };
      engineLogs.push(log);

      // Notify this engine completed
      onProgress({
        type: 'engine_complete',
        engineName: engine.name,
        engineIndex: index,
        totalEngines,
        engineLog: log,
      });

      return result;
    });
  });

  await Promise.all(enginePromises);

  // Now consolidate
  onProgress({ type: 'consolidating', totalEngines });

  const allHighlights: HighlightSegment[] = [];

  results.forEach(res => {
    const segCount = res.highlights.length;
    consensusLog.push({ step: 'Engine Result', detail: `${res.engineName}: ${segCount} segment(s)${res.error ? ` [ERROR: ${res.error}]` : ''}` });
    res.highlights.forEach(h => {
      allHighlights.push(h);
    });
  });

  // Sort chronologically
  allHighlights.sort((a, b) => a.start - b.start);
  consensusLog.push({ step: 'Pre-merge', detail: `Total raw segments from all engines: ${allHighlights.length}` });

  // 2. Merge overlapping timestamps
  const merged: HighlightSegment[] = [];
  let current: HighlightSegment | null = null;

  for (const seg of allHighlights) {
    if (!current) {
      current = { ...seg, source: 'consensus' };
      continue;
    }

    // Overlap condition (if segments are within 3 seconds of each other, merge them)
    if (seg.start <= current.end + 3) {
      current.end = Math.max(current.end, seg.end);
      current.score = Math.min(1.0, (current.score || 0) + (seg.score || 0)); // Boost score on overlap
    } else {
      merged.push(current);
      current = { ...seg, source: 'consensus' };
    }
  }
  if (current) merged.push(current);

  consensusLog.push({ step: 'Post-merge', detail: `After merging overlaps (3s tolerance): ${merged.length} unique segment(s)` });

  // 3. Enforce Quotas (10% max duration, max 10 jumps per 1 minute of summary)
  const targetSummaryDuration = duration * 0.1;
  const maxJumps = Math.max(1, Math.ceil((targetSummaryDuration / 60) * 10));

  consensusLog.push({ step: 'Quota', detail: `Max summary: ${targetSummaryDuration.toFixed(1)}s, max jumps: ${maxJumps}` });

  // Sort by score (descending) to prioritize high-confidence overlap areas
  merged.sort((a, b) => (b.score || 0) - (a.score || 0));

  let finalSelection: HighlightSegment[] = [];
  let currentSum = 0;

  for (const seg of merged) {
    if (finalSelection.length >= maxJumps) break;
    
    // Rather than forcefully truncating segments to exactly 15s,
    // allow longer segments if they naturally formed a complete thought.
    let jumpStart = seg.start;
    let jumpEnd = seg.end; // Allow the segment to extend fully without artificial caps
    const segLength = jumpEnd - jumpStart;

    if (currentSum < targetSummaryDuration) { 
      // We haven't hit the target yet, so we can add this segment fully
      // even if it pushes the total slightly past the 10% target.
      // This makes 10% a soft approximation.
      finalSelection.push({ ...seg, start: jumpStart, end: jumpEnd });
      currentSum += segLength;
    } else {
      // We've met or exceeded the 10% target with entire complete sentences.
      break;
    }
  }

  // Sort final selection chronologically again before returning to player
  finalSelection.sort((a, b) => a.start - b.start);

  consensusLog.push({ step: 'Final', detail: `Selected ${finalSelection.length} jump(s) totaling ${currentSum.toFixed(1)}s` });
  
  // Log each final segment
  finalSelection.forEach((seg, i) => {
    consensusLog.push({ 
      step: `Jump ${i + 1}`, 
      detail: `${seg.start.toFixed(1)}s → ${seg.end.toFixed(1)}s (${(seg.end - seg.start).toFixed(1)}s, score: ${(seg.score || 0).toFixed(2)})`
    });
  });

  console.log(`=== Finished Consensus. Kept ${finalSelection.length} jumps for ${currentSum.toFixed(1)}s total ===\n`);
  return { highlights: finalSelection, engineLogs, consensusLog };
}

// Keep the old function name as an alias for compatibility
export const computeConsensus = (videoId: string, duration: number) => 
  computeConsensusStreaming(videoId, duration, () => {});
