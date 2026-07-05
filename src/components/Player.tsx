import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { buildManifestUrl } from '../lib/buildProxyUrl';

type Status =
  | { kind: 'loading' }
  | { kind: 'playing' }
  | { kind: 'error'; message: string };

interface Props {
  url: string;
  headers?: Record<string, string>;
}

export function Player({ url, headers }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const src = buildManifestUrl(url, headers);
    setStatus({ kind: 'loading' });
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus({ kind: 'playing' });
        void video.play().catch(() => {
          /* Autoplay may be blocked; the user can press play. */
        });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setStatus({ kind: 'error', message: `${data.type} — ${data.details}` });
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / iOS play HLS natively.
      video.src = src;
      const onLoaded = () => {
        setStatus({ kind: 'playing' });
        void video.play().catch(() => {});
      };
      const onError = () =>
        setStatus({ kind: 'error', message: 'Native HLS playback failed.' });
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      return () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      };
    } else {
      setStatus({ kind: 'error', message: 'HLS is not supported in this browser.' });
    }

    return () => {
      hls?.destroy();
    };
  }, [url]);

  return (
    <div className="player">
      <video ref={videoRef} controls playsInline />
      <p className={`status status-${status.kind}`}>
        {status.kind === 'loading' && 'Loading stream…'}
        {status.kind === 'playing' && '● Playing'}
        {status.kind === 'error' && `Error: ${status.message}`}
      </p>
    </div>
  );
}
