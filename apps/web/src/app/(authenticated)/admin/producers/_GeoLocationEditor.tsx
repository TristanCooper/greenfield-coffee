'use client';

// apps/web/src/app/(authenticated)/admin/producers/_GeoLocationEditor.tsx
//
// Card 0.16 — client-side GeoJSON editor + map picker for the
// producer's `geolocation` (geography(MultiPolygon, 4326)).
//
// The card body says: "Producer form must include the GeoJSON map
// picker for `geolocation` (full implementation in card 0.17, but
// the form field + save logic should be wired here even if the map
// widget is a stub for v0)".
//
// Card 0.17 is DONE — the MapPicker component lives at
// apps/web/src/app/(authenticated)/receiving/green/new/MapPicker.tsx.
// We reuse it here. The editor renders the current GeoJSON as a
// read-only preview, plus a "Draw / edit boundary" button that
// opens the MapPicker modal. The form submits the GeoJSON as a
// hidden JSON input.

import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  buttonSecondaryStyle,
  inputStyle,
  labelStyle,
} from '@/lib/admin/styles';

// The MapPicker is a Client Component that imports leaflet /
// react-leaflet, which are not SSR-friendly. We lazy-load it via
// next/dynamic with `ssr: false` so the producer form remains a
// Server Component parent.
const MapPicker = dynamic(
  () =>
    import(
      // The MapPicker is not in the admin tree, but it's a Client
      // Component. We import from the absolute source path; Next
      // resolves the import at build time.
      /* webpackIgnore: false */ '@/app/(authenticated)/receiving/green/new/MapPicker'
    ).then((m) => m.MapPicker),
  { ssr: false },
);

interface GeoLocationEditorProps {
  initialGeojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  initialAreaHectares: number | null;
  disabled?: boolean;
}

function geojsonAreaHectares(
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): number {
  // Reuse the same heuristic as MapPicker for a coarse area
  // estimate — accurate to ~1% for farm-sized polygons.
  const R = 6378137;
  function ringArea(ring: number[][]): number {
    if (ring.length < 3) return 0;
    let total = 0;
    for (let i = 0; i < ring.length; i++) {
      const p1 = ring[i]!;
      const p2 = ring[(i + 1) % ring.length]!;
      const lng1 = p1[0]!;
      const lat1 = p1[1]!;
      const lng2 = p2[0]!;
      const lat2 = p2[1]!;
      total +=
        ((lng2 - lng1) * Math.PI) / 180 *
        (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
    }
    return Math.abs((total * R * R) / 2) / 10000;
  }
  if (geojson.type === 'Polygon') {
    return ringArea(geojson.coordinates[0] ?? []);
  }
  return geojson.coordinates.reduce((sum, poly) => {
    return sum + ringArea(poly[0] ?? []);
  }, 0);
}

export function GeoLocationEditor(
  props: GeoLocationEditorProps,
): React.ReactElement {
  const [geojson, setGeojson] = useState<
    GeoJSON.Polygon | GeoJSON.MultiPolygon | null
  >(props.initialGeojson);
  const [area, setArea] = useState<number | null>(
    props.initialAreaHectares,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const onSave = (next: GeoJSON.Polygon | GeoJSON.MultiPolygon, ha: number) => {
    setGeojson(next);
    setArea(ha);
    setPickerOpen(false);
  };

  const onClear = () => {
    setGeojson(null);
    setArea(null);
  };

  const onTextareaChange = (raw: string) => {
    if (raw.trim() === '') {
      setGeojson(null);
      setArea(null);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const t = (parsed as { type: unknown }).type;
      if (t === 'Polygon' || t === 'MultiPolygon') {
        const gj = parsed as GeoJSON.Polygon | GeoJSON.MultiPolygon;
        setGeojson(gj);
        setArea(geojsonAreaHectares(gj));
      }
    } catch {
      // Silent — user is typing.
    }
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={labelStyle}>Geolocation</label>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#737373' }}>
        The farm's boundary as a GeoJSON Polygon or MultiPolygon. WGS84 (EPSG:4326).
        Click "Draw boundary" to use the map picker, or paste a GeoJSON string below.
        The card 0.17 map widget is reused here.
      </p>
      <input
        type="hidden"
        name="geolocationGeojson"
        value={geojson ? JSON.stringify(geojson) : ''}
      />
      <input type="hidden" name="areaHectares" value={area ?? ''} />
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={props.disabled}
          style={buttonSecondaryStyle}
        >
          {geojson ? 'Edit boundary' : 'Draw boundary'}
        </button>
        {geojson ? (
          <button
            type="button"
            onClick={onClear}
            disabled={props.disabled}
            style={buttonSecondaryStyle}
          >
            Clear
          </button>
        ) : null}
        {area !== null ? (
          <span
            style={{
              alignSelf: 'center',
              fontSize: '0.9rem',
              color: '#525252',
            }}
          >
            Area: {area.toFixed(2)} ha
          </span>
        ) : null}
      </div>
      <textarea
        ref={textAreaRef}
        rows={5}
        placeholder='{"type":"Polygon","coordinates":[…]}'
        defaultValue={geojson ? JSON.stringify(geojson, null, 2) : ''}
        onChange={(e) => onTextareaChange(e.target.value)}
        disabled={props.disabled}
        style={{
          ...inputStyle,
          fontFamily: 'monospace',
          fontSize: '0.85rem',
        }}
      />
      {pickerOpen ? (
        <MapPicker
          initialGeojson={geojson}
          initialAreaHectares={area}
          onCancel={() => setPickerOpen(false)}
          onSave={onSave}
        />
      ) : null}
    </div>
  );
}
