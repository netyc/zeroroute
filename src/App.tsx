/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Route,
  Map as MapIcon,
  Search,
  Navigation2,
  Car,
  Bike,
  Footprints,
  Loader2,
  Sparkles,
  Layers,
  List,
  MapPin,
  Crosshair,
  TrainFront,
  Ship,
  Plane,
  Eye,
  Mountain,
  Image as ImageIcon,
  Save,
  FolderOpen,
  Trash2,
  Clock,
  WifiOff,
  X,
  Building2,
  Send,
  User,
  Bot
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Map, {
  Source,
  Layer,
  MapRef,
  Marker,
  Popup,
  NavigationControl,
  FullscreenControl,
  GeolocateControl,
} from "react-map-gl/maplibre";
import { MapMouseEvent } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import Markdown from "react-markdown";

// Types
type VehicleType =
  | "driving"
  | "cycling"
  | "walking"
  | "motorcycle"
  | "train"
  | "ship"
  | "plane";

interface LocationSearchResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: string[];
}

interface SavedRoute {
  id: string;
  from: LocationSearchResult;
  to: LocationSearchResult;
  routes: RouteData[];
  aiAnalysis: string;
  vehicle: VehicleType;
  timestamp: number;
}

interface SavedPlace {
  id: string;
  location: LocationSearchResult;
  timestamp: number;
}

interface RouteData {
  distance: number; // meters
  duration: number; // seconds
  originalDuration?: number; // seconds, before traffic adjust
  geometry: any; // GeoJSON line string
  trafficFeatureCollection?: any; // FeatureCollection of segments for traffic rendering
  legs?: {
    steps: {
      maneuver: { instruction?: string; type: string; modifier?: string };
      name: string;
      distance: number;
    }[];
  }[];
}

const getInstruction = (step: any) => {
  if (step.maneuver?.instruction) return step.maneuver.instruction; // from mapbox if available

  const type = step.maneuver?.type;
  const modifier = step.maneuver?.modifier;
  const name = step.name;

  let action = "Lanjut";
  if (type === "turn") action = "Belok";
  else if (type === "new name") action = "Terus ke";
  else if (type === "depart") action = "Mulai dari";
  else if (type === "arrive") action = "Sampai di tujuan";
  else if (type === "merge") action = "Bergabung";
  else if (type === "on ramp") action = "Masuk ramp";
  else if (type === "off ramp") action = "Keluar ramp";
  else if (type === "fork") action = "Di percabangan";
  else if (type === "end of road") action = "Di ujung jalan";
  else if (type === "roundabout") action = "Di bundaran";

  let mod = "";
  if (modifier) {
    if (modifier.includes("left")) mod = "kiri";
    else if (modifier.includes("right")) mod = "kanan";
    else if (modifier.includes("straight")) mod = "lurus";
    else mod = modifier;
  }

  const roadName = name ? ` di ${name}` : "";

  if (type === "depart") return `Mulai perjalanan arah ${mod}${roadName}`;
  if (type === "arrive") return `Sampai di tujuan`;

  return `${action} ${mod}${roadName}`.replace(/\s+/g, " ").trim();
};

const VECHICLES: { id: VehicleType; icon: React.FC<any>; label: string }[] = [
  { id: "driving", icon: Car, label: "Mobil" },
  { id: "motorcycle", icon: Bike, label: "Motor" },
  { id: "cycling", icon: Bike, label: "Sepeda" },
  { id: "walking", icon: Footprints, label: "Jalan Kaki" },
  { id: "train", icon: TrainFront, label: "Kereta" },
  { id: "ship", icon: Ship, label: "Kapal" },
  { id: "plane", icon: Plane, label: "Pesawat" },
];

const getHaversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) => {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

const applySimulatedTraffic = (
  route: RouteData,
  vehicleType: string,
): RouteData => {
  // Only apply traffic to motorized vehicles
  if (vehicleType !== "driving" && vehicleType !== "motorcycle") {
    return {
      ...route,
      trafficFeatureCollection: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { trafficLevel: "low" },
            geometry: route.geometry,
          },
        ],
      },
    };
  }

  const coordinates = route.geometry.coordinates;
  if (!coordinates || coordinates.length < 2) return route;

  const features = [];
  let totalDistance = 0;
  let totalDuration = 0;

  // Create varying traffic chunks
  let currentTraffic = "low";
  let trafficTimeLeft = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];

    // coord is [lon, lat]
    const dist = getHaversineDistance(p1[1], p1[0], p2[1], p2[0]);
    totalDistance += dist;

    if (trafficTimeLeft <= 0) {
      const rand = Math.random();
      if (rand > 0.95) currentTraffic = "closed";
      else if (rand > 0.85) currentTraffic = "heavy";
      else if (rand > 0.65) currentTraffic = "moderate";
      else currentTraffic = "low";

      trafficTimeLeft = Math.floor(Math.random() * 5) + 3; // span 3 to 7 segments
    }
    trafficTimeLeft--;

    features.push({
      type: "Feature",
      properties: {
        trafficLevel: currentTraffic,
      },
      geometry: {
        type: "LineString",
        coordinates: [p1, p2],
      },
    });

    // base speed from OSRM overall approx (m/s)
    const baseSpeed = route.distance / route.duration || 10;
    let actualSpeed = baseSpeed;
    if (currentTraffic === "moderate") actualSpeed *= 0.6;
    if (currentTraffic === "heavy") actualSpeed *= 0.3;
    if (currentTraffic === "closed") actualSpeed *= 0.05;

    totalDuration += dist / actualSpeed;
  }

  return {
    ...route,
    originalDuration: route.duration,
    duration: totalDuration > 0 ? totalDuration : route.duration,
    trafficFeatureCollection: {
      type: "FeatureCollection",
      features,
    },
  };
};

const getBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);

  return ((theta * 180) / Math.PI + 360) % 360;
};

const getDestinationPoint = (
  lat: number,
  lon: number,
  distanceMeters: number,
  bearingDegrees: number,
) => {
  const R = 6371e3;
  const delta = distanceMeters / R;
  const theta = (bearingDegrees * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lon * Math.PI) / 180;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
      Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );

  return {
    lat: (phi2 * 180) / Math.PI,
    lon: (lambda2 * 180) / Math.PI,
  };
};

export const ROUTE_VARIANTS = [
  { id: "tikus", label: "Jalan Tikus", offset: 0.02, side: "left" },
  { id: "super_dekat", label: "Super Dekat", offset: 0, side: "none" },
  { id: "paling_dekat", label: "Paling Dekat", offset: 0.04, side: "left" },
  { id: "dekat", label: "Dekat", offset: 0.04, side: "right" },
  { id: "sedang", label: "Sedang", offset: 0.08, side: "left" },
  { id: "normal", label: "Normal", offset: 0.08, side: "right" },
  { id: "jauh", label: "Jauh", offset: 0.15, side: "left" },
  { id: "terjauh", label: "Terjauh", offset: 0.15, side: "right" },
  { id: "paling_jauh", label: "Paling Jauh", offset: 0.25, side: "left" },
  { id: "super_jauh", label: "Super Jauh", offset: 0.35, side: "right" },
];

if (typeof window !== "undefined") {
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const msg = args.map(String).join(" ");
    if (
      msg.includes("signal is aborted") ||
      msg.includes("AbortError") ||
      msg.includes("Failed to load map style") ||
      msg.includes("water")
    ) {
      return;
    }
    originalConsoleError(...args);
  };

  window.addEventListener("unhandledrejection", (event) => {
    const msg = event.reason?.message || String(event.reason);
    if (msg.includes("signal is aborted") || msg.includes("AbortError")) {
      event.preventDefault(); // Suppress the unhandled rejection
      console.warn("Suppressed abort error", msg);
    }
  });

  window.addEventListener("error", (event) => {
    const msg = event.error?.message || event.message || String(event.error);
    if (msg.includes("signal is aborted") || msg.includes("AbortError")) {
      event.preventDefault(); // Suppress the error
    }
  });
}

export default function App() {
  const mapRef = useRef<MapRef>(null);

  const [fromQuery, setFromQuery] = useState(
    () => sessionStorage.getItem("nexus_fromQuery") || "",
  );
  const [toQuery, setToQuery] = useState(
    () => sessionStorage.getItem("nexus_toQuery") || "",
  );
  const [vehicle, setVehicle] = useState<VehicleType>(
    () => (sessionStorage.getItem("nexus_vehicle") as VehicleType) || "driving",
  );

  const [fromLocation, setFromLocation] = useState<LocationSearchResult | null>(
    () => {
      const saved = sessionStorage.getItem("nexus_fromLocation");
      return saved ? JSON.parse(saved) : null;
    },
  );
  const [toLocation, setToLocation] = useState<LocationSearchResult | null>(
    () => {
      const saved = sessionStorage.getItem("nexus_toLocation");
      return saved ? JSON.parse(saved) : null;
    },
  );

  // Autocomplete states
  const [fromSuggestions, setFromSuggestions] = useState<
    LocationSearchResult[]
  >([]);
  const [toSuggestions, setToSuggestions] = useState<LocationSearchResult[]>(
    [],
  );
  const [isSearchingFrom, setIsSearchingFrom] = useState(false);
  const [isSearchingTo, setIsSearchingTo] = useState(false);
  const [showFromSuggestions, setShowFromSuggestions] = useState(false);
  const [showToSuggestions, setShowToSuggestions] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const fetchSuggestions = async () => {
      if (
        !fromQuery ||
        (fromLocation && fromQuery === fromLocation.display_name)
      ) {
        setFromSuggestions([]);
        return;
      }
      setIsSearchingFrom(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fromQuery)}&limit=5&countrycodes=id`,
          {
            signal: controller.signal,
          },
        );
        const data = await res.json();
        setFromSuggestions(data || []);
      } catch (e: any) {
        if (e.name === "AbortError" || e.message?.includes("signal is aborted")) return;
        console.error(e);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingFrom(false);
        }
      }
    };
    const timer = setTimeout(fetchSuggestions, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fromQuery, fromLocation]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchSuggestions = async () => {
      if (!toQuery || (toLocation && toQuery === toLocation.display_name)) {
        setToSuggestions([]);
        return;
      }
      setIsSearchingTo(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(toQuery)}&limit=5&countrycodes=id`,
          {
            signal: controller.signal,
          },
        );
        const data = await res.json();
        setToSuggestions(data || []);
      } catch (e: any) {
        if (e.name === "AbortError" || e.message?.includes("signal is aborted")) return;
        console.error(e);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingTo(false);
        }
      }
    };
    const timer = setTimeout(fetchSuggestions, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [toQuery, toLocation]);

  useEffect(() => {
    sessionStorage.setItem("nexus_fromQuery", fromQuery);
  }, [fromQuery]);
  useEffect(() => {
    sessionStorage.setItem("nexus_toQuery", toQuery);
  }, [toQuery]);
  useEffect(() => {
    sessionStorage.setItem("nexus_vehicle", vehicle);
  }, [vehicle]);
  useEffect(() => {
    if (fromLocation)
      sessionStorage.setItem(
        "nexus_fromLocation",
        JSON.stringify(fromLocation),
      );
    else sessionStorage.removeItem("nexus_fromLocation");
  }, [fromLocation]);
  useEffect(() => {
    if (toLocation)
      sessionStorage.setItem("nexus_toLocation", JSON.stringify(toLocation));
    else sessionStorage.removeItem("nexus_toLocation");
  }, [toLocation]);

  const [is3D, setIs3D] = useState(true);
  const [show3DBuildings, setShow3DBuildings] = useState(true);
  const [terrainExaggeration, setTerrainExaggeration] = useState(1.5);
  const [debouncedTerrainExaggeration, setDebouncedTerrainExaggeration] =
    useState(1.5);

  useEffect(() => {
    const t = setTimeout(
      () => setDebouncedTerrainExaggeration(terrainExaggeration),
      150,
    );
    return () => clearTimeout(t);
  }, [terrainExaggeration]);

  const [mapStyleType, setMapStyleType] = useState<
    "dark" | "realistic" | "osm"
  >("dark");
  const [currentCenter, setCurrentCenter] = useState<{
    lat: number;
    lng: number;
  }>({ lat: -6.1751, lng: 106.8272 });
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const [currentElevation, setCurrentElevation] = useState<number | null>(null);

  const enterImmersiveMode = () => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const center = map.getCenter();
      map.flyTo({
        center: center,
        zoom: 19,
        pitch: 80,
        bearing: map.getBearing() + 45,
        duration: 2500,
      });
      setIs3D(true);
    }
  };

  const fromLocationRef = useRef<LocationSearchResult | null>(null);

  // Update ref when fromLocation changes
  useEffect(() => {
    fromLocationRef.current = fromLocation;
  }, [fromLocation]);

  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeVariant, setRouteVariant] = useState("super_dekat");

  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [showSavedRoutes, setShowSavedRoutes] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savedRecordsTab, setSavedRecordsTab] = useState<"routes" | "places">(
    "routes",
  );

  const [placeQuery, setPlaceQuery] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState<
    LocationSearchResult[]
  >([]);
  const [isSearchingPlace, setIsSearchingPlace] = useState(false);
  const [showPlaceSuggestions, setShowPlaceSuggestions] = useState(false);
  const [selectedPlace, setSelectedPlace] =
    useState<LocationSearchResult | null>(null);
  const [isMobileSearchExpanded, setIsMobileSearchExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const fetchSuggestions = async () => {
      if (
        !placeQuery ||
        (selectedPlace && placeQuery === selectedPlace.display_name)
      ) {
        setPlaceSuggestions([]);
        return;
      }
      setIsSearchingPlace(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeQuery)}&limit=5&countrycodes=id`,
          {
            signal: controller.signal,
          },
        );
        const data = await res.json();
        setPlaceSuggestions(data || []);
      } catch (e: any) {
        if (e.name === "AbortError" || e.message?.includes("signal is aborted")) return;
        console.error(e);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingPlace(false);
        }
      }
    };
    const timer = setTimeout(fetchSuggestions, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [placeQuery, selectedPlace]);

  useEffect(() => {
    try {
      const storedRoutes = localStorage.getItem("nexus_saved_routes");
      if (storedRoutes) {
        setSavedRoutes(JSON.parse(storedRoutes));
      }
      const storedPlaces = localStorage.getItem("nexus_saved_places");
      if (storedPlaces) {
        setSavedPlaces(JSON.parse(storedPlaces));
      }
    } catch (e) {
      console.error("Failed to load saved data", e);
    }
  }, []);

  const saveCurrentRouteToOffline = () => {
    if (!fromLocation || !toLocation || routes.length === 0) return;
    const newSavedRoute: SavedRoute = {
      id: Date.now().toString(),
      from: fromLocation,
      to: toLocation,
      routes,
      aiAnalysis,
      vehicle,
      timestamp: Date.now(),
    };
    const updated = [newSavedRoute, ...savedRoutes].slice(0, 10); // Keep last 10
    setSavedRoutes(updated);
    localStorage.setItem("nexus_saved_routes", JSON.stringify(updated));
    alert("Rute berhasil disimpan untuk penggunaan offline!");
  };

  const loadSavedRoute = (route: SavedRoute) => {
    setFromLocation(route.from);
    setToLocation(route.to);
    setFromQuery(route.from.display_name);
    setToQuery(route.to.display_name);
    setVehicle(route.vehicle);
    setRoutes(route.routes);
    setAiAnalysis(route.aiAnalysis);
    setSelectedRouteIndex(0);
    setShowSavedRoutes(false);

    if (route.routes.length > 0) {
      fitBounds(route.routes[0]);
    }
  };

  const removeSavedRoute = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedRoutes.filter((r) => r.id !== id);
    setSavedRoutes(updated);
    localStorage.setItem("nexus_saved_routes", JSON.stringify(updated));
  };

  const handleSelectPlace = (place: LocationSearchResult) => {
    setSelectedPlace(place);
    setPlaceQuery(place.display_name);
    setShowPlaceSuggestions(false);

    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);

    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: 16,
      pitch: is3D ? 60 : 0,
      duration: 1500,
    });

    if (window.innerWidth < 768) {
      setIsMobilePanelOpen(false);
    }
  };

  const savePlace = (place: LocationSearchResult) => {
    const newPlace: SavedPlace = {
      id: Date.now().toString(),
      location: place,
      timestamp: Date.now(),
    };
    const updated = [newPlace, ...savedPlaces].slice(0, 20);
    setSavedPlaces(updated);
    localStorage.setItem("nexus_saved_places", JSON.stringify(updated));
    alert("Tempat berhasil disimpan!");
  };

  const removeSavedPlace = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedPlaces.filter((p) => p.id !== id);
    setSavedPlaces(updated);
    localStorage.setItem("nexus_saved_places", JSON.stringify(updated));
  };

  const [isLoading, setIsLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Chat AI State
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "model"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatLoading]);

  const handleSendChat = async () => {
    if (!chatInput.trim() || !fromLocation || !toLocation || !aiAnalysis) return;
    
    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsChatLoading(true);

    try {
      const shortestRoute = routes.length > 0 ? [...routes].sort((a, b) => a.distance - b.distance)[0] : null;
      let routeContext = "";
      if (shortestRoute) {
        routeContext = `Rute terdekat sejauh ${(shortestRoute.distance / 1000).toFixed(1)} km dengan estimasi waktu ${Math.round(shortestRoute.duration / 60)} menit.`;
      }

      const systemPrompt = `Kamu adalah asisten AI dari ZeroRoute, yang membantu pengguna menavigasi rute dari ${fromLocation.display_name.split(",")[0]} ke ${toLocation.display_name.split(",")[0]} 
menggunakan moda transportasi ${vehicle}. ${routeContext}
Analisis awal yang kamu berikan: ${aiAnalysis}

Jawab pertanyaan pengguna secara terfokus pada rute, keadaan lalu lintas, atau rekomendasi di sekitar lokasi tersebut dalam bahasa Indonesia. Jangan terlalu panjang, berikan jawaban to-the-point dan modern.`;

      const messages = [
        { role: "system", content: systemPrompt }
      ];

      chatMessages.forEach(msg => {
        messages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
      });
      messages.push({ role: "user", content: userMessage });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setChatMessages((prev) => [...prev, { role: "model", content: data.text || "Maaf, saya tidak dapat merespons saat ini." }]);
    } catch (e) {
      console.error("AI Error:", e);
      setChatMessages((prev) => [...prev, { role: "model", content: "Maaf, terjadi kesalahan pada jaringan saya." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const [selectingOnMap, setSelectingOnMap] = useState<"from" | "to" | null>(
    null,
  );

  // Map Style
  const [mapStyleUri, setMapStyleUri] = useState<any>(null);
  const baseStylesRef = useRef<{ dark?: any; osm?: any }>({});
  const [firstSymbolId, setFirstSymbolId] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    const updateStyle = async () => {
      let baseStyle;

      const isDark = mapStyleType === "dark";

      if (mapStyleType === "osm") {
        if (baseStylesRef.current["osm"]) {
          baseStyle = baseStylesRef.current["osm"];
        } else {
          try {
            const res = await fetch("https://tiles.openfreemap.org/styles/liberty");
            baseStyle = await res.json();
            baseStylesRef.current["osm"] = baseStyle;
          } catch (e) {
            console.error("Failed to load openfreemap style", e);
            return;
          }
        }
      } else {
        const styleUrl = isDark
          ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          : "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

        const cacheKey = isDark ? "dark" : "osm"; // using osm cacheKey for voyager previously but let's just use dark

        if (baseStylesRef.current[cacheKey as "dark" | "osm"]) {
          baseStyle = baseStylesRef.current[cacheKey as "dark" | "osm"];
        } else {
          try {
            const res = await fetch(styleUrl);
            baseStyle = await res.json();
            baseStylesRef.current[cacheKey as "dark" | "osm"] = baseStyle;
          } catch (e) {
            console.error("Failed to load base style", e);
            return;
          }
        }
      }

      const style = JSON.parse(JSON.stringify(baseStyle));

      // Find first symbol layer for 3D building placement
      const firstSymbol = style.layers.find((l: any) => l.type === "symbol");
      if (firstSymbol) {
        setFirstSymbolId(firstSymbol.id);
      }

      if (mapStyleType === "realistic") {
        style.sources.satellite = {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          maxzoom: 19,
        };
        style.sources.terrainSource = {
          type: "raster-dem",
          tiles: [
            "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
          ],
          encoding: "terrarium",
          tileSize: 256,
          maxzoom: 14,
        };

        if (is3D) {
          style.terrain = {
            source: "terrainSource",
            exaggeration: debouncedTerrainExaggeration,
          };
        }

        // Filter out fills and backgrounds, BUT KEEP lines (roads) and symbols (labels)
        style.layers = style.layers
          .filter((layer: any) => {
            if (
              layer.type === "fill" ||
              layer.type === "background" ||
              layer.type === "fill-extrusion"
            ) {
              return false;
            }
            return true;
          })
          .map((layer: any) => {
            if (layer.type === "symbol") {
              if (!layer.paint) layer.paint = {};
              layer.paint["text-color"] = "#ffffff";
              layer.paint["text-halo-color"] = "rgba(0, 0, 0, 0.8)";
              layer.paint["text-halo-width"] = 1.5;
              layer.paint["text-halo-blur"] = 0.5;
            } else if (layer.type === "line") {
              // Make roads a bit more transparent in satellite view
              if (!layer.paint) layer.paint = {};
              layer.paint["line-opacity"] = 0.6;
            }
            return layer;
          });

        style.layers.unshift({
          id: "satellite",
          type: "raster",
          source: "satellite",
          minzoom: 0,
          maxzoom: 22,
        });
      }

      setMapStyleUri(style);
    };
    updateStyle();
  }, [mapStyleType, debouncedTerrainExaggeration, is3D]);

  const searchLocation = async (
    query: string,
  ): Promise<LocationSearchResult | null> => {
    if (!query) return null;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      );
      const data = await res.json();
      return data[0] || null;
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  const reverseGeocode = async (lat: number, lon: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      );
      const data = await res.json();
      return data;
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  const handleMapClick = async (e: MapMouseEvent) => {
    if (!selectingOnMap) return;
    const { lng, lat } = e.lngLat;

    const tempName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const tempLocationData: LocationSearchResult = {
      display_name: tempName,
      lat: lat.toString(),
      lon: lng.toString(),
      boundingbox: [],
    };

    if (selectingOnMap === "from") {
      setFromLocation(tempLocationData);
      setFromQuery(tempName);
    } else {
      setToLocation(tempLocationData);
      setToQuery(tempName);
    }

    // Animasi fly-to
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: 16,
      pitch: is3D ? 60 : 0,
      duration: 1500,
    });

    const geoData = await reverseGeocode(lat, lng);
    const displayName =
      geoData?.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    const locationData: LocationSearchResult = {
      display_name: displayName,
      lat: lat.toString(),
      lon: lng.toString(),
      boundingbox: geoData?.boundingbox || [],
    };

    if (selectingOnMap === "from") {
      setFromLocation(locationData);
      setFromQuery(displayName);
    } else {
      setToLocation(locationData);
      setToQuery(displayName);
    }
    setSelectingOnMap(null);
  };

  const performRouting = async (
    fromLoc: LocationSearchResult,
    toLoc: LocationSearchResult,
    selectedVehicle: VehicleType,
  ) => {
    setIsLoading(true);
    setAiAnalysis("");
    setChatMessages([]);
    setRoutes([]);
    setSelectedRouteIndex(0);

    const isDirectRouting = ["train", "ship", "plane"].includes(
      selectedVehicle,
    );
    if (isDirectRouting) {
      setIsLoading(false);
      setAiAnalysis("");
      setRoutes([]);
      alert(`Maaf, rute untuk ${selectedVehicle === 'train' ? 'Kereta' : selectedVehicle === 'plane' ? 'Pesawat' : 'Kapal'} tidak dapat dikalkulasi karena tidak ada jalur yang sesuai. Opsi ini hanya pratinjau mode transportasi.`);
      return;
    }

    const promises = [];

    // OSRM - Free open-source routing machine (using openstreetmap.de to support multiple profiles)
    let profilePath = "routed-car";
    if (selectedVehicle === "cycling") profilePath = "routed-bike";
    if (selectedVehicle === "walking") profilePath = "routed-foot";

    const variant =
      ROUTE_VARIANTS.find((v) => v.id === routeVariant) || ROUTE_VARIANTS[1];

    let waypointStr = "";
    if (variant.offset > 0) {
      const lat1 = parseFloat(fromLoc.lat);
      const lon1 = parseFloat(fromLoc.lon);
      const lat2 = parseFloat(toLoc.lat);
      const lon2 = parseFloat(toLoc.lon);

      const midLat = (lat1 + lat2) / 2;
      const midLon = (lon1 + lon2) / 2;

      const totalDist = getHaversineDistance(lat1, lon1, lat2, lon2);
      const bearing = getBearing(lat1, lon1, lat2, lon2);

      const perpBearing = variant.side === "left" ? bearing - 90 : bearing + 90;
      const wp = getDestinationPoint(
        midLat,
        midLon,
        totalDist * variant.offset,
        perpBearing,
      );
      waypointStr = `;${wp.lon.toFixed(5)},${wp.lat.toFixed(5)}`;
    }

    const osrmUrl = `https://routing.openstreetmap.de/${profilePath}/route/v1/driving/${fromLoc.lon},${fromLoc.lat}${waypointStr};${toLoc.lon},${toLoc.lat}?overview=full&geometries=geojson&alternatives=false&steps=true`;
    promises.push(
      fetch(osrmUrl)
        .then((res) => res.json())
        .catch(() => null),
    );

    try {
      const results = await Promise.all(promises);

      let allRoutes: RouteData[] = [];
      results.forEach((data) => {
        if (data && data.code === "Ok" && data.routes) {
          const modRoutes = data.routes.map((r: any) => {
            if (r.geometry && r.geometry.coordinates) {
              const coords = r.geometry.coordinates;
              const start = [parseFloat(fromLoc.lon), parseFloat(fromLoc.lat)];
              const end = [parseFloat(toLoc.lon), parseFloat(toLoc.lat)];

              if (coords.length > 0) {
                const first = coords[0];
                const last = coords[coords.length - 1];
                if (first[0] !== start[0] || first[1] !== start[1]) {
                  coords.unshift(start);
                }
                if (last[0] !== end[0] || last[1] !== end[1]) {
                  coords.push(end);
                }
              }
            }
            return r;
          });
          allRoutes = [...allRoutes, ...modRoutes];
        }
      });

      if (allRoutes.length > 0) {
        // deduplicate routes roughly by distance
        let uniqueRoutes: RouteData[] = [];
        const seenDistances = new Set();
        allRoutes.forEach((r) => {
          const distStr = r.distance.toFixed(0);
          if (!seenDistances.has(distStr)) {
            seenDistances.add(distStr);
            uniqueRoutes.push(r);
          }
        });

        // Apply traffic simulation
        uniqueRoutes = uniqueRoutes.map((r) =>
          applySimulatedTraffic(r, selectedVehicle),
        );

        setRoutes(uniqueRoutes);
        analyzeWithAI(fromLoc, toLoc, uniqueRoutes, selectedVehicle);
        // Fit bounds for the new route
        fitBounds(uniqueRoutes[0]);
      } else {
        alert("Tidak dapat menemukan rute untuk kendaraan ini.");
      }
    } catch (e) {
      console.error("Routing error:", e);
      alert("Terjadi kesalahan saat mencari rute.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (fromLocation && toLocation) {
      performRouting(fromLocation, toLocation, vehicle);
      if (window.innerWidth < 768) {
        setIsMobilePanelOpen(false);
      }
    }
  }, [vehicle, fromLocation, toLocation]);

  const calculateRoute = async () => {
    if (!fromQuery || !toQuery) return;
    setIsLoading(true);

    let finalFrom = fromLocation;
    let finalTo = toLocation;

    // Automatically geocode if the query doesn't match the current location display name
    if (!finalFrom || fromQuery !== finalFrom.display_name) {
      finalFrom = await searchLocation(fromQuery);
    }
    if (!finalTo || toQuery !== finalTo.display_name) {
      finalTo = await searchLocation(toQuery);
    }

    if (!finalFrom || !finalTo) {
      alert(
        "Lokasi tidak ditemukan. Coba dengan kata kunci yang lebih spesifik.",
      );
      setIsLoading(false);
      return;
    }

    setFromLocation(finalFrom);
    setToLocation(finalTo);

    performRouting(finalFrom, finalTo, vehicle);
  };

  const analyzeWithAI = async (
    from: LocationSearchResult,
    to: LocationSearchResult,
    routesList: RouteData[],
    selectedVehicle: string,
  ) => {
    setIsAiLoading(true);
    setChatMessages([]);
    try {
      const shortestRoute = [...routesList].sort(
        (a, b) => a.distance - b.distance,
      )[0];
      const distanceKm = (shortestRoute.distance / 1000).toFixed(1);
      const durationMin = Math.round(shortestRoute.duration / 60);

      let trafficSummary = "";
      if (shortestRoute.trafficFeatureCollection) {
        let low = 0, mod = 0, heavy = 0, closed = 0;
        const features = shortestRoute.trafficFeatureCollection.features;
        features.forEach((f: any) => {
          if (f.properties.trafficLevel === "closed") closed++;
          else if (f.properties.trafficLevel === "heavy") heavy++;
          else if (f.properties.trafficLevel === "moderate") mod++;
          else low++;
        });
        const total = features.length || 1;
        trafficSummary = `(Lancar: ${Math.round((low/total)*100)}%, Padat: ${Math.round((mod/total)*100)}%, Macet: ${Math.round((heavy/total)*100)}%, Ditutup: ${Math.round((closed/total)*100)}%)`;
      }

      const prompt = `Sebagai asisten AI peta pintar, berikan analisis singkat dan modern dalam bahasa Indonesia tentang rute ini:
      Dari: ${from.display_name.split(",")[0]}
      Ke: ${to.display_name.split(",")[0]}
      Kendaraan: ${selectedVehicle}
      Real-time Traffic: Aktif ${trafficSummary}
      Ditemukan ${routesList.length} alternatif rute.
      Rute terdekat sejauh ${distanceKm} km dengan estimasi waktu ${durationMin} menit (sudah memperhitungkan kemacetan rute).
      Berikan ringkasan yang menarik, mengapa ini rute terbaik, dan berikan satu tips perjalanan terhindar kemacetan/efisien. Sertakan peringatan jika ada jalan yang macet parah atau ditutup. Jangan terlalu panjang.`;

      const messages = [
        { role: "system", content: "Kamu adalah asisten AI peta pintar." },
        { role: "user", content: prompt }
      ];

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setAiAnalysis(data.text || "Analisis siap.");
    } catch (e) {
      console.error("AI Error:", e);
      setAiAnalysis("Maaf, gagal memuat analisis AI.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const fitBounds = (route: RouteData) => {
    if (!mapRef.current) return;
    const coordinates = route.geometry.coordinates;
    if (!coordinates || coordinates.length === 0) return;

    // Check if it's a valid bounding box geometry with enough points or just two points (direct routes)
    if (
      coordinates.length === 2 &&
      coordinates[0][0] === coordinates[1][0] &&
      coordinates[0][1] === coordinates[1][1]
    )
      return;

    // Calculate bounds manually since geojson bounds aren't directly provided by OSRM
    const bounds = coordinates.reduce(
      (acc: maplibregl.LngLatBounds, coord: [number, number]) => {
        return acc.extend(coord as [number, number]);
      },
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );

    mapRef.current.fitBounds(bounds, {
      padding: 50,
      pitch: is3D ? 60 : 0,
      bearing: is3D ? Math.random() * 30 - 15 : 0, // Random slight bearing for cool 3D effect
      duration: 2000,
    });
  };

  // Toggle 3D view
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.flyTo({
        pitch: is3D ? 60 : 0,
        bearing: is3D ? mapRef.current.getBearing() || 20 : 0,
        duration: 1000,
      });
    }
  }, [is3D]);

  // Calculate route when variant changes
  useEffect(() => {
    if (fromLocation && toLocation) {
      calculateRoute();
    }
  }, [routeVariant]);

  const selectedRouteData = routes[selectedRouteIndex];

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 font-sans overflow-hidden relative">
      {/* Map View */}
      <div className="absolute inset-0 z-0">
        {/* Traffic Status Overlay */}
        {selectedRouteData && selectedRouteData.trafficFeatureCollection && (
          <div className="absolute top-12 left-4 md:top-14 md:left-auto md:right-16 z-[20] flex">
            {(() => {
              const features =
                selectedRouteData.trafficFeatureCollection.features;
              if (!features || features.length === 0) return null;

              let low = 0,
                mod = 0,
                heavy = 0,
                closed = 0;
              features.forEach((f: any) => {
                if (f.properties.trafficLevel === "closed") closed++;
                else if (f.properties.trafficLevel === "heavy") heavy++;
                else if (f.properties.trafficLevel === "moderate") mod++;
                else low++;
              });
              const total = features.length;

              if (vehicle !== "driving" && vehicle !== "motorcycle")
                return null;

              return (
                <div className="flex items-center gap-1.5 md:gap-3 px-2 py-1 md:px-3 md:py-1.5 rounded-full border border-slate-700/50 bg-slate-900/80 backdrop-blur-md shadow-lg font-medium text-[9px] md:text-[10px] transition-all hover:bg-slate-800/90 pointer-events-auto">
                  <div className="flex items-center gap-1 md:gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></div>
                    <span className="text-slate-300">
                      Lancar {Math.round((low / total) * 100)}%
                    </span>
                  </div>
                  <div className="w-px h-2.5 md:h-3 bg-slate-700/50"></div>
                  <div className="flex items-center gap-1 md:gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse"></div>
                    <span className="text-slate-300">
                      Padat {Math.round((mod / total) * 100)}%
                    </span>
                  </div>
                  <div className="w-px h-2.5 md:h-3 bg-slate-700/50"></div>
                  <div className="flex items-center gap-1 md:gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse"></div>
                    <span className="text-slate-300">
                      Macet {Math.round((heavy / total) * 100)}%
                    </span>
                  </div>
                  {closed > 0 && (
                    <>
                      <div className="w-px h-2.5 md:h-3 bg-slate-700/50"></div>
                      <div className="flex items-center gap-1 md:gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-500 shadow-[0_0_8px_rgba(100,116,139,0.6)] animate-pulse"></div>
                        <span className="text-slate-300">
                          Ditutup {Math.round((closed / total) * 100)}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Top Controls */}
        <div className="absolute top-6 left-6 z-10 flex gap-2 pointer-events-none md:max-w-md w-[80%]">
          {selectingOnMap && (
            <div className="px-4 py-2 rounded-full border shadow-lg backdrop-blur-md bg-blue-600/90 border-blue-500 text-white text-sm font-medium animate-bounce pointer-events-auto flex items-center gap-2 w-fit">
              <Crosshair className="w-4 h-4 shrink-0" />
              <span>
                Klik peta untuk lokasi{" "}
                {selectingOnMap === "from" ? "awal" : "tujuan"}
              </span>
            </div>
          )}
        </div>


        {/* Global Place Search Mobile */}
        <div className="md:hidden">
          {!isMobileSearchExpanded ? (
            <motion.div
              drag
              dragConstraints={{ top: 16, left: 16, right: window.innerWidth ? window.innerWidth - 64 : 300, bottom: window.innerHeight ? window.innerHeight - 150 : 600 }}
              dragElastic={0.1}
              dragMomentum={false}
              className="fixed top-4 right-4 z-[40] w-12 h-12 bg-indigo-600 rounded-full shadow-2xl shadow-indigo-900/50 flex items-center justify-center cursor-pointer border-2 border-indigo-400/30 active:scale-95 transition-transform"
              onTap={() => setIsMobileSearchExpanded(true)}
            >
              <Search className="w-5 h-5 text-white" />
            </motion.div>
          ) : (
            <div className="fixed top-4 left-4 right-4 z-[40]">
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <Search className="w-4 h-4 text-slate-400" />
                </div>
                <input
                  autoFocus
                  type="text"
                  placeholder="Cari jalan / tempat..."
                  value={placeQuery}
                  onChange={(e) => {
                    setPlaceQuery(e.target.value);
                    setShowPlaceSuggestions(true);
                  }}
                  onFocus={() => setShowPlaceSuggestions(true)}
                  className="w-full bg-slate-900/95 backdrop-blur-md border border-slate-700/50 rounded-full px-4 py-3 pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-white placeholder:text-slate-500 shadow-2xl"
                />
                <button
                  onClick={() => {
                    if (placeQuery) {
                      setPlaceQuery("");
                      setSelectedPlace(null);
                      setShowPlaceSuggestions(false);
                    } else {
                      setIsMobileSearchExpanded(false);
                    }
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Suggestions */}
                {showPlaceSuggestions && placeQuery && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden z-50">
                    {isSearchingPlace ? (
                      <div className="p-4 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Mencari...
                      </div>
                    ) : placeSuggestions.length > 0 ? (
                      <div className="max-h-[250px] overflow-y-auto custom-scrollbar">
                        {placeSuggestions.map((place, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              handleSelectPlace(place);
                              setIsMobileSearchExpanded(false);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-slate-800/50 border-b border-slate-800 last:border-0 transition-colors flex items-start gap-3"
                          >
                            <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-indigo-400 transition-colors" />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-slate-200">
                                {place.display_name.split(",")[0]}
                              </span>
                              <span className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                                {place.display_name}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-sm text-slate-400 border-t border-slate-800">
                        Tidak ditemukan.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {mapStyleUri ? (
          <Map
            ref={mapRef}
            initialViewState={{
              longitude: 106.8272, // Default Jakarta
              latitude: -6.1751,
              zoom: 12,
              pitch: 60,
              bearing: 15,
            }}
            cooperativeGestures={true}
            minZoom={0}
            maxZoom={24}
            cursor={selectingOnMap ? "crosshair" : "grab"}
            onClick={handleMapClick}
            onMove={(e) => {
              setCurrentCenter({
                lat: e.viewState.latitude,
                lng: e.viewState.longitude,
              });
              if (mapRef.current) {
                const map = mapRef.current.getMap();
                if (typeof map.queryTerrainElevation === "function") {
                  const center = map.getCenter();
                  const elev = map.queryTerrainElevation(center);
                  setCurrentElevation(elev !== null ? elev : 0);
                } else {
                  setCurrentElevation(0);
                }
              }
            }}
            onMoveEnd={(e) => {
              if (mapRef.current) {
                const map = mapRef.current.getMap();
                if (typeof map.queryTerrainElevation === "function") {
                  const center = map.getCenter();
                  const elev = map.queryTerrainElevation(center);
                  setCurrentElevation(elev !== null ? elev : 0);
                }
              }
            }}
            onError={(e) => {
              const msg = e.error?.message || e.message || String(e);
              if (
                msg.includes("signal is aborted") ||
                msg.includes("already running") ||
                msg.includes("before non-existing layer") ||
                msg.includes("cannot be removed while layer") ||
                msg.includes("Cannot add layer") ||
                msg.includes("Cannot move layer") ||
                msg.includes("Failed to load image") // suppress missing icon errors
              ) {
                return;
              }
              console.error("Map Error:", msg);
            }}
            mapStyle={mapStyleUri}
            style={{ width: "100%", height: "100%" }}
          >
            {is3D && show3DBuildings && (
              <Source
                id="carto-building-source"
                type="vector"
                url="https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json"
              >
                <Layer
                  id="3d-buildings"
                  source-layer="building"
                  type="fill-extrusion"
                  minzoom={14}
                  beforeId={firstSymbolId}
                  paint={{
                    "fill-extrusion-color":
                      mapStyleType === "dark"
                        ? "#2a2a2a"
                        : mapStyleType === "osm"
                          ? "#f8fafc"
                          : "#e2e8f0",
                    "fill-extrusion-height": [
                      "coalesce",
                      ["get", "render_height"],
                      ["get", "height"],
                      15,
                    ],
                    "fill-extrusion-base": [
                      "coalesce",
                      ["get", "render_min_height"],
                      ["get", "min_height"],
                      0,
                    ],
                    "fill-extrusion-opacity":
                      mapStyleType === "dark"
                        ? 0.6
                        : mapStyleType === "osm"
                          ? 0.4
                          : 0.8,
                  }}
                />
              </Source>
            )}
            <NavigationControl position="top-right" />
            <FullscreenControl position="top-right" />
            <GeolocateControl position="top-right" />

            {/* All Routes (faded) */}
            {routes.map(
              (route, idx) =>
                idx !== selectedRouteIndex && (
                  <Source
                    key={`source-route-${idx}`}
                    type="geojson"
                    data={route.geometry}
                  >
                    <Layer
                      id={`route-line-${idx}`}
                      type="line"
                      layout={{ "line-join": "round", "line-cap": "round" }}
                      paint={{
                        "line-color": "#475569",
                        "line-width": 4,
                        "line-opacity": 0.5,
                      }}
                    />
                  </Source>
                ),
            )}

            {/* Selected Route */}
            {selectedRouteData && (
              <Source
                type="geojson"
                data={
                  selectedRouteData.trafficFeatureCollection ||
                  selectedRouteData.geometry
                }
              >
                <Layer
                  id="selected-route-glow"
                  type="line"
                  layout={{ "line-join": "round", "line-cap": "round" }}
                  paint={{
                    "line-color": selectedRouteData.trafficFeatureCollection
                      ? [
                          "match",
                          ["get", "trafficLevel"],
                          "closed",
                          "#000000",
                          "heavy",
                          "#ef4444",
                          "moderate",
                          "#f59e0b",
                          "#6366f1",
                        ]
                      : "#6366f1",
                    "line-width": 12,
                    "line-blur": 10,
                    "line-opacity": 0.5,
                  }}
                  beforeId={is3D ? "water" : undefined} // Keep below labels
                />
                <Layer
                  id="selected-route-line"
                  type="line"
                  layout={{ "line-join": "round", "line-cap": "round" }}
                  paint={{
                    "line-color": selectedRouteData.trafficFeatureCollection
                      ? [
                          "match",
                          ["get", "trafficLevel"],
                          "closed",
                          "#1e293b",
                          "heavy",
                          "#b91c1c",
                          "moderate",
                          "#d97706",
                          "#818cf8",
                        ]
                      : "#818cf8",
                    "line-width": 4,
                  }}
                />
              </Source>
            )}

            {/* Start and End Markers */}
            {fromLocation && (
              <Marker
                longitude={parseFloat(fromLocation.lon)}
                latitude={parseFloat(fromLocation.lat)}
                anchor="bottom"
              >
                <div className="relative group">
                  <div className="absolute -inset-1 bg-blue-500 rounded-full blur opacity-40 group-hover:opacity-100 transition duration-200"></div>
                  <div className="relative flex items-center justify-center w-8 h-8 bg-blue-600 rounded-full shadow-lg border-2 border-white animate-bounce-short">
                    <MapPin className="w-4 h-4 text-white" />
                  </div>
                </div>
              </Marker>
            )}

            {toLocation && (
              <Marker
                longitude={parseFloat(toLocation.lon)}
                latitude={parseFloat(toLocation.lat)}
                anchor="bottom"
              >
                <div className="relative group">
                  <div className="absolute -inset-1 bg-indigo-500 rounded-full blur opacity-40 group-hover:opacity-100 transition duration-200"></div>
                  <div className="relative flex items-center justify-center w-8 h-8 bg-indigo-600 rounded-full shadow-lg border-2 border-white animate-bounce-short">
                    <MapPin className="w-4 h-4 text-white" />
                  </div>
                </div>
              </Marker>
            )}

            {/* Selected Place Marker & Popup */}
            {selectedPlace && (
              <>
                <Popup
                  longitude={parseFloat(selectedPlace.lon)}
                  latitude={parseFloat(selectedPlace.lat)}
                  closeButton={false}
                  closeOnClick={false}
                  anchor="bottom"
                  offset={15}
                >
                  <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl min-w-[200px] max-w-[250px] shadow-2xl relative mt-2 -m-2">
                    <h3 className="font-semibold text-slate-200 text-sm mb-1 pr-5">
                      {selectedPlace.display_name.split(",")[0]}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-2 mb-2 pr-5">
                      {selectedPlace.display_name}
                    </p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${selectedPlace.lat}, ${selectedPlace.lon}`);
                        alert("Koordinat disalin!");
                      }}
                      className="text-[10px] text-blue-400 hover:text-blue-300 font-mono mb-3 block w-full text-left bg-slate-800/50 hover:bg-slate-800 p-1.5 rounded"
                    >
                      {parseFloat(selectedPlace.lat).toFixed(5)}, {parseFloat(selectedPlace.lon).toFixed(5)}
                    </button>

                    <button
                      onClick={() => setSelectedPlace(null)}
                      className="absolute top-2 right-2 p-1 text-slate-500 hover:text-white bg-slate-800/80 rounded-md"
                    >
                      <X className="w-3 h-3" />
                    </button>

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          savePlace(selectedPlace);
                          setSelectedPlace(null);
                        }}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-900/50"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Simpan
                      </button>
                    </div>
                  </div>
                </Popup>

                <Marker
                  longitude={parseFloat(selectedPlace.lon)}
                  latitude={parseFloat(selectedPlace.lat)}
                  anchor="center"
                >
                  <div
                    className="relative group cursor-pointer"
                    onClick={() => {
                      // Clicking marker flies to it again
                      mapRef.current?.flyTo({
                        center: [
                          parseFloat(selectedPlace.lon),
                          parseFloat(selectedPlace.lat),
                        ],
                        zoom: 16,
                      });
                    }}
                  >
                    <div className="absolute -inset-1 bg-green-500 rounded-full blur opacity-40 group-hover:opacity-100 transition duration-200"></div>
                    <div className="relative flex items-center justify-center w-8 h-8 bg-green-600 rounded-full shadow-lg border-2 border-white animate-bounce-short">
                      <MapPin className="w-4 h-4 text-white" />
                    </div>
                  </div>
                </Marker>
              </>
            )}
          </Map>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10 w-full h-full">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-slate-400 text-sm font-medium animate-pulse">
                Memuat Peta...
              </p>
            </div>
          </div>
        )}

        {/* LngLat Display */}
        <div className="absolute top-4 left-4 md:top-4 md:left-auto md:right-16 z-10 px-2 py-1 md:px-3 md:py-1.5 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700/50 shadow-lg pointer-events-none flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-mono text-slate-300">
          <span className="text-slate-500">Lng:</span>{" "}
          {currentCenter.lng.toFixed(5)}
          <div className="w-px h-3 bg-slate-700 mx-1" />
          <span className="text-slate-500">Lat:</span>{" "}
          {currentCenter.lat.toFixed(5)}
        </div>
      </div>

      {/* Sidebar Panel */}
      <div
        className={`absolute bottom-0 left-0 right-0 md:relative md:w-[400px] flex-shrink-0 bg-slate-950/90 backdrop-blur-3xl md:bg-slate-950 border-t md:border-t-0 md:border-r border-slate-800 flex flex-col shadow-[0_-20px_40px_rgba(0,0,0,0.7)] md:shadow-2xl z-20 transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] rounded-t-3xl md:rounded-none
        ${isMobilePanelOpen ? "h-[85vh]" : "h-[35vh] md:h-full"}`}
      >
        {/* Mobile Drag Handle */}
        <div
          className="w-full flex justify-center py-4 md:hidden cursor-pointer"
          onClick={() => setIsMobilePanelOpen(!isMobilePanelOpen)}
        >
          <div className="w-12 h-1.5 bg-slate-700 rounded-full" />
        </div>

        {/* Header - Hidden on mobile if not open to save space */}
        <div
          className={`p-4 md:p-6 pb-2 md:pb-4 border-b border-white/5 bg-gradient-to-b from-blue-950/40 to-transparent ${!isMobilePanelOpen ? "hidden md:block" : ""}`}
        >
          <div className="flex items-center justify-between mb-1 md:mb-2">
            <div className="flex items-center gap-3 text-blue-400">
              <MapIcon className="w-6 h-6 md:w-8 md:h-8" />
              <h1 className="text-xl md:text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
                ZeroRoute
              </h1>
            </div>
            <button
              onClick={() => setShowSavedRoutes(!showSavedRoutes)}
              className={`p-2 rounded-lg transition-colors border ${
                showSavedRoutes
                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-400"
                  : "bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 border-slate-700/50"
              }`}
              title="Rute Tersimpan (Offline)"
            >
              <FolderOpen className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Input Controls */}
        <div className="px-4 py-2 md:p-6 flex flex-col gap-4 overflow-y-auto custom-scrollbar overflow-x-hidden relative h-full">
          {/* Global Place Search - Unified for Desktop */}
          <div className="hidden md:block w-full">
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <Search className="w-4 h-4 text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="Cari jalan / tempat..."
                value={placeQuery}
                onChange={(e) => {
                  setPlaceQuery(e.target.value);
                  setShowPlaceSuggestions(true);
                }}
                onFocus={() => setShowPlaceSuggestions(true)}
                className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-700/50 rounded-xl px-4 py-3 pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-white placeholder:text-slate-500 shadow-sm"
              />
              {placeQuery && (
                <button
                  onClick={() => {
                    setPlaceQuery("");
                    setSelectedPlace(null);
                    setShowPlaceSuggestions(false);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {/* Suggestions */}
              {showPlaceSuggestions && placeQuery && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-xl shadow-xl overflow-hidden z-50">
                  {isSearchingPlace ? (
                    <div className="p-4 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Mencari...
                    </div>
                  ) : placeSuggestions.length > 0 ? (
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      {placeSuggestions.map((place, i) => (
                        <button
                          key={i}
                          onClick={() => handleSelectPlace(place)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-800/50 border-b border-slate-800 last:border-0 transition-colors flex items-start gap-3 group"
                        >
                          <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-slate-500 group-hover:text-blue-400 transition-colors" />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-slate-200">
                              {place.display_name.split(",")[0]}
                            </span>
                            <span className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                              {place.display_name}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-slate-400 border-t border-slate-800">
                      Tidak ditemukan.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Quick Toggle Maps (Desktop & Mobile) */}
          <div className="flex items-center justify-between gap-2 -mt-1 md:-mt-2 mb-2 border-b border-slate-800 pb-3 flex-wrap">
            <button
              onClick={() => setIs3D(!is3D)}
              className={`flex-1 min-w-[22%] flex justify-center items-center gap-1.5 px-2 py-2 rounded-lg border text-[11px] font-medium transition-all
                ${is3D ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-400" : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"}`}
            >
              <Layers className="w-3.5 h-3.5" />
              3D View
            </button>
            <button
              onClick={() =>
                setMapStyleType(mapStyleType === "dark" ? "osm" : "dark")
              }
              className={`flex-1 min-w-[22%] flex justify-center items-center gap-1.5 px-2 py-2 rounded-lg border text-[11px] font-medium transition-all
                ${mapStyleType === "osm" ? "bg-blue-600/20 border-blue-500/50 text-blue-400" : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"}`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Detail
            </button>
            <button
              onClick={() =>
                setMapStyleType(
                  mapStyleType === "realistic" ? "dark" : "realistic",
                )
              }
              className={`flex-1 min-w-[22%] flex justify-center items-center gap-1.5 px-2 py-2 rounded-lg border text-[11px] font-medium transition-all
                ${mapStyleType === "realistic" ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-400" : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"}`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Satelit
            </button>
            <button
              onClick={enterImmersiveMode}
              className={`flex-1 min-w-[22%] flex justify-center items-center gap-1.5 px-2 py-2 rounded-lg border text-[11px] font-medium transition-all bg-sky-600/20 border-sky-500/50 text-sky-400 hover:bg-sky-600/30`}
            >
              <Eye className="w-3.5 h-3.5" />
              Cam on
            </button>
          </div>

          {/* 3D Buildings Toggle */}
          {is3D && (
            <div className="mb-2 -mt-1">
              <button
                onClick={() => setShow3DBuildings(!show3DBuildings)}
                className={`w-full flex justify-center items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] font-medium transition-all
                  ${show3DBuildings ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-400" : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"}`}
              >
                <Building2 className="w-3.5 h-3.5" />
                {show3DBuildings ? "Tutup 3D" : "Bangunan 3D"}
              </button>
            </div>
          )}

          {/* Elevation Slider when 3D */}
          {is3D && (
            <div className="px-4 py-3 -mt-2 mb-2 rounded-xl border border-slate-700 bg-slate-800/50 flex flex-col gap-2 w-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mountain className="w-4 h-4 text-emerald-400" />
                  <span className="text-[11px] text-slate-300 font-medium">Elevasi 3D</span>
                </div>
                <div className="text-right flex items-center">
                  <span className="text-[11px] text-emerald-400 font-mono">
                    x{(terrainExaggeration)}
                  </span>
                  {currentElevation !== null && (
                    <div className="ml-2 text-[10px] text-slate-400 font-mono inline-block border-l border-slate-600 pl-2">
                      {currentElevation >= 0 ? (
                        <span className="text-blue-300 font-semibold">{currentElevation.toFixed(0)}m (Ketinggian)</span>
                      ) : (
                        <span className="text-red-400 font-semibold">{Math.abs(currentElevation).toFixed(0)}m (Kedalaman)</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={terrainExaggeration}
                onChange={(e) =>
                  setTerrainExaggeration(parseFloat(e.target.value))
                }
                className="w-full accent-emerald-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer outline-none"
              />
            </div>
          )}

          {/* Location Inputs or Saved Routes */}
          {showSavedRoutes ? (
            <div className="flex flex-col gap-3 h-full overflow-hidden">
              <div className="flex gap-2 p-1 bg-slate-900 border border-slate-700/50 rounded-lg">
                <button
                  onClick={() => setSavedRecordsTab("routes")}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${savedRecordsTab === "routes" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Rute ({savedRoutes.length})
                </button>
                <button
                  onClick={() => setSavedRecordsTab("places")}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${savedRecordsTab === "places" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Tempat ({savedPlaces.length})
                </button>
              </div>

              {savedRecordsTab === "routes" ? (
                <div className="flex flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar">
                  {savedRoutes.length === 0 ? (
                    <div className="text-center py-10 bg-slate-900/50 rounded-xl border border-slate-800/50">
                      <WifiOff className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                      <p className="text-slate-400 text-sm">
                        Belum ada rute offline.
                      </p>
                      <p className="text-slate-500 text-xs mt-1">
                        Cari rute lalu simpan untuk diakses tanpa internet.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {savedRoutes.map((savedRoute) => (
                        <div
                          key={savedRoute.id}
                          className="bg-slate-900/80 rounded-xl border border-slate-700/50 hover:border-indigo-500/50 transition-all p-4 cursor-pointer group"
                          onClick={() => loadSavedRoute(savedRoute)}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex flex-col gap-1.5 flex-1 pr-3 truncate">
                              <div className="flex items-center gap-2 text-sm text-slate-200 font-medium">
                                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                                <span className="truncate">
                                  {savedRoute.from.display_name.split(",")[0]}
                                </span>
                              </div>
                              <div className="w-0.5 h-3 bg-slate-700 ml-1 rounded-full shrink-0" />
                              <div className="flex items-center gap-2 text-sm text-slate-200 font-medium">
                                <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                                <span className="truncate">
                                  {savedRoute.to.display_name.split(",")[0]}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) =>
                                removeSavedRoute(savedRoute.id, e)
                              }
                              className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors md:opacity-0 md:group-hover:opacity-100 shrink-0"
                              title="Hapus rute"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
                            <span className="flex items-center gap-1.5 bg-slate-800/50 px-2 py-1 rounded-md uppercase">
                              <Car className="w-3.5 h-3.5" />{" "}
                              {savedRoute.vehicle}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              {new Date(
                                savedRoute.timestamp,
                              ).toLocaleDateString("id-ID")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar">
                  {savedPlaces.length === 0 ? (
                    <div className="text-center py-10 bg-slate-900/50 rounded-xl border border-slate-800/50">
                      <FolderOpen className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                      <p className="text-slate-400 text-sm">
                        Belum ada tempat tersimpan.
                      </p>
                      <p className="text-slate-500 text-xs mt-1">
                        Cari tempat di peta dan simpan.
                      </p>
                    </div>
                  ) : (
                    savedPlaces.map((place) => (
                      <div
                        key={place.id}
                        className="bg-slate-900/80 rounded-xl border border-slate-700/50 hover:border-indigo-500/50 transition-all p-3 cursor-pointer group"
                        onClick={() => handleSelectPlace(place.location)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex flex-col gap-1 pr-3 truncate">
                            <span className="text-sm font-semibold text-slate-200 truncate">
                              {place.location.display_name.split(",")[0]}
                            </span>
                            <span className="text-xs text-slate-400 truncate">
                              {place.location.display_name}
                            </span>
                          </div>
                          <button
                            onClick={(e) => removeSavedPlace(place.id, e)}
                            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors md:opacity-0 md:group-hover:opacity-100 shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Location Inputs */}
              <div className="flex flex-col gap-3 relative">
                <div className="absolute left-[15px] top-[24px] bottom-[24px] w-0.5 bg-slate-800 rounded z-0" />

                <div className="flex gap-2">
                  <div className="relative z-50 flex-1">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500 border border-slate-950" />
                    <input
                      type="text"
                      placeholder="Titik Awal (Misal: Monas)"
                      className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-4 py-3 pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-slate-500"
                      value={fromQuery}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFromQuery(val);
                        if (val === "") {
                          setFromLocation(null);
                          setRoutes([]);
                          setAiAnalysis("");
                        }
                        setShowFromSuggestions(true);
                      }}
                      onFocus={() => {
                        setIsMobilePanelOpen(true);
                        setShowFromSuggestions(true);
                      }}
                      onBlur={() =>
                        setTimeout(() => setShowFromSuggestions(false), 250)
                      }
                    />
                    {fromQuery && (
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault(); // Prevents input blur
                          setFromQuery("");
                          setFromLocation(null);
                          setRoutes([]);
                          setAiAnalysis("");
                          setShowFromSuggestions(false);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    {showFromSuggestions &&
                      (fromSuggestions.length > 0 || isSearchingFrom) && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-xl z-50 max-h-[40vh] overflow-y-auto">
                          {isSearchingFrom ? (
                            <div className="p-3 text-xs text-slate-400 text-center flex items-center justify-center gap-2">
                              <Loader2 className="w-3 h-3 animate-spin" />{" "}
                              Mencari lokasi...
                            </div>
                          ) : (
                            fromSuggestions.map((s, i) => (
                              <button
                                key={i}
                                className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors border-b last:border-b-0 border-slate-800/50 flex flex-col gap-0.5"
                                onClick={() => {
                                  setFromQuery(s.display_name);
                                  setFromLocation(s);
                                  setShowFromSuggestions(false);
                                }}
                              >
                                <span className="font-medium truncate text-slate-200">
                                  {s.display_name.split(",")[0]}
                                </span>
                                <span className="truncate text-[10px] text-slate-500">
                                  {s.display_name.split(",").slice(1).join(",")}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                  </div>
                  <button
                    onClick={() => {
                      setSelectingOnMap(
                        selectingOnMap === "from" ? null : "from",
                      );
                      setIsMobilePanelOpen(false); // Close panel to pick
                    }}
                    className={`p-3 rounded-xl border transition-all relative z-10 ${
                      selectingOnMap === "from"
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                    }`}
                    title="Pilih titik awal di peta"
                  >
                    {selectingOnMap === "from" ? (
                      <Crosshair className="w-5 h-5 animate-pulse" />
                    ) : (
                      <MapPin className="w-5 h-5" />
                    )}
                  </button>
                </div>

                <div className="flex gap-2">
                  <div className="relative z-40 flex-1">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-indigo-500 border border-slate-950" />
                    <input
                      type="text"
                      placeholder="Tujuan (Misal: Ancol)"
                      className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-4 py-3 pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-slate-500"
                      value={toQuery}
                      onChange={(e) => {
                        const val = e.target.value;
                        setToQuery(val);
                        if (val === "") {
                          setToLocation(null);
                          setRoutes([]);
                          setAiAnalysis("");
                        }
                        setShowToSuggestions(true);
                      }}
                      onFocus={() => {
                        setIsMobilePanelOpen(true);
                        setShowToSuggestions(true);
                      }}
                      onBlur={() =>
                        setTimeout(() => setShowToSuggestions(false), 250)
                      }
                    />
                    {toQuery && (
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault(); // Prevents input blur
                          setToQuery("");
                          setToLocation(null);
                          setRoutes([]);
                          setAiAnalysis("");
                          setShowToSuggestions(false);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    {showToSuggestions &&
                      (toSuggestions.length > 0 || isSearchingTo) && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-xl z-50 max-h-[40vh] overflow-y-auto">
                          {isSearchingTo ? (
                            <div className="p-3 text-xs text-slate-400 text-center flex items-center justify-center gap-2">
                              <Loader2 className="w-3 h-3 animate-spin" />{" "}
                              Mencari lokasi...
                            </div>
                          ) : (
                            toSuggestions.map((s, i) => (
                              <button
                                key={i}
                                className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors border-b last:border-b-0 border-slate-800/50 flex flex-col gap-0.5"
                                onClick={() => {
                                  setToQuery(s.display_name);
                                  setToLocation(s);
                                  setShowToSuggestions(false);
                                }}
                              >
                                <span className="font-medium truncate text-slate-200">
                                  {s.display_name.split(",")[0]}
                                </span>
                                <span className="truncate text-[10px] text-slate-500">
                                  {s.display_name.split(",").slice(1).join(",")}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                  </div>
                  <button
                    onClick={() => {
                      setSelectingOnMap(selectingOnMap === "to" ? null : "to");
                      setIsMobilePanelOpen(false); // Close panel to pick
                    }}
                    className={`p-3 rounded-xl border transition-all relative z-10 ${
                      selectingOnMap === "to"
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                    }`}
                    title="Pilih tujuan di peta"
                  >
                    {selectingOnMap === "to" ? (
                      <Crosshair className="w-5 h-5 animate-pulse" />
                    ) : (
                      <MapPin className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Vehicle Selection - Scrollable */}
              <div>
                <style>{`
                  .custom-x-scroll::-webkit-scrollbar { height: 4px; }
                  .custom-x-scroll::-webkit-scrollbar-track { background: transparent; }
                  .custom-x-scroll::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
                  .custom-x-scroll::-webkit-scrollbar-thumb:hover { background: #64748b; }
                `}</style>
                <div 
                  className="flex bg-slate-900 p-1.5 rounded-xl border border-slate-800 overflow-x-auto snap-x custom-x-scroll"
                >
                  {VECHICLES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setVehicle(v.id)}
                      title={v.label}
                      className={`min-w-[70px] shrink-0 flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-lg text-[10px] sm:text-xs font-medium transition-all snap-center ${vehicle === v.id ? "bg-slate-800 text-blue-400 shadow-sm border border-slate-700/50" : "text-slate-500 hover:text-slate-300 border border-transparent"}`}
                    >
                      <v.icon
                        className={`w-5 h-5 ${vehicle === v.id ? "opacity-100" : "opacity-60"}`}
                      />
                      <span>{v.label}</span>
                    </button>
                  ))}
                </div>
                {vehicle === "driving" && (
                  <div className="mt-2 flex">
                    <span className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full flex items-center gap-1.5 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />{" "}
                      Free OSRM Routing
                    </span>
                  </div>
                )}
              </div>

              {/* AI Analysis Section */}
              {(isAiLoading || aiAnalysis) && (
                <div className="bg-gradient-to-br from-indigo-900/20 to-purple-900/10 border border-indigo-500/20 rounded-xl p-4 md:p-5 relative overflow-hidden group shrink-0">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150 duration-700 pointer-events-none" />
                  <div className="flex items-center gap-2 mb-2 text-indigo-300">
                    <Sparkles className="w-4 h-4 md:w-5 md:h-5" />
                    <h3 className="font-semibold text-xs md:text-sm">
                      Analisis AI Cerdas
                    </h3>
                  </div>
                  <div className="text-xs md:text-sm text-indigo-100/80 leading-relaxed relative z-10">
                    {isAiLoading ? (
                      <div className="flex items-center gap-2 text-indigo-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Memproses data rute terkini...
                      </div>
                    ) : (
                      <div className="text-xs md:text-[13px] text-indigo-100 flex flex-col gap-2">
                        <Markdown>{aiAnalysis}</Markdown>
                      </div>
                    )}
                  </div>

                  {/* Chat UI */}
                  {aiAnalysis && !isAiLoading && (
                    <div className="mt-4 pt-4 border-t border-indigo-500/20 flex flex-col gap-3 relative z-10">
                      
                      {chatMessages.length > 0 && (
                        <div 
                          ref={chatScrollRef}
                          className="flex flex-col gap-3 max-h-[180px] overflow-y-auto custom-scrollbar pr-1"
                        >
                          {chatMessages.map((msg, i) => (
                            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                              <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${msg.role === "user" ? "bg-indigo-600" : "bg-blue-600"}`}>
                                {msg.role === "user" ? <User className="w-3.5 h-3.5 text-white" /> : <Bot className="w-3.5 h-3.5 text-white" />}
                              </div>
                              <div className={`text-xs md:text-[13px] px-3 py-2 rounded-xl max-w-[85%] ${msg.role === "user" ? "bg-indigo-600 text-white" : "bg-indigo-900/50 text-indigo-100"}`}>
                                {msg.role === "user" ? (
                                  msg.content
                                ) : (
                                  <Markdown>{msg.content}</Markdown>
                                )}
                              </div>
                            </div>
                          ))}
                          {isChatLoading && (
                            <div className="flex gap-2 mr-auto">
                              <div className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center bg-blue-600">
                                <Bot className="w-3.5 h-3.5 text-white" />
                              </div>
                              <div className="text-xs px-3 py-2 rounded-xl bg-indigo-900/50 text-indigo-100 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{animationDelay: "150ms"}}></span>
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{animationDelay: "300ms"}}></span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="relative">
                        <input 
                          type="text" 
                          placeholder="Tanya soal rute ini..."
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSendChat();
                          }}
                          className="w-full bg-indigo-950/40 border border-indigo-500/30 rounded-lg px-3 py-2.5 pr-10 text-xs text-indigo-100 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 placeholder:text-indigo-400/50"
                        />
                        <button
                          onClick={handleSendChat}
                          disabled={isChatLoading || !chatInput.trim()}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:bg-indigo-800 rounded-md transition-colors text-white"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Route Options */}
              {routes.length > 0 && (
                <div className="mt-2 pb-6 md:pb-2">
                  <div className="flex items-center justify-between mb-3 text-sm">
                    <div className="flex items-center gap-2">
                      <label className="font-semibold text-slate-300 flex items-center gap-2 text-xs md:text-sm">
                        <List className="w-4 h-4 text-slate-500" />
                        Rute Terpilih
                      </label>
                      <button
                        onClick={saveCurrentRouteToOffline}
                        className="p-1 px-2 rounded-md bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/40 text-xs font-medium flex items-center gap-1.5 transition-colors border border-indigo-500/30"
                        title="Simpan untuk Offline"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Simpan
                      </button>
                    </div>
                    <select
                      value={routeVariant}
                      onChange={(e) => {
                        setRouteVariant(e.target.value);
                      }}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none"
                    >
                      {ROUTE_VARIANTS.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-2">
                    {routes.map((route, i) => {
                      const originalIndex = i;
                      return (
                        <button
                          key={i}
                          onClick={() => {
                            setSelectedRouteIndex(originalIndex);
                            fitBounds(route);
                            setIsMobilePanelOpen(false);
                          }}
                          className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${originalIndex === selectedRouteIndex ? "bg-blue-600/10 border-blue-500/50 text-blue-300" : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-800"}`}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-[13px] md:text-sm">
                              Rute {i + 1}{" "}
                              {routeVariant === "super_dekat" && i === 0
                                ? "(Terbaik)"
                                : ""}
                            </span>
                            <span className="text-xs opacity-70">
                              {(route.distance / 1000).toFixed(1)} km &bull;{" "}
                              {Math.round(route.duration / 60)} mnt
                              {route.originalDuration &&
                                route.originalDuration !== route.duration && (
                                  <span className="text-amber-400 font-medium ml-1">
                                    (+
                                    {Math.max(
                                      1,
                                      Math.round(
                                        (route.duration -
                                          route.originalDuration) /
                                          60,
                                      ),
                                    )}{" "}
                                    mnt macet)
                                  </span>
                                )}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Turn by turn directions */}
                  {selectedRouteData?.legs &&
                    selectedRouteData.legs[0]?.steps && (
                      <div className="mt-4 border-t border-slate-800 pt-4">
                        <h4 className="text-xs md:text-sm font-semibold text-slate-300 flex items-center gap-2 mb-3">
                          <Navigation2 className="w-4 h-4 text-blue-400" />
                          Arah Perjalanan (Step-by-step)
                        </h4>
                        <div className="flex flex-col gap-3 pr-2 pb-6">
                          {selectedRouteData.legs[0].steps.map((step, idx) => {
                            // skip empty destination steps
                            if (
                              step.distance === 0 &&
                              step.maneuver.type === "arrive"
                            )
                              return null;
                            return (
                              <div
                                key={idx}
                                className="flex gap-3 items-start text-xs md:text-sm text-slate-400 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/50"
                              >
                                <div className="min-w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 shrink-0 shadow-inner text-[10px] md:text-xs">
                                  {idx + 1}
                                </div>
                                <div className="flex w-full flex-col">
                                  <span className="text-slate-300 font-medium leading-relaxed">
                                    {getInstruction(step)}
                                  </span>
                                  {step.distance > 0 && (
                                    <span className="text-slate-500 font-mono mt-1 text-[10px] md:text-xs">
                                      {step.distance.toFixed(0)} meter
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
