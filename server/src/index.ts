import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { computeConsensusStreaming } from './ConsensusEngine';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Original batch endpoint (kept for compatibility)
app.post('/api/highlights', async (req: Request, res: Response): Promise<any> => {
  try {
    const { videoId, duration } = req.body;
    
    if (!videoId || !duration) {
      return res.status(400).json({ error: 'Missing videoId or duration' });
    }

    const { highlights, engineLogs, consensusLog } = await computeConsensusStreaming(
      videoId, 
      duration,
      () => {} // no-op progress callback for batch mode
    );
    res.json({ highlights, engineLogs, consensusLog });
  } catch (error: any) {
    console.error(`[Server] Error computing highlights: ${error.message}`);
    res.status(500).json({ error: 'Internal server error computing highlights' });
  }
});

// SSE streaming endpoint — sends engine results as they complete
app.get('/api/highlights/stream', async (req: Request, res: Response): Promise<any> => {
  const videoId = req.query.videoId as string;
  const duration = parseFloat(req.query.duration as string);

  if (!videoId || !duration) {
    return res.status(400).json({ error: 'Missing videoId or duration' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const result = await computeConsensusStreaming(videoId, duration, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Send the final consolidated result
    res.write(`data: ${JSON.stringify({ 
      type: 'complete', 
      highlights: result.highlights, 
      engineLogs: result.engineLogs, 
      consensusLog: result.consensusLog 
    })}\n\n`);

    res.end();
  } catch (error: any) {
    console.error(`[Server] SSE error: ${error.message}`);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[YouTube Summary Backend] Running on http://localhost:${PORT}`);
});
