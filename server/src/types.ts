export interface HighlightSegment {
  start: number;
  end: number;
  score?: number; // 0.0 to 1.0 confidence
  source?: 'text' | 'heatmap' | 'curation' | 'consensus';
  reasoning?: string; // Engine explanation for why this was chosen
  startIndex?: number; // Index in transcript for text engine
  endIndex?: number; // Index in transcript for text engine
}

export interface TranscriptItem {
  text: string;
  offset: number;   // ms
  duration: number;  // ms
}

export interface EngineResult {
  engineName: string;
  highlights: HighlightSegment[];
  error?: string;
  /** Detailed processing log messages from this engine */
  processingLog?: string[];
  /** Optional transcript data if this engine produced/used one */
  transcript?: TranscriptItem[];
}
