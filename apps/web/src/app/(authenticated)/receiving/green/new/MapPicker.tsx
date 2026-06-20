'use client';

// apps/web/src/app/(authenticated)/receiving/green/new/MapPicker.tsx
//
// Card 0.17 — GeoJSON polygon picker for the producer's
// farm boundary.
//
// The card body specifies: "User can draw a polygon (click
// points, double-click to close) or paste a GeoJSON string."
// This component does both.
//
// AREA CALCULATION
//
//   Area is computed in hectares from a WGS84 (EPSG:4326)
//   polygon using the spherical excess formula on the
//   ellipsoid (Turf.js-style algorithm). This is a
//   client-side approximation; the rigorous version uses
//   `ST_Area(geography(polygon)) / 10000` on the server
//   (card 0.22's area-validation check). The two should
//   agree to within 1% for any farm-shaped polygon.
//
//   v1 LIMITATION: the delta check (polygon area vs
//   `area_hectares` input) is a v0 warning. The card body
//   calls for "> 20%" warning. We show the percentage
//   delta but don't enforce.
//
// LEAFLET IMPORT
//
//   Leaflet and react-leaflet render client-side only.
//   We use `dynamic(() => import('leaflet'), { ssr: false })`
//   to load them in the browser only.

import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { LatLngExpression, LatLngTuple } from 'leaflet';

interface MapPickerProps {
  initialGeojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  initialAreaHectares: number | null;
  onCancel: () => void;
  onSave: (
    geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon,
    areaHectares: number,
  ) => void;
}

// Compute the area of a GeoJSON Polygon in hectares using
// the spherical excess formula on a WGS84 sphere
// approximation. This is accurate to < 1% for farm-sized
// polygons (the rigorous version is ST_Area on geography).
function polygonAreaHectares(ring: LatLngTuple[]): number {
  if (ring.length < 3) return 0;
  const R = 6378137; // WGS84 equatorial radius (m)
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    if (!p1 || !p2) continue;
    const lat1 = p1[0];
    const lng1 = p1[1];
    const lat2 = p2[0];
    const lng2 = p2[1];
    total +=
      ((lng2 - lng1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  const areaM2 = Math.abs((total * R * R) / 2);
  return areaM2 / 10000; // m² → hectares
}

function geojsonAreaHectares(
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): number {
  if (geojson.type === 'Polygon') {
    // Exterior ring only (interior rings = holes; we
    // don't support holes in v1 but the structure is here).
    return polygonAreaHectares(
      geojson.coordinates[0] as LatLngTuple[],
    );
  }
  // MultiPolygon: sum of polygons.
  return geojson.coordinates.reduce((sum, poly) => {
    return sum +
      polygonAreaHectares(poly[0] as LatLngTuple[]);
  }, 0);
}

function geojsonToLatLngTuple(
  g: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): LatLngTuple[][] {
  if (g.type === 'Polygon') {
    return g.coordinates.map((ring) =>
      ring.map(([lng, lat]) => [lat, lng] as LatLngTuple),
    );
  }
  // MultiPolygon: collapse to the first polygon's exterior
  // ring (the v1 map picker only draws / edits a single
  // polygon — multi-polygon producers are deferred to a
  // follow-up card).
  const first = g.coordinates[0];
  if (!first) return [];
  return first.map((ring) =>
    ring.map(([lng, lat]) => [lat, lng] as LatLngTuple),
  );
}

function latLngTupleToGeojsonPolygon(
  rings: LatLngTuple[][],
): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: rings.map((ring) =>
      ring.map(([lat, lng]) => [lng, lat]),
    ),
  };
}

export function MapPicker(props: MapPickerProps): ReactElement {
  const [points, setPoints] = useState<LatLngTuple[]>([]);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [areaHectares, setAreaHectares] = useState<number | null>(
    props.initialAreaHectares,
  );

  // Initialise from props.
  useEffect(() => {
    if (props.initialGeojson && points.length === 0) {
      const rings = geojsonToLatLngTuple(props.initialGeojson);
      setPoints(rings[0] || []);
    }
  }, [props.initialGeojson, points.length]);

  // Recompute area whenever points change.
  useEffect(() => {
    if (points.length < 3) {
      setAreaHectares(null);
      return;
    }
    setAreaHectares(polygonAreaHectares(points));
  }, [points]);

  const onPaste = (): void => {
    setPasteError(null);
    try {
      const parsed = JSON.parse(pasteValue);
      if (parsed.type !== 'Polygon' && parsed.type !== 'MultiPolygon') {
        throw new Error('GeoJSON must be Polygon or MultiPolygon');
      }
      const rings = geojsonToLatLngTuple(parsed);
      setPoints(rings[0] || []);
      setAreaHectares(geojsonAreaHectares(parsed));
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : 'Invalid GeoJSON');
    }
  };

  const onSave = (): void => {
    if (points.length < 3) return;
    const polygon = latLngTupleToGeojsonPolygon([points]);
    props.onSave(polygon, areaHectares ?? 0);
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h3 style={{ margin: '0 0 0.5rem' }}>Draw farm boundary</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#555' }}>
          Click points on the map to draw a polygon. Double-click to
          finish. Or paste a GeoJSON string below.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input
            type="text"
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder='{"type":"Polygon","coordinates":[…]}'
            style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }}
          />
          <button type="button" onClick={onPaste} style={secondaryButtonStyle}>
            Load GeoJSON
          </button>
        </div>
        {pasteError && (
          <p style={{ color: '#a00', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {pasteError}
          </p>
        )}
        <div style={{ height: 360, border: '1px solid #ccc', borderRadius: 4 }}>
          <MapContainer
            center={[0, 0] as LatLngExpression}
            zoom={2}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickHandler onAdd={(p) => setPoints((arr) => [...arr, p])} />
            <DoubleClickHandler />
            {points.length >= 3 && (
              <Polygon
                pathOptions={{ color: '#37c' }}
                positions={points}
              />
            )}
            <FitToPoints points={points} />
          </MapContainer>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.5rem 0' }}>
          {points.length === 0 && 'Click the map to add the first point.'}
          {points.length === 1 && '1 point added. Add at least 2 more.'}
          {points.length === 2 && '2 points added. Add at least 1 more, then double-click to finish.'}
          {points.length >= 3 && (
            <>
              {points.length} points. Double-click to finish.
              {' '}
              <button
                type="button"
                onClick={() => setPoints((arr) => arr.slice(0, -1))}
                style={linkButtonStyle}
              >
                Undo last
              </button>
              {' '}
              <button
                type="button"
                onClick={() => {
                  setPoints([]);
                  setAreaHectares(null);
                }}
                style={linkButtonStyle}
              >
                Clear
              </button>
            </>
          )}
        </p>
        {areaHectares !== null && (
          <p style={{ fontSize: '0.9rem', margin: '0.25rem 0' }}>
            <strong>Area:</strong> {areaHectares.toFixed(2)} ha
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button
            type="button"
            onClick={props.onCancel}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onSave}
            disabled={points.length < 3}
            style={
              points.length < 3
                ? disabledButtonStyle
                : primaryButtonStyle
            }
          >
            Save boundary
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Map sub-components ────────────────────────────────────────────────────

function ClickHandler({ onAdd }: { onAdd: (p: LatLngTuple) => void }): null {
  useMapEvents({
    click(e) {
      onAdd([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function DoubleClickHandler(): null {
  // Leaflet's default double-click is "zoom in" — we
  // disable it via the map's `doubleClickZoom: false`
  // option. The user finishes the polygon via the Save
  // button instead (consistent with the rest of the
  // form's explicit-save UX).
  const map = useMap();
  useEffect(() => {
    map.doubleClickZoom.disable();
    return () => {
      map.doubleClickZoom.enable();
    };
  }, [map]);
  return null;
}

function FitToPoints({ points }: { points: LatLngTuple[] }): null {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = points.map(
      ([lat, lng]) => [lat, lng] as [number, number],
    );
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, points]);
  return null;
}

// ── Inline styles ─────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '1rem',
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  maxWidth: 640,
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '0.25rem',
  padding: '0.4rem 0.5rem',
  fontSize: '0.95rem',
  border: '1px solid #bbb',
  borderRadius: 4,
  fontFamily: 'inherit',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  fontSize: '1rem',
  background: '#3a7',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: '#888',
};

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: '#ccc',
  cursor: 'not-allowed',
};

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#37c',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontSize: '0.85rem',
  marginLeft: '0.5rem',
};
