export interface MapDef {
  id: string;
  name: string;
  src: string;
}

export const MAPS: MapDef[] = [
  { id: 'cozy', name: 'Cozy', src: '/sprites/maps/Cozy.png' },
  { id: 'cyberpunk', name: 'Cyberpunk', src: '/sprites/maps/Cyberpunk.png' },
  { id: 'lofi', name: 'Lofi', src: '/sprites/maps/Lofi.png' },
  { id: 'station', name: 'Station', src: '/sprites/maps/Station.png' },
  { id: 'tatami', name: 'Tatami', src: '/sprites/maps/Tatami.png' },
  { id: 'wizard', name: 'Wizard', src: '/sprites/maps/Wizard.png' },
];

export function getMapById(id: string): MapDef | undefined {
  return MAPS.find((m) => m.id === id);
}
