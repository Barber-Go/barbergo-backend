import { Injectable, Logger } from '@nestjs/common';

export interface ExternalBarber {
  id: string;
  displayName: string;
  lat: number;
  lng: number;
  entityType: string;
  action: string;
  rating: number;
  address: string | null;
  phone: string | null;
  isExternal: boolean;
  avatarUrl: null;
  services: never[];
  distance?: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ExternalBarbersService {
  private readonly logger = new Logger(ExternalBarbersService.name);
  private cache: ExternalBarber[] | null = null;
  private cacheTime = 0;

  async getAll(): Promise<ExternalBarber[]> {
    if (this.cache && Date.now() - this.cacheTime < CACHE_TTL_MS) {
      return this.cache;
    }

    const query = `[out:json][timeout:25];
area["ISO3166-1"="CL"][admin_level=2]->.chile;
(
  node["shop"="hairdresser"](area.chile);
  node["shop"="barber"](area.chile);
  way["shop"="hairdresser"](area.chile);
  way["shop"="barber"](area.chile);
);
out center tags;`;

    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!res.ok) {
        this.logger.warn(`Overpass API returned ${res.status}`);
        return this.cache ?? [];
      }

      const json = await res.json();
      const elements: OverpassElement[] = json.elements ?? [];

      this.cache = elements
        .map((el) => {
          const lat = el.lat ?? el.center?.lat;
          const lon = el.lon ?? el.center?.lon;
          if (lat == null || lon == null) return null;

          const tags = el.tags ?? {};
          const street = tags['addr:street'] ?? '';
          const number = tags['addr:housenumber'] ?? '';
          const address = street ? `${street} ${number}`.trim() : null;

          return {
            id: `osm_${el.id}`,
            displayName: tags.name || 'Barberia',
            lat,
            lng: lon,
            entityType: 'EXTERNAL_BARBERSHOP',
            action: 'OPEN_EXTERNAL',
            rating: 0,
            address,
            phone: tags.phone || tags['contact:phone'] || null,
            isExternal: true,
            avatarUrl: null,
            services: [] as never[],
          };
        })
        .filter((b): b is ExternalBarber => b !== null);

      this.cacheTime = Date.now();
      this.logger.log(`Cached ${this.cache.length} external barbers from Overpass`);
      return this.cache;
    } catch (err) {
      this.logger.error('Overpass API error', err);
      return this.cache ?? [];
    }
  }

  async search(lat?: number, lng?: number, radiusKm?: number): Promise<ExternalBarber[]> {
    const all = await this.getAll();
    if (lat == null || lng == null) return all;

    const r = radiusKm ?? 10;
    return all
      .map((b) => {
        const d = haversine(lat, lng, b.lat, b.lng);
        return { ...b, distance: d };
      })
      .filter((b) => b.distance <= r)
      .sort((a, b) => a.distance - b.distance);
  }
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
