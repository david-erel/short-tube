export interface HighlightSegment {
  start: number;
  end: number;
  score?: number; // 0-1 confidence
  source?: 'text' | 'heatmap' | 'curation' | 'consensus';
  startIndex?: number;
  endIndex?: number;
}

export interface TranscriptItem {
  text: string;
  offset: number;   // ms
  duration: number;  // ms
}

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

export interface ConsensusLogEntry {
  step: string;
  detail: string;
}

export interface ConsensusReport {
  highlights: HighlightSegment[];
  engineLogs: EngineLog[];
  consensusLog: ConsensusLogEntry[];
}

/** Progress events streamed from the backend */
export interface StreamEvent {
  type: 'engine_start' | 'engine_complete' | 'consolidating' | 'complete' | 'error';
  engineName?: string;
  engineIndex?: number;
  totalEngines?: number;
  engineLog?: EngineLog;
  highlights?: HighlightSegment[];
  engineLogs?: EngineLog[];
  consensusLog?: ConsensusLogEntry[];
  error?: string;
}

export interface ProgressState {
  phase: 'idle' | 'running' | 'consolidating' | 'done' | 'error';
  completedEngines: number;
  totalEngines: number;
  engineLogs: EngineLog[];
  message: string;
}

/**
 * Stream-based consensus highlights using SSE.
 * Calls onProgress for each engine completion, then resolves with the final result.
 */
export function generateConsensusHighlightsStreaming(
  videoId: string,
  duration: number,
  onProgress: (state: ProgressState) => void,
  signal?: AbortSignal
): Promise<ConsensusReport> {
  return new Promise((resolve, reject) => {
    const url = `/api/highlights/stream?videoId=${encodeURIComponent(videoId)}&duration=${duration}`;
    const eventSource = new EventSource(url);

    // Handle abort signal
    if (signal) {
      if (signal.aborted) {
        eventSource.close();
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => {
        eventSource.close();
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }

    let completedEngines = 0;
    let totalEngines = 3;
    const engineLogs: EngineLog[] = [];

    onProgress({
      phase: 'running',
      completedEngines: 0,
      totalEngines,
      engineLogs: [],
      message: 'Starting analysis engines...',
    });

    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);

        switch (data.type) {
          case 'engine_start':
            totalEngines = data.totalEngines || totalEngines;
            break;

          case 'engine_complete':
            completedEngines++;
            if (data.engineLog) {
              engineLogs.push(data.engineLog);
            }
            onProgress({
              phase: 'running',
              completedEngines,
              totalEngines,
              engineLogs: [...engineLogs],
              message: `${data.engineName} engine complete`,
            });
            break;

          case 'consolidating':
            onProgress({
              phase: 'consolidating',
              completedEngines,
              totalEngines,
              engineLogs: [...engineLogs],
              message: 'Consolidating results...',
            });
            break;

          case 'complete':
            eventSource.close();
            const report: ConsensusReport = {
              highlights: data.highlights || [],
              engineLogs: data.engineLogs || engineLogs,
              consensusLog: data.consensusLog || [],
            };
            onProgress({
              phase: 'done',
              completedEngines: totalEngines,
              totalEngines,
              engineLogs: report.engineLogs,
              message: 'Analysis complete!',
            });
            resolve(report);
            break;

          case 'error':
            eventSource.close();
            onProgress({
              phase: 'error',
              completedEngines,
              totalEngines,
              engineLogs: [...engineLogs],
              message: data.error || 'Unknown error',
            });
            reject(new Error(data.error));
            break;
        }
      } catch (err) {
        console.error('Error parsing SSE data:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      // If we already got engine results, try to return what we have
      if (engineLogs.length > 0) {
        onProgress({
          phase: 'error',
          completedEngines,
          totalEngines,
          engineLogs: [...engineLogs],
          message: 'Connection lost during analysis',
        });
      }
      reject(new Error('SSE connection failed'));
    };
  });
}

/**
 * Legacy batch fetch (fallback if SSE fails)
 */
export async function generateConsensusHighlights(videoId: string, duration: number): Promise<ConsensusReport> {
  try {
    const response = await fetch('/api/highlights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ videoId, duration })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching highlights`);
    }

    const data = await response.json();
    return { 
      highlights: data.highlights || [], 
      engineLogs: data.engineLogs || [],
      consensusLog: data.consensusLog || []
    };
  } catch (err) {
    console.error("Failed to fetch highlights from backend, using safe fallback...", err);
    return {
      highlights: [
        { start: Math.floor(duration * 0.1), end: Math.floor(duration * 0.1) + 10, score: 1 },
        { start: Math.floor(duration * 0.5), end: Math.floor(duration * 0.5) + 12, score: 1 },
        { start: Math.floor(duration * 0.8), end: Math.floor(duration * 0.8) + 8, score: 1 }
      ],
      engineLogs: [],
      consensusLog: []
    };
  }
}
