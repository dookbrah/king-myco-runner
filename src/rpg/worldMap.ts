import { PlayerWorldState, RegionDefinition } from "../types";

export const REGION_CATALOG: RegionDefinition[] = [
  {
    id: "mycelial-hollow",
    name: "Mycelial Hollow",
    biome: "grove",
    threatLevel: 2,
    description: "A living fungal basin where initiates learn lane discipline.",
    recommendedElements: ["fire", "water"],
    connectedRegionIds: ["sporefall-wetlands", "ember-ruins"],
  },
  {
    id: "sporefall-wetlands",
    name: "Sporefall Wetlands",
    biome: "wetlands",
    threatLevel: 3,
    description: "Tidal fungus fields with shifting terrain and swarm pressure.",
    recommendedElements: ["water", "nature"],
    connectedRegionIds: ["mycelial-hollow", "icebound-caverns"],
  },
  {
    id: "ember-ruins",
    name: "Ember Ruins",
    biome: "ruins",
    threatLevel: 4,
    description: "Collapsed arcane towers where elite interceptors regroup.",
    recommendedElements: ["fire", "ice"],
    connectedRegionIds: ["mycelial-hollow", "voidglass-sanctum"],
  },
  {
    id: "icebound-caverns",
    name: "Icebound Caverns",
    biome: "cavern",
    threatLevel: 5,
    description: "Crystal tunnels that amplify projectile storms and precision checks.",
    recommendedElements: ["ice", "water"],
    connectedRegionIds: ["sporefall-wetlands", "voidglass-sanctum"],
  },
  {
    id: "voidglass-sanctum",
    name: "Voidglass Sanctum",
    biome: "void",
    threatLevel: 7,
    description: "A fractured rift citadel where boss lanes become lethal rituals.",
    recommendedElements: ["void", "ice"],
    connectedRegionIds: ["ember-ruins", "icebound-caverns"],
  },
];

export const START_REGION_ID = "mycelial-hollow";

const unique = (values: string[]): string[] => Array.from(new Set(values));

export const getRegionById = (regionId: string): RegionDefinition | undefined => {
  return REGION_CATALOG.find((region) => region.id === regionId);
};

export const createInitialWorldState = (): PlayerWorldState => ({
  currentRegionId: START_REGION_ID,
  discoveredRegionIds: [START_REGION_ID],
  conqueredRegionIds: [],
  travelHistory: [],
});

export const normalizeWorldState = (
  state: Partial<PlayerWorldState> | undefined,
): PlayerWorldState => {
  const base = createInitialWorldState();
  const currentRegionId = state?.currentRegionId ?? base.currentRegionId;
  const currentRegion = getRegionById(currentRegionId);
  const safeCurrentRegionId = currentRegion?.id ?? base.currentRegionId;

  return {
    currentRegionId: safeCurrentRegionId,
    discoveredRegionIds: unique([
      safeCurrentRegionId,
      ...(state?.discoveredRegionIds ?? base.discoveredRegionIds),
    ]),
    conqueredRegionIds: unique([...(state?.conqueredRegionIds ?? [])]),
    travelHistory: [...(state?.travelHistory ?? [])].slice(-40),
  };
};

export const travelToRegion = (
  world: PlayerWorldState,
  destinationRegionId: string,
): PlayerWorldState => {
  const currentRegion = getRegionById(world.currentRegionId);
  const destination = getRegionById(destinationRegionId);

  if (!currentRegion || !destination) {
    throw new Error("Unknown region id for travel request");
  }

  if (!currentRegion.connectedRegionIds.includes(destination.id)) {
    throw new Error(
      `Region ${destination.id} is not connected to ${currentRegion.id}`,
    );
  }

  const traveledAt = new Date().toISOString();
  const travelEntry = `${traveledAt}:${currentRegion.id}->${destination.id}`;

  return normalizeWorldState({
    ...world,
    currentRegionId: destination.id,
    discoveredRegionIds: [...world.discoveredRegionIds, destination.id],
    travelHistory: [...world.travelHistory, travelEntry],
  });
};
