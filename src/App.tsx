import { useState, useMemo, useCallback, useRef } from 'react';
import { Search, Play, X } from 'lucide-react';
import { YouTubePlayer } from './components/YouTubePlayer';
import { parseYouTubeId } from './utils/youtube';
import type { HighlightSegment, EngineLog, ConsensusLogEntry, ProgressState } from './utils/engine';
import './App.css';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const ENGINE_NAMES = ['Text', 'Heatmap', 'Curation'];

function App() {
  const [urlInput, setUrlInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<HighlightSegment[]>([]);
  const [engineLogs, setEngineLogs] = useState<EngineLog[]>([]);
  const [consensusLog, setConsensusLog] = useState<ConsensusLogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('consensus');
  const [totalVidDuration, setTotalVidDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState<ProgressState | null>(null);
  const [selectedTextSegIdx, setSelectedTextSegIdx] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedId = parseYouTubeId(urlInput);
    if (parsedId) {
      // Abort any in-flight analysis
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Create fresh controller
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setVideoId(parsedId);
      setHighlights([]);
      setEngineLogs([]);
      setConsensusLog([]);
      setCurrentTime(0);
      setTotalVidDuration(0);
      setShowLogs(false);
      setAnalysisProgress(null);
      setSelectedTextSegIdx(null);
    } else {
      alert('Invalid YouTube URL');
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setVideoId(null);
    setHighlights([]);
    setEngineLogs([]);
    setConsensusLog([]);
    setCurrentTime(0);
    setTotalVidDuration(0);
    setShowLogs(false);
    setAnalysisProgress(null);
  };

  const handleHighlightsCalculated = (
    calculatedMarks: HighlightSegment[],
    calcEngineLogs: EngineLog[],
    calcConsensusLog: ConsensusLogEntry[],
    duration: number
  ) => {
    setHighlights(calculatedMarks);
    setEngineLogs(calcEngineLogs);
    setConsensusLog(calcConsensusLog);
    setTotalVidDuration(duration);
  };

  const handleProgress = (time: number) => {
    setCurrentTime(time);
  };

  const handleAnalysisProgress = useCallback((state: ProgressState) => {
    setAnalysisProgress(state);
    // Update engine logs progressively as they arrive
    if (state.engineLogs.length > 0) {
      setEngineLogs(state.engineLogs);
    }
  }, []);

  const { currentSummaryTime, totalSummaryDuration } = useMemo(() => {
    let summaryTime = 0;
    let summaryDuration = 0;

    for (const seg of highlights) {
      const segLength = seg.end - seg.start;
      summaryDuration += segLength;

      if (currentTime >= seg.start && currentTime <= seg.end) {
        summaryTime += (currentTime - seg.start);
      } else if (currentTime > seg.end) {
        summaryTime += segLength;
      }
    }
    return { currentSummaryTime: summaryTime, totalSummaryDuration: summaryDuration };
  }, [highlights, currentTime]);

  const progressPercent = totalSummaryDuration > 0 ? (currentSummaryTime / totalSummaryDuration) * 100 : 0;

  // Which engines are completed?
  const completedEngineNames = new Set(
    analysisProgress?.engineLogs.map(l => l.engineName) || []
  );

  const isAnalysing = analysisProgress &&
    (analysisProgress.phase === 'running' || analysisProgress.phase === 'consolidating');

  const analysisStarted = analysisProgress !== null;

  // Show engine summary: during analysis OR after completion (when we have engine logs)
  const showEngineSummary = analysisStarted;


  return (
    <div className="app-container">
      <header className="header">
        <h1 className="title">ShortTube</h1>
        <p className="subtitle">Watch the best moments — skip the rest</p>
      </header>

      <div className="search-section">
        <div className="search-wrapper">
          <form onSubmit={isAnalysing ? (e) => { e.preventDefault(); handleCancel(); } : handleSearch} className="search-bar glass-panel input-glow rounded-2xl">
            <Search className="search-icon" size={24} />
            <input
              type="text"
              className="search-input"
              placeholder="Paste a YouTube URL here..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={!!isAnalysing}
            />
            {isAnalysing ? (
              <button type="submit" className="search-button cancel-button mr-2">
                <X size={20} />
                Cancel
              </button>
            ) : (
              <button type="submit" className="search-button mr-2">
                <Play size={20} />
                Summarize
              </button>
            )}
          </form>
          <span
            className="example-url-hint"
            onClick={() => {
              const exampleUrl = 'https://www.youtube.com/watch?v=UF8uR6Z6KLc';
              setUrlInput(exampleUrl);
              const parsedId = parseYouTubeId(exampleUrl);
              if (parsedId) {
                // Abort any in-flight analysis
                if (abortControllerRef.current) {
                  abortControllerRef.current.abort();
                }
                const controller = new AbortController();
                abortControllerRef.current = controller;

                setVideoId(parsedId);
                setHighlights([]);
                setEngineLogs([]);
                setConsensusLog([]);
                setCurrentTime(0);
                setTotalVidDuration(0);
                setShowLogs(false);
                setAnalysisProgress(null);
              }
            }}
          >
            e.g. https://www.youtube.com/watch?v=UF8uR6Z6KLc
          </span>
        </div>
      </div>

      <main className="main-content">
        <div className="video-container glass-panel">
          <YouTubePlayer
            key={videoId || ''}
            videoId={videoId || ''}
            onHighlightsCalculated={handleHighlightsCalculated}
            onProgress={handleProgress}
            onAnalysisProgress={handleAnalysisProgress}
            abortSignal={abortControllerRef.current?.signal}
          />
        </div>

        {/* Engine summary panel — visible during AND after analysis */}
        {showEngineSummary && (
          <div className="progress-container glass-panel">
            {/* Header with progress text */}
            <div className="progress-header">
              <span className="progress-title">
                {analysisProgress?.phase === 'consolidating'
                  ? 'Consolidating results...'
                  : analysisProgress?.phase === 'done'
                    ? (() => {
                      const pct = totalVidDuration > 0 ? Math.round((1 - totalSummaryDuration / totalVidDuration) * 100) : 0;
                      return `Analysis complete — ${formatTime(totalSummaryDuration)} of ${formatTime(totalVidDuration)} (${pct}% shorter)`;
                    })()
                    : analysisProgress?.phase === 'error'
                      ? `Analysis error: ${analysisProgress.message}`
                      : `Analysing — ${analysisProgress?.completedEngines || 0} of ${analysisProgress?.totalEngines || 3} engines complete`
                }
              </span>
            </div>

            {/* Engine status pills — clickable to toggle debug details */}
            <div className="engine-progress-grid">
              {ENGINE_NAMES.map((name) => {
                const isComplete = completedEngineNames.has(name);
                const log = engineLogs.find(l => l.engineName === name);
                const tabId = name.toLowerCase();
                const isActivePill = showLogs && activeTab === tabId;
                return (
                  <button
                    key={name}
                    className={`engine-progress-item ${isComplete ? 'engine-complete' : 'engine-pending'} engine-clickable ${isActivePill ? 'engine-pill-active' : ''}`}
                    title="Debug info"
                    onClick={() => {
                      if (isActivePill) {
                        setShowLogs(false);
                      } else {
                        setActiveTab(tabId);
                        setShowLogs(true);
                      }
                    }}
                  >
                    <div className="engine-progress-icon">
                      {isComplete
                        ? (log?.status === 'error' ? '❌' : '✅')
                        : isAnalysing
                          ? <span className="engine-dot-spinner" />
                          : <span className="engine-dot-waiting" />
                      }
                    </div>
                    <span className="engine-progress-name">{name}</span>
                    {isComplete && log && (
                      <span className="engine-progress-detail">
                        {log.segmentsProduced} segment{log.segmentsProduced !== 1 ? 's' : ''}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Consolidation step */}
              {(() => {
                const isConsensusDone = analysisProgress?.phase === 'done';
                const isConsolidating = analysisProgress?.phase === 'consolidating';
                const isActivePill = showLogs && activeTab === 'consensus';
                return (
                  <button
                    className={`engine-progress-item ${isConsensusDone ? 'engine-complete' :
                      isConsolidating ? 'engine-consolidating' :
                        'engine-pending'
                      } engine-clickable ${isActivePill ? 'engine-pill-active' : ''}`}
                    title="Debug info"
                    onClick={() => {
                      if (isActivePill) {
                        setShowLogs(false);
                      } else {
                        setActiveTab('consensus');
                        setShowLogs(true);
                      }
                    }}
                  >
                    <div className="engine-progress-icon">
                      {isConsensusDone
                        ? '✅'
                        : isConsolidating
                          ? <span className="engine-dot-spinner" />
                          : <span className="engine-dot-waiting" />
                      }
                    </div>
                    <span className="engine-progress-name">Consensus</span>
                    {isConsensusDone && highlights.length > 0 && (
                      <span className="engine-progress-detail">
                        {highlights.length} highlight{highlights.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </button>
                );
              })()}
            </div>

            {/* Progress bar — only during analysis */}
            {isAnalysing && (
              <div className="analysis-progress-bar">
                <div
                  className="analysis-progress-fill"
                  style={{
                    width: `${analysisProgress?.phase === 'consolidating'
                      ? 90
                      : ((analysisProgress?.completedEngines || 0) / (analysisProgress?.totalEngines || 3)) * 80}%`
                  }}
                />
              </div>
            )}



            {/* Detail logs panel — viewable during AND after analysis */}
            {showLogs && (
              <div className="engine-logs-panel">
                {/* Tab content — tab is selected by clicking the engine pills above */}
                <div className="tab-content">
                  {activeTab === 'consensus' && (
                    <div className="log-pane">
                      <h3 className="log-pane-title">Consensus Engine — Merge & Quota Enforcement</h3>
                      <p className="log-pane-subtitle">
                        How the final highlights were decided from all engine results
                      </p>
                      {consensusLog.length > 0 ? (
                        <>
                          <div className="log-entries">
                            {consensusLog.map((entry, idx) => (
                              <div key={idx} className="log-entry">
                                <span className="log-step">{entry.step}</span>
                                <span className="log-detail">{entry.detail}</span>
                              </div>
                            ))}
                          </div>

                          {/* Final segments table */}
                          {highlights.length > 0 && (
                            <>
                              <h4 className="log-section-title">Final Highlight Segments</h4>
                              <div className="segments-table">
                                <div className="segments-header">
                                  <span>#</span>
                                  <span>Time Range</span>
                                  <span>Duration</span>
                                  <span>Score</span>
                                </div>
                                {highlights.map((seg, i) => (
                                  <div key={i} className="segment-row">
                                    <span>{i + 1}</span>
                                    <span>{formatTime(seg.start)} → {formatTime(seg.end)}</span>
                                    <span>{(seg.end - seg.start).toFixed(1)}s</span>
                                    <span>
                                      <span className="score-bar" style={{ width: `${Math.min(100, (seg.score || 0) * 100)}%` }}></span>
                                      {(seg.score || 0).toFixed(2)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <p className="log-empty">Working...</p>
                      )}
                    </div>
                  )}

                  {/* Engine-specific tabs — show live data or "Working..." */}
                  {ENGINE_NAMES.map(name => {
                    if (activeTab !== name.toLowerCase()) return null;
                    const el = engineLogs.find(l => l.engineName === name);
                    if (!el) {
                      return (
                        <div key={name} className="log-pane">
                          <h3 className="log-pane-title">{name} Engine</h3>
                          <p className="log-empty">Working...</p>
                        </div>
                      );
                    }
                    return (
                      <div key={el.engineName} className="log-pane">
                        <div className="log-pane-header">
                          <h3 className="log-pane-title">
                            {el.engineName} Engine
                            <span className={`status-badge status-${el.status}`}>
                              {el.status === 'success' ? '✅ Success' : el.status === 'error' ? '❌ Error' : '⚠️ Partial'}
                            </span>
                          </h3>
                          <p className="log-pane-subtitle">
                            Produced {el.segmentsProduced} segment{el.segmentsProduced !== 1 ? 's' : ''}
                          </p>
                        </div>

                        {/* Processing log */}
                        <h4 className="log-section-title">Processing Log</h4>
                        <div className="processing-log">
                          {el.processingLog.map((line, idx) => (
                            <div key={idx} className="processing-log-line">
                              <span className="log-line-num">{idx + 1}</span>
                              <pre className="log-line-text">{line}</pre>
                            </div>
                          ))}
                          {el.processingLog.length === 0 && (
                            <p className="log-empty">No processing log available.</p>
                          )}
                        </div>

                        {/* Segments detail */}
                        {el.segments.length > 0 && (
                          <>
                            <h4 className="log-section-title">Segments Produced</h4>
                            <div className="segments-detail">
                              {el.segments.map((seg, idx) => {
                                const isSelected = selectedTextSegIdx === idx;

                                // Calculate context text if selected
                                let contextItems: { text: string; isSelected: boolean }[] = [];
                                if (isSelected && el.transcript && seg.startIndex !== undefined && seg.endIndex !== undefined) {
                                  const t = el.transcript;

                                  // Find context before (max 1-2 sentences OR ~15 words OR 8 segments)
                                  let startContext = seg.startIndex;
                                  let sentencesBefore = 0;
                                  let wordsBefore = 0;
                                  let segmentsBefore = 0;
                                  while (startContext > 0 && sentencesBefore < 1 && wordsBefore < 15 && segmentsBefore < 8) {
                                    startContext--;
                                    segmentsBefore++;
                                    const text = t[startContext].text.trim();
                                    wordsBefore += text.split(/\s+/).length;
                                    if (/[.!?]$/.test(text)) {
                                      sentencesBefore++;
                                    }
                                  }

                                  // Find context after (max 1-2 sentences OR ~15 words OR 8 segments)
                                  let endContext = seg.endIndex;
                                  let sentencesAfter = 0;
                                  let wordsAfter = 0;
                                  let segmentsAfter = 0;
                                  while (endContext < t.length - 1 && sentencesAfter < 1 && wordsAfter < 15 && segmentsAfter < 8) {
                                    endContext++;
                                    segmentsAfter++;
                                    const text = t[endContext].text.trim();
                                    wordsAfter += text.split(/\s+/).length;
                                    if (/[.!?]$/.test(text)) {
                                      sentencesAfter++;
                                    }
                                  }

                                  // Collect items
                                  for (let i = startContext; i <= endContext; i++) {
                                    contextItems.push({
                                      text: t[i].text,
                                      isSelected: i >= seg.startIndex && i <= seg.endIndex
                                    });
                                  }
                                }

                                return (
                                  <div
                                    key={idx}
                                    className={`segment-detail-card clickable-segment ${isSelected ? 'segment-selected' : ''}`}
                                    onClick={() => setSelectedTextSegIdx(isSelected ? null : idx)}
                                  >
                                    <div className="segment-detail-header">
                                      <span className="segment-num">#{idx + 1}</span>
                                      <span className="segment-time">{formatTime(seg.start)} → {formatTime(seg.end)}</span>
                                      <span className="segment-score">Score: {seg.score.toFixed(2)}</span>
                                    </div>
                                    <p className="segment-reasoning">{seg.reasoning}</p>

                                    {isSelected && contextItems.length > 0 && (
                                      <div className="segment-transcript-preview">
                                        {contextItems.map((item, i) => (
                                          <span
                                            key={i}
                                            className={item.isSelected ? 'text-highlight-main' : 'text-highlight-context'}
                                          >
                                            {item.text}{' '}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timeline — only after highlights are computed */}
        {videoId && highlights.length > 0 && (
          <div className="timeline-container glass-panel">
            <div className="timeline-header flex justify-between w-full">
              <span className="timeline-title">Summary Timeline</span>
              <span className="timeline-stats">
                {formatTime(currentSummaryTime)} / {formatTime(totalSummaryDuration)}
                <span className="opacity-50 ml-2">({formatTime(totalVidDuration)} original)</span>
              </span>
            </div>

            <div className="timeline-bar relative">
              <div className="timeline-progress" style={{ width: `${progressPercent}%` }}></div>

              {highlights.map((_seg, i) => {
                let accumulated = 0;
                for (let j = 0; j <= i; j++) {
                  accumulated += (highlights[j].end - highlights[j].start);
                }
                const leftPercent = (accumulated / totalSummaryDuration) * 100;
                if (i === highlights.length - 1) return null;
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 bg-white/30 w-1"
                    style={{ left: `${leftPercent}%` }}
                    title={`Jump point ${i + 1}`}
                  />
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
