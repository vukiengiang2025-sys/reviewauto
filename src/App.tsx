import React, { useState, useEffect, useRef } from 'react';
import { Settings, Video, Link as LinkIcon, Loader2, CheckCircle, Play, Download } from 'lucide-react';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [elevenKey, setElevenKey] = useState('');
  const [voiceId, setVoiceId] = useState('EXAVITQu4vr4xnSDxMaL');
  const [serverUrl, setServerUrl] = useState('');
  const [url, setUrl] = useState('');
  
  const [processing, setProcessing] = useState(false);
  const [jobId, setJobId] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setGeminiKey(localStorage.getItem('APP_GEMINI_KEY') || '');
    setElevenKey(localStorage.getItem('APP_ELEVEN_KEY') || '');
    setVoiceId(localStorage.getItem('APP_VOICE_ID') || 'EXAVITQu4vr4xnSDxMaL');
    setServerUrl(localStorage.getItem('APP_SERVER_URL') || window.location.origin);
  }, []);

  const saveSettings = () => {
    localStorage.setItem('APP_GEMINI_KEY', geminiKey);
    localStorage.setItem('APP_ELEVEN_KEY', elevenKey);
    localStorage.setItem('APP_VOICE_ID', voiceId);
    let sUrl = serverUrl.replace(/\/$/, ''); // remove trailing slash
    localStorage.setItem('APP_SERVER_URL', sUrl);
    setServerUrl(sUrl);
    setShowSettings(false);
  };

  const getApiUrl = (path: string) => {
    return `${serverUrl}${path}`;
  };

  const startProcess = async () => {
    if (!geminiKey || !elevenKey) {
      alert("Vui lòng nhập API Key trong Cài đặt");
      return setShowSettings(true);
    }
    if (!url) return alert("Vui lòng nhập URL YouTube");
    if (!serverUrl) return alert("Vui lòng nhập Backend Server URL trong Cài đặt");

    setProcessing(true);
    setLogs([]);
    setResultUrl('');
    setError('');

    try {
      const res = await fetch(getApiUrl('/api/process'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, geminiKey, elevenKey, voiceId })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setJobId(data.jobId);
    } catch (err: any) {
      setError(err.message);
      setProcessing(false);
    }
  };

  useEffect(() => {
    if (!jobId || !processing) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(getApiUrl(`/api/job/${jobId}`));
        const data = await res.json();
        
        if (data.logs) setLogs(data.logs);
        
        if (data.status === 'done') {
          // ensure resultUrl maps to the remote server if on mobile
          setResultUrl(getApiUrl(data.resultUrl));
          setProcessing(false);
          clearInterval(interval);
        } else if (data.status === 'error') {
          setError(data.error);
          setProcessing(false);
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [jobId, processing]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 font-sans selection:bg-indigo-500/30">
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Video className="w-4 h-4 text-white" />
            </div>
            <h1 className="font-semibold tracking-tight text-lg">AutoReviewX</h1>
          </div>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-neutral-400 hover:text-white"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-semibold tracking-tight mb-4">Tạo video review tự động</h2>
          <p className="text-neutral-400 text-lg">Dán link YouTube và để AI làm phần còn lại. Dành cho TikTok & Reels.</p>
        </div>

        <div className="bg-neutral-900 border border-white/10 rounded-2xl p-2 flex gap-2 mb-8 shadow-2xl shadow-indigo-500/5 transition-all focus-within:border-indigo-500/50 focus-within:shadow-indigo-500/10">
          <div className="flex-1 flex items-center gap-3 px-4">
            <LinkIcon className="w-5 h-5 text-neutral-500" />
            <input 
              type="text" 
              placeholder="https://www.youtube.com/watch?v=..." 
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="bg-transparent border-none outline-none flex-1 text-neutral-100 placeholder:text-neutral-600"
              disabled={processing}
            />
          </div>
          <button 
            onClick={startProcess}
            disabled={processing || !url}
            className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {processing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Đang xử lý</>
            ) : (
              <><Play className="w-4 h-4" /> Bắt đầu</>
            )}
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl mb-8">
            <b>Lỗi: </b> {error}
          </div>
        )}

        {processing && logs.length > 0 && (
          <div className="bg-neutral-900 rounded-2xl border border-white/5 p-6 mb-8 mb-8 font-mono text-sm text-neutral-400 max-h-64 overflow-y-auto">
            {logs.map((log, i) => (
              <div key={i} className="mb-2">
                <span className="text-neutral-500">[{new Date().toLocaleTimeString()}]</span> {log}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}

        {resultUrl && (
          <div className="bg-neutral-900 rounded-2xl border border-white/10 p-6 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Thành công!</h3>
            <p className="text-neutral-400 mb-6">Video review của bạn đã sẵn sàng</p>
            
            <video 
              src={resultUrl} 
              controls 
              className="w-full max-w-sm rounded-xl aspect-[9/16] bg-black mb-6 object-cover"
            />
            
            <a 
              href={resultUrl} 
              download 
              className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl font-medium hover:bg-neutral-200 transition-colors"
            >
              <Download className="w-5 h-5" />
              Tải Video
            </a>
          </div>
        )}
      </main>

      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-neutral-900 border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl relative">
            <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" />
              Cài đặt API
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">Backend Server URL</label>
                <input 
                  type="text" 
                  value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors text-neutral-300"
                  placeholder="https://your-backend.com"
                />
                <p className="text-xs text-neutral-500 mt-2">Dùng khi chạy trên mobile app (APK) để trỏ về API server.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">Google Gemini API Key</label>
                <input 
                  type="password" 
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors"
                  placeholder="AIzaSy..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">ElevenLabs API Key</label>
                <input 
                  type="password" 
                  value={elevenKey}
                  onChange={e => setElevenKey(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors"
                  placeholder="sk_..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">Voice ID (ElevenLabs)</label>
                <input 
                  type="text" 
                  value={voiceId}
                  onChange={e => setVoiceId(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 transition-colors text-neutral-300"
                  placeholder="EXAVITQu4vr4xnSDxMaL"
                />
              </div>
            </div>

            <div className="mt-8 flex gap-3">
              <button 
                onClick={() => setShowSettings(false)}
                className="flex-1 px-4 py-3 rounded-xl font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Hủy
              </button>
              <button 
                onClick={saveSettings}
                className="flex-[2] bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-3 rounded-xl font-medium transition-colors"
              >
                Lưu cài đặt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
