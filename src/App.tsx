import { useEffect, useMemo, useState } from 'react';
import { UrlInput } from './components/UrlInput';
import { Player } from './components/Player';
import { ChannelList } from './components/ChannelList';
import { loadChannels, type Channel } from './lib/channels';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; channels: Channel[] }
  | { kind: 'error'; message: string };

export default function App() {
  const [channelsState, setChannelsState] = useState<LoadState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Channel | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const allChannels = channelsState.kind === 'ready' ? channelsState.channels : [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allChannels;
    return allChannels.filter(
      (c) => c.name.toLowerCase().includes(q) || c.url.toLowerCase().includes(q),
    );
  }, [allChannels, query]);

  // 5 columns x 3 rows per page.
  const PAGE_SIZE = 15;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp: a shrinking filter can leave `page` past the end.
  const safePage = Math.min(page, totalPages - 1);
  const pageChannels = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Jump back to the first page whenever the search query changes.
  useEffect(() => {
    setPage(0);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    loadChannels()
      .then((channels) => !cancelled && setChannelsState({ kind: 'ready', channels }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setChannelsState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Failed to load channels.',
          }),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app">
      <header>
        <h1>M3U8 Web Streamer</h1>
        <p className="subtitle">Pick a channel, or paste any HLS stream URL.</p>
      </header>

      <section className="channels-section">
        <div className="channels-head">
          <h2>Channels</h2>
          {channelsState.kind === 'ready' && (
            <span className="channels-count">
              {query.trim()
                ? `${filtered.length} of ${allChannels.length}`
                : `${allChannels.length}`}
            </span>
          )}
        </div>

        {channelsState.kind === 'loading' && <p className="muted">Loading channels…</p>}
        {channelsState.kind === 'error' && (
          <p className="status status-error">Error: {channelsState.message}</p>
        )}
        {channelsState.kind === 'ready' && (
          <>
            <div className="search">
              <input
                type="search"
                placeholder="Search channels by name or URL…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
              {query && (
                <button type="button" className="search-clear" onClick={() => setQuery('')}>
                  Clear
                </button>
              )}
            </div>
            {filtered.length === 0 ? (
              <p className="channels-empty">No channels match “{query}”.</p>
            ) : (
              <>
                <ChannelList
                  channels={pageChannels}
                  activeUrl={selected?.url ?? null}
                  onSelect={setSelected}
                />
                <nav className="pager" aria-label="Channel pages">
                  <button
                    type="button"
                    className="pager-btn"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  <span className="pager-status">
                    Page {safePage + 1} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="pager-btn"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </nav>
              </>
            )}
          </>
        )}
      </section>

      <section className="manual-section">
        <h2>Or paste a URL</h2>
        <UrlInput onSubmit={(url) => setSelected({ name: url, url })} />
      </section>

      {selected && (
        <section className="now-playing">
          <h2>{selected.name}</h2>
          {/* key remounts the player (tearing down hls.js) on each channel change. */}
          <Player key={selected.url} url={selected.url} headers={selected.headers} />
        </section>
      )}
    </main>
  );
}
