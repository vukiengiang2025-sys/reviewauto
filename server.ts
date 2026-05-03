import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import youtubedl from 'youtube-dl-exec';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure temp directory exists
const TEMP_DIR = path.join(process.cwd(), 'temp_processing');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Ensure ffmpeg comes from ffmpeg-static
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const app = express();
app.use(cors());
app.use(express.json());

// Track processing jobs
const jobs = new Map<string, {
  status: string;
  logs: string[];
  resultUrl?: string;
  error?: string;
}>();

const logJob = (jobId: string, message: string) => {
  const job = jobs.get(jobId);
  if (job) {
    job.logs.push(message);
    jobs.set(jobId, job);
    console.log(`[Job ${jobId}] ${message}`);
  }
}

// Utility: run ffmpeg as promise
const runFfmpeg = (command: ffmpeg.FfmpegCommand): Promise<void> => {
  return new Promise((resolve, reject) => {
    command
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
};

const extractJson = (text: string) => {
  const match = text.match(/\[.*\]/s);
  if (!match) throw new Error("Gemini did not return valid JSON");
  return JSON.parse(match[0]);
};

const getSampledSubs = (filePath: string) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const total = lines.length;
  if (total === 0) return "";
  
  const chunks = [0, 0.3, 0.6].map(i => {
    const start = Math.floor(total * i);
    const end = Math.floor(total * (i + 0.1));
    return lines.slice(start, end).join('\n');
  });
  return chunks.join('\n');
};

app.post('/api/process', async (req, res) => {
  try {
    const { url, geminiKey, elevenKey, voiceId } = req.body;
    
    if (!url || !geminiKey || !elevenKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const jobId = uuidv4();
    jobs.set(jobId, { status: 'processing', logs: [] });
    res.json({ jobId });

    // Start background processing
    (async () => {
      const jobDir = path.join(TEMP_DIR, jobId);
      fs.mkdirSync(jobDir, { recursive: true });

      try {
        logJob(jobId, '[1] Downloading video...');
        const originalVideoPath = path.join(jobDir, 'original_video.mp4');
        
        await youtubedl(url, {
          format: 'best[height<=360]',
          output: originalVideoPath
        });

        logJob(jobId, '[1.5] Downloading subtitles...');
        const subTempPath = path.join(jobDir, 'sub_temp');
        try {
          await youtubedl(url, {
            writeAutoSub: true,
            subLang: 'vi',
            skipDownload: true,
            output: subTempPath
          });
        } catch (e) {
          console.error("Warning: Subtitle download error", e);
        }

        const vttPath = `${subTempPath}.vi.vtt`;
        let content = "Đây là video phim. Hãy tạo review về bộ phim này."; // fallback
        if (fs.existsSync(vttPath)) {
          content = getSampledSubs(vttPath);
        } else {
          logJob(jobId, 'No subtitle found, using generic prompt.');
        }

        logJob(jobId, '[2] Generating script with Gemini...');
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        
        const prompt = `
          Bạn là chuyên gia review phim TikTok.

          Dựa vào phụ đề:
          ${content}

          Tạo 8 đoạn, mỗi đoạn 5-10s.
          Có hook, gây tò mò.
          Viết ngắn, có "...".

          Trả JSON:
          [{"start":giây,"duration":giây,"script":"text"}]
          (start and duration should be numbers, script should be string).
          NOTE: if no subtitle content, just make up a generic 8-part review script for a random movie, but ensure JSON format is correct.
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: prompt
        });

        const text = response.text || "[]";
        const segments = extractJson(text);

        logJob(jobId, '[3] Generating TTS...');
        const targetVoiceId = voiceId || "EXAVITQu4vr4xnSDxMaL";
        const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${targetVoiceId}`;
        
        const voices: string[] = [];
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const r = await fetch(ttsUrl, {
            method: 'POST',
            headers: {
              'xi-api-key': elevenKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              text: seg.script,
              model_id: "eleven_multilingual_v2",
              voice_settings: { stability: 0.45, similarity_boost: 0.8 }
            })
          });

          if (!r.ok) {
            const errText = await r.text();
            throw new Error(`TTS error: ${errText}`);
          }

          const buffer = await r.arrayBuffer();
          const voicePath = path.join(jobDir, `voice_${i}.mp3`);
          fs.writeFileSync(voicePath, Buffer.from(buffer));
          voices.push(voicePath);
        }

        logJob(jobId, '[4] Cutting video segments...');
        const listFile = path.join(jobDir, 'list.txt');
        const listLines: string[] = [];
        
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const clipPath = path.join(jobDir, `clip_${i}.mp4`);
          const voicePath = voices[i];

          const start = parseFloat(seg.start) || 0;
          const duration = parseFloat(seg.duration) || 5;

          await new Promise<void>((resolve, reject) => {
            ffmpeg()
              .input(originalVideoPath)
              .setStartTime(start)
              .setDuration(duration)
              .input(voicePath)
              .complexFilter(["hflip,scale=854:480,eq=contrast=1.05:brightness=0.02"])
              .outputOptions([
                '-map 0:v', 
                '-map 1:a', 
                '-shortest', 
                '-c:v libx264', 
                '-preset veryfast'
              ])
              .output(clipPath)
              .on('end', () => resolve())
              .on('error', (err) => reject(err))
              .run();
          });

          // list.txt requires forward slashes even on Windows, safely use relative paths if possible, but absolute works if formatted correctly.
          const formattedPath = clipPath.replace(/\\/g, '/');
          listLines.push(`file '${formattedPath}'`);
        }
        
        fs.writeFileSync(listFile, listLines.join('\n'));

        logJob(jobId, '[5] Merging clips...');
        const mergedPath = path.join(jobDir, 'merged.mp4');
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(listFile)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions(['-c copy'])
            .output(mergedPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
        });

        logJob(jobId, '[6] Checking for subtitles & [7] Output...');
        // For simplicity and environment safety, we skip embedding VTT back into mp4 if it causes issues.
        // Instead, we just serve the merged video directly.
        jobs.set(jobId, { status: 'done', logs: jobs.get(jobId)!.logs, resultUrl: `/videos/${jobId}/merged.mp4` });
        logJob(jobId, 'DONE');
      } catch (err: any) {
        logJob(jobId, `Error: ${err.message}`);
        console.error(err);
        jobs.set(jobId, { status: 'error', logs: jobs.get(jobId)!.logs, error: err.message });
      }
    })();

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.use('/videos', express.static(TEMP_DIR));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Explicitly handle 404 for API routes to avoid returning HTML
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `API endpoint ${req.originalUrl} not found` });
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
