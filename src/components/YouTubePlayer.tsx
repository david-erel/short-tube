import React, { useEffect, useRef, useState } from 'react';
import YouTube from 'react-youtube';
import type { YouTubeEvent } from 'react-youtube';
import { generateConsensusHighlightsStreaming } from '../utils/engine';
import type { HighlightSegment, EngineLog, ConsensusLogEntry, ProgressState } from '../utils/engine';

interface YouTubePlayerProps {
  videoId: string;
  onHighlightsCalculated: (
    highlights: HighlightSegment[],
    engineLogs: EngineLog[],
    consensusLog: ConsensusLogEntry[],
    totalDuration: number
  ) => void;
  onProgress: (currentVideoTime: number) => void;
  onAnalysisProgress: (state: ProgressState) => void;
  abortSignal?: AbortSignal;
}

export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  videoId,
  onHighlightsCalculated,
  onProgress,
  onAnalysisProgress,
  abortSignal
}) => {
  const [highlights, setHighlights] = useState<HighlightSegment[]>([]);
  const [currentHighlightIndex, setCurrentHighlightIndex] = useState(0);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const playerRef = useRef<any>(null);
  const playTimerRef = useRef<number | null>(null);
  const analysisStartedRef = useRef(false);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, []);

  const handleReady = async (event: YouTubeEvent) => {
    playerRef.current = event.target;
    const dur = event.target.getDuration();

    // Don't auto-play — pause immediately
    event.target.pauseVideo();

    // Start analysis only once
    if (analysisStartedRef.current) return;
    analysisStartedRef.current = true;
    setIsAnalysing(true);

    try {
      const result = await generateConsensusHighlightsStreaming(
        videoId,
        dur,
        onAnalysisProgress,
        abortSignal
      );

      setHighlights(result.highlights);
      setIsAnalysing(false);

      // Pass to parent for UI timeline rendering
      onHighlightsCalculated(result.highlights, result.engineLogs, result.consensusLog, dur);

      // Cue video at first highlight — shows thumbnail + play button, no buffering spinner
      if (result.highlights.length > 0 && playerRef.current) {
        setCurrentHighlightIndex(0);
        playerRef.current.cueVideoById({
          videoId: videoId,
          startSeconds: result.highlights[0].start
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Cancelled by user — reset silently
        setIsAnalysing(false);
        return;
      }
      console.error('Analysis failed:', err);
      setIsAnalysing(false);
    }
  };

  const handleStateChange = (event: YouTubeEvent) => {
    // 1(PLAYING), 2(PAUSED), 3(BUFFERING)
    if (event.data === 1) {
      // Start polling
      if (!playTimerRef.current) {
        playTimerRef.current = window.setInterval(() => checkProgress(event.target), 200);
      }
    } else {
      // Stop polling if paused
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    }
  };

  const checkProgress = (player: any) => {
    if (highlights.length === 0) return;

    const currentTime = player.getCurrentTime();
    onProgress(currentTime);

    const currentHighlight = highlights[currentHighlightIndex];
    if (!currentHighlight) return;

    // Did we pass the end of the current highlight?
    if (currentTime >= currentHighlight.end) {
      const nextIndex = currentHighlightIndex + 1;
      if (nextIndex < highlights.length) {
        // Jump to next highlight
        setCurrentHighlightIndex(nextIndex);
        player.seekTo(highlights[nextIndex].start, true);
      } else {
        // Summary finished
        player.pauseVideo();
        if (playTimerRef.current) {
          clearInterval(playTimerRef.current);
          playTimerRef.current = null;
        }
      }
    } else if (currentTime < currentHighlight.start - 1) {
      // User scrubbed backward manually outside the highlight window
      player.seekTo(currentHighlight.start, true);
    }
  };

  const opts = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      controls: 1,
      modestbranding: 1,
      rel: 0,
      fs: 1
    },
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'black', position: 'relative' }}>
      {videoId ? (
        <>
          {/* YouTube embed is always visible — shows its own thumbnail when paused */}
          <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <YouTube
              videoId={videoId}
              opts={opts}
              onReady={handleReady}
              onStateChange={handleStateChange}
              style={{ width: '100%', height: '100%' }}
              iframeClassName="youtube-iframe-full"
            />
          </div>

          {/* Semi-transparent overlay while analysing — user can still see the video thumbnail underneath */}
          {isAnalysing && (
            <div className="analysis-overlay">
              <div className="analysis-overlay-content">
                <div className="analysis-spinner" />
                <span className="analysis-label">Analysing</span>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
