import { useState, type FormEvent } from 'react';

interface Props {
  onSubmit: (url: string) => void;
  disabled?: boolean;
}

export function UrlInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <form className="url-input" onSubmit={handleSubmit}>
      <input
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste an .m3u8 or .m3u stream URL…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
      />
      <button type="submit" disabled={disabled}>
        Play
      </button>
    </form>
  );
}
