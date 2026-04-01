-- Add coordinates column to territories table
-- Stores GeoJSON polygon coordinates as JSONB
-- Format: [[[lng, lat], [lng, lat], ...]] (Polygon rings)

ALTER TABLE territories
  ADD COLUMN IF NOT EXISTS coordinates JSONB;

COMMENT ON COLUMN territories.coordinates IS
  'GeoJSON polygon coordinates array: [[[lng, lat], ...]]';
