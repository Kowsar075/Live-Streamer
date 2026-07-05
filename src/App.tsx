import { useState } from 'react';
import { UrlInput } from './components/UrlInput';
import { Player } from './components/Player';

// Public HLS test stream (Mux) — handy for a first run.
const SAMPLE_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

export default function App() {
  const [url, setUrl] = useState('');

  return (
    <main className="app">
      <header>
        <h1>M3U8 Web Streamer</h1>
        <p className="subtitle">Paste an HLS stream URL and play it in your browser.</p>
      </header>

      <UrlInput onSubmit={setUrl} />

      <button className="sample" type="button" onClick={() => setUrl(SAMPLE_URL)}>
        Try a sample stream
      </button>

      {/* key={url} remounts the player (and tears down hls.js) on each new URL. */}
      {url && <Player key={url} url={url} />}
    </main>
  );
}
