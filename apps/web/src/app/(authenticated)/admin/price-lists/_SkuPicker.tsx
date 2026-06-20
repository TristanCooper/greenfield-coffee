'use client';

// apps/web/src/app/(authenticated)/admin/price-lists/_SkuPicker.tsx
//
// Card 0.16 — internal SKU combobox for the price-list entries
// editor. Fetches /api/skus?q=…; user picks from the tenant-scoped
// SKU list.

import { useState, useEffect, useRef, useCallback } from 'react';
import { inputStyle } from '@/lib/admin/styles';

export interface SkuOption {
  id: string;
  code: string;
  name: string;
  unitWeightG: string | null;
}

export interface SkuPickerProps {
  index: number;
  initial: { skuId: string; skuCode?: string; skuName?: string } | null;
  disabled?: boolean;
  onChange: (next: {
    skuId: string;
    skuCode: string;
    skuName: string;
  } | null) => void;
}

export function SkuPicker(props: SkuPickerProps): React.ReactElement {
  const [query, setQuery] = useState<string>(props.initial?.skuCode ?? '');
  const [options, setOptions] = useState<SkuOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    props.initial?.skuId ?? null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOptions = useCallback(async (q: string) => {
    if (q.length < 1) {
      setOptions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/skus?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { skus: SkuOption[] };
      setOptions(data.skus ?? []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchOptions(query);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchOptions]);

  const onSelect = (opt: SkuOption) => {
    setQuery(opt.code);
    setSelectedId(opt.id);
    setOpen(false);
    props.onChange({ skuId: opt.id, skuCode: opt.code, skuName: opt.name });
  };

  const onClear = () => {
    setQuery('');
    setSelectedId(null);
    props.onChange(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input type="hidden" name={`entry.skuId.${props.index}`} value={selectedId ?? ''} />
      <input
        type="text"
        value={query}
        placeholder="Search SKU…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (selectedId) setSelectedId(null);
          props.onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={props.disabled}
        style={inputStyle}
      />
      {open && query.length > 0 ? (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            margin: 0,
            padding: 0,
            listStyle: 'none',
            background: '#fff',
            border: '1px solid #d4d4d4',
            borderRadius: 4,
            maxHeight: '12rem',
            overflowY: 'auto',
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          {loading ? (
            <li style={{ padding: '0.5rem', color: '#737373' }}>Loading…</li>
          ) : options.length === 0 ? (
            <li style={{ padding: '0.5rem', color: '#737373' }}>No matches.</li>
          ) : (
            options.map((opt) => (
              <li
                key={opt.id}
                role="option"
                aria-selected={selectedId === opt.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(opt);
                }}
                style={{
                  padding: '0.4rem 0.6rem',
                  cursor: 'pointer',
                  background: selectedId === opt.id ? '#dbeafe' : 'transparent',
                }}
              >
                {opt.code} · {opt.name}
              </li>
            ))
          )}
        </ul>
      ) : null}
      {selectedId ? (
        <button
          type="button"
          onClick={onClear}
          disabled={props.disabled}
          style={{
            marginTop: '0.25rem',
            background: 'none',
            border: 'none',
            color: '#1d4ed8',
            cursor: 'pointer',
            fontSize: '0.8rem',
            padding: 0,
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
