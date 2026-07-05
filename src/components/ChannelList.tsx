import type { Channel } from '../lib/channels';

interface Props {
  channels: Channel[];
  activeUrl: string | null;
  onSelect: (channel: Channel) => void;
}

export function ChannelList({ channels, activeUrl, onSelect }: Props) {
  if (channels.length === 0) {
    return <p className="channels-empty">No channels found in channels.json.</p>;
  }

  return (
    <ul className="channels">
      {channels.map((channel) => (
        <li key={`${channel.name}|${channel.url}`}>
          <button
            type="button"
            className={`channel${channel.url === activeUrl ? ' channel-active' : ''}`}
            onClick={() => onSelect(channel)}
            title={channel.name}
          >
            <span className="channel-name">{channel.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
